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

describe("OpenCode MCP Server - Resources", () => {
  let mcpServer: OpenCodeMcpServer;
  let mcpClient: Client;
  const mockOpencodeUrl = "http://localhost:4096";

  beforeEach(async () => {
    mcpServer = new OpenCodeMcpServer({
      url: mockOpencodeUrl,
      autoStart: false
    });
    
    await mcpServer.init();

    const transports = InMemoryTransport.createLinkedPair();
    await mcpServer.server.connect(transports[1]);

    mcpClient = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await mcpClient.connect(transports[0]);
  });

  afterEach(async () => {
    try {
      await mcpServer.shutdown();
      await mcpClient.close();
    } catch {}
  });

  const setHealthy = () => {
    mockServer.use(
      http.get("*/agent", () => {
        return HttpResponse.json({ "hephaestus": {} });
      })
    );
  };

  test("listResources should return available resources", async () => {
    const result = await mcpClient.listResources();

    expect(result.resources).toBeDefined();
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources.find(r => r.uri === "opencode://docs")).toBeDefined();
  });

  test("listResourceTemplates should return templates", async () => {
    const result = await mcpClient.listResourceTemplates();

    expect(result.resourceTemplates).toBeDefined();
    expect(result.resourceTemplates.find(t => t.uriTemplate.includes("{sessionId}"))).toBeDefined();
  });

  test("readResource (docs) should work", async () => {
    const result: any = await mcpClient.readResource({ uri: "opencode://docs" });

    expect(result.contents[0].text).toContain("OpenCode MCP Resources");
  });

  test("readResource (agents) should work", async () => {
    const result: any = await mcpClient.readResource({ uri: "opencode://agents/discovery" });

    const agents = JSON.parse(result.contents[0].text);
    expect(agents).toHaveProperty("hephaestus");
  });

  test("readResource (session logs) should work", async () => {
    setHealthy();
    mockServer.use(
      http.get("*/session/:id/message", () => {
        return HttpResponse.json([
          { role: "user", parts: [{ type: "text", text: "hello" }] },
          { role: "model", parts: [{ type: "text", text: "world" }] }
        ]);
      })
    );

    const result: any = await mcpClient.readResource({ uri: "opencode://sessions/test-session/logs" });

    expect(result.contents[0].text).toContain("[user] hello");
    expect(result.contents[0].text).toContain("[model] world");
  });

  test("readResource (config) should work", async () => {
    const result: any = await mcpClient.readResource({ uri: "opencode://config/current" });

    const config = JSON.parse(result.contents[0].text);
    expect(config).toHaveProperty("omo");
    expect(config).toHaveProperty("opencode");
  });

  test("readResource (mcp status) should work", async () => {
    setHealthy();
    mockServer.use(
      http.get("*/mcp", () => {
        return HttpResponse.json([{ name: "test-mcp", status: "ok" }]);
      })
    );

    const result: any = await mcpClient.readResource({ uri: "opencode://mcp/status" });

    const status = JSON.parse(result.contents[0].text);
    expect(status[0].name).toBe("test-mcp");
  });
});
