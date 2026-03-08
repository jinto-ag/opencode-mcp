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
const OPENCODE_AUTO_START = process.env.OPENCODE_AUTO_START !== "false";
const OPENCODE_AUTO_START_PORT = parseInt(
  process.env.OPENCODE_AUTO_START_PORT || "4096",
  10,
);

async function main() {
  console.error("Starting OpenCode MCP Server...");

  const opencodeServer = new OpenCodeMcpServer({
    url: OPENCODE_URL,
    username: OPENCODE_USERNAME,
    password: OPENCODE_PASSWORD,
    maxRetries: OPENCODE_MAX_RETRIES,
    autoStart: OPENCODE_AUTO_START,
    autoStartPort: OPENCODE_AUTO_START_PORT,
  });

  // Register graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    console.error(`\n[OpenCode-MCP] Received ${signal}, shutting down...`);
    await opencodeServer.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // Non-blocking startup health probe: logs status without preventing initialization
  try {
    await opencodeServer.checkOpencodeHealth();
    console.error(
      `[OpenCode-MCP] OpenCode server is healthy at ${OPENCODE_URL}`,
    );
  } catch {
    if (OPENCODE_AUTO_START) {
      console.error(
        `[OpenCode-MCP] OpenCode server is not reachable at ${OPENCODE_URL}. Will provision automatically on first tool invocation.`,
      );
    } else {
      console.error(
        `[OpenCode-MCP] WARNING: OpenCode not reachable at ${OPENCODE_URL}. ` +
          `Start it with: opencode serve --port ${OPENCODE_AUTO_START_PORT}`,
      );
    }
  }

  const transport = new StdioServerTransport();
  await opencodeServer.server.connect(transport);

  console.error("OpenCode MCP Server successfully running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting OpenCode MCP Server:", error);
  process.exit(1);
});
