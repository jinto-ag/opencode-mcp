# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-09

### Added
- **Official SDK Integration**: Migrated from manual Axios requests to the official `@opencode-ai/sdk` v2.
- **Advanced PTY Tools**: Added `opencode_pty_create` and `opencode_pty_list` for persistent terminal management.
- **Dynamic MCP Chaining**: Added `opencode_mcp_status`, `opencode_mcp_add`, and `opencode_mcp_remove` to manage secondary MCP servers within OpenCode.
- **Session Revision Control**: Added `opencode_session_diff`, `opencode_session_fork`, and `opencode_session_revert` for powerful workspace versioning.
- **Disposable Sessions**: Implemented automatic cleanup for shell commands without an explicit session ID.
- **Task Verification**: 100% line coverage achieved across all tool handlers and core logic.

### Changed
- **Testing Infrastructure**: Migrated from `axios-mock-adapter` to **Mock Service Worker (MSW)** for more accurate network-level interception.
- **Error Handling**: Improved error reporting with structured API response details.
- **Task Polling**: Enhanced `opencode_ask_sync` with better timeout handling and automatic task aborting on failure.

### Removed
- Widespread dependency on `axios` and `axios-retry`.
- Informal implementation of session management.

## [1.0.0] - 2026-03-08
- Initial production release with 11 core tools.
- Auto-provisioning of OpenCode server.
- Basic multi-agent delegation.
