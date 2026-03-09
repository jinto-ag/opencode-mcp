import { OpencodeClient } from "@opencode-ai/sdk";
import { OMOConfigManager } from "./config.js";

/**
 * ResilienceEngine
 * Wraps Opencode SDK calls to provide automatic model rotation and retries.
 */

export class ResilienceEngine {
  constructor(
    private client: OpencodeClient,
    private configManager: OMOConfigManager
  ) {}

  /**
   * Executes an SDK call with resilience (retries + fallback rotation).
   */
  async executeWithResilience<T>(
    operation: (client: OpencodeClient, model: string) => Promise<T>,
    initialModel?: string
  ): Promise<T> {
    const config = this.configManager.get();
    const fallbackChain = initialModel 
      ? [initialModel, ...config.fallbackModels.filter(m => m !== initialModel)]
      : config.fallbackModels;

    let lastError: any;

    for (const model of fallbackChain) {
      let retryCount = 0;
      while (retryCount <= config.maxRetries) {
        try {
          return await operation(this.client, model);
        } catch (error: any) {
          lastError = error;
          
          const status = error?.status || error?.response?.status || error?.statusCode || error?.status_code;
          const errorMsg = (error?.message || error?.error || "").toLowerCase();
          const isRateLimit = status === 429 || errorMsg.includes("rate limit") || errorMsg.includes("too many requests");
          const isServerError = status >= 500 || errorMsg.includes("internal server error");
          const isConnectionError = error?.code === "ECONNREFUSED" || error?.code === "ETIMEDOUT" || error?.name === "AbortError";

          if (isRateLimit || isServerError || isConnectionError) {
            if (retryCount < config.maxRetries) {
              retryCount++;
              const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
              console.error(`[Resilience] Error with ${model}. Retrying in ${Math.round(delay)}ms... (${retryCount}/${config.maxRetries})`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            } else {
              console.error(`[Resilience] ${model} exhausted retries. Rotating to next model in chain...`);
              break; // Rotate to next model
            }
          }

          // If it's a validation error or something else that won't benefit from retries/rotation, throw immediately
          throw error;
        }
      }
    }

    throw new Error(`[Resilience] Entire fallback chain exhausted. Last error: ${lastError?.message}`);
  }
}
