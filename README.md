# OpenCode MCP Server

[![CI](https://github.com/jinto-ag/opencode-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/jinto-ag/opencode-mcp/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/release/jinto-ag/opencode-mcp?sort=semver)](https://github.com/jinto-ag/opencode-mcp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tested with Bun](https://img.shields.io/badge/Bun-%23000000.svg?logo=bun&logoColor=white)](https://bun.sh)

A production-ready [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that integrates AI-powered IDEs with [OpenCode](https://github.com/anomalyco/opencode) agents. Supports multi-agent delegation, dynamic model selection, rate-limit mitigation, and resilient connection management.

Built with [Bun](https://bun.sh), [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk), and the official [`@opencode-ai/sdk`](https://www.npmjs.com/package/@opencode-ai/sdk) v2. Validated at 100% line coverage.

## Key Capabilities

- **Automatic Server Provisioning** — Detects and spawns `opencode serve` via the official SDK when no running instance is found. No manual setup required.
- **Resilient Connection Management** — Automatic retries with exponential backoff for `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, HTTP `429`, and `5xx` responses.
- **Optimized Health Monitoring** — Server availability is validated with a configurable TTL-based cache (default: 30 seconds), minimizing redundant network overhead.
- **Graceful Lifecycle Management** — `SIGINT` and `SIGTERM` signals trigger orderly termination of any managed OpenCode processes.
- **Diagnostic Error Reporting** — Connection failures include specific remediation instructions and contextual details.
- **Input Validation** — All tool arguments are validated before dispatching to the OpenCode API, preventing malformed requests.

## Features

| Feature | Description |
|---------|-------------|
| **Asynchronous Task Delegation** | Submits tasks to OpenCode's `/prompt_async` endpoint for background processing. Returns a session ID immediately for non-blocking operation. |
| **Synchronous Execution** | Executes tasks with internal status polling, returning the final result upon completion. |
| **Multi-Agent Delegation** | Route tasks to any OpenCode-native agent (e.g., `hephaestus` for implementation, `momus` for review, `oracle` for analysis). Run multiple agents concurrently via parallel async sessions. |
| **Dynamic Model Selection** | Switch the active LLM model at runtime via `opencode_set_config` — useful for routing complex tasks to larger models. |
| **Rate-Limit Mitigation** | Integrates `axios-retry` with exponential backoff for `429 Too Many Requests`, `5xx` server errors, and transient network failures. |
| **Remote Shell Execution** | Executes shell commands within OpenCode session workspaces via `opencode_run_shell`. |
| **Comprehensive Test Coverage** | Ships with unit tests and end-to-end tests at 100% line coverage. |

## Prerequisites

- [Bun](https://bun.sh) v1.0 or later
- [OpenCode](https://github.com/anomalyco/opencode) v1.2 or later

## Installation

```bash
bun install
```

### Compiled Binary

For optimized startup performance in production environments:

```bash
bun run build
./opencode-mcp
```

## Quick Start

The server automatically provisions an OpenCode instance on first use:

```bash
bun run start
```

To connect to an externally managed OpenCode instance:

```bash
# Terminal 1: Start OpenCode separately
opencode serve --port 4096

# Terminal 2: Start the MCP server with auto-start disabled
OPENCODE_AUTO_START=false bun run start
```

## Configuration

The server communicates with clients via JSON-RPC over `stdio` and with the OpenCode API via HTTP. All configuration is managed through environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_SERVER_URL` | `http://127.0.0.1:4096` | Base URL of the OpenCode REST API server. |
| `OPENCODE_SERVER_USERNAME` | `opencode` | HTTP Basic Authentication username (applied when a password is configured). |
| `OPENCODE_SERVER_PASSWORD` | _(empty)_ | HTTP Basic Authentication password. Leave empty to disable authentication. |
| `OPENCODE_MAX_RETRIES` | `3` | Maximum number of retry attempts for failed requests (applies to `429`, `5xx`, and connection errors). |
| `OPENCODE_AUTO_START` | `true` | When `true`, automatically spawns `opencode serve` if no server is reachable. Set to `false` in managed environments. |
| `OPENCODE_AUTO_START_PORT` | `4096` | Port number for the automatically provisioned OpenCode server. |

### Automatic Server Provisioning

When `OPENCODE_AUTO_START=true` (default):

1. **At startup** — Performs a non-blocking health check. If the server is unreachable, logs a diagnostic message and continues initialization.
2. **On first tool invocation** — If the server remains unreachable, spawns `opencode serve` via `@opencode-ai/sdk` and waits for it to report healthy status.
3. **On shutdown** — Terminates any managed OpenCode process via registered signal handlers.

Set `OPENCODE_AUTO_START=false` when OpenCode is managed externally (e.g., via systemd, Docker, or Kubernetes).

## Available Tools

This server exposes 19 tools to connected MCP clients:

| Tool | Parameters | Description |
|------|------------|-------------|
| `opencode_ask_sync` | `task`, `agent?`, `model?` | Submit a task and block until the agent completes execution. |
| `opencode_ask_async` | `task`, `agent?`, `model?` | Submit a task for background execution. Returns a session ID immediately. |
| `opencode_get_session` | `sessionId`, `limit?` | Retrieve session details, status, and recent messages. |
| `opencode_run_shell` | `command`, `agent`, `sessionId?` | Execute a shell command within an OpenCode session workspace. |
| `opencode_list_agents` | _(none)_ | List all available agent profiles. |
| `opencode_list_providers` | _(none)_ | List all configured LLM providers and models. |
| `opencode_get_config` | _(none)_ | Retrieve the current global configuration. |
| `opencode_set_config` | `config` | Update global configuration parameters (e.g., switch the active model). |
| `opencode_health_check` | _(none)_ | Query the server health endpoint (bypassing cache). |
| `opencode_abort_session` | `sessionId` | Abort a running or unresponsive session. |
| `opencode_delete_session` | `sessionId` | Permanently delete a session. |
| **Advanced Tools** | | |
| `opencode_mcp_status` | _(none)_ | List all MCP servers configured within OpenCode. |
| `opencode_mcp_add` | `name`, `config` | Dynamically add a new MCP server to OpenCode. |
| `opencode_mcp_remove` | `name` | Remove a configured MCP server by name. |
| `opencode_pty_create` | `cols?`, `rows?`, `cwd?`| Create a persistent PTY (pseudo-terminal) session. |
| `opencode_pty_list` | _(none)_ | List all active PTY sessions. |
| `opencode_session_diff` | `sessionId`, `messageId?`| Get a file-system diff for a session state. |
| `opencode_session_fork` | `sessionId`, `messageId?`| Create a new session forked from a specific point in history. |
| `opencode_session_revert` | `sessionId`, `messageId`| Revert a session's workspace to a specific message ID. |

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

### Synchronous Task Execution

```json
{
  "name": "opencode_ask_sync",
  "arguments": {
    "task": "Analyze the architecture of the src/auth module and provide recommendations",
    "agent": "oracle"
  }
}
```

### Remote Shell Execution

```json
{
  "name": "opencode_run_shell",
  "arguments": {
    "command": "bun test --coverage",
    "agent": "hephaestus"
  }
}
```

### Dynamic Model Configuration

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

### Session Status Monitoring

```json
{
  "name": "opencode_get_session",
  "arguments": {
    "sessionId": "abc-123-xyz",
    "limit": 20
  }
}

### Forking a Session (Revision Control)

```json
{
  "name": "opencode_session_fork",
  "arguments": {
    "sessionId": "original-session-id",
    "messageId": "msg-456"
  }
}
```

### Managing PTY Terminals

```json
{
  "name": "opencode_pty_create",
  "arguments": {
    "cols": 120,
    "rows": 40,
    "cwd": "/home/user/project"
  }
}
```

### Dynamic MCP Chaining

```json
{
  "name": "opencode_mcp_add",
  "arguments": {
    "name": "mysql-mcp",
    "config": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-mysql", "mysql://..."]
    }
  }
}
```
```

## IDE Integration

Configure the server as an MCP tool provider in your preferred IDE. Provide the absolute path to `src/index.ts` or the compiled binary.

### Claude Desktop

Add to `claude_desktop_config.json`:

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

### Gemini Code Assist / Antigravity

Add to your workspace or global MCP configuration:

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

1. Navigate to **Settings** → **Features** → **MCP Servers**.
2. Add a new server:
   - **Type**: `stdio`
   - **Name**: `opencode`
   - **Command**: `bun run /absolute/path/to/opencode-mcp/src/index.ts`

### Windsurf

Add to `mcp_config.json`:

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

### Using the Compiled Binary

For any IDE, the pre-compiled binary may be used in place of `bun run`:

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

```text
┌─────────────┐     stdio      ┌──────────────────────┐     HTTP      ┌─────────────────┐
│  AI IDE     │  ◄──────────►  │  OpenCode MCP        │  ◄─────────►  │  OpenCode API   │
│  (Claude,   │   JSON-RPC     │  Server               │   REST API    │  (opencode      │
│   Cursor,   │                │                        │   /session    │   serve)        │
│   etc.)     │                │  • Auto-provisioning   │   /agent      │                 │
└─────────────┘                │  • Health cache        │   /config     └─────────────────┘
                               │  • Retry with backoff  │   /provider         ▲
                               │  • Lifecycle mgmt      │                     │
                               └──────────────────────┘   Auto-provisioned
                                                          when unavailable
```

## Testing

```bash
# Run unit tests with coverage reporting
bun test --coverage

# Run static type analysis
bun run typecheck

# Run end-to-end tests (requires Podman or a running OpenCode instance)
OPENCODE_SERVER_URL=http://127.0.0.1:4096 bun test
```

## Troubleshooting

### `ECONNREFUSED` on Port 4096

**Cause**: The OpenCode HTTP API server is not running on the expected port.

**Resolution**: Enable automatic server provisioning (default behavior) or start OpenCode manually:

```bash
opencode serve --port 4096
```

### Automatic Provisioning Failure

**Cause**: The `opencode` CLI is not installed or not available in the system `PATH`.

**Resolution**: Verify the OpenCode installation:

```bash
which opencode        # Should return a valid path
opencode --version    # Should return version 1.2 or later
```

### Health Check Timeout

**Cause**: The OpenCode server is experiencing high load or network connectivity issues.

**Resolution**: Increase the retry limit:

```bash
OPENCODE_MAX_RETRIES=5 bun run start
```

## License

[MIT](LICENSE) © Jinto AG
