import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { OpenCodeMcpServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

describe("OpenCodeMcpServer E2E Tests", () => {
  let mcpServer: OpenCodeMcpServer;
  let mcpClient: Client;
  let testSessionId: string;

  beforeAll(async () => {
    if (!process.env.OPENCODE_TEST_E2E) return;

    mcpServer = new OpenCodeMcpServer({
      url: process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096",
    });

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "e2e-test", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
  });

  afterAll(async () => {
    if (!process.env.OPENCODE_TEST_E2E) return;
    try {
      await mcpClient.close();
      await mcpServer.server.close();
    } catch (e) {
      // Ignore transport already closed errors from inMemory transport
    }
  });

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should pass health check",
    async () => {
      const healthRes: any = await mcpClient.callTool({
        name: "opencode_health_check",
        arguments: {},
      });
      expect(healthRes.isError).toBeUndefined();
      expect(healthRes.content[0].text).toContain("true");
    },
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should get OpenCode config",
    async () => {
      const configRes: any = await mcpClient.callTool({
        name: "opencode_get_config",
        arguments: {},
      });
      expect(configRes.isError).toBeUndefined();
      expect(configRes.content[0].text).toContain("Config:");
    },
    60000,
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should list providers",
    async () => {
      const providersRes: any = await mcpClient.callTool({
        name: "opencode_list_providers",
        arguments: {},
      });
      expect(providersRes.isError).toBeUndefined();
      expect(providersRes.content[0].text).toContain("Providers:");
    },
    60000,
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should list agents",
    async () => {
      const agentsRes: any = await mcpClient.callTool({
        name: "opencode_list_agents",
        arguments: {},
      });
      expect(agentsRes.isError).toBeUndefined();
      expect(agentsRes.content[0].text).toContain("Agents:");
    },
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should execute opencode_ask_sync",
    async () => {
      const syncRes: any = await mcpClient.request(
        {
          method: "tools/call",
          params: {
            name: "opencode_ask_sync",
            arguments: {
              task: "Reply precisely with 'SyncTest'",
            },
          },
        },
        CallToolResultSchema,
        { timeout: 300000 },
      );
      expect(syncRes.isError).toBeUndefined();
      expect(syncRes.content[0].text).toContain("Session ID:");
    },
    300000,
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should start an async task",
    async () => {
      const asyncRes: any = await mcpClient.callTool({
        name: "opencode_ask_async",
        arguments: { task: "Test async payload logic", agent: "hephaestus" },
      });
      expect(asyncRes.isError).toBeUndefined();
      expect(asyncRes.content[0].text).toContain("Background task started");

      // Parse session id
      const match = asyncRes.content[0].text.match(
        /Session ID:\s*([a-zA-Z0-9_-]+)/,
      );
      expect(match).toBeTruthy();
      if (match) {
        testSessionId = match[1];
      }
    },
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should get async session status",
    async () => {
      expect(testSessionId).toBeDefined();

      const sessionRes: any = await mcpClient.callTool({
        name: "opencode_get_session",
        arguments: { sessionId: testSessionId, limit: 10 },
      });
      expect(sessionRes.isError).toBeUndefined();
      expect(sessionRes.content[0].text).toContain("Status:");
    },
    60000,
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should execute shell command",
    async () => {
      const shellRes: any = await mcpClient.callTool({
        name: "opencode_run_shell",
        arguments: { command: "echo E2EShellCheck", agent: "explore" },
      });
      expect(shellRes.isError).toBeUndefined();
      expect(shellRes.content[0].text).toContain("Result:");
    },
    60000,
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should abort session",
    async () => {
      expect(testSessionId).toBeDefined();
      const abortRes: any = await mcpClient.callTool({
        name: "opencode_abort_session",
        arguments: { sessionId: testSessionId },
      });
      expect(abortRes.isError).toBeUndefined();
      expect(abortRes.content[0].text).toContain("aborted successfully");
    },
  );

  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should delete session",
    async () => {
      expect(testSessionId).toBeDefined();
      const deleteRes: any = await mcpClient.callTool({
        name: "opencode_delete_session",
        arguments: { sessionId: testSessionId },
      });
      expect(deleteRes.isError).toBeUndefined();
      expect(deleteRes.content[0].text).toContain("deleted successfully");
    },
  );
});
