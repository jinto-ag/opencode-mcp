import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createOpencodeServer } from "@opencode-ai/sdk/server";
import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk/client";
import { OMOConfigManager } from "./orchestrator/config.js";
import { OMOOrchestrator } from "./orchestrator/omo.js";
import { OMO_PERSONAS } from "./agents/personas.js";
import { OMODiscovery } from "./orchestrator/discovery.js";
import { execa } from "execa";

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

interface ManagedProcess {
  url: string;
  close: () => void;
}

export class OpenCodeMcpServer {
  public server: Server;
  public apiClient: OpencodeClient;

  public readonly config: OpenCodeConfig;
  private managedProcess: ManagedProcess | null = null;
  private isStartingOpenCode = false;

  private lastHealthCheck: { timestamp: number; data: any } | null = null;
  private readonly healthCacheTtlMs: number;

  private omoConfig: OMOConfigManager;
  private omo: OMOOrchestrator;
  private omoDiscovery: OMODiscovery;

  constructor(config: OpenCodeConfig) {
    this.config = config;
    this.healthCacheTtlMs = config.healthCacheTtlMs ?? 30_000;

    this.server = new Server(
      { name: "opencode-mcp-server", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    let authHeader: string | undefined = undefined;
    if (config.username || config.password) {
      const b64 = Buffer.from(
        `${config.username || "opencode"}:${config.password || ""}`,
      ).toString("base64");
      authHeader = `Basic ${b64}`;
    }

    this.apiClient = createOpencodeClient({
      baseUrl: config.url,
      headers: authHeader ? { Authorization: authHeader } : undefined,
    });

    this.omoConfig = new OMOConfigManager();
    this.omoDiscovery = new OMODiscovery();
    this.omo = new OMOOrchestrator(this.apiClient, this.omoConfig);

    this.setupHandlers();
  }

  async init(): Promise<void> {
    await this.omoConfig.init();
    await this.omoDiscovery.discover();
  }

  private logError(...args: any[]) {
    if (process.env.NODE_ENV !== "test") {
      console.error(...args);
    }
  }

  async ensureOpenCodeRunning(): Promise<void> {
    try {
      await this.checkOpencodeHealth();
      return;
    } catch {
      // Not reachable
    }

    if (this.config.autoStart === false) {
      throw new Error(
        `OpenCode server is not reachable at ${this.config.url}. Start it manually.`,
      );
    }

    if (this.isStartingOpenCode) {
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (!this.isStartingOpenCode) break;
      }
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

      let authHeader: string | undefined = undefined;
      if (this.config.username || this.config.password) {
        const b64 = Buffer.from(
          `${this.config.username || "opencode"}:${this.config.password || ""}`,
        ).toString("base64");
        authHeader = `Basic ${b64}`;
      }
      
      this.apiClient = createOpencodeClient({
        baseUrl: managed.url,
        headers: authHeader ? { Authorization: authHeader } : undefined,
      });

      this.logError(`[OpenCode-MCP] OpenCode server auto-started at ${managed.url}`);
      await this.checkOpencodeHealth();
    } catch (error: any) {
      throw new Error(`Failed to auto-start OpenCode server: ${error.message}`);
    } finally {
      this.isStartingOpenCode = false;
    }
  }

  async checkOpencodeHealth() {
    if (this.lastHealthCheck) {
      const age = Date.now() - this.lastHealthCheck.timestamp;
      if (age < this.healthCacheTtlMs) {
        return this.lastHealthCheck.data;
      }
    }

    try {
      const res = await this.apiClient.app.agents({ throwOnError: true });
      if (!res.data) {
        throw new Error("Opencode API returned no data for agents health proxy");
      }

      const data = { healthy: true, agentsCount: Object.keys(res.data).length };
      this.lastHealthCheck = { timestamp: Date.now(), data };
      return data;
    } catch (error: any) {
      this.lastHealthCheck = null;
      throw new Error(`Failed to connect to OpenCode server at ${this.config.url}: ${error.message}`);
    }
  }

  invalidateHealthCache() {
    this.lastHealthCheck = null;
  }

  async shutdown(): Promise<void> {
    this.logError("[OpenCode-MCP] Shutting down...");
    try { await this.server.close(); } catch {}
    if (this.managedProcess) {
      try { this.managedProcess.close(); } catch {}
      this.managedProcess = null;
    }
    this.lastHealthCheck = null;
    this.logError("[OpenCode-MCP] Shutdown complete.");
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolList: any[] = [
        {
          name: "opencode_ask_sync",
          description: "Delegate a task to OpenCode synchronously.",
          inputSchema: { type: "object", properties: { task: { type: "string" }, agent: { type: "string" }, model: { type: "string" } }, required: ["task"] },
          discovery: { type: "text", text: "For complex tasks requiring higher accuracy, consider using omo_sisyphus or other omo_ agents." }
        },
        {
          name: "opencode_ask_async",
          description: "Delegate a task to OpenCode asynchronously. Returns Session ID.",
          inputSchema: { type: "object", properties: { task: { type: "string" }, agent: { type: "string" }, model: { type: "string" } }, required: ["task"] },
        },
        {
          name: "opencode_get_session",
          description: "Fetch details of an OpenCode session.",
          inputSchema: { type: "object", properties: { sessionId: { type: "string" }, limit: { type: "number" } }, required: ["sessionId"] },
        },
        {
          name: "opencode_run_shell",
          description: "Run a shell command autonomously.",
          inputSchema: { type: "object", properties: { sessionId: { type: "string" }, command: { type: "string" }, agent: { type: "string" } }, required: ["command", "agent"] },
        },
        {
          name: "opencode_abort_session",
          description: "Abort a session.",
          inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
        },
        {
          name: "opencode_delete_session",
          description: "Delete a session.",
          inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
        },
        {
          name: "opencode_list_agents",
          description: "List available agents.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "opencode_list_providers",
          description: "List providers and models.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "opencode_health_check",
          description: "Check server health.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "opencode_get_config",
          description: "Get global OpenCode config.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "opencode_set_config",
          description: "Update global OpenCode config.",
          inputSchema: { type: "object", properties: { config: { type: "object" } }, required: ["config"] },
        },
        {
          name: "opencode_session_diff",
          description: "Get the diff for a session.",
          inputSchema: { type: "object", properties: { sessionId: { type: "string" }, messageId: { type: "string" } }, required: ["sessionId"] },
        },
        {
          name: "opencode_session_fork",
          description: "Fork a session.",
          inputSchema: { type: "object", properties: { sessionId: { type: "string" }, messageId: { type: "string" } }, required: ["sessionId"] },
        },
        {
          name: "opencode_session_revert",
          description: "Revert a session's workspace.",
          inputSchema: { type: "object", properties: { sessionId: { type: "string" }, messageId: { type: "string" } }, required: ["sessionId", "messageId"] },
        },
        // OMO Native Orchestration Tools
        {
          name: "omo_sisyphus",
          description: "Run a high-accuracy Plan -> Execute -> Verify loop for complex tasks.",
          inputSchema: { type: "object", properties: { task: { type: "string" }, model: { type: "string" } }, required: ["task"] },
        },
        {
          name: "omo_get_config",
          description: "Get the current oh-my-opencode native orchestration configuration.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "omo_set_config",
          description: "Update the oh-my-opencode native orchestration configuration.",
          inputSchema: { 
            type: "object", 
            properties: { 
              fallbackModels: { type: "array", items: { type: "string" } },
              maxRetries: { type: "number" },
              sisyphusMaxLoops: { type: "number" },
              ulwMaxIterations: { type: "number" },
              ralphMaxIterations: { type: "number" },
              accuracyThreshold: { type: "number" }
            } 
          },
        },
        {
          name: "opencode_list_commands",
          description: "List available native commands.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "opencode_execute_command",
          description: "Execute a native command.",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string", description: "The name of the command to execute." },
              args: { type: "object", description: "Arguments for the command as a JSON object." },
              sessionId: { type: "string", description: "Optional session ID to execute the command within." },
            },
            required: ["command"],
          },
        },
        {
          name: "opencode_manage_skills",
          description: "Manage OpenCode skills using the skills CLI (find, add, rm, update, ls).",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["find", "add", "rm", "update", "ls"], description: "The action to perform." },
              packageName: { type: "string", description: "The package name or search query (required for find, add, rm)." },
              global: { type: "boolean", description: "Apply globally.", default: true }
            },
            required: ["action"],
          },
        },
        {
          name: "omo_refresh_discovery",
          description: "Reload available OMO agents from native config.",
          inputSchema: { type: "object", properties: {} },
        }
      ];

      const personas = await this.omoDiscovery.getAvailableAgents();
      for (const [key, persona] of Object.entries(personas)) {
        if (key === "sisyphus") continue;
        toolList.push({
          name: `omo_${key}`,
          description: `Run the ${persona.name} agent: ${persona.description}`,
          inputSchema: {
            type: "object",
            properties: {
              task: { type: "string" },
              model: { type: "string" },
              sessionId: { type: "string" },
              mode: { type: "string", enum: ["normal", "ulw", "ralph"], default: "normal" }
            },
            required: ["task"]
          }
        });
      }

      return { tools: toolList };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args: any = request.params.arguments || {};
      const logPrefix = `[OpenCode-MCP][${toolName}]`;

      try {
        await this.ensureOpenCodeRunning();

        if (toolName === "opencode_ask_sync") {
          const { task, agent, model } = args;
          if (!task || typeof task !== "string" || task.trim().length === 0) throw new Error("task required");
          
          const sessionTitle = `MCP Sync Task: ${task.substring(0, 30)}`;
          const sess = await this.apiClient.session.create({ body: { title: sessionTitle }, throwOnError: true });
          const sessionId = sess.data.id;

          const payload: any = { parts: [{ type: "text", text: task }] };
          if (agent) payload.agent = agent;
          if (model) payload.model = model;

          await this.apiClient.session.promptAsync({ path: { id: sessionId }, body: payload, throwOnError: true });

          let isRunning = true;
          let attempts = 0;
          let lastStatusObj: any = null;
          const pollDelay = process.env.NODE_ENV === "test" ? 100 : 5000;
          
          while (isRunning && attempts < 120) {
            await new Promise((r) => setTimeout(r, pollDelay));
            try {
              const statusRes = await this.apiClient.session.status({ throwOnError: true });
              const status = (statusRes.data as any)?.[sessionId];
              
              if (status) lastStatusObj = status;
              const statusValue = typeof status === "object" ? status.type : status;

              if (!statusValue || ["waiting_for_user", "stopped", "error", "retry"].includes(statusValue)) {
                isRunning = false;
              }
            } catch (e) {
              this.logError(`${logPrefix} Polling error:`, e);
            }
            attempts++;
          }

          if (isRunning) {
            // Abort it if we timed out
            try { await this.apiClient.session.abort({ path: { id: sessionId }, throwOnError: true }); } catch {}
          }

          let summary = "Done.";
          try {
            const messageRes = await this.apiClient.session.messages({ path: { id: sessionId }, query: { limit: 10 }, throwOnError: true });
            const messages = (messageRes.data || []) as any[];

            const textParts = messages
              .map(m => m.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") || "")
              .filter(Boolean)
              .join("\n\n---\n\n");

            if (textParts.length > 0) {
              summary = textParts;
            } else if (lastStatusObj && typeof lastStatusObj === "object" && lastStatusObj.message) {
              summary = `Task stopped. Status: ${lastStatusObj.type} - ${lastStatusObj.message}`;
            }

            // Accuracy Discovery Hint
            summary += "\n\n---\n💡 *Tip: For complex engineering tasks requiring higher accuracy, try using the high-accuracy orchestrator tool: `omo_sisyphus`.*";

            return { content: [{ type: "text", text: `Session ID: ${sessionId}\n\nAgent Response:\n${summary}` }] };
          } catch (e) {
            this.logError(`${logPrefix} Error fetching final messages:`, e);
          }

          return { content: [{ type: "text", text: `Session ID: ${sessionId}\n\nAgent Response:\n${summary}` }] };
        }

        if (toolName === "opencode_ask_async") {
          const { task, agent, model } = args;
          if (!task || typeof task !== "string" || task.trim().length === 0) throw new Error("task required");
          const sess = await this.apiClient.session.create({ body: { title: `MCP Async Task: ${task.substring(0, 30)}` }, throwOnError: true });
          const sessionId = sess.data.id;

          const payload: any = { parts: [{ type: "text", text: task }] };
          if (agent) payload.agent = agent;
          if (model) payload.model = model;

          await this.apiClient.session.promptAsync({ path: { id: sessionId }, body: payload, throwOnError: true });
          return { content: [{ type: "text", text: `Background task started. Session ID: ${sessionId}` }] };
        }

        if (toolName === "opencode_get_session") {
          const { sessionId, limit = 10 } = args;
          if (!sessionId) throw new Error("sessionId required");
          
          const sessionInfo = await this.apiClient.session.get({ path: { id: sessionId }, throwOnError: true });
          const sessionMessages = await this.apiClient.session.messages({ path: { id: sessionId }, query: { limit }, throwOnError: true });
          const sessionStatus = await this.apiClient.session.status({ throwOnError: true });

          return {
            content: [{
              type: "text",
              text: `Status: ${(sessionStatus.data as any)?.[sessionId] || "unknown"}\nInfo: ${JSON.stringify(sessionInfo.data)}\nLast Messages: ${JSON.stringify(sessionMessages.data)}`,
            }],
          };
        }

        if (toolName === "opencode_run_shell") {
          const { sessionId, command, agent } = args;
          if (!command || typeof command !== "string" || command.trim().length === 0) throw new Error("command required");
          if (!agent || typeof agent !== "string" || agent.trim().length === 0) throw new Error("agent required");
          
          let targetId = sessionId;
          let createdSession = false;
          
          if (!targetId) {
            const sess = await this.apiClient.session.create({ body: { title: `Shell: ${command}` }, throwOnError: true });
            targetId = sess.data.id;
            createdSession = true;
          }

          const payload: any = { command };
          if (agent) payload.agent = agent;

          try {
            const shellRes = await this.apiClient.session.shell({ path: { id: targetId }, body: payload, throwOnError: true });
            return { content: [{ type: "text", text: `Result:\n${JSON.stringify(shellRes.data)}` }] };
          } finally {
            if (createdSession) {
              try { await this.apiClient.session.delete({ path: { id: targetId }, throwOnError: true }); } catch {}
            }
          }
        }

        if (toolName === "opencode_abort_session") {
          const { sessionId } = args;
          if (!sessionId) throw new Error("sessionId required");
          await this.apiClient.session.abort({ path: { id: sessionId }, throwOnError: true });
          return { content: [{ type: "text", text: `Session ${sessionId} aborted successfully.` }] };
        }

        if (toolName === "opencode_delete_session") {
          const { sessionId } = args;
          if (!sessionId) throw new Error("sessionId required");
          await this.apiClient.session.delete({ path: { id: sessionId }, throwOnError: true });
          return { content: [{ type: "text", text: `Session ${sessionId} deleted successfully.` }] };
        }

        if (toolName === "opencode_list_agents") {
          const res = await this.apiClient.app.agents({ throwOnError: true });
          return { content: [{ type: "text", text: `Agents:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_list_providers") {
          const res = await this.apiClient.config.providers({ throwOnError: true });
          return { content: [{ type: "text", text: `Providers:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_health_check") {
          this.invalidateHealthCache();
          const res = await this.checkOpencodeHealth();
          return { content: [{ type: "text", text: `Status: ${res.healthy ? "Healthy" : "Unhealthy"}\nAgents: ${res.agentsCount}` }] };
        }

        if (toolName === "opencode_get_config") {
          const res = await this.apiClient.config.get({ throwOnError: true });
          return { content: [{ type: "text", text: `Config:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_set_config") {
          const { config } = args;
          if (!config || typeof config !== "object") throw new Error("config object required");
          const res = await this.apiClient.config.update({ body: config, throwOnError: true });
          return { content: [{ type: "text", text: `Config Updated:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_mcp_status") {
          const res = await this.apiClient.mcp.status({ throwOnError: true });
          return { content: [{ type: "text", text: `MCP Servers:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_mcp_add") {
          const { name, config: mcpConfig } = args;
          if (!name || typeof name !== "string") throw new Error("name string required");
          if (!mcpConfig || typeof mcpConfig !== "object") throw new Error("config object required");
          const res = await this.apiClient.mcp.add({ body: { name, config: mcpConfig }, throwOnError: true });
          return { content: [{ type: "text", text: `MCP Server added:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_mcp_remove") {
          const { name } = args;
          if (!name || typeof name !== "string") throw new Error("name string required");
          const res = await this.apiClient.mcp.auth.remove({ path: { name }, throwOnError: true });
          return { content: [{ type: "text", text: `MCP Server ${name} removed.` }] };
        }

        if (toolName === "opencode_pty_create") {
          const { cols, rows, cwd } = args;
          const body: any = {};
          if (cols) body.cols = cols;
          if (rows) body.rows = rows;
          if (cwd) body.cwd = cwd;

          const res = await this.apiClient.pty.create({ body, throwOnError: true });
          return { content: [{ type: "text", text: `PTY Session Created:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_pty_list") {
          const res = await this.apiClient.pty.list({ throwOnError: true });
          return { content: [{ type: "text", text: `PTY Sessions:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_session_diff") {
          const { sessionId, messageId } = args;
          if (!sessionId) throw new Error("sessionId required");
          const query: any = {};
          if (messageId) query.messageID = messageId;
          const res = await this.apiClient.session.diff({ path: { id: sessionId }, query, throwOnError: true });
          return { content: [{ type: "text", text: `Session Diff:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_session_fork") {
          const { sessionId, messageId } = args;
          if (!sessionId) throw new Error("sessionId required");
          const query: any = {};
          if (messageId) query.messageID = messageId;
          const res = await this.apiClient.session.fork({ path: { id: sessionId }, query, throwOnError: true });
          return { content: [{ type: "text", text: `Session Forked:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        if (toolName === "opencode_session_revert") {
          const { sessionId, messageId } = args;
          if (!sessionId) throw new Error("sessionId required");
          if (!messageId) throw new Error("messageId required");
          const res = await this.apiClient.session.revert({
            path: { id: sessionId },
            body: { messageID: messageId },
            throwOnError: true
          });
          return { content: [{ type: "text", text: `Session Reverted to ${messageId}:\n${JSON.stringify(res.data, null, 2)}` }] };
        }

        // --- OMO Native Orchestration Tools ---

        if (toolName === "omo_sisyphus") {
          const { task, model } = args;
          if (!task || typeof task !== "string") throw new Error("task required");
          const result = await this.omo.runSisyphusTask(task, model);
          return { content: [{ type: "text", text: result }] };
        }

        if (toolName === "omo_get_config") {
          const config = this.omoConfig.get();
          return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
        }

        if (toolName === "omo_set_config") {
          const newConfig = await this.omoConfig.update(args);
          return { content: [{ type: "text", text: `OMO Config Updated:\n${JSON.stringify(newConfig, null, 2)}` }] };
        }

        if (toolName === "opencode_list_commands") {
          const res = await fetch(`${this.config.url}/command`);
          if (!res.ok) throw new Error(`Failed to fetch commands: ${res.status}`);
          const commands = await res.json() as Array<{name: string, description: string, source: string}>;
          const formatted = commands.map(c => `- **${c.name}** (${c.source}): ${c.description || 'No description'}`).join('\n');
          return { content: [{ type: "text", text: `Available Commands & Skills:\n\n${formatted}` }] };
        }

        if (toolName === "opencode_execute_command") {
          let sessionId = args.sessionId;
          
          if (!sessionId) {
            const sessRes = await fetch(`${this.config.url}/session`, { method: "POST" });
            if (!sessRes.ok) throw new Error("Failed to create session");
            sessionId = ((await sessRes.json()) as any).id;
          }
          
          const execRes = await fetch(`${this.config.url}/session/${sessionId}/command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command: args.command,
              arguments: args.args,
              agent: args.agent,
              model: args.model
            })
          });

          if (!execRes.ok) {
              const body = await execRes.text();
              throw new Error(`Command execution failed: ${body}`);
          }

          return { content: [{ type: "text", text: `Command successfully executed in session ${sessionId}.` }] };
        }

        if (toolName === "opencode_manage_skills") {
          const { action, packageName, global } = args as { action: string, packageName?: string, global?: boolean };
          const argsList: string[] = ["--yes", "skills@latest", action];
          
          if (["find", "add", "rm"].includes(action)) {
            if (!packageName) {
              throw new Error(`packageName is required for action '${action}'`);
            }
            argsList.push(packageName);
          }

          if (global !== false) {
             argsList.push("-g");
          }
          if (["add", "rm"].includes(action)) {
             argsList.push("-y");
          }

          try {
            const { stdout, stderr } = await execa("bunx", argsList);
            return { content: [{ type: "text", text: `Success:\n${stdout}\n${stderr}`.trim() }] };
          } catch (e: any) {
            throw new Error(`Skills CLI failed: ${e.message}\nStdout: ${e.stdout}\nStderr: ${e.stderr}`);
          }
        }

        if (toolName === "omo_refresh_discovery") {
          await this.omoDiscovery.discover();
          return { content: [{ type: "text", text: "OMO Discovery refreshed. New agents and commands reloaded." }] };
        }

        if (toolName.startsWith("omo_")) {
          const personaName = toolName.replace("omo_", "");
          const personas = await this.omoDiscovery.getAvailableAgents();
          const persona = personas[personaName];
          if (!persona) throw new Error(`Unknown OMO agent: ${personaName}`);

          const { task, model, sessionId, mode } = args;
          if (!task || typeof task !== "string") throw new Error("task required");

          const result = await this.omo.runAgentWithMode(task, persona, mode || "normal", model, sessionId);
          return { 
            content: [{ 
              type: "text", 
              text: `[OMO Agent: ${persona.name}] Mode: ${mode || "normal"}\n\nResult:\n${result}` 
            }] 
          };
        }

        throw new Error(`Unrecognized tool: ${toolName}`);
      } catch (error: any) {
        this.invalidateHealthCache();
        
        let msg = "Unknown error";
        if (error instanceof Error) {
          msg = error.message;
        } else if (typeof error === "string") {
          msg = error;
        } else if (error && typeof error === "object") {
          msg = error.message || error.error || JSON.stringify(error);
        }

        if (error?.response?.data) {
          msg += ` - API: ${JSON.stringify(error.response.data)}`;
        }

        this.logError(`${logPrefix} Error executing tool: ${msg}`, error?.stack);
        return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    });
  }
}
