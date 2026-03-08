import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import type { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { createOpencodeServer } from "@opencode-ai/sdk/server";

export interface OpenCodeConfig {
  url: string;
  username?: string;
  password?: string;
  maxRetries?: number;
  /** Enable auto-starting OpenCode serve if not reachable. Default: true */
  autoStart?: boolean;
  /** Port for auto-started OpenCode server. Default: 4096 */
  autoStartPort?: number;
  /** Health check cache TTL in milliseconds. Default: 30000 */
  healthCacheTtlMs?: number;
}

/** Internal state for the auto-spawned OpenCode process */
interface ManagedProcess {
  url: string;
  close: () => void;
}

export class OpenCodeMcpServer {
  public server: Server;
  public apiClient: AxiosInstance;

  private readonly config: OpenCodeConfig;
  private managedProcess: ManagedProcess | null = null;
  private isStartingOpenCode = false;

  // Health check cache
  private lastHealthCheck: { timestamp: number; data: any } | null = null;
  private readonly healthCacheTtlMs: number;

  constructor(config: OpenCodeConfig) {
    this.config = config;
    this.healthCacheTtlMs = config.healthCacheTtlMs ?? 30_000;

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
      timeout: 0, // No global timeout; individual endpoints set their own as needed
    });

    if (config.password) {
      this.apiClient.defaults.auth = {
        username: config.username || "opencode",
        password: config.password,
      };
    }

    // Retry policy: handles rate limits, server errors, and transient connection failures
    axiosRetry(this.apiClient, {
      retries: config.maxRetries || 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        // Retry on connection errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT)
        if (axiosRetry.isNetworkOrIdempotentRequestError(error)) {
          return true;
        }
        const status = error.response?.status ?? 0;
        // Retry on 429 Too Many Requests or 5xx server errors
        return status === 429 || status >= 500;
      },
      onRetry: (retryCount, error, requestConfig) => {
        this.logError(
          `[Retry] Request ${requestConfig.url} (Attempt ${retryCount}): ${error.message}`,
        );
      },
    });

    this.setupHandlers();
  }

  private logError(...args: any[]) {
    if (process.env.NODE_ENV !== "test") {
      console.error(...args);
    }
  }

  /**
   * Ensures an OpenCode server is reachable, auto-starting one if configured.
   * Returns once the server is healthy or throws if all attempts fail.
   */
  async ensureOpenCodeRunning(): Promise<void> {
    // Try existing server first
    try {
      await this.checkOpencodeHealth();
      return;
    } catch {
      // Not reachable — try auto-start if enabled
    }

    if (this.config.autoStart === false) {
      throw new Error(
        `OpenCode server is not reachable at ${this.config.url}. ` +
          `Start it manually: opencode serve --port ${this.config.autoStartPort ?? 4096} ` +
          `or set OPENCODE_SERVER_URL to point to a running instance.`,
      );
    }

    // Prevent concurrent start attempts
    if (this.isStartingOpenCode) {
      // Wait for the in-progress start to complete
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (!this.isStartingOpenCode) break;
      }
      // Verify it worked
      await this.checkOpencodeHealth();
      return;
    }

    this.isStartingOpenCode = true;
    try {
      this.logError(
        `[OpenCode-MCP] Auto-starting OpenCode server on port ${this.config.autoStartPort ?? 4096}...`,
      );

      const managed = await createOpencodeServer({
        port: this.config.autoStartPort ?? 4096,
        hostname: "127.0.0.1",
        timeout: 15_000,
      });

      this.managedProcess = managed;

      // Update the axios baseURL to the actual URL returned by the SDK
      this.apiClient.defaults.baseURL = managed.url;

      this.logError(
        `[OpenCode-MCP] OpenCode server auto-started at ${managed.url}`,
      );

      // Validate health after start
      await this.checkOpencodeHealth();
    } catch (error: any) {
      throw new Error(
        `Failed to auto-start OpenCode server: ${error.message}. ` +
          `Start it manually: opencode serve --port ${this.config.autoStartPort ?? 4096}`,
      );
    } finally {
      this.isStartingOpenCode = false;
    }
  }

  /**
   * Validates that the OpenCode server is accessible.
   * Results are cached with a configurable TTL to minimize redundant network requests.
   */
  async checkOpencodeHealth() {
    // Return cached result if still fresh
    if (this.lastHealthCheck) {
      const age = Date.now() - this.lastHealthCheck.timestamp;
      if (age < this.healthCacheTtlMs) {
        return this.lastHealthCheck.data;
      }
    }

    try {
      const res = await this.apiClient.get("/global/health", { timeout: 5000 });
      if (!res.data?.healthy) {
        throw new Error(
          `OpenCode server returned unhealthy status: ${JSON.stringify(res.data)}`,
        );
      }

      // Cache the successful result
      this.lastHealthCheck = { timestamp: Date.now(), data: res.data };
      return res.data;
    } catch (error: any) {
      // Invalidate cache on failure
      this.lastHealthCheck = null;

      if (error.response) {
        throw new Error(
          `OpenCode server error (${error.response.status}): ${JSON.stringify(error.response.data)}`,
        );
      }

      const baseURL = this.apiClient.defaults.baseURL;
      throw new Error(
        `Failed to connect to OpenCode server at ${baseURL}: ${error.message}. ` +
          `Ensure OpenCode is running: opencode serve --port 4096`,
      );
    }
  }

  /** Invalidates the health check cache, forcing a fresh validation on next check. */
  invalidateHealthCache() {
    this.lastHealthCheck = null;
  }

  /**
   * Gracefully shut down the MCP server and any managed OpenCode process.
   */
  async shutdown(): Promise<void> {
    this.logError("[OpenCode-MCP] Shutting down...");

    try {
      await this.server.close();
    } catch {
      // Server may already be closed
    }

    if (this.managedProcess) {
      this.logError(
        "[OpenCode-MCP] Terminating managed OpenCode server process...",
      );
      try {
        this.managedProcess.close();
      } catch {
        // Process may already be terminated
      }
      this.managedProcess = null;
    }

    this.lastHealthCheck = null;
    this.logError("[OpenCode-MCP] Shutdown complete.");
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
                agent: {
                  type: "string",
                  description: "Required agent ID to execute the shell command",
                },
              },
              required: ["command", "agent"],
            },
          },
          {
            name: "opencode_abort_session",
            description:
              "Abort a currently running or stuck OpenCode session or background task.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
              },
              required: ["sessionId"],
            },
          },
          {
            name: "opencode_delete_session",
            description:
              "Delete an OpenCode session to clean up the workspace history.",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string" },
              },
              required: ["sessionId"],
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
      const logPrefix = `[OpenCode-MCP][${toolName}]`;
      this.logError(`${logPrefix} Executing tool request...`, args);

      try {
        // Validate server availability (auto-provisions if configured, uses cached health state)
        await this.ensureOpenCodeRunning();
        this.logError(`${logPrefix} OpenCode server is available.`);

        if (toolName === "opencode_ask_sync") {
          const { task, agent, model } = args;
          if (!task || typeof task !== "string" || task.trim().length === 0) {
            throw new Error("Validation error: 'task' is required and must be a non-empty string.");
          }
          const sessionTitle = `MCP Sync Task: ${task.substring(0, 30)}`;
          const sessionRes = await this.apiClient.post("/session", {
            title: sessionTitle,
          });
          const sessionId = sessionRes.data.id;

          const payload: any = { parts: [{ type: "text", text: task }] };
          if (agent) payload.agent = agent;
          if (model) payload.model = model;

          // Dispatch asynchronously to prevent blocking on streaming SSE responses
          await this.apiClient.post(
            `/session/${sessionId}/prompt_async`,
            payload,
          );

          // Poll for completion status to provide synchronous semantics over the async API
          let isRunning = true;
          let attempts = 0;
          let lastStatusObj: any = null;
          const pollDelay = process.env.NODE_ENV === "test" ? 100 : 5000;
          while (isRunning && attempts < 120) {
            // Max ~10 mins
            await new Promise((r) => setTimeout(r, pollDelay));
            try {
              const statusRes = await this.apiClient.get("/session/status");
              const status = statusRes.data?.[sessionId];
              if (status) lastStatusObj = status;

              // Handle both primitive string statuses and complex object statuses (like retries or errors)
              const statusValue =
                typeof status === "object" ? status.type : status;

              if (
                !statusValue ||
                ["waiting_for_user", "stopped", "error", "retry"].includes(
                  statusValue,
                )
              ) {
                isRunning = false;
              }
            } catch (e) {
              this.logError(`${logPrefix} Polling error:`, e);
            }
            attempts++;
          }

          // Fetch final messages to get the outcome
          let summary = "Done.";
          try {
            const messageRes = await this.apiClient.get(
              `/session/${sessionId}/message?limit=10`,
            );
            const messages = messageRes.data || [];

            // Aggregate text content from the most recent messages
            const textParts = messages
              .map(
                (m: any) =>
                  m.parts
                    ?.filter((p: any) => p.type === "text")
                    .map((p: any) => p.text)
                    .join("\n") || "",
              )
              .filter(Boolean)
              .join("\n\n---\n\n");

            if (textParts.length > 0) {
              summary = textParts;
            } else if (
              lastStatusObj &&
              typeof lastStatusObj === "object" &&
              lastStatusObj.message
            ) {
              summary = `Task stopped. Status: ${lastStatusObj.type} - ${lastStatusObj.message}`;
            }
          } catch (e) {
            this.logError(`${logPrefix} Error fetching final messages:`, e);
          }

          return {
            content: [
              {
                type: "text",
                text: `Session ID: ${sessionId}\n\nAgent Response:\n${summary}`,
              },
            ],
          };
        }

        if (toolName === "opencode_ask_async") {
          const { task, agent, model } = args;
          if (!task || typeof task !== "string" || task.trim().length === 0) {
            throw new Error("Validation error: 'task' is required and must be a non-empty string.");
          }
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
          if (!command || typeof command !== "string" || command.trim().length === 0) {
            throw new Error("Validation error: 'command' is required and must be a non-empty string.");
          }
          if (!agent || typeof agent !== "string" || agent.trim().length === 0) {
            throw new Error("Validation error: 'agent' is required and must be a non-empty string.");
          }
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

        if (toolName === "opencode_abort_session") {
          const { sessionId } = args;
          if (!sessionId || typeof sessionId !== "string") {
            throw new Error("Validation error: 'sessionId' is required and must be a string.");
          }
          await this.apiClient.post(`/session/${sessionId}/abort`);
          return {
            content: [
              {
                type: "text",
                text: `Session ${sessionId} aborted successfully.`,
              },
            ],
          };
        }

        if (toolName === "opencode_delete_session") {
          const { sessionId } = args;
          if (!sessionId || typeof sessionId !== "string") {
            throw new Error("Validation error: 'sessionId' is required and must be a string.");
          }
          await this.apiClient.delete(`/session/${sessionId}`);
          return {
            content: [
              {
                type: "text",
                text: `Session ${sessionId} deleted successfully.`,
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
          // Force a fresh health check (bypass cache)
          this.invalidateHealthCache();
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
          if (!config || typeof config !== "object") {
            throw new Error("Validation error: 'config' is required and must be an object.");
          }
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

        throw new Error(`Unrecognized tool: ${toolName}`);
      } catch (error: any) {
        // Invalidate cache on any error to force re-check next time
        this.invalidateHealthCache();

        let msg = error.message;
        if (error.response?.data)
          msg += ` - API: ${JSON.stringify(error.response.data)}`;

        this.logError(`${logPrefix} Error executing tool: ${msg}`, error.stack);

        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    });
  }
}
