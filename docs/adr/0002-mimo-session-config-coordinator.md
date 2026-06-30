# Place MiMo session configuration in a coordinator module

Status: accepted

Sidebar MiMo-Code will introduce `MimoSessionConfigCoordinator` under `src/providers/mimo/runtime/` to own the MiMo chat session configuration loop: extracting ACP model, mode, and effort state; applying selected mode, model, and effort before prompt turns through a narrow `setConfigOption` interface; updating discovery/settings state; refreshing model selectors; mapping MiMo modes to UI permission modes; and reporting the active display model. This keeps `MimoChatRuntime` focused on session lifecycle, notification routing, prompt/stream orchestration, supported commands, permissions, and file delegates while concentrating model/mode/effort rules behind one tested interface.

The coordinator is intentionally chat-runtime scoped in its first version. It will not serve `MimoAuxQueryRunner`, own `sessionId`, create or load sessions, handle raw notifications, manage supported slash commands, display permission prompts, or own file read/write policy; callers reset its session state when the chat session changes and pass only configuration-related data after runtime-level routing.
