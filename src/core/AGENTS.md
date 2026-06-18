# Core Infrastructure

Keep `src/core/` provider-neutral. Features consume core contracts; MiMo-Code and ACP implementations live under `src/providers/`.

## Modules

| Module | Responsibility |
| --- | --- |
| `bootstrap/` | Sidebar MiMo-Code settings/session paths and shared storage contracts |
| `commands/` | Built-in cross-runtime commands |
| `mcp/` | Provider-neutral MCP contracts; in-app MCP UI remains capability-gated off |
| `prompt/` | Shared prompt templates |
| `providers/` | Provider registries, capabilities, environment, and workspace contracts |
| `runtime/` | Provider-neutral `ChatRuntime` and turn/session types |
| `storage/` | Generic vault and home filesystem adapters |
| `tools/` | Shared tool constants and formatting helpers |
| `types/` | Shared settings, chat, tool, and persistence types |

## Boundaries

- `src/providers/acp/` owns JSON-RPC transport, ACP connection, subprocess, and stream normalization.
- `src/providers/mimo/` owns MiMo-Code runtime behavior, history, settings, agents, commands, and auxiliary services.
- Feature code must not inspect MiMo-specific `Conversation.providerState` fields directly.
- Provider-owned behavior is resolved through `ProviderRegistry` and `ProviderWorkspaceRegistry`.
- `ChatRuntime.cleanup()` must run whenever a tab/runtime is disposed.
- Fork and in-app MCP controls must remain hidden until their runtime and storage contracts are implemented and tested.

## Storage

- Plugin-owned settings and session metadata live under `.sidebar-mimocode/`.
- MiMo-Code native conversation history remains in `mimocode.db`.
- MiMo-specific workspace files belong under `.mimocode/`, not under `src/core/` conventions.
