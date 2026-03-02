import { expect, test, describe } from "bun:test";
import { OpenCodeMcpServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("OpenCodeMcpServer E2E Tests (Skip by default unless explicitly configured)", () => {
  // Real endpoint, tests will run only if you configure the real endpoint
  // and set an ENV for OPENCODE_TEST_E2E=1
  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should connect to live opencode server and fetch health via MCP",
    async () => {
      const mcpServer = new OpenCodeMcpServer({
        url: process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096",
      });

      const transports = InMemoryTransport.createLinkedPair();
      await mcpServer.server.connect(transports[1]);

      const mcpClient = new Client(
        { name: "e2e-test", version: "1" },
        { capabilities: {} },
      );
      await mcpClient.connect(transports[0]);

      // Call Health
      const healthRes: any = await mcpClient.callTool({
        name: "opencode_health_check",
        arguments: {},
      });
      expect(healthRes.isError).toBeUndefined();
      expect(healthRes.content[0].text).toContain("true");

      // Verify explicit logging / error isolation inside live payload bounds
      expect(healthRes.content.length).toBeGreaterThan(0);

      await mcpClient.close();
      await mcpServer.server.close();
    },
  );
});
