# OpenCode MCP Server

An **Enterprise-Grade** Model Context Protocol (MCP) server for seamlessly integrating the OpenCode swarm and CLI into large-scale, automated environments. Fully supports advanced features dynamically introduced by the `oh-my-opencode` extensions such as custom agent injection (`@hephaestus`, `@momus`), custom models, rate limit mitigations, and resilient connection pooling.

Built locally with [Bun](https://bun.sh) and `@modelcontextprotocol/sdk`. Highly performant and tested up to 100% coverage.

## Features

- **Asynchronous Task Delegation (`opencode_ask_async`)**: Deep integration with OpenCode's `/prompt_async` endpoint allows background processing. Hand off a major codebase refactor to a swarm, receive a session ID instantly, and poll for progress—never blocking the active MCP connection.
- **Synchronous Commands (`opencode_ask_sync`)**: Execute short-lived queries where you want OpenCode's response blocking.
- **Agent and Model Swapping**: Injects custom `agent` profiles (e.g. `hephaestus` for implementation or `momus` for quality checks) and overrides the active SLM/LLM profile dynamically. Supported out-of-the-box by the available tool definitions.
- **Resilient Rate Limits Bypass Mechanism**: Integrates Axios automatic exponential backoffs on `429 Too Many Requests` or `500x` errors specifically protecting agent swarms from external API closures.
- **Direct Shell Interop**: Control standard shells wrapped around the active session workspaces via `opencode_run_shell`.
- **E2E and Unit Test Ready**: Ships with full `bun test` validations.

## Installation

You must have `bun` and `opencode` installed.

```bash
bun install
```

## Running the Server

Start via Bun native execution:

```bash
bun run src/index.ts
```

### Configuration Setup (Environment Variables)

This server connects over standard JSON-RPC over `stdio` but communicates with the local/remote OpenCode API server under the hood.

Customize these environments to override OpenCode target paths (e.g. if the opencode server runs remotely):

| Variable                   | Default Value           | Description                                                                              |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `OPENCODE_SERVER_URL`      | `http://127.0.0.1:4096` | Base URL of the actively running opencode REST API `/doc` server.                        |
| `OPENCODE_SERVER_USERNAME` | `opencode`              | Basic auth username (if password is provided)                                            |
| `OPENCODE_SERVER_PASSWORD` | _(empty)_               | Optional: Pass if you started your opencode instance with `OPENCODE_SERVER_PASSWORD`     |
| `OPENCODE_MAX_RETRIES`     | `3`                     | Adjust the ceiling for exponential back-off attempts when OpenCode swarm encounters 429. |
| `OPENCODE_TEST_E2E`        | _(empty)_               | Set to `1` when running `bun test` to hit active localhost API tests.                    |

## Exposed MCP Tools

The target language models connecting to this MCP will be granted:

- `opencode_ask_sync(task, agent?, model?)`: Forward generic tasks blocking until resolution.
- `opencode_ask_async(task, agent?, model?)`: Launch tasks without blocking, granting a session ID.
- `opencode_get_session(sessionId, limit)`: Followup tool to poll for swarm completion and read output context trails.
- `opencode_run_shell(command, sessionId?, agent?)`: Invokes shell tasks autonomously.
- `opencode_list_agents()`: See what context profiles are initialized inside OpenCode.
- `opencode_list_providers()`: Poll available model capabilities (e.g. fallback choices during heavy load).

## Utilizing with `oh-my-opencode` Agents

The parameters mapped per tool intrinsically integrate into the OpenCode schema. An external AI can leverage the active agent protocols (like the `hephaestus` Implementation Specialist) by just stating:

```json
{
  "name": "opencode_ask_async",
  "arguments": {
    "task": "Create a new scalable python app logic",
    "agent": "hephaestus"
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

## Running Tests

Zero-configuration testing out of the box with `bun test`. Test suits cover 100% of the active logic paths matching the `OpenCodeMcpServer` request schema mocks.

```bash
# Unit + coverage checks
bun test --coverage

# Add live instance validation tests
OPENCODE_TEST_E2E=1 bun test
```
