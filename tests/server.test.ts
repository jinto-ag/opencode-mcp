import { expect, test, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test";
import { OpenCodeMcpServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const mockServer = setupServer();

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

describe("OpenCodeMcpServer Unit Tests", () => {
  let mcpServer: OpenCodeMcpServer;
  let mcpClient: Client;

  beforeEach(async () => {
    mcpServer = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      password: "pwd",
      autoStart: false,
      healthCacheTtlMs: 0,
    });

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "test", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
  });

  afterEach(async () => {
    try {
      await mcpServer.shutdown();
      await mcpClient.close();
    } catch {}
  });

  // Helper to mock the proxy health check used in server.ts (app.agents)
  const setHealthy = () => {
    mockServer.use(
      http.get("*/agent", () => {
        return HttpResponse.json({ hephaestus: { name: "Hephaestus" } });
      })
    );
  };

  test("should handle health object failures", async () => {
    mockServer.use(
      http.get("*/agent", () => {
        return new HttpResponse(null, { status: 500 });
      })
    );

    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Start it manually");
  });

  test("should handle network error", async () => {
    mockServer.use(
      http.get("*/agent", () => {
        return HttpResponse.error();
      })
    );
    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Start it manually");
  });

  test("should include actionable guidance in connection errors", async () => {
    mockServer.use(
      http.get("*/agent", () => {
        return HttpResponse.error();
      })
    );
    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Start it manually");
  });

  test("should execute opencode_list_agents", async () => {
    setHealthy();
    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("Hephaestus");
  });

  test("should execute opencode_list_providers", async () => {
    setHealthy();
    mockServer.use(
      http.get("*/config/providers", () => {
        return HttpResponse.json({
          providers: [{ id: "claude-3-5" }],
          default: {}
        });
      })
    );

    const res: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("claude-3-5");
  });

  test("should start opencode_ask_async", async () => {
    setHealthy();
    mockServer.use(
      http.post("*/session", () => HttpResponse.json({ id: "test-session-123" })),
      http.post("*/session/test-session-123/prompt_async", () => new HttpResponse(null, { status: 204 }))
    );

    const res: any = await mcpClient.callTool({
      name: "opencode_ask_async",
      arguments: { task: "write some logic", agent: "foo", model: "bar" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("test-session-123");
  });

  test("should start opencode_ask_sync", async () => {
    setHealthy();
    mockServer.use(
      http.post("*/session", () => HttpResponse.json({ id: "sync-session" })),
      http.post("*/session/sync-session/prompt_async", () => new HttpResponse(null, { status: 204 })),
      http.get("*/session/status", () => HttpResponse.json({ "sync-session": "stopped" })),
      http.get("*/session/sync-session/message", ({ request }) => {
        return HttpResponse.json([
          {
            parts: [
              { type: "text", text: "I fixed the issue." },
              { type: "image", mime: "image/png" }
            ],
          },
        ]);
      })
    );

    const res: any = await mcpClient.callTool({
      name: "opencode_ask_sync",
      arguments: { task: "fix this bug", agent: "foo", model: "bar" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("I fixed the issue.");
  });

  test("should get session status", async () => {
    setHealthy();
    mockServer.use(
      http.get("*/session/xyz123", () => HttpResponse.json({ id: "xyz123", title: "Testing" })),
      http.get("*/session/xyz123/message", () => HttpResponse.json([])),
      http.get("*/session/status", () => HttpResponse.json({ xyz123: "waiting_for_user" }))
    );

    const res: any = await mcpClient.callTool({
      name: "opencode_get_session",
      arguments: { sessionId: "xyz123", limit: 10 },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("waiting_for_user");
  });

  test("should execute opencode_run_shell with target ID", async () => {
    setHealthy();
    mockServer.use(
      http.post("*/session/xyz/shell", () => HttpResponse.json({ status: "ok" }))
    );

    const res: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { sessionId: "xyz", command: "ls", agent: "ops" },
    });

    expect(res.isError).toBeUndefined();
  });

  test("should execute opencode_run_shell without target ID", async () => {
    setHealthy();
    mockServer.use(
      http.post("*/session", () => HttpResponse.json({ id: "new-session" })),
      http.post("*/session/new-session/shell", () => HttpResponse.json({ status: "ok" })),
      http.delete("*/session/new-session", () => HttpResponse.json({}))
    );

    const res: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { command: "ls", agent: "ops" },
    });

    expect(res.isError).toBeUndefined();
  });

  test("should check opencode health", async () => {
    setHealthy();

    const res: any = await mcpClient.callTool({
      name: "opencode_health_check",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("true");
  });

  test("should get opencode config", async () => {
    setHealthy();
    mockServer.use(http.get("*/config", () => HttpResponse.json({ model: "claude-3-opus" })));

    const res: any = await mcpClient.callTool({
      name: "opencode_get_config",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("claude-3-opus");
  });

  test("should set opencode config", async () => {
    setHealthy();
    mockServer.use(http.patch("*/config", () => HttpResponse.json({ model: "gpt-4o" })));

    const res: any = await mcpClient.callTool({
      name: "opencode_set_config",
      arguments: { config: { model: "gpt-4o" } },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("gpt-4o");
  });

  test("should handle unknown tools", async () => {
    setHealthy();

    const res: any = await mcpClient.callTool({
      name: "unknown_xyz",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unrecognized tool");
  });

  test("should abort opencode session", async () => {
    setHealthy();
    mockServer.use(http.post("*/session/xyz-session/abort", () => HttpResponse.json({})));

    const res: any = await mcpClient.callTool({
      name: "opencode_abort_session",
      arguments: { sessionId: "xyz-session" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("aborted successfully");
  });

  test("should delete opencode session", async () => {
    setHealthy();
    mockServer.use(http.delete("*/session/del-session", () => HttpResponse.json({})));

    const res: any = await mcpClient.callTool({
      name: "opencode_delete_session",
      arguments: { sessionId: "del-session" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("deleted successfully");
  });

  test("should list all tools gracefully", async () => {
    const res: any = await mcpClient.listTools();
    expect(res.tools.length).toBe(11);
    expect(res.tools.map((t: any) => t.name)).toContain("opencode_list_agents");
  });

  test("should handle error when api throws 500 inside opencode_list_providers", async () => {
    setHealthy();
    mockServer.use(http.get("*/config/providers", () => HttpResponse.json({ error: "fatal error msg" }, { status: 500 })));

    const res: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("fatal error msg");
  });
});

describe("Input Validation", () => {
  let mcpServer: OpenCodeMcpServer;
  let mcpClient: Client;

  beforeEach(async () => {
    mcpServer = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      autoStart: false,
      healthCacheTtlMs: 0,
    });
    
    mockServer.use(
      http.get("*/agent", () => HttpResponse.json({ hephaestus: { name: "Hephaestus" } }))
    );

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "test-validation", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
  });

  afterEach(async () => {
    try {
      await mcpServer.shutdown();
      await mcpClient.close();
    } catch {}
  });

  test("should reject opencode_ask_sync with empty task", async () => {
    const res: any = await mcpClient.callTool({
      name: "opencode_ask_sync",
      arguments: { task: "" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("task required");
  });

  test("should reject opencode_ask_async with missing task", async () => {
    const res: any = await mcpClient.callTool({
      name: "opencode_ask_async",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("task required");
  });

  test("should reject opencode_run_shell with empty command", async () => {
    const res: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { command: "", agent: "ops" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("command required");
  });

  test("should reject opencode_run_shell with missing agent", async () => {
    const res: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { command: "ls" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("agent required");
  });

  test("should reject opencode_abort_session with missing sessionId", async () => {
    const res: any = await mcpClient.callTool({
      name: "opencode_abort_session",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("sessionId required");
  });

  test("should reject opencode_set_config with non-object config", async () => {
    const res: any = await mcpClient.callTool({
      name: "opencode_set_config",
      arguments: { config: "not-an-object" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("config object required");
  });
});

describe("Health Check Cache", () => {
  let mcpServer: OpenCodeMcpServer;
  let mcpClient: Client;

  beforeEach(async () => {
    mcpServer = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      autoStart: false,
      healthCacheTtlMs: 60_000, // Long TTL for testing cache behavior
    });

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "test-cache", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
  });

  afterEach(async () => {
    try {
      await mcpServer.shutdown();
      await mcpClient.close();
    } catch {}
  });

  test("should cache health check results across tool calls", async () => {
    let callCount = 0;
    mockServer.use(
      http.get("*/agent", () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({ hephaestus: {} });
        }
        return new HttpResponse(null, { status: 500 }); // Should not be called
      }),
      http.get("*/config/providers", () => HttpResponse.json({ providers: [], default: {} }))
    );

    const res1: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });
    expect(res1.isError).toBeUndefined();

    // Second call — should use cached health (no mock registered for second health call)
    const res2: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });
    expect(res2.isError).toBeUndefined();
    expect(callCount).toBe(1); // Cached
  });
  test("should invalidate cache on error", async () => {
    let callCount = 0;
    mockServer.use(
      http.get("*/agent", () => {
        callCount++;
        if (callCount === 1) return HttpResponse.json({ hephaestus: {} });
        return new HttpResponse(null, { status: 500 }); // Should fail 2nd time checkOpencodeHealth is called
      }),
      http.get("*/config/providers", () => HttpResponse.json({ providers: [], default: {} }))
    );

    await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });

    // Manually invalidate cache
    mcpServer.invalidateHealthCache();

    const res: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(callCount).toBe(2);
  });

  test("health_check tool should bypass cache", async () => {
    let callCount = 0;
    mockServer.use(
      http.get("*/agent", () => {
        callCount++;
        return HttpResponse.json({ hephaestus: {} });
      }),
      http.get("*/config/providers", () => HttpResponse.json({ providers: [], default: {} }))
    );

    await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });

    const healthRes: any = await mcpClient.callTool({
      name: "opencode_health_check",
      arguments: {},
    });
    expect(healthRes.isError).toBeUndefined();
    expect(healthRes.content[0].text).toContain("true");
    expect(callCount).toBe(2); // health_check bypassed cache
  });
});

describe("Auto-Start & Lifecycle", () => {
  test("should throw actionable error when autoStart is disabled and server unreachable", async () => {
    mockServer.use(http.get("*/agent", () => HttpResponse.error()));
    
    const server = new OpenCodeMcpServer({
      url: "http://localhost:19999", // Intentionally unreachable
      autoStart: false,
      healthCacheTtlMs: 0,
    });

    try {
      await server.ensureOpenCodeRunning();
      throw new Error("Should have thrown");
    } catch (error: any) {
      expect(error.message).toContain("Start it manually");
    }
  });

  test("should skip auto-start if server is already healthy", async () => {
    mockServer.use(http.get("*/agent", () => HttpResponse.json({ hephaestus: {} })));
    
    const server = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      autoStart: true,
      healthCacheTtlMs: 0,
    });

    // Should NOT attempt to start — just validate health
    await server.ensureOpenCodeRunning();
  });

  test("shutdown should be idempotent", async () => {
    const server = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      autoStart: false,
    });

    const transports = InMemoryTransport.createLinkedPair();
    await server.server.connect(transports[1]);

    // Should not throw even when called multiple times
    await server.shutdown();
    await server.shutdown();
  });
});
