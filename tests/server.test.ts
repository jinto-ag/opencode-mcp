import { expect, test, describe, beforeEach, afterEach, mock } from "bun:test";
import { OpenCodeMcpServer } from "../src/server.js";
import MockAdapter from "axios-mock-adapter";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("OpenCodeMcpServer Unit Tests", () => {
  let mcpServer: OpenCodeMcpServer;
  let mockAxios: MockAdapter;
  let mcpClient: Client;

  beforeEach(async () => {
    mcpServer = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      password: "pwd",
      autoStart: false, // Disable auto-start in unit tests
      healthCacheTtlMs: 0, // Disable health cache in unit tests for deterministic behavior
    });
    mockAxios = new MockAdapter(mcpServer.apiClient);

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "test", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
  });

  afterEach(async () => {
    mockAxios.restore();
    try {
      await mcpServer.server.close();
      await mcpClient.close();
    } catch {
      // Transport may already be closed
    }
  });

  test("should handle health object failures", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: false });

    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not reachable");
  });

  test("should handle network error", async () => {
    mockAxios.onGet("/global/health").networkError();
    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(
      "not reachable",
    );
  });

  test("should include actionable guidance in connection errors", async () => {
    mockAxios.onGet("/global/health").networkError();
    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("opencode serve --port 4096");
  });

  test("should execute opencode_list_agents", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onGet("/agent").reply(200, [{ id: "hephaestus" }]);

    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("hephaestus");
  });

  test("should execute opencode_list_providers", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onGet("/provider").reply(200, { all: [{ id: "claude-3-5" }] });

    const res: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("claude-3-5");
  });

  test("should start opencode_ask_async", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onPost("/session").reply(200, { id: "test-session-123" });
    mockAxios.onPost("/session/test-session-123/prompt_async").reply(204);

    const res: any = await mcpClient.callTool({
      name: "opencode_ask_async",
      arguments: { task: "write some logic", agent: "foo", model: "bar" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("test-session-123");
  });

  test("should start opencode_ask_sync", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onPost("/session").reply(200, { id: "sync-session" });
    mockAxios.onPost("/session/sync-session/prompt_async").reply(204);

    // Polling setup: Returns stopped to exit while loop immediately
    mockAxios.onGet("/session/status").reply(200, { "sync-session": "stopped" });
    mockAxios.onGet("/session/sync-session/message?limit=10").reply(200, [
      {
        parts: [
          { type: "text", text: "I fixed the issue." },
          { type: "image" }, // simulate a non-text response part
        ],
      },
    ]);

    const res: any = await mcpClient.callTool({
      name: "opencode_ask_sync",
      arguments: { task: "fix this bug", agent: "foo", model: "bar" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("I fixed the issue");
  });

  test("should get session status", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios
      .onGet("/session/xyz123")
      .reply(200, { id: "xyz123", title: "Testing" });
    mockAxios.onGet("/session/xyz123/message?limit=10").reply(200, []);
    mockAxios.onGet("/session/status").reply(200, { xyz123: "waiting_for_user" });

    const res: any = await mcpClient.callTool({
      name: "opencode_get_session",
      arguments: { sessionId: "xyz123", limit: 10 },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("waiting_for_user");
  });

  test("should execute opencode_run_shell with target ID", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onPost("/session/xyz/shell").reply(200, { status: "ok" });

    const res: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { sessionId: "xyz", command: "ls", agent: "ops" },
    });

    expect(res.isError).toBeUndefined();
  });

  test("should execute opencode_run_shell without target ID", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onPost("/session").reply(200, { id: "new-session" });
    mockAxios.onPost("/session/new-session/shell").reply(200, { status: "ok" });

    const res: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { command: "ls" },
    });

    expect(res.isError).toBeUndefined();
  });

  test("should check opencode health", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });

    const res: any = await mcpClient.callTool({
      name: "opencode_health_check",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("true");
  });

  test("should get opencode config", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onGet("/config").reply(200, { model: "claude-3-opus" });

    const res: any = await mcpClient.callTool({
      name: "opencode_get_config",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("claude-3-opus");
  });

  test("should set opencode config", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onPatch("/config").reply(200, { model: "gpt-4o" });

    const res: any = await mcpClient.callTool({
      name: "opencode_set_config",
      arguments: { config: { model: "gpt-4o" } },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("gpt-4o");
  });

  test("should handle unknown tools", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });

    const res: any = await mcpClient.callTool({
      name: "unknown_xyz",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown tool");
  });

  test("should abort opencode session", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onPost("/session/xyz-session/abort").reply(200, {});

    const res: any = await mcpClient.callTool({
      name: "opencode_abort_session",
      arguments: { sessionId: "xyz-session" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("aborted successfully");
  });

  test("should delete opencode session", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onDelete("/session/del-session").reply(200, {});

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

  test("should handle error when api throws 500 inside opencode_list_agents", async () => {
    mockAxios.onGet("/global/health").reply(200, { healthy: true });
    mockAxios.onGet("/agent").reply(500, { error: "fatal" });

    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("fatal");
  });
});

describe("Health Check Cache", () => {
  let mcpServer: OpenCodeMcpServer;
  let mockAxios: MockAdapter;
  let mcpClient: Client;

  beforeEach(async () => {
    mcpServer = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      autoStart: false,
      healthCacheTtlMs: 60_000, // Long TTL for testing cache behavior
    });
    mockAxios = new MockAdapter(mcpServer.apiClient);

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "test-cache", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
  });

  afterEach(async () => {
    mockAxios.restore();
    try {
      await mcpServer.server.close();
      await mcpClient.close();
    } catch {
      // Transport may already be closed
    }
  });

  test("should cache health check results across tool calls", async () => {
    // First call — will hit the mock
    mockAxios.onGet("/global/health").replyOnce(200, { healthy: true });
    mockAxios.onGet("/agent").reply(200, [{ id: "alpha" }]);
    mockAxios.onGet("/provider").reply(200, { all: [] });

    const res1: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res1.isError).toBeUndefined();

    // Second call — should use cached health (no mock registered for second health call)
    const res2: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });
    expect(res2.isError).toBeUndefined();
  });

  test("should invalidate cache on error", async () => {
    // First call succeeds
    mockAxios.onGet("/global/health").replyOnce(200, { healthy: true });
    mockAxios.onGet("/agent").replyOnce(200, []);

    await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });

    // Manually invalidate cache
    mcpServer.invalidateHealthCache();

    // Next health check should fail because no mock is registered
    mockAxios.onGet("/global/health").replyOnce(500, { error: "down" });

    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });

  test("health_check tool should bypass cache", async () => {
    // Seed the cache with a successful health check
    mockAxios.onGet("/global/health").replyOnce(200, { healthy: true });
    mockAxios.onGet("/agent").reply(200, []);

    await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });

    // health_check should force a fresh check (second mock)
    mockAxios.onGet("/global/health").replyOnce(200, { healthy: true });

    const healthRes: any = await mcpClient.callTool({
      name: "opencode_health_check",
      arguments: {},
    });
    expect(healthRes.isError).toBeUndefined();
    expect(healthRes.content[0].text).toContain("true");
  });
});

describe("Auto-Start & Lifecycle", () => {
  test("should throw actionable error when autoStart is disabled and server unreachable", async () => {
    const server = new OpenCodeMcpServer({
      url: "http://localhost:19999", // Intentionally unreachable
      autoStart: false,
      healthCacheTtlMs: 0,
    });

    try {
      await server.ensureOpenCodeRunning();
      throw new Error("Should have thrown");
    } catch (error: any) {
      expect(error.message).toContain("OpenCode server is not reachable");
      expect(error.message).toContain("opencode serve --port");
    }
  });

  test("should skip auto-start if server is already healthy", async () => {
    const server = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      autoStart: true,
      healthCacheTtlMs: 0,
    });
    const mockAxios = new MockAdapter(server.apiClient);
    mockAxios.onGet("/global/health").reply(200, { healthy: true });

    // Should NOT attempt to start — just validate health
    await server.ensureOpenCodeRunning();

    mockAxios.restore();
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
