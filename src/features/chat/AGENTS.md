# Chat Feature

`SidebarMimocodeView` assembles tabs, controllers, renderers, and MiMo-backed services around the provider-neutral `ChatRuntime` boundary.

## Flow

```text
User input
  -> InputController
  -> ChatRuntime.prepareTurn()
  -> MimoChatRuntime.query()
  -> StreamController
  -> renderers + conversation persistence
```

## Responsibilities

- `ConversationController`: switching, history hydration, and persistence.
- `StreamController`: stream chunks, abort handling, tool state, and auto-scroll.
- `InputController`: text, images, mentions, commands, and approval follow-ups.
- `SidebarMimocodeView`: lifecycle and component assembly only.
- Renderers consume provider-neutral `StreamChunk` values; MiMo normalization belongs under `src/providers/mimo/`.

## Capability Rules

- MiMo-Code supports native history, images, instruction mode, runtime commands, and Plan/Safe/YOLO modes.
- Rewind, fork, turn steering, and in-app MCP tools are currently unsupported and must remain gated by capabilities.
- Plan-mode transitions and permission requests come from ACP runtime events.
- Bang-bash bypasses the runtime and must remain explicitly gated by the provider UI configuration.

## Lifecycle

- Tabs initialize runtimes lazily on first use.
- `SidebarMimocodeView.onClose()` must abort active work and dispose every runtime.
- `Conversation.providerState` is opaque to this feature; use provider services/helpers.
- Title generation is provider-routed and may run concurrently with the active chat turn.
