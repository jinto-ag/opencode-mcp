import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * oh-my-opencode Configuration Manager
 * Handles persistent settings for resilience and orchestration.
 */

export interface OMOConfig {
  fallbackModels: string[];
  maxRetries: number;
  accuracyThreshold: number; // 0 to 1
  sisyphusMaxLoops: number;
  ulwMaxIterations: number;
  ralphMaxIterations: number;
  ralphCompletionMarker: string;
  monitoredProviders: string[];
}

const DEFAULT_CONFIG: OMOConfig = {
  fallbackModels: [
    "opencode/big-pickle",
    "gpt-4o",
    "claude-3-5-sonnet",
    "gemini-1.5-pro"
  ],
  maxRetries: 3,
  accuracyThreshold: 0.8,
  sisyphusMaxLoops: 5,
  ulwMaxIterations: 10,
  ralphMaxIterations: 5,
  ralphCompletionMarker: "<promise>DONE</promise>",
  monitoredProviders: ["opencode", "openai", "anthropic", "google"]
};

export class OMOConfigManager {
  private configPath: string;
  private config: OMOConfig;

  constructor(storageDir: string = process.cwd()) {
    this.configPath = path.join(storageDir, "omo-config.json");
    this.config = { ...DEFAULT_CONFIG };
  }

  async init(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, "utf-8");
      const saved = JSON.parse(data);
      this.config = { ...DEFAULT_CONFIG, ...saved };
    } catch (error) {
      // If file doesn't exist or is invalid, use defaults and save them
      await this.save();
    }
  }

  get(): OMOConfig {
    return { ...this.config };
  }

  async update(newConfig: Partial<OMOConfig>): Promise<OMOConfig> {
    this.config = { ...this.config, ...newConfig };
    await this.save();
    return this.get();
  }

  private async save(): Promise<void> {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error("[OMO-Config] Failed to save configuration:", error);
    }
  }
}
