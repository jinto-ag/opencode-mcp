import { expect, test, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { OpenCodeMcpServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const mockServer = setupServer();

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe("OpenCode MCP Server - OMO Tools", () => {
  let mcpServer: OpenCodeMcpServer;
  let mcpClient: Client;
  let tempDir: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omo-server-test-"));
    process.chdir(tempDir);
    
    mcpServer = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      autoStart: false
    });
    await mcpServer.init();

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "test", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
    
    // Default mock for health checks to avoid MSW warnings
    mockServer.use(
      http.get("*/agent", () => {
        return HttpResponse.json({ data: { hephaestus: { name: "Hephaestus" } } });
      })
    );
  });

  const setHealthy = () => {
    mockServer.use(
      http.get("*/agent", () => {
        return HttpResponse.json({ hephaestus: { name: "Hephaestus" } });
      })
    );
  };

  afterEach(async () => {
    try {
      await mcpClient.close();
      await mcpServer.server.close();
    } catch {}
    process.chdir(originalCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("omo_get_config should return current config", async () => {
    const result: any = await mcpClient.callTool({
      name: "omo_get_config",
      arguments: {}
    });

    const config = JSON.parse(result.content[0].text);
    expect(config.maxRetries).toBe(3);
    expect(config.ulwMaxIterations).toBe(10);
  });

  test("omo_set_config should update config", async () => {
    await mcpClient.callTool({
      name: "omo_set_config",
      arguments: { maxRetries: 5, ulwMaxIterations: 20 }
    });
    
    const getResult: any = await mcpClient.callTool({
      name: "omo_get_config",
      arguments: {}
    });
    const config = JSON.parse(getResult.content[0].text);
    expect(config.maxRetries).toBe(5);
    expect(config.ulwMaxIterations).toBe(20);
  });

  test("opencode_execute_command tool should work", async () => {
    mockServer.use(
      http.post("*/session", () => HttpResponse.json({ data: { id: "ses_123" } })),
      http.post("*/session/:id/command", () => HttpResponse.json({ data: { info: {} } }))
    );
    const result: any = await mcpClient.callTool({
      name: "opencode_execute_command",
      arguments: { command: "ulw-loop", args: "quick task", sessionId: "ses_123" }
    });

    expect(result.content[0].text).toContain("Command successfully executed in session ses_123.");
  });
  test("opencode_manage_skills tool should work for listing", async () => {
    const result: any = await mcpClient.callTool({
      name: "opencode_manage_skills",
      arguments: { action: "ls", global: true }
    });

    expect(result.content[0].text).toContain("Success:");
  });

  test("opencode_manage_skills should handle missing package error", async () => {
    const result: any = await mcpClient.callTool({
      name: "opencode_manage_skills",
      arguments: { action: "find" }
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("packageName is required");
  });

  test("listTools should include dynamic omo agents", async () => {
    const tools: any = await mcpClient.listTools();
    const hasHephaestus = tools.tools.some((t: any) => t.name === "omo_hephaestus");
    expect(hasHephaestus).toBe(true);
    
    const hephaestus = tools.tools.find((t: any) => t.name === "omo_hephaestus");
    expect(hephaestus.inputSchema.properties).toHaveProperty("mode");
  });

  test("omo_hephaestus tool should work with mode", async () => {
    mockServer.use(
      http.post("*/session", () => HttpResponse.json({ data: { id: "s2" } })),
      http.post("*/session/:id/prompt_async", () => HttpResponse.json({ data: { id: "p2" } })),
      http.get("*/session/status", () => HttpResponse.json({ data: { "s2": { type: "stopped" } } })),
      http.get("*/session/:id/message", () => HttpResponse.json({ data: [{ parts: [{ type: "text", text: "Task done <promise>DONE</promise>" }] }] }))
    );

    const result: any = await mcpClient.callTool({
      name: "omo_hephaestus",
      arguments: { task: "mode task", mode: "ralph" }
    });

    expect(result.content[0].text).toContain("[RALPH-COMPLETE]");
    expect(result.content[0].text).toContain("Task done");
  });

  test("omo_refresh_discovery should reload agents", async () => {
    const result: any = await mcpClient.callTool({
      name: "omo_refresh_discovery",
      arguments: {}
    });
    expect(result.content[0].text).toContain("Discovery refreshed");
  });
});
