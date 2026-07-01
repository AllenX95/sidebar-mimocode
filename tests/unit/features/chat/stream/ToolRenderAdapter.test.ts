import { createMockEl } from '@test/helpers/mockElement';
import { setIcon } from 'obsidian';

import type { ChatMessage, ToolCallInfo, ToolDiffData } from '@/core/types';
import { ChatState } from '@/features/chat/state/ChatState';
import { ToolRenderAdapter } from '@/features/chat/stream/ToolRenderAdapter';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

function createToolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return {
    id: 'tool-1',
    name: 'Read',
    input: { file_path: 'old.md' },
    status: 'running',
    ...overrides,
  };
}

function createMessage(toolCall: ToolCallInfo): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: [toolCall],
    contentBlocks: [{ type: 'tool_use', toolId: toolCall.id }],
  };
}

function createDiffData(): ToolDiffData {
  return {
    filePath: 'file.md',
    diffLines: [
      {
        type: 'insert',
        text: 'new line',
        newLineNum: 1,
      },
    ],
    stats: {
      added: 1,
      removed: 0,
    },
  };
}

function createHarness(options: { expandFileEdits?: boolean } = {}) {
  const state = new ChatState();
  const scheduleToolOutputRender = jest.fn();
  const cancelToolOutputRender = jest.fn();
  const adapter = new ToolRenderAdapter({
    state,
    shouldExpandFileEditsByDefault: () => options.expandFileEdits ?? false,
    scheduleToolOutputRender,
    cancelToolOutputRender,
  });

  return {
    adapter,
    cancelToolOutputRender,
    scheduleToolOutputRender,
    state,
  };
}

describe('ToolRenderAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a pending regular tool and removes it from pending tools', () => {
    const { adapter, state } = createHarness();
    const parentEl = createMockEl();
    const toolCall = createToolCall();

    state.pendingTools.set('tool-1', {
      toolCall,
      parentEl: parentEl as HTMLElement,
    });

    adapter.renderPendingTool('tool-1');

    expect(state.pendingTools.has('tool-1')).toBe(false);
    expect(state.toolCallElements.get('tool-1')?.dataset.toolId).toBe('tool-1');
    expect(parentEl.children).toHaveLength(1);
    expect(setIcon).toHaveBeenCalled();
  });

  it('renders write/edit tools through the write-edit renderer state', () => {
    const { adapter, state } = createHarness({ expandFileEdits: true });
    const parentEl = createMockEl();
    const toolCall = createToolCall({
      name: 'Write',
      input: { file_path: 'notes/new.md' },
    });

    state.pendingTools.set('tool-1', {
      toolCall,
      parentEl: parentEl as HTMLElement,
    });

    adapter.renderPendingTool('tool-1');

    const writeEditState = state.writeEditStates.get('tool-1');
    expect(writeEditState?.wrapperEl.dataset.toolId).toBe('tool-1');
    expect(writeEditState?.isExpanded).toBe(true);
    expect(state.toolCallElements.get('tool-1')).toBe(writeEditState?.wrapperEl);
  });

  it('flushes all pending tools', () => {
    const { adapter, state } = createHarness();
    const parentEl = createMockEl();

    state.pendingTools.set('tool-1', {
      toolCall: createToolCall({ id: 'tool-1' }),
      parentEl: parentEl as HTMLElement,
    });
    state.pendingTools.set('tool-2', {
      toolCall: createToolCall({ id: 'tool-2' }),
      parentEl: parentEl as HTMLElement,
    });

    adapter.flushPendingTools();

    expect(state.pendingTools.size).toBe(0);
    expect(state.toolCallElements.has('tool-1')).toBe(true);
    expect(state.toolCallElements.has('tool-2')).toBe(true);
  });

  it('updates a rendered tool header from the message tool call', () => {
    const { adapter, state } = createHarness();
    const parentEl = createMockEl();
    const toolCall = createToolCall();
    const msg = createMessage(toolCall);

    state.pendingTools.set('tool-1', {
      toolCall,
      parentEl: parentEl as HTMLElement,
    });
    adapter.renderPendingTool('tool-1');

    toolCall.input = { file_path: 'new-name.md' };
    adapter.updateToolHeader('tool-1', msg);

    const toolEl = state.toolCallElements.get('tool-1');
    expect(toolEl?.querySelector('.sidebar-mimocode-tool-summary')?.textContent).toBe('new-name.md');
  });

  it('schedules and cancels streamed tool output rendering', () => {
    const { adapter, cancelToolOutputRender, scheduleToolOutputRender } = createHarness();
    const toolCall = createToolCall();
    const msg = createMessage(toolCall);

    adapter.scheduleToolOutputRender('tool-1', msg);
    adapter.cancelToolOutputRender('tool-1');

    expect(scheduleToolOutputRender).toHaveBeenCalledWith('tool-1', toolCall);
    expect(cancelToolOutputRender).toHaveBeenCalledWith('tool-1');
  });

  it('updates and finalizes write-edit rendering from projected tool state', () => {
    const { adapter, state } = createHarness();
    const parentEl = createMockEl();
    const toolCall = createToolCall({
      name: 'Write',
      input: { file_path: 'notes/new.md' },
    });
    const msg = createMessage(toolCall);

    state.pendingTools.set('tool-1', {
      toolCall,
      parentEl: parentEl as HTMLElement,
    });
    adapter.renderPendingTool('tool-1');

    const diffData = createDiffData();
    toolCall.diffData = diffData;
    adapter.updateWriteEditDiff('tool-1', msg);
    adapter.finalizeWriteEdit('tool-1', false);

    const writeEditState = state.writeEditStates.get('tool-1');
    expect(writeEditState?.diffLines).toEqual(diffData.diffLines);
    expect(writeEditState?.wrapperEl.hasClass('done')).toBe(true);
  });
});
