import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { OpenCodeMcpServer } from "../src/server.js";
import MockAdapter from "axios-mock-adapter";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("OpenCodeMcpServer Unit Tests", () => {
  let mcpServer: OpenCodeMcpServer;
  let mock: MockAdapter;
  let mcpClient: Client;

  beforeEach(async () => {
    mcpServer = new OpenCodeMcpServer({
      url: "http://localhost:4096",
      password: "pwd",
    });
    mock = new MockAdapter(mcpServer.apiClient);

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "test", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
  });

  afterEach(async () => {
    mock.restore();
    await mcpServer.server.close();
    await mcpClient.close();
  });

  test("should handle health object failures", async () => {
    mock.onGet("/global/health").reply(200, { healthy: false });

    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("unhealthy status");
  });

  test("should handle network error", async () => {
    mock.onGet("/global/health").networkError();
    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(
      "Failed to connect to OpenCode server",
    );
  });

  test("should execute opencode_list_agents", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onGet("/agent").reply(200, [{ id: "hephaestus" }]);

    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("hephaestus");
  });

  test("should execute opencode_list_providers", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onGet("/provider").reply(200, { all: [{ id: "claude-3-5" }] });

    const res: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("claude-3-5");
  });

  test("should start opencode_ask_async", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onPost("/session").reply(200, { id: "test-session-123" });
    mock.onPost("/session/test-session-123/prompt_async").reply(204);

    const res: any = await mcpClient.callTool({
      name: "opencode_ask_async",
      arguments: { task: "write some logic", agent: "foo", model: "bar" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("test-session-123");
  });

  test("should start opencode_ask_sync", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onPost("/session").reply(200, { id: "sync-session" });
    mock.onPost("/session/sync-session/prompt_async").reply(204);

    // Polling setup: Returns stopped to exit while loop immediately
    mock.onGet("/session/status").reply(200, { "sync-session": "stopped" });
    mock.onGet("/session/sync-session/message?limit=10").reply(200, [
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
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock
      .onGet("/session/xyz123")
      .reply(200, { id: "xyz123", title: "Testing" });
    mock.onGet("/session/xyz123/message?limit=10").reply(200, []);
    mock.onGet("/session/status").reply(200, { xyz123: "waiting_for_user" });

    const res: any = await mcpClient.callTool({
      name: "opencode_get_session",
      arguments: { sessionId: "xyz123", limit: 10 },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("waiting_for_user");
  });

  test("should execute opencode_run_shell with target ID", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onPost("/session/xyz/shell").reply(200, { status: "ok" });

    const res: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { sessionId: "xyz", command: "ls", agent: "ops" },
    });

    expect(res.isError).toBeUndefined();
  });

  test("should execute opencode_run_shell without target ID", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onPost("/session").reply(200, { id: "new-session" });
    mock.onPost("/session/new-session/shell").reply(200, { status: "ok" });

    const res: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { command: "ls" },
    });

    expect(res.isError).toBeUndefined();
  });

  test("should check opencode health", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });

    const res: any = await mcpClient.callTool({
      name: "opencode_health_check",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("true");
  });

  test("should get opencode config", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onGet("/config").reply(200, { model: "claude-3-opus" });

    const res: any = await mcpClient.callTool({
      name: "opencode_get_config",
      arguments: {},
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("claude-3-opus");
  });

  test("should set opencode config", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onPatch("/config").reply(200, { model: "gpt-4o" });

    const res: any = await mcpClient.callTool({
      name: "opencode_set_config",
      arguments: { config: { model: "gpt-4o" } },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("gpt-4o");
  });

  test("should handle unknown tools", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });

    const res: any = await mcpClient.callTool({
      name: "unknown_xyz",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Unknown tool");
  });

  test("should abort opencode session", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onPost("/session/xyz-session/abort").reply(200, {});

    const res: any = await mcpClient.callTool({
      name: "opencode_abort_session",
      arguments: { sessionId: "xyz-session" },
    });

    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("aborted successfully");
  });

  test("should delete opencode session", async () => {
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onDelete("/session/del-session").reply(200, {});

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
    mock.onGet("/global/health").reply(200, { healthy: true });
    mock.onGet("/agent").reply(500, { error: "fatal" });

    const res: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("fatal");
  });
});
