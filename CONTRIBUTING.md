# Contributing to OpenCode MCP Server

Thank you for your interest in contributing to this project.

## Getting Started

If you have identified a bug or would like to request a feature, please verify that it has not already been reported in the [issue tracker](https://github.com/jinto-ag/opencode-mcp/issues). If no existing issue matches, open a new one with a detailed description.

## Development Workflow

### 1. Fork and Branch

Fork the repository and create a feature branch with a descriptive name:

```bash
git checkout -b feat/your-feature-name
```

### 2. Install Dependencies and Run Tests

Ensure you have [Bun](https://bun.sh) installed, then:

```bash
bun install
bun test --coverage
bun run typecheck
```

All tests must pass and type checking must succeed before submitting changes.

### 3. Implement Changes

Make your changes following the existing code style and patterns. All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.

### 4. Submit a Pull Request

Ensure your branch is up to date with `main`, then submit a pull request with a clear description of the changes and their rationale.
