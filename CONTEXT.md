# Sidebar MiMo-Code

Sidebar MiMo-Code embeds MiMo-Code inside Obsidian as a sidebar chat experience with provider-backed runtime and persisted conversation history.

## Language

**Chat tab**:
An independent sidebar conversation workspace with its own chat state, runtime handle, input surface, and rendered transcript.
_Avoid_: pane, chat instance, tab component

**Chat tab lifecycle**:
The creation, initialization, activation, provider refresh, runtime callback wiring, and teardown of a single Chat tab.
_Avoid_: tab setup, tab wiring, tab component lifecycle

**Chat turn**:
One user-submitted request and the provider-backed assistant response that follows it, including queued delivery, streaming, interruption, and save outcome.
_Avoid_: message, prompt, query

**Chat turn submission**:
The flow that captures user input/context, prepares a Chat turn for the runtime, starts streaming, and decides what happens after the turn completes.
_Avoid_: sendMessage, input handling, query execution

**Stream projection**:
The data-state projection for provider stream chunks during an assistant response. It mutates assistant message state and returns render commands, but does not touch DOM, renderer instances, Obsidian vault APIs, or subagent lifecycle state.
_Avoid_: stream rendering, stream controller, chunk handler

**Stream render command**:
A small instruction emitted by stream projection and executed by the stream controller, such as appending text, rendering a pending tool, updating a tool result, or notifying file changes.
_Avoid_: DOM update, stream side effect, render callback

**Subagent projection**:
The data-state projection for Task-series subagent stream chunks. It owns pending/sync/async subagent state, task/output ID maps, message persistence shape, hydration result application, and orphaning rules, while emitting render commands instead of touching DOM or runtime I/O.
_Avoid_: subagent manager, subagent renderer, task handler

**Subagent render adapter**:
The DOM adapter that executes subagent render commands using `SubagentRenderer`. It owns live subagent DOM state, not subagent lifecycle decisions.
_Avoid_: subagent state machine, subagent projection
