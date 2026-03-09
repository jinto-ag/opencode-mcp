/**
 * oh-my-opencode Agent Registry
 * Maps to native personas configured on the OpenCode server.
 */

export interface AgentPersona {
  name: string;
  role: string;
  description: string;
}

export const OMO_PERSONAS: Record<string, AgentPersona> = {
  sisyphus: {
    name: "Sisyphus",
    role: "Main Orchestrator",
    description: "Orchestrates complex tasks with Plan -> Execute -> Verify loop.",
  },
  atlas: {
    name: "Atlas",
    role: "Task Delegation Hub",
    description: "Analyzes and routes requests to specialized agents.",
  },
  oracle: {
    name: "Oracle",
    role: "Architecture & Debugging",
    description: "Read-only consultant for deep analysis and debugging.",
  },
  prometheus: {
    name: "Prometheus",
    role: "Strategic Planner",
    description: "Conducts interviews and builds detailed implementation plans.",
  },
  metis: {
    name: "Metis",
    role: "Pre-planning Analyst",
    description: "Clarifies ambiguous requirements and missing context.",
  },
  momus: {
    name: "Momus",
    role: "High-Accuracy Reviewer",
    description: "Performs rigorous QA and verification of solutions.",
  },
  librarian: {
    name: "Librarian",
    role: "Research & Docs",
    description: "Finds documentation and external code examples.",
  },
  explore: {
    name: "Explore",
    role: "Codebase Searcher",
    description: "Navigates and greps through the internal codebase.",
  },
  hephaestus: {
    name: "Hephaestus",
    role: "Implementation Specialist",
    description: "Builds features and writes production-ready code.",
  },
};
