# AGENTS.md

## Project overview

Sidebar MiMo-Code is an Obsidian desktop plugin that embeds MiMo-Code CLI through its ACP server. MiMo-Code is the only built-in runtime provider. The plugin supports sidebar chat, streaming, cancel/resume, native SQLite history, native Build/Plan modes, custom MiMo permission rules, image attachments, inline edit, instruction mode, commands, skills, and custom subagents.

Fork and in-app MCP management are intentionally disabled until the runtime and storage contracts are implemented and tested.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `src/app/` | Shared defaults and plugin-level storage |
| `src/core/` | Provider-neutral runtime, ACP, storage, tool, and UI contracts |
| `src/providers/acp/` | ACP JSON-RPC transport, connection, process, and stream normalization |
| `src/providers/mimo/` | MiMo-Code runtime, environment, launch artifacts, history, settings, commands, agents, and auxiliary services |
| `src/features/chat/` | Sidebar, tabs, input, rendering, and conversation coordination |
| `src/features/inline-edit/` | Provider-backed inline editing |
| `src/features/settings/` | General settings shell and MiMo-Code settings tab |

MiMo conversation state is stored in `Conversation.providerState` as `MimoProviderState`. MiMo native history is read from `mimocode.db`; only rows with `message.agent_id = 'main'` belong in the primary conversation.

## Runtime contracts

- Verified compatibility baseline: MiMo-Code CLI 0.1.1.
- Use official `MIMOCODE_*` runtime variables. Do not rename `MIMO_API_KEY` or other model-provider business variables.
- MiMo-Code data directory name is `mimocode`; default database name is `mimocode.db`.
- Vault agents are written to `.mimocode/agent/` and read from `.mimocode/agent/` plus `.mimocode/agents/`. Legacy `.mimo/*` paths are read-only compatibility inputs and migrate when edited.
- Prefer ACP and MiMo-Code native behavior over local reimplementations.

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run lint:fix
npm run test
npm run test:watch
npm run test:coverage
```

After changes, run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.

## Development rules

- Write a failing test before a bug fix, then make it pass and refactor.
- Tests mirror `src/` under `tests/unit/` and `tests/integration/`.
- Inspect real MiMo-Code ACP output and SQLite schemas before changing provider contracts.
- Comment why, not what. Do not add `console.*` to production code.
- Keep temporary scripts and local notes under `.context/`.
- Preserve provider capability gating: unsupported fork and MCP UI must remain hidden.
