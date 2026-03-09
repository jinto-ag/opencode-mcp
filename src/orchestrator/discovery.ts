import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { OMO_PERSONAS } from "../agents/personas.js";

/**
 * OMODiscovery
 * Dynamically discovers available agents and categories from the native OMO config.
 */
export interface NativeOMOConfig {
  agents: Record<string, any>;
  categories: Record<string, any>;
}

export class OMODiscovery {
  private nativeConfigPath: string;
  private nativeConfig: NativeOMOConfig | null = null;
  private lastChecked: number = 0;

  constructor() {
    this.nativeConfigPath = path.join(os.homedir(), ".config", "opencode", "oh-my-opencode.json");
  }

  /**
   * Loads or reloads the native OMO configuration.
   */
  async discover(): Promise<NativeOMOConfig> {
    try {
      const data = await fs.readFile(this.nativeConfigPath, "utf-8");
      this.nativeConfig = JSON.parse(data);
      this.lastChecked = Date.now();
      return this.nativeConfig!;
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.error("[OMO-Discovery] Failed to read native OMO config. Using defaults.", error);
      }
      return { agents: {}, categories: {} };
    }
  }

  /**
   * Returns available personas, merging native config with built-in metadata.
   */
  async getAvailableAgents() {
    const config = this.nativeConfig || await this.discover();
    const agents = { ...OMO_PERSONAS };
    
    // Enrich with native config info if available
    for (const [name, info] of Object.entries(config.agents)) {
      if (agents[name]) {
        // We can add native info here if needed
      } else {
        // Discover new agents not in our hardcoded registry
        (agents as any)[name] = {
          name: name.charAt(0).toUpperCase() + name.slice(1),
          role: "Custom OMO Agent",
          description: "Dynamically discovered agent from native config.",
          discovery: { type: "text", text: `Use the ${name} agent discovered from your native OMO config.` }
        };
      }
    }
    return agents;
  }

  /**
   * Returns available modes (categories).
   */
  async getAvailableModes() {
    const config = this.nativeConfig || await this.discover();
    return Object.keys(config.categories);
  }

  /**
   * Checks if a refresh is needed (e.g., every 5 minutes or on demand).
   */
  async ensureFresh() {
    if (Date.now() - this.lastChecked > 300_000) {
      await this.discover();
    }
  }
}
