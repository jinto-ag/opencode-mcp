# OpenCode MCP Server

[![CI](https://github.com/jinto-ag/opencode-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jinto-ag/opencode-mcp/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/release/jinto-ag/opencode-mcp?sort=semver)](https://github.com/jinto-ag/opencode-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tested with Bun](https://img.shields.io/badge/Bun-%23000000.svg?logo=bun&logoColor=white)](https://bun.sh)

An **Enterprise-Grade** Model Context Protocol (MCP) server for seamlessly integrating the [OpenCode](https://github.com/anomalyco/opencode) swarm and CLI into large-scale, automated environments. Fully supports advanced features dynamically introduced by the `oh-my-opencode` extensions such as custom agent injection (`@hephaestus`, `@momus`), custom models, rate limit mitigations, and resilient connection pooling.

Built locally with [Bun](https://bun.sh), `@modelcontextprotocol/sdk`, and `@opencode-ai/sdk`. Highly performant, self-healing, and tested at 100% line coverage.

## Highlights

- **Zero-Configuration Auto-Start** — Automatically spawns `opencode serve` via the official SDK if no server is running. No manual setup required.
- **Resilient Connection Handling** — Retries on `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, HTTP `429`, and `5xx` errors with exponential backoff.
- **Cached Health Checks** — Validates OpenCode server health with a 30-second TTL cache, avoiding redundant network calls on every tool invocation.
- **Graceful Lifecycle Management** — `SIGINT`/`SIGTERM` handlers cleanly terminate any auto-spawned OpenCode process.
- **Actionable Error Messages** — Connection failures include precise remediation guidance.

## Features

- **Asynchronous Task Delegation (`opencode_ask_async`)**: Deep integration with OpenCode's `/prompt_async` endpoint allows background processing. Hand off a major codebase refactor to a swarm, receive a session ID instantly, and poll for progress—never blocking the active MCP connection.
- **Synchronous Commands (`opencode_ask_sync`)**: Execute short-lived queries where you want OpenCode's response blocking. Internally polls via `/session/status` to simulate synchronous behavior without network hangups.
- **Agent and Model Swapping**: Injects custom `agent` profiles (e.g. `hephaestus` for implementation or `momus` for quality checks) and overrides the active SLM/LLM profile dynamically.
- **Resilient Rate Limits Bypass Mechanism**: Integrates `axios-retry` with automatic exponential backoff on `429 Too Many Requests`, `5xx` server errors, and transient network failures (`ECONNREFUSED`, `ENOTFOUND`).
- **Direct Shell Interop**: Control standard shells wrapped around the active session workspaces via `opencode_run_shell`.
- **E2E and Unit Test Ready**: Ships with full `bun test` validations at 100% line coverage.

## Installation

You must have `bun` (v1.0+) and `opencode` (v1.2+) installed.

```bash
bun install
```

### Pre-Compiled Standalone Binary (Optimized)

For environments where you want maximum startup performance or do not wish to use the `bun run` runtime directly, you can compile the server into an optimized standalone binary:

```bash
bun run build
./opencode-mcp
```

## Quick Start

The fastest way to get started — the server auto-starts OpenCode for you:

```bash
# Just run it — OpenCode will be auto-spawned on first tool call
bun run start
```

If you prefer to manage OpenCode yourself:

```bash
# Terminal 1: Start OpenCode manually
opencode serve --port 4096

# Terminal 2: Start the MCP server
OPENCODE_AUTO_START=false bun run start
```

## Configuration (Environment Variables)

This server connects over standard JSON-RPC over `stdio` but communicates with the local/remote OpenCode API server under the hood.

| Variable                    | Default Value           | Description                                                                                  |
| --------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| `OPENCODE_SERVER_URL`       | `http://127.0.0.1:4096` | Base URL of the running OpenCode REST API server.                                           |
| `OPENCODE_SERVER_USERNAME`  | `opencode`              | Basic auth username (if password is provided).                                               |
| `OPENCODE_SERVER_PASSWORD`  | _(empty)_               | Optional: Pass if you started your opencode instance with `OPENCODE_SERVER_PASSWORD`.        |
| `OPENCODE_MAX_RETRIES`      | `3`                     | Maximum exponential back-off retry attempts for `429`, `5xx`, and connection errors.         |
| `OPENCODE_AUTO_START`       | `true`                  | Set to `false` to disable automatic `opencode serve` spawning. Requires manual server start. |
| `OPENCODE_AUTO_START_PORT`  | `4096`                  | Port for the auto-started OpenCode server instance.                                          |

### Auto-Start Behavior

When `OPENCODE_AUTO_START=true` (default), the server will:

1. **At startup**: Perform a non-blocking health check. If OpenCode is not reachable, log a warning and proceed.
2. **On first tool call**: If OpenCode is still not reachable, spawn `opencode serve --port 4096` via `@opencode-ai/sdk` and wait for it to become healthy.
3. **On shutdown**: Terminate the managed OpenCode process via `SIGINT`/`SIGTERM` handlers.

Set `OPENCODE_AUTO_START=false` in production environments where you manage OpenCode externally (e.g., via systemd, Docker, or Kubernetes).

## Exposed MCP Tools

The target language models connecting to this MCP will be granted these 11 tools:

| Tool | Arguments | Description |
|------|-----------|-------------|
| `opencode_ask_sync` | `task`, `agent?`, `model?` | Forward tasks blocking until resolution. Polls internally for completion. |
| `opencode_ask_async` | `task`, `agent?`, `model?` | Launch tasks without blocking, returns a Session ID immediately. |
| `opencode_get_session` | `sessionId`, `limit?` | Poll for swarm completion and read output context trails. |
| `opencode_run_shell` | `command`, `agent`, `sessionId?` | Invoke shell commands autonomously (requires agent ID). |
| `opencode_list_agents` | _(none)_ | List available agent profiles inside OpenCode. |
| `opencode_list_providers` | _(none)_ | Poll available model/provider capabilities. |
| `opencode_get_config` | _(none)_ | Get the global OpenCode config (model, variant, agent). |
| `opencode_set_config` | `config` | Update the global config dynamically (e.g., rotate models). |
| `opencode_health_check` | _(none)_ | Query OpenCode server health status (bypasses cache). |
| `opencode_abort_session` | `sessionId` | Forcefully abort a hanging background session. |
| `opencode_delete_session` | `sessionId` | Hard-delete a completed or running session. |

## Usage Examples

### Delegating a Task to a Specific Agent

```json
{
  "name": "opencode_ask_async",
  "arguments": {
    "task": "Refactor the authentication module to use JWT tokens",
    "agent": "hephaestus"
  }
}
```

### Running a Synchronous Query

```json
{
  "name": "opencode_ask_sync",
  "arguments": {
    "task": "Explain the architecture of the src/auth module",
    "agent": "oracle"
  }
}
```

### Executing a Shell Command

```json
{
  "name": "opencode_run_shell",
  "arguments": {
    "command": "bun test --coverage",
    "agent": "hephaestus"
  }
}
```

### Dynamically Switching Models

```json
{
  "name": "opencode_set_config",
  "arguments": {
    "config": {
      "model": "claude-sonnet-4-20250514",
      "agent": "hephaestus"
    }
  }
}
```

### Monitoring an Async Task

```json
{
  "name": "opencode_get_session",
  "arguments": {
    "sessionId": "abc-123-xyz",
    "limit": 20
  }
}
```

## IDE Configuration

To use the OpenCode MCP Server in your preferred AI-powered IDE, configure it as an MCP server. You will need to provide the absolute path to `src/index.ts`.

### Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "opencode": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/opencode-mcp/src/index.ts"],
      "env": {
        "OPENCODE_SERVER_URL": "http://127.0.0.1:4096"
      }
    }
  }
}
```

### Antigravity (Gemini Code Assist)

Add to your workspace or global MCP settings:

```json
{
  "mcpServers": {
    "opencode": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/opencode-mcp/src/index.ts"]
    }
  }
}
```

### Cursor

1. Open Cursor Settings.
2. Go to **Features** > **MCP Servers** (or "MCP" tab).
3. Add a new server:
   - **Type**: `stdio`
   - **Name**: `opencode`
   - **Command**: `bun run /absolute/path/to/opencode-mcp/src/index.ts`

### Windsurf

Add the following to your `mcp_config.json`:

```json
{
  "mcpServers": {
    "opencode": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/opencode-mcp/src/index.ts"]
    }
  }
}
```

### Using the Pre-Built Binary

For any IDE, you can also use the pre-compiled binary instead of `bun run`:

```json
{
  "mcpServers": {
    "opencode": {
      "command": "/absolute/path/to/opencode-mcp/opencode-mcp"
    }
  }
}
```

## Architecture

```
┌─────────────┐     stdio      ┌────────────────────┐     HTTP      ┌─────────────────┐
│  AI IDE     │  ◄──────────►  │  OpenCode MCP      │  ◄─────────►  │  OpenCode API   │
│  (Claude,   │   JSON-RPC     │  Server             │   REST API    │  (opencode      │
│   Cursor,   │                │                      │   /session    │   serve)        │
│   etc.)     │                │  • Auto-start        │   /agent      │                 │
└─────────────┘                │  • Health cache      │   /config     └─────────────────┘
                               │  • Retry logic       │   /provider         ▲
                               │  • Lifecycle mgmt    │                     │
                               └────────────────────┘      Auto-spawned
                                                           if not running
```

## Running Tests

Zero-configuration testing out of the box with `bun test`. Test suites cover 100% of active logic paths.

```bash
# Unit tests + coverage
bun test --coverage

# Type checking
bun run typecheck

# E2E tests (requires Podman or a running OpenCode instance)
OPENCODE_SERVER_URL=http://127.0.0.1:4096 bun test
```

## Troubleshooting

### `ECONNREFUSED` on port 4096

**Cause**: OpenCode's HTTP API is not running.

**Fix**: Either enable auto-start (default) or start OpenCode manually:

```bash
opencode serve --port 4096
```

### Auto-start fails

**Cause**: `opencode` CLI is not in `PATH` or not installed.

**Fix**: Install OpenCode and ensure it's accessible:

```bash
which opencode        # Should return a path
opencode --version    # Should return version ≥ 1.2
```

### Health check timeouts

**Cause**: OpenCode is under heavy load or network issues.

**Fix**: Increase retry ceiling:

```bash
OPENCODE_MAX_RETRIES=5 bun run start
```

## License

[MIT](LICENSE) © Jinto AG
