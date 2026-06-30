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
- `src/providers/mimo/runtime/MimoAcpRuntimeHost.ts` is the MiMo-specific ACP startup seam. It owns runtime environment construction, launch artifacts, launch key comparison, subprocess creation, JSON-RPC transport, ACP connection initialization, close notification, stderr snapshot access, and shutdown.
- `MimoChatRuntime` and `MimoAuxQueryRunner` should use `MimoAcpRuntimeHost.ensureStarted()` instead of creating `AcpSubprocess`, `AcpJsonRpcTransport`, or `AcpClientConnection` directly. Host startup failures throw `MimoAcpRuntimeHostError`; callers convert that into their public contract, such as `ChatRuntime.ensureReady(): boolean` or an auxiliary query error.
- `src/providers/mimo/runtime/MimoSessionConfigCoordinator.ts` owns chat session configuration synchronization: extracting ACP model/mode/effort state, applying selected mode/model/effort through a narrow `setConfigOption` interface, updating MiMo discovery/settings state, refreshing model selectors, mapping MiMo modes to UI permission modes, and reporting the active display model.
- `MimoSessionConfigCoordinator` is scoped to `MimoChatRuntime`. Do not wire it into `MimoAuxQueryRunner` unless a new ADR changes that boundary.
- `src/providers/mimo/history/MimoNativeHistory.ts` owns MiMo native history hydration: database path resolution, missing/in-memory database handling, SQLite row loading, primary-agent message mapping, diagnostic messages, hydration caching, and MiMo-owned persisted provider state.
- Keep `MimoConversationHistoryService` as the adapter for the provider-level history interface; callers should not inspect SQLite row shape, SQL constants, diagnostic message IDs, or database cache keys.
- Keep session creation/loading, raw ACP notification routing, stream normalization, supported commands, permission presentation, file read/write policy, and `sessionId -> cwd` tracking in the runtime callers.
- When changing host launch, restart, failure, or shutdown semantics, update `tests/unit/providers/mimo/MimoAcpRuntimeHost.test.ts` and check `docs/adr/0001-mimo-acp-runtime-host.md`.
- When changing model/mode/effort synchronization semantics, update `tests/unit/providers/mimo/MimoSessionConfigCoordinator.test.ts` and check `docs/adr/0002-mimo-session-config-coordinator.md`.
- When changing native history hydration semantics, update `tests/unit/providers/mimo/MimoNativeHistory.test.ts` and check `docs/adr/0003-mimo-native-history.md`.

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

## Preflight

Before editing:

- Confirm the working directory is `E:\claude-projects\sidebar-mimocode`.
- Run or inspect `git status --short`; do not revert user changes.
- Check the target issue against MiMo-Code runtime contracts before changing provider behavior.
- Search with `rg`, excluding `node_modules`, generated `main.js`, generated `styles.css`, release assets, and coverage/build artifacts unless the task explicitly needs them.
- When a task references upstream MiMo-Code behavior, verify against the installed MiMo CLI or official source before assuming copied OpenCode behavior is still valid.

## Task flow

Use this default flow:

1. For broad review or release-readiness tasks, first produce a read-only Top 5 findings list with severity, evidence, and suggested fix.
2. For specific runtime bugs, map the chain first: UI action -> provider runtime -> ACP transport -> MiMo process -> SQLite/history -> UI state.
3. For implementation, keep edits scoped to the relevant provider, feature, or settings layer.
4. After changes, run `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` when dependencies are available.
5. If dependencies are missing or registry access fails, report the exact blocker and do not present unrun checks as passing.

## Sub-agent use

Use sub-agents for independent read-only work:

- Runtime agent: MiMo environment variables, ACP startup, process lifecycle, launch artifacts.
- History/storage agent: `mimocode.db`, SQL filters, vault agent paths, migration behavior.
- UI/settings agent: sidebar, inline edit, settings, capability gating, Obsidian packaging.

The main thread owns edits and final integration. Do not let multiple agents edit overlapping files.

## Release checklist

For release or publish tasks, check:

- `package.json` version.
- `manifest.json` version and minimum app version.
- `versions.json`.
- `main.js` and `styles.css` regenerated by the production build.
- README and user-facing naming.
- Git tag/release assets, if requested.
- No `.env.local`, vault-local files, node caches, or temporary artifacts included.

## Handoff format

End substantial tasks with:

- `cwd`:
- Goal:
- Files read:
- Files changed:
- Commands run:
- Validation result:
- Unverified areas:
- Key decisions:
- Recommended next prompt:
