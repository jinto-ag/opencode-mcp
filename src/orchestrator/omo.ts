import { OpencodeClient } from "@opencode-ai/sdk";
import { OMOConfigManager } from "./config.js";
import { ResilienceEngine } from "./resilience.js";
import { OMO_PERSONAS } from "../agents/personas.js";
import type { AgentPersona } from "../agents/personas.js";

/**
 * OMOOrchestrator
 * High-accuracy multi-agent orchestrator implementing Plan -> Execute -> Verify.
 */

export class OMOOrchestrator {
  private resilience: ResilienceEngine;

  constructor(
    private client: OpencodeClient,
    private configManager: OMOConfigManager
  ) {
    this.resilience = new ResilienceEngine(client, configManager);
  }
  
  private logInfo(...args: any[]) {
    if (process.env.NODE_ENV !== "test") {
      console.error(...args);
    }
  }

  /**
   * Run an agent task with a specific mode (e.g., 'ulw', 'ralph', 'normal').
   * This is the refined, mode-aware orchestration entry point.
   */
  async runAgentWithMode(
    task: string, 
    persona: AgentPersona, 
    mode: "normal" | "ulw" | "ralph" = "normal",
    modelHint?: string,
    sessionId?: string
  ): Promise<string> {
    const config = this.configManager.get();
    
    if (mode === "normal") {
      const res = await this.runAgentTask(task, persona, modelHint, sessionId);
      return res.content;
    }

    const maxIterations = mode === "ulw" ? config.ulwMaxIterations : config.ralphMaxIterations;
    const continuationPrompt = mode === "ulw" 
      ? `ultrawork: Continue the task until 100% complete. If done, reply with ${config.ralphCompletionMarker}.`
      : `Continue working on the task. If finished, reply with ${config.ralphCompletionMarker}.`;

    return this.runGeneralLoop(
      task, 
      mode.toUpperCase(), 
      maxIterations, 
      continuationPrompt, 
      persona,
      modelHint,
      sessionId
    );
  }

  /**
   * Generic iterative loop implementation.
   */
  private async runGeneralLoop(
    task: string, 
    type: string, 
    maxIterations: number, 
    continuationPrompt: string, 
    persona: AgentPersona,
    modelHint?: string,
    existingSessionId?: string
  ): Promise<string> {
    const config = this.configManager.get();
    let iteration = 0;
    let lastResult = "";
    let sessionId = existingSessionId;

    this.logInfo(`[OMO-${type}] Starting task with persona ${persona.name}: ${task}`);

    while (iteration < maxIterations) {
      iteration++;
      this.logInfo(`[OMO-${type}] Iteration ${iteration}/${maxIterations}`);

      const response = await this.runAgentTask(
        iteration === 1 ? task : continuationPrompt,
        persona,
        modelHint,
        sessionId
      );

      lastResult = response.content;
      sessionId = response.sessionId;

      if (this.isTaskComplete(lastResult, config.ralphCompletionMarker)) {
        this.logInfo(`[OMO-${type}] Task completed on iteration ${iteration}.`);
        return `[${type}-COMPLETE] Task finished successfully.\n\nSession ID: ${sessionId}\n\nResult:\n${lastResult}`;
      }
    }

    return `[${type}-TIMEOUT] Reached max iterations (${maxIterations}).\n\nFinal Result:\n${lastResult}`;
  }

  private isTaskComplete(content: string, marker: string): boolean {
    const lowerContent = content.toLowerCase();
    const lowerMarker = marker.toLowerCase();
    
    // Check for explicit marker
    if (lowerContent.includes(lowerMarker)) return true;
    
    // Heuristic: If it says "done" or [passed] and is short, it might be a completion signal
    if ((lowerContent.includes("done") || lowerContent.includes("[passed]")) && content.length < 100) {
      return true;
    }

    return false;
  }

  /**
   * Run a task using the Sisyphus orchestrator persona.
   * Implements a resilient implementation-verification loop.
   */
  async runSisyphusTask(task: string, modelHint?: string): Promise<string> {
    const config = this.configManager.get();
    let currentTask = task;
    let iteration = 0;
    let lastResult = "";
    let sessionId: string | undefined;

    this.logInfo(`[OMO-Sisyphus] Starting Task: ${task}`);

    while (iteration < config.sisyphusMaxLoops) {
      iteration++;
      this.logInfo(`[OMO-Sisyphus] Iteration ${iteration}/${config.sisyphusMaxLoops}`);

      // 1. Implementation Phase (Hephaestus Persona)
      const executionResult = await this.runAgentTask(
        `Implement the following task. If this is a correction from a previous review, apply the fixes carefully:\n\n${currentTask}`,
        OMO_PERSONAS.hephaestus!,
        modelHint,
        sessionId
      );
      
      lastResult = executionResult.content;
      sessionId = executionResult.sessionId;

      // 2. Verification Phase (Momus Persona)
      this.logInfo(`[OMO-Sisyphus] Verifying with Momus...`);
      const verificationResponse = await this.runAgentTask(
        `Critically review the following implementation against the original requirement: "${task}". 
        If it is complete and correct, reply with "PASSED". 
        If there are issues, list them clearly so they can be fixed.
        
        Implementation:
        ${lastResult}`,
        OMO_PERSONAS.momus!,
        modelHint,
        sessionId
      );

      if (verificationResponse.content.includes("PASSED")) {
        this.logInfo(`[OMO-Sisyphus] Verification PASSED on iteration ${iteration}.`);
        return `[PASSED] Sisyphus successfully completed the task.\n\nSession ID: ${sessionId}\n\nResult:\n${lastResult}`;
      }

      this.logInfo(`[OMO-Sisyphus] Verification failed. Looping back for corrections...`);
      currentTask = `The previous implementation had issues discovered by Momus. Please fix them:\n\nCritique: ${verificationResponse.content}\n\nPrevious Implementation:\n${lastResult}`;
    }

    return `[WARNING] Sisyphus reached max loops (${config.sisyphusMaxLoops}) without PASSED verification.\n\nFinal Result:\n${lastResult}`;
  }

  /**
   * Run a task using the UltraWork (ULW) iterative loop.
   */
  async runULWLoop(task: string, modelHint?: string): Promise<string> {
    return this.runAgentWithMode(task, OMO_PERSONAS.hephaestus!, "ulw", modelHint);
  }

  /**
   * Run a task using the Ralph iterative loop.
   */
  async runRalphLoop(task: string, modelHint?: string): Promise<string> {
    return this.runAgentWithMode(task, OMO_PERSONAS.hephaestus!, "ralph", modelHint);
  }

  /**
   * Initialize a project using Deep Init mode.
   * Generates hierarchical AGENTS.md and project structure.
   */
  async runInitDeep(projectPath: string = ".", modelHint?: string): Promise<string> {
    const result = await this.runAgentTask(
      `/init-deep projectPath: ${projectPath}. Initialize hierarchical agent structure and AGENTS.md.`,
      OMO_PERSONAS.atlas!, // Atlas handles to-do and project orchestration
      modelHint
    );
    return `[Init-Deep] Project initialization started.\n\nResult:\n${result.content}`;
  }

  /**
   * Run a single task using a specific agent persona with resilience.
   */
  async runAgentTask(
    task: string,
    persona: AgentPersona,
    modelHint?: string,
    existingSessionId?: string
  ): Promise<{ content: string; sessionId: string }> {
    return await this.resilience.executeWithResilience(async (client, model) => {
      let sessionId = existingSessionId;
      let sessionRes: any;

      if (!sessionId) {
        sessionRes = await client.session.create({ 
          body: { 
            title: `OMO Agent: ${persona.name}`
          },
          throwOnError: true 
        });
        sessionId = (sessionRes.data as any)?.id || (sessionRes.data as any)?.data?.id;
      }

      if (!sessionId) throw new Error(`Failed to create or retrieve session ID. sessionRes.data: ${JSON.stringify(sessionRes?.data)}`);

      const payload: any = { 
        parts: [{ type: "text", text: task }],
        agent: persona.name.toLowerCase()
      };
      if (model) payload.model = { id: model };

      await client.session.promptAsync({ 
        path: { id: sessionId }, 
        body: payload, 
        throwOnError: true 
      });

      // Poll for status
      let isRunning = true;
      let lastStatusValue = "";
      while (isRunning) {
        await new Promise((r) => setTimeout(r, 1000));
        const statusRes = await client.session.status({ throwOnError: true });
        const rawData = (statusRes.data as any)?.data || statusRes.data;
        const status = rawData?.[sessionId];
        const statusValue = typeof status === "object" ? status.type : status;
        lastStatusValue = statusValue;

        if (!statusValue || ["waiting_for_user", "stopped", "error", "retry"].includes(statusValue)) {
          isRunning = false;
        }
      }

      if (lastStatusValue === "error") {
        throw new Error(`Agent task failed status check for session ${sessionId}`);
      }

      // Fetch result
      const messageRes = await client.session.messages({ 
        path: { id: sessionId }, 
        query: { limit: 10 }, 
        throwOnError: true 
      });
      const messages = ((messageRes.data as any)?.data || messageRes.data || []) as any[];

      const textParts = messages
        .map(m => m.parts?.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") || "")
        .filter(Boolean)
        .join("\n\n---\n\n");
      
      return {
        content: textParts || "No response received from agent.",
        sessionId: sessionId,
      };
    }, modelHint);
  }
}
