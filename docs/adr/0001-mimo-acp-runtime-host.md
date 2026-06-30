# Place MiMo ACP Runtime Host at the MiMo runtime seam

Status: accepted

Sidebar MiMo-Code will introduce a `MimoAcpRuntimeHost` module under `src/providers/mimo/runtime/` to own MiMo-specific ACP startup: runtime environment, launch artifacts, launch key comparison, subprocess creation, JSON-RPC transport, ACP connection initialization, close notification, and shutdown. Its `ensureStarted()` interface will accept a small `chat` or `auxiliary` profile and return a started handle with a ready `AcpClientConnection`, `databasePath`, and `launchKey`; startup failure is reported by throwing and is converted by the caller into the existing runtime-facing boolean or user-visible error.

We chose this seam because `MimoChatRuntime` and `MimoAuxQueryRunner` currently duplicate the same startup implementation, but the duplicated rules are MiMo-specific rather than generic ACP infrastructure. The generic `src/providers/acp/` modules should remain protocol/process building blocks, while the new host concentrates MiMo launch locality and gives both callers leverage through one interface.

The host deliberately will not own session creation or loading, model/mode/effort synchronization, stream normalization, file read/write policy, permission presentation, or `sessionId -> cwd` tracking. Those remain in the runtime callers because they are chat or auxiliary behavior rather than ACP startup behavior; file delegate policy may become a separate module later.
