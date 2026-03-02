#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OpenCodeMcpServer } from "./server.js";

const OPENCODE_URL = process.env.OPENCODE_SERVER_URL || "http://127.0.0.1:4096";
const OPENCODE_USERNAME = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || "";
const OPENCODE_MAX_RETRIES = parseInt(
  process.env.OPENCODE_MAX_RETRIES || "3",
  10,
);

async function main() {
  console.error("Starting OpenCode MCP Server...");

  const opencodeServer = new OpenCodeMcpServer({
    url: OPENCODE_URL,
    username: OPENCODE_USERNAME,
    password: OPENCODE_PASSWORD,
    maxRetries: OPENCODE_MAX_RETRIES,
  });

  const transport = new StdioServerTransport();
  await opencodeServer.server.connect(transport);

  console.error("OpenCode MCP Server successfully running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting OpenCode MCP Server:", error);
  process.exit(1);
});
