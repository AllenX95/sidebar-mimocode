import type { ChatMessage, StreamChunk, ToolCallInfo } from '@/core/types';
import { ChatState } from '@/features/chat/state/ChatState';
import {
  StreamProjection,
  type StreamProjectionOptions,
} from '@/features/chat/stream/StreamProjection';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    ...overrides,
  };
}

function createProjection(overrides: Partial<StreamProjectionOptions> = {}): {
  projection: StreamProjection;
  state: ChatState;
} {
  const state = overrides.state ?? new ChatState();
  const projection = new StreamProjection({
    state,
    getActiveProviderModel: () => 'mimo-model',
    getCurrentSessionId: () => 'session-1',
    getPlanPathPrefix: () => '.mimocode/plans',
    getSubagentsSpawnedThisStream: () => 0,
    ...overrides,
  });
  return { projection, state };
}

describe('StreamProjection', () => {
  it('projects text chunks into message content and append commands', () => {
    const { projection } = createProjection();
    const msg = createMessage();

    const result = projection.apply({ type: 'text', content: 'hello' }, msg);

    expect(result.handled).toBe(true);
    expect(msg.content).toBe('hello');
    expect(result.commands).toEqual([
      { type: 'append_text', text: 'hello' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('finalizes thinking before appending text', () => {
    const { projection, state } = createProjection();
    const msg = createMessage();
    state.currentThinkingState = {} as never;

    const result = projection.apply({ type: 'text', content: 'answer' }, msg);

    expect(result.handled).toBe(true);
    expect(result.commands).toEqual([
      { type: 'finalize_thinking' },
      { type: 'append_text', text: 'answer' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('creates and buffers regular tool calls while applying input side effects', () => {
    const { projection, state } = createProjection();
    const msg = createMessage();
    state.currentContentEl = {} as HTMLElement;

    const result = projection.apply({
      type: 'tool_use',
      id: 'tool-1',
      name: 'Write',
      input: {
        file_path: 'vault/.mimocode/plans/plan.md',
        content: 'plan',
      },
    }, msg);

    expect(result.handled).toBe(true);
    expect(msg.toolCalls).toEqual([
      {
        id: 'tool-1',
        name: 'Write',
        input: {
          file_path: 'vault/.mimocode/plans/plan.md',
          content: 'plan',
        },
        status: 'running',
        isExpanded: false,
      },
    ]);
    expect(msg.contentBlocks).toEqual([{ type: 'tool_use', toolId: 'tool-1' }]);
    expect(state.pendingTools.get('tool-1')?.toolCall).toBe(msg.toolCalls?.[0]);
    expect(state.planFilePath).toBe('vault/.mimocode/plans/plan.md');
    expect(result.commands).toEqual([
      { type: 'finalize_text' },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('merges streamed tool input updates and requests a header refresh', () => {
    const { projection } = createProjection();
    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'partial' },
      status: 'running',
      isExpanded: false,
    };
    const msg = createMessage({ toolCalls: [toolCall] });

    const result = projection.apply({
      type: 'tool_use',
      id: 'tool-1',
      name: 'Read',
      input: { limit: 20 },
    }, msg);

    expect(toolCall.input).toEqual({ file_path: 'partial', limit: 20 });
    expect(result.commands).toEqual([
      { type: 'finalize_text' },
      { type: 'update_tool_header', toolId: 'tool-1' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('marks regular tool results completed and requests result rendering', () => {
    const { projection, state } = createProjection();
    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: { file_path: 'note.md' },
      status: 'running',
      isExpanded: false,
    };
    const msg = createMessage({ toolCalls: [toolCall] });
    state.pendingTools.set('tool-1', { toolCall, parentEl: {} as HTMLElement });

    const result = projection.apply({
      type: 'tool_result',
      id: 'tool-1',
      content: 'ok',
    }, msg);

    expect(toolCall.status).toBe('completed');
    expect(toolCall.result).toBe('ok');
    expect(result.commands).toEqual([
      { type: 'render_pending_tool', toolId: 'tool-1' },
      { type: 'cancel_tool_output_render', toolId: 'tool-1' },
      { type: 'update_tool_result', toolId: 'tool-1' },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('detects blocked tool results without marking ask-user-question answers blocked', () => {
    const { projection } = createProjection();
    const blockedTool: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: {},
      status: 'running',
      isExpanded: false,
    };
    const askTool: ToolCallInfo = {
      id: 'tool-2',
      name: 'AskUserQuestion',
      input: {},
      status: 'running',
      isExpanded: false,
    };
    const msg = createMessage({ toolCalls: [blockedTool, askTool] });

    projection.apply({ type: 'tool_result', id: 'tool-1', content: 'Access denied' }, msg);
    projection.apply({
      type: 'tool_result',
      id: 'tool-2',
      content: 'approval received',
      toolUseResult: { answers: { decision: 'yes' } },
    }, msg);

    expect(blockedTool.status).toBe('blocked');
    expect(askTool.status).toBe('completed');
    expect(askTool.resolvedAnswers).toEqual({ decision: 'yes' });
  });

  it('captures write/edit diff data through write-edit commands', () => {
    const { projection, state } = createProjection();
    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Write',
      input: { file_path: 'note.md', content: 'hello\nworld' },
      status: 'running',
      isExpanded: false,
    };
    const msg = createMessage({ toolCalls: [toolCall] });
    state.writeEditStates.set('tool-1', {} as never);

    const result = projection.apply({
      type: 'tool_result',
      id: 'tool-1',
      content: 'wrote file',
    }, msg);

    expect(toolCall.diffData?.filePath).toBe('note.md');
    expect(toolCall.diffData?.stats).toEqual({ added: 2, removed: 0 });
    expect(result.commands).toEqual([
      { type: 'update_write_edit_diff', toolId: 'tool-1' },
      { type: 'finalize_write_edit', toolId: 'tool-1', failed: false },
      { type: 'notify_vault_file_change', input: toolCall.input },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('appends tool output and schedules incremental result rendering', () => {
    const { projection } = createProjection();
    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Bash',
      input: {},
      status: 'running',
      isExpanded: false,
    };
    const msg = createMessage({ toolCalls: [toolCall] });

    const result = projection.apply({
      type: 'tool_output',
      id: 'tool-1',
      content: 'line 1\n',
    }, msg);

    expect(toolCall.result).toBe('line 1\n');
    expect(result.commands).toEqual([
      { type: 'schedule_tool_output_render', toolId: 'tool-1' },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('flushes and clears pending tools on done chunks', () => {
    const { projection, state } = createProjection();
    const toolCall: ToolCallInfo = {
      id: 'tool-1',
      name: 'Read',
      input: {},
      status: 'running',
      isExpanded: false,
    };
    state.pendingTools.set('tool-1', { toolCall, parentEl: null });

    const result = projection.apply({ type: 'done' }, createMessage());

    expect(result.commands).toEqual([
      { type: 'render_pending_tool', toolId: 'tool-1' },
      { type: 'clear_pending_tools' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('updates usage for the current session and injects the active model', () => {
    const { projection, state } = createProjection();
    const usage: Extract<StreamChunk, { type: 'usage' }>['usage'] = {
      inputTokens: 10,
      contextWindow: 100,
      contextTokens: 20,
      percentage: 20,
    };

    projection.apply({ type: 'usage', usage, sessionId: 'session-1' }, createMessage());

    expect(state.usage).toEqual({ ...usage, model: 'mimo-model' });
  });

  it('ignores usage from other sessions and subagent streams', () => {
    const first = createProjection();
    const usage: Extract<StreamChunk, { type: 'usage' }>['usage'] = {
      inputTokens: 10,
      contextWindow: 100,
      contextTokens: 20,
      percentage: 20,
    };

    first.projection.apply({ type: 'usage', usage, sessionId: 'session-2' }, createMessage());
    expect(first.state.usage).toBeNull();

    const second = createProjection({ getSubagentsSpawnedThisStream: () => 1 });
    second.projection.apply({ type: 'usage', usage, sessionId: 'session-1' }, createMessage());
    expect(second.state.usage).toBeNull();
  });

  it('defers subagent and provider lifecycle chunks to the legacy path', () => {
    const { projection } = createProjection({
      isProviderLifecycleTool: name => name === 'spawn_agent',
      isProviderHiddenTool: name => name === 'wait_agent',
    });
    const msg = createMessage();

    expect(projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: {},
    }, msg)).toEqual({ handled: false, reason: 'subagent-deferred', commands: [] });
    expect(projection.apply({
      type: 'tool_use',
      id: 'spawn-1',
      name: 'spawn_agent',
      input: {},
    }, msg)).toEqual({ handled: false, reason: 'subagent-deferred', commands: [] });
    expect(projection.apply({
      type: 'subagent_tool_use',
      subagentId: 'task-1',
      id: 'tool-1',
      name: 'Read',
      input: {},
    }, msg)).toEqual({ handled: false, reason: 'subagent-deferred', commands: [] });
  });
});
