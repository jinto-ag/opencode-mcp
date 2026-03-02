import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import type { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";

export interface OpenCodeConfig {
  url: string;
  username?: string;
  password?: string;
  maxRetries?: number;
}

export class OpenCodeMcpServer {
  public server: Server;
  public apiClient: AxiosInstance;

  constructor(config: OpenCodeConfig) {
    this.server = new Server(
      {
        name: "opencode-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.apiClient = axios.create({
      baseURL: config.url,
      timeout: 0, // Disable timeout for long-running agent tasks
    });

    if (config.password) {
      this.apiClient.defaults.auth = {
        username: config.username || "opencode",
        password: config.password,
      };
    }

    // Rate Exceed bypassing setup
    axiosRetry(this.apiClient, {
      retries: config.maxRetries || 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        // Retry on 429 Too Many Requests or 5xx server errors
        return error.response?.status === 429 || error.response?.status! >= 500;
      },
      onRetry: (retryCount, error, requestConfig) => {
        console.error(
          `[Rate Limit or Error] Retrying request ${requestConfig.url} (Attempt ${retryCount}): ${error.message}`,
        );
      },
    });

    this.setupHandlers();
  }

  /**
   * Validates that the OpenCode server is accessible.
   */
  async checkOpencodeHealth() {
    try {
      const res = await this.apiClient.get("/global/health", { timeout: 5000 });
      if (!res.data?.healthy) {
        throw new Error(
          `OpenCode server returned unhealthy status: ${JSON.stringify(res.data)}`,
        );
      }
      return res.data;
    } catch (error: any) {
      if (error.response) {
        throw new Error(
          `OpenCode server error (${error.response.status}): ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(
        `Failed to connect to OpenCode server at ${this.apiClient.defaults.baseURL}: ${error.message}`,
      );
    }
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "opencode_ask_sync",
            description:
              "Delegate a coding task to the OpenCode background agent synchronously (blocks until completion).",
            inputSchema: {
              type: "object",
              properties: {
                task: { type: "string" },
                agent: {
                  type: "string",
                  description: "e.g., 'hephaestus', 'momus'",
                },
                model: { type: "string" },
              },
              required: ["task"],
            },
          },
          {
            name: "opencode_ask_async",
            description:
              "Delegate a time-consuming task to the OpenCode background agent asynchronously. Returns a Session ID.",
            inputSchema: {
              type: "object",
              properties: {
                task: { type: "string" },
                agent: { type: "string" },
                model: { type: "string" },
              },
              required: ["task"],
            },
          },
          {
            name: "opencode_get_session",
            description: "Fetch details of an OpenCode session.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                limit: { type: "number" },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "opencode_run_shell",
            description: "Run a shell command autonomously through OpenCode.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
                command: { type: "string" },
                agent: { type: "string" },
              },
              required: ["command"],
            },
          },
          {
            name: "opencode_list_agents",
            description: "List available agents in OpenCode.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "opencode_list_providers",
            description: "List configured LLM providers and models.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "opencode_health_check",
            description: "Check the health and status of the OpenCode server.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "opencode_get_config",
            description:
              "Get the global OpenCode config, including active model, variant, and agent.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "opencode_set_config",
            description:
              "Update the global OpenCode config to switch active model, agent, variant, etc.",
            inputSchema: {
              type: "object",
              properties: {
                config: {
                  type: "object",
                  description:
                    "Key-value pairs to update in the global config (e.g. { model: 'gpt-4', agent: 'hephaestus' })",
                },
              },
              required: ["config"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args: any = request.params.arguments || {};

      try {
        await this.checkOpencodeHealth();

        if (toolName === "opencode_ask_sync") {
          const { task, agent, model } = args;
          const sessionTitle = `MCP Sync Task: ${task.substring(0, 30)}`;
          const sessionRes = await this.apiClient.post("/session", {
            title: sessionTitle,
          });
          const sessionId = sessionRes.data.id;

          const payload: any = { parts: [{ type: "text", text: task }] };
          if (agent) payload.agent = agent;
          if (model) payload.model = model;

          const messageRes = await this.apiClient.post(
            `/session/${sessionId}/message`,
            payload,
          );
          const parts = messageRes.data?.parts || [];
          const textParts = parts
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n\n");

          return {
            content: [
              {
                type: "text",
                text: `Session ID: ${sessionId}\n\nAgent Response:\n${textParts || "Done."}`,
              },
            ],
          };
        }

        if (toolName === "opencode_ask_async") {
          const { task, agent, model } = args;
          const sessionTitle = `MCP Async Task: ${task.substring(0, 30)}`;
          const sessionRes = await this.apiClient.post("/session", {
            title: sessionTitle,
          });
          const sessionId = sessionRes.data.id;

          const payload: any = { parts: [{ type: "text", text: task }] };
          if (agent) payload.agent = agent;
          if (model) payload.model = model;

          await this.apiClient.post(
            `/session/${sessionId}/prompt_async`,
            payload,
          );

          return {
            content: [
              {
                type: "text",
                text: `Background task started. Session ID: ${sessionId}`,
              },
            ],
          };
        }

        if (toolName === "opencode_get_session") {
          const { sessionId, limit = 10 } = args;
          const [sessionInfo, sessionMessages, sessionStatus] =
            await Promise.all([
              this.apiClient.get(`/session/${sessionId}`),
              this.apiClient.get(
                `/session/${sessionId}/message?limit=${limit}`,
              ),
              this.apiClient.get(`/session/status`),
            ]);

          return {
            content: [
              {
                type: "text",
                text: `Status: ${sessionStatus.data?.[sessionId] || "unknown"}\nInfo: ${JSON.stringify(sessionInfo.data)}\nLast Messages: ${JSON.stringify(sessionMessages.data)}`,
              },
            ],
          };
        }

        if (toolName === "opencode_run_shell") {
          const { sessionId, command, agent } = args;
          let targetId = sessionId;
          if (!targetId) {
            const sessionRes = await this.apiClient.post("/session", {
              title: `Shell: ${command}`,
            });
            targetId = sessionRes.data.id;
          }

          const payload: any = { command };
          if (agent) payload.agent = agent;

          const shellRes = await this.apiClient.post(
            `/session/${targetId}/shell`,
            payload,
          );
          return {
            content: [
              {
                type: "text",
                text: `Result:\n${JSON.stringify(shellRes.data)}`,
              },
            ],
          };
        }

        if (toolName === "opencode_list_agents") {
          const agentsRes = await this.apiClient.get(`/agent`);
          return {
            content: [
              {
                type: "text",
                text: `Agents:\n${JSON.stringify(agentsRes.data, null, 2)}`,
              },
            ],
          };
        }

        if (toolName === "opencode_list_providers") {
          const providersRes = await this.apiClient.get(`/provider`);
          return {
            content: [
              {
                type: "text",
                text: `Providers:\n${JSON.stringify(providersRes.data, null, 2)}`,
              },
            ],
          };
        }

        if (toolName === "opencode_health_check") {
          const res = await this.checkOpencodeHealth();
          return {
            content: [
              {
                type: "text",
                text: `Health Status:\n${JSON.stringify(res, null, 2)}`,
              },
            ],
          };
        }

        if (toolName === "opencode_get_config") {
          const configRes = await this.apiClient.get(`/config`);
          return {
            content: [
              {
                type: "text",
                text: `Config:\n${JSON.stringify(configRes.data, null, 2)}`,
              },
            ],
          };
        }

        if (toolName === "opencode_set_config") {
          const { config } = args;
          const configRes = await this.apiClient.patch(`/config`, config);
          return {
            content: [
              {
                type: "text",
                text: `Config Updated:\n${JSON.stringify(configRes.data, null, 2)}`,
              },
            ],
          };
        }

        throw new Error(`Unknown tool: ${toolName}`);
      } catch (error: any) {
        let msg = error.message;
        if (error.response?.data)
          msg += ` - API: ${JSON.stringify(error.response.data)}`;
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    });
  }
}
