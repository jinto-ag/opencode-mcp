import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { OpenCodeMcpServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";

describe("OpenCodeMcpServer E2E Tests", () => {
  let mcpServer: OpenCodeMcpServer;
  let mcpClient: Client;
  let testSessionId: string;
  let containerProcess: any;

  beforeAll(async () => {
    let serverUrl = process.env.OPENCODE_SERVER_URL;

    // Spin up podman if no URL provided
    if (!serverUrl) {
      console.log("[E2E] Spinning up isolated OpenCode via Podman...");
      containerProcess = spawn("podman", [
        "run",
        "--rm",
        "--name",
        "opencode-mcp-e2e-server",
        "-p",
        "4099:4099",
        "ghcr.io/anomalyco/opencode:latest",
        "serve",
        "--port",
        "4099",
        "--hostname",
        "0.0.0.0",
      ]);

      serverUrl = "http://127.0.0.1:4099";

      let isHealthy = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`${serverUrl}/global/health`);
          if (res.ok) {
            isHealthy = true;
            break;
          }
        } catch (e) {
          // wait
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!isHealthy) {
        throw new Error("[E2E] Failed to start OpenCode container in time.");
      }
      console.log("[E2E] OpenCode container is healthy!");
    } else {
      console.log(`[E2E] Using existing OPENCODE_SERVER_URL: ${serverUrl}`);
    }

    mcpServer = new OpenCodeMcpServer({
      url: serverUrl,
    });

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "e2e-test", version: "1" },
      { capabilities: {} },
    );
    await mcpClient.connect(transports[0]);
  }, 35000);

  afterAll(async () => {
    try {
      await mcpClient.close();
      await mcpServer.server.close();
    } catch (e) {
      // Ignore transport already closed errors from inMemory transport
    }

    if (containerProcess) {
      console.log("[E2E] Tearing down OpenCode Podman container...");
      containerProcess.kill();
      // forcefully rm in case it hangs
      const rmProc = spawn("podman", ["rm", "-f", "opencode-mcp-e2e-server"]);

      // Wrap with manual timeout resolution to prevent test hangs
      await Promise.race([
        new Promise((r) => rmProc.on("close", r)),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
    }
  }, 10000);

  test(
    "should pass health check",
    async () => {
      const health: any = await mcpClient.callTool({
        name: "opencode_health_check",
        arguments: {},
      });
      expect(health.content[0].text).toContain("Status: Healthy");
      expect(health.content[0].text).toContain("Agents:");
    },
    10000
  );

  test("should get OpenCode config", async () => {
    const configRes: any = await mcpClient.callTool({
      name: "opencode_get_config",
      arguments: {},
    });
    expect(configRes.isError).toBeUndefined();
    expect(configRes.content[0].text).toContain("Config:");
  }, 60000);

  test("should list providers", async () => {
    const providersRes: any = await mcpClient.callTool({
      name: "opencode_list_providers",
      arguments: {},
    });
    expect(providersRes.isError).toBeUndefined();
    expect(providersRes.content[0].text).toContain("Providers:");
  }, 60000);

  test("should list agents", async () => {
    const agentsRes: any = await mcpClient.callTool({
      name: "opencode_list_agents",
      arguments: {},
    });
    expect(agentsRes.isError).toBeUndefined();
    expect(agentsRes.content[0].text).toContain("Agents:");
  });

  test("should execute opencode_ask_sync", async () => {
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
  }, 300000);

  test("should start an async task", async () => {
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
  });

  test("should get async session status", async () => {
    expect(testSessionId).toBeDefined();

    const sessionRes: any = await mcpClient.callTool({
      name: "opencode_get_session",
      arguments: { sessionId: testSessionId, limit: 10 },
    });
    expect(sessionRes.isError).toBeUndefined();
    expect(sessionRes.content[0].text).toContain("Status:");
  }, 60000);

  test("should execute shell command", async () => {
    const shellRes: any = await mcpClient.callTool({
      name: "opencode_run_shell",
      arguments: { command: "echo E2EShellCheck", agent: "explore" },
    });
    expect(shellRes.isError).toBeUndefined();
    expect(shellRes.content[0].text).toContain("Result:");
  }, 60000);

  test("should abort session", async () => {
    expect(testSessionId).toBeDefined();
    const abortRes: any = await mcpClient.callTool({
      name: "opencode_abort_session",
      arguments: { sessionId: testSessionId },
    });
    expect(abortRes.isError).toBeUndefined();
    expect(abortRes.content[0].text).toContain("aborted successfully");
  });

  test("should delete session", async () => {
    expect(testSessionId).toBeDefined();
    const deleteRes: any = await mcpClient.callTool({
      name: "opencode_delete_session",
      arguments: { sessionId: testSessionId },
    });
    expect(deleteRes.isError).toBeUndefined();
    expect(deleteRes.content[0].text).toContain("deleted successfully");
  });

  test("should list MCP status", async () => {
    const res: any = await mcpClient.callTool({
      name: "opencode_mcp_status",
      arguments: {},
    });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("MCP Servers:");
  });

  test("should list PTY sessions", async () => {
    const res: any = await mcpClient.callTool({
      name: "opencode_pty_list",
      arguments: {},
    });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("PTY Sessions:");
  });
});
