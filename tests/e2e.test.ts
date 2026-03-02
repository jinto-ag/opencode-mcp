import { expect, test, describe } from "bun:test";
import { OpenCodeMcpServer } from "../src/server";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

describe("OpenCodeMcpServer E2E Tests (Skip by default unless explicitly configured)", () => {
  // Real endpoint, tests will run only if you configure the real endpoint
  // and set an ENV for OPENCODE_TEST_E2E=1
  test.skipIf(!process.env.OPENCODE_TEST_E2E)(
    "should connect to live opencode server and fetch agents",
    async () => {
      const mcpServer = new OpenCodeMcpServer({
        url: process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096",
      });

      // test the check function directly
      const health = await mcpServer.checkOpencodeHealth();
      expect(health.healthy).toBe(true);

      const agentsResponse = await mcpServer.apiClient.get("/agent");
      expect(agentsResponse.status).toBe(200);
      expect(Array.isArray(agentsResponse.data)).toBe(true);
    },
  );
});
