import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { OMODiscovery } from "../src/orchestrator/discovery.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

describe("OMODiscovery", () => {
  let discovery: OMODiscovery;
  let tempConfigDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "omo-discovery-"));
    configPath = path.join(tempConfigDir, "oh-my-opencode.json");
    
    // Mock the path in OMODiscovery instance
    discovery = new OMODiscovery();
    (discovery as any).nativeConfigPath = configPath;
  });

  afterEach(async () => {
    await fs.rm(tempConfigDir, { recursive: true, force: true });
  });

  test("should discover native agents and modes", async () => {
    const config = {
      agents: {
        custom: { role: "Tester" }
      },
      categories: {
        research: {},
        coding: {}
      }
    };
    await fs.writeFile(configPath, JSON.stringify(config));

    await discovery.discover();
    const agents: any = await discovery.getAvailableAgents();
    expect(agents).toHaveProperty("custom");
    expect(agents.custom?.name).toBe("Custom");

    const modes = await discovery.getAvailableModes();
    expect(modes).toContain("research");
    expect(modes).toContain("coding");
  });

  test("should handle missing config gracefully", async () => {
    const agents = await discovery.getAvailableAgents();
    expect(Object.keys(agents).length).toBeGreaterThan(0); // built-ins
    
    const modes = await discovery.getAvailableModes();
    expect(modes.length).toBe(0);
  });

  test("ensureFresh should reload only if needed", async () => {
    const config = { agents: {}, categories: { cat1: {} } };
    await fs.writeFile(configPath, JSON.stringify(config));

    await discovery.discover();
    expect(await discovery.getAvailableModes()).toContain("cat1");

    // Wait 0ms, should not reload
    await discovery.ensureFresh();
    
    // Force older timestamp
    (discovery as any).lastChecked = Date.now() - 400_000;
    
    const newConfig = { agents: {}, categories: { cat2: {} } };
    await fs.writeFile(configPath, JSON.stringify(newConfig));

    await discovery.ensureFresh();
    expect(await discovery.getAvailableModes()).toContain("cat2");
  });
});
