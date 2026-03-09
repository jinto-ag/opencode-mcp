import { expect, test, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { OMOConfigManager } from "../src/orchestrator/config.js";
import { ResilienceEngine } from "../src/orchestrator/resilience.js";
import { OMOOrchestrator } from "../src/orchestrator/omo.js";
import { OMO_PERSONAS } from "../src/agents/personas.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const mockServer = setupServer();

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe("OMO Orchestration Logic", () => {
  let configManager: OMOConfigManager;
  let client: any;
  let resilience: ResilienceEngine;
  let orchestrator: OMOOrchestrator;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omo-test-"));
    configManager = new OMOConfigManager(tempDir);
    await configManager.init();
    await configManager.update({ maxRetries: 1 });
    client = createOpencodeClient({ baseUrl: "http://localhost:4096" });
    resilience = new ResilienceEngine(client, configManager);
    orchestrator = new OMOOrchestrator(client, configManager);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("ResilienceEngine", () => {
    test("should retry on 429 and eventually succeed", async () => {
      let attempts = 0;
      mockServer.use(
        http.post("*/session", () => {
          attempts++;
          if (attempts < 2) {
            return HttpResponse.json({ error: "rate limit" }, { status: 429 });
          }
          return HttpResponse.json({ id: "sess-123" });
        })
      );

      const result = await resilience.executeWithResilience(async (c, model) => {
        const res = await c.session.create({ body: { title: "test" }, throwOnError: true });
        return res.data;
      });

      expect(attempts).toBe(2);
      expect((result as any).id).toBe("sess-123");
    });

    test("should rotate to fallback model on 429 exhaustion", async () => {
      let modelsTried: string[] = [];
      mockServer.use(
        http.post("*/session", async () => {
          return HttpResponse.json({ error: "too many requests" }, { status: 429 });
        })
      );

      // This should exhaust all retries for all models in the fallback chain
      try {
        await resilience.executeWithResilience(async (c, model) => {
          modelsTried.push(model);
          await c.session.create({ body: { title: "test" }, throwOnError: true });
        });
        expect(false).toBe(true); // Should not reach here
      } catch (error: any) {
        expect(modelsTried.length).toBeGreaterThan(1);
        expect(modelsTried).toContain("opencode/big-pickle");
        expect(modelsTried).toContain("gpt-4o");
      }
    }, 30000); // Resilience tests with retries can take time
  });

  describe("OMOOrchestrator", () => {
    test("one-step agent task should work", async () => {
      mockServer.use(
        http.post("*/session", () => HttpResponse.json({ data: { id: "sess-1" } })),
        http.post("*/session/:id/prompt_async", () => HttpResponse.json({ data: { id: "p-1" } })),
        http.get("*/session/status", () => HttpResponse.json({ data: { "sess-1": { type: "stopped" } } })),
        http.get("*/session/:id/message", () => HttpResponse.json({ data: [
          { parts: [{ type: "text", text: "Task completed successfully." }] }
        ] }))
      );

      const result = await orchestrator.runAgentTask("test task", OMO_PERSONAS.hephaestus!);
      expect(result.content).toContain("Task completed successfully");
      expect(result.sessionId).toBe("sess-1");
    });

    test("Sisyphus loop should handle verification failure and correction", async () => {
      let iteration = 0;
      mockServer.use(
        http.post("*/session", () => HttpResponse.json({ data: { id: "sess-sisyphus" } })),
        http.post("*/session/:id/prompt_async", () => HttpResponse.json({ data: { id: "p-1" } })),
        http.get("*/session/status", () => HttpResponse.json({ data: { "sess-sisyphus": { type: "stopped" } } })),
        http.get("*/session/:id/message", () => {
          iteration++;
          if (iteration === 1) return HttpResponse.json({ data: [{ parts: [{ type: "text", text: "Initial Code" }] }] });
          if (iteration === 2) return HttpResponse.json({ data: [{ parts: [{ type: "text", text: "Issues found: bug fixed." }] }] });
          if (iteration === 3) return HttpResponse.json({ data: [{ parts: [{ type: "text", text: "Fixed Code" }] }] });
          if (iteration === 4) return HttpResponse.json({ data: [{ parts: [{ type: "text", text: "PASSED" }] }] });
          return HttpResponse.json({ data: [] });
        })
      );

      const result = await orchestrator.runSisyphusTask("fix a bug");
      expect(result).toContain("[PASSED]");
      expect(result).toContain("Fixed Code");
    }, 15000);

    test("ULW loop should complete on <promise>DONE</promise>", async () => {
      let iteration = 0;
      mockServer.use(
        http.post("*/session", () => HttpResponse.json({ data: { id: "sess-ulw" } })),
        http.post("*/session/:id/prompt_async", () => HttpResponse.json({ data: { id: "p-ulw" } })),
        http.get("*/session/status", () => HttpResponse.json({ data: { "sess-ulw": { type: "stopped" } } })),
        http.get("*/session/:id/message", () => {
          iteration++;
          if (iteration === 1) return HttpResponse.json({ data: [{ parts: [{ type: "text", text: "Working..." }] }] });
          return HttpResponse.json({ data: [{ parts: [{ type: "text", text: "<promise>DONE</promise>" }] }] });
        })
      );

      const result = await orchestrator.runULWLoop("heavy task");
      expect(result).toContain("[ULW-COMPLETE]");
      expect(iteration).toBe(2);
    });

    test("Ralph loop should handle timeout", async () => {
      await configManager.update({ ralphMaxIterations: 2 });
      mockServer.use(
        http.post("*/session", () => HttpResponse.json({ data: { id: "sess-ralph" } })),
        http.post("*/session/:id/prompt_async", () => HttpResponse.json({ data: { id: "p-ralph" } })),
        http.get("*/session/status", () => HttpResponse.json({ data: { "sess-ralph": { type: "stopped" } } })),
        http.get("*/session/:id/message", () => HttpResponse.json({ data: [{ parts: [{ type: "text", text: "Still working..." }] }] }))
      );

      const result = await orchestrator.runRalphLoop("incremental task");
      expect(result).toContain("[RALPH-TIMEOUT]");
    });

    test("Init-Deep should initiate project", async () => {
      mockServer.use(
        http.post("*/session", () => HttpResponse.json({ data: { id: "sess-init" } })),
        http.post("*/session/:id/prompt_async", () => HttpResponse.json({ data: { id: "p-init" } })),
        http.get("*/session/status", () => HttpResponse.json({ data: { "sess-init": { type: "stopped" } } })),
        http.get("*/session/:id/message", () => HttpResponse.json({ data: [{ parts: [{ type: "text", text: "Project initialized." }] }] }))
      );

      const result = await orchestrator.runInitDeep("./my-proj");
      expect(result).toContain("[Init-Deep]");
      expect(result).toContain("Project initialized");
    });
  });
});
