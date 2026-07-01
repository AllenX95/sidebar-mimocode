import { createMockEl } from '@test/helpers/mockElement';
import { setIcon } from 'obsidian';

import type { ProviderId, ProviderSubagentLifecycleAdapter } from '@/core/providers/types';
import type { ChatMessage, SubagentInfo, ToolCallInfo } from '@/core/types';
import { ChatState } from '@/features/chat/state/ChatState';
import { ProviderLifecycleSubagentController } from '@/features/chat/stream/ProviderLifecycleSubagentController';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

function createMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: [],
    contentBlocks: [],
  };
}

function createAdapter(): ProviderSubagentLifecycleAdapter {
  return {
    isHiddenTool: (name: string) => name === 'wait_agent' || name === 'close_agent',
    isSpawnTool: (name: string) => name === 'spawn_agent',
    isWaitTool: (name: string) => name === 'wait_agent',
    isCloseTool: (name: string) => name === 'close_agent',
    resolveSpawnToolIds: (_waitToolCall, agentIdToSpawnId) => {
      const spawnId = agentIdToSpawnId.get('agent-1');
      return spawnId ? [spawnId] : [];
    },
    buildSubagentInfo: (
      spawnToolCall: ToolCallInfo,
      siblingToolCalls: ToolCallInfo[] = [],
    ): SubagentInfo => {
      const waitToolCall = siblingToolCalls.find(toolCall => toolCall.name === 'wait_agent');
      const isError = spawnToolCall.status === 'error' || waitToolCall?.status === 'error';
      const isCompleted = waitToolCall?.status === 'completed';
      return {
        id: spawnToolCall.id,
        description: (spawnToolCall.input.message as string) || 'Lifecycle task',
        prompt: (spawnToolCall.input.message as string) || '',
        status: isError ? 'error' : (isCompleted ? 'completed' : 'running'),
        result: waitToolCall?.result ?? spawnToolCall.result,
        isExpanded: false,
        toolCalls: [],
      };
    },
    extractSpawnResult: (raw: string | undefined) => ({
      agentId: raw?.includes('agent-1') ? 'agent-1' : undefined,
    }),
    extractWaitResult: () => ({
      statuses: {},
      timedOut: false,
    }),
  };
}

function createHarness() {
  const state = new ChatState();
  const adapter = createAdapter();
  const flushPendingTools = jest.fn();
  const controller = new ProviderLifecycleSubagentController({
    state,
    getProviderId: () => 'mimo' as ProviderId,
    flushPendingTools,
    resolveAdapter: (_providerId, toolName) => {
      if (!toolName) return adapter;
      return (
        adapter.isSpawnTool(toolName) ||
        adapter.isWaitTool(toolName) ||
        adapter.isCloseTool(toolName) ||
        adapter.isHiddenTool(toolName)
      )
        ? adapter
        : null;
    },
  });

  return {
    controller,
    flushPendingTools,
    state,
  };
}

describe('ProviderLifecycleSubagentController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('identifies lifecycle and hidden tools owned by the provider adapter', () => {
    const { controller } = createHarness();

    expect(controller.isLifecycleTool('spawn_agent')).toBe(true);
    expect(controller.isLifecycleTool('wait_agent')).toBe(true);
    expect(controller.isHiddenTool('wait_agent')).toBe(true);
    expect(controller.shouldUseLegacyToolUse('close_agent')).toBe(true);
    expect(controller.shouldUseLegacyToolUse('Read')).toBe(false);
  });

  it('renders a spawn tool as a provider lifecycle subagent block', () => {
    const { controller, flushPendingTools, state } = createHarness();
    const msg = createMessage();
    const contentEl = createMockEl();
    state.currentContentEl = contentEl as HTMLElement;

    const handled = controller.handleToolUse({
      type: 'tool_use',
      id: 'spawn-1',
      name: 'spawn_agent',
      input: { message: 'Inspect utils.ts' },
    }, msg);

    expect(handled).toBe(true);
    expect(flushPendingTools).toHaveBeenCalledTimes(1);
    expect(msg.toolCalls).toEqual([
      expect.objectContaining({
        id: 'spawn-1',
        name: 'spawn_agent',
        status: 'running',
      }),
    ]);
    expect(msg.contentBlocks).toEqual([{ type: 'tool_use', toolId: 'spawn-1' }]);
    expect(contentEl.querySelector('.sidebar-mimocode-subagent-label')?.textContent).toBe('Inspect utils.ts');
    expect(setIcon).toHaveBeenCalled();
  });

  it('tracks hidden lifecycle tools without rendering content blocks', () => {
    const { controller } = createHarness();
    const msg = createMessage();

    const handled = controller.handleToolUse({
      type: 'tool_use',
      id: 'wait-1',
      name: 'wait_agent',
      input: { targets: ['agent-1'] },
    }, msg);

    expect(handled).toBe(true);
    expect(msg.toolCalls).toEqual([
      expect.objectContaining({
        id: 'wait-1',
        name: 'wait_agent',
      }),
    ]);
    expect(msg.contentBlocks).toEqual([]);
  });

  it('links spawn results to wait results and finalizes the subagent block', () => {
    const { controller, state } = createHarness();
    const msg = createMessage();
    const contentEl = createMockEl();
    state.currentContentEl = contentEl as HTMLElement;

    controller.handleToolUse({
      type: 'tool_use',
      id: 'spawn-1',
      name: 'spawn_agent',
      input: { message: 'Inspect utils.ts' },
    }, msg);

    expect(controller.handleToolResult({
      type: 'tool_result',
      id: 'spawn-1',
      content: '{"agent_id":"agent-1"}',
    }, msg)).toBe(true);

    controller.handleToolUse({
      type: 'tool_use',
      id: 'wait-1',
      name: 'wait_agent',
      input: { targets: ['agent-1'] },
    }, msg);

    expect(controller.shouldHandleToolResult('wait-1', msg)).toBe(true);
    expect(controller.handleToolResult({
      type: 'tool_result',
      id: 'wait-1',
      content: 'Patched utils.ts',
    }, msg)).toBe(true);

    const wrapperEl = contentEl.querySelector('.sidebar-mimocode-subagent-list');
    expect(wrapperEl?.hasClass('done')).toBe(true);
    expect(contentEl.querySelector('.sidebar-mimocode-subagent-result-output')?.textContent)
      .toBe('Patched utils.ts');
  });

  it('ignores tool results it does not own', () => {
    const { controller } = createHarness();
    const msg = createMessage();
    msg.toolCalls = [{
      id: 'read-1',
      name: 'Read',
      input: {},
      status: 'running',
    }];

    expect(controller.shouldHandleToolResult('read-1', msg)).toBe(false);
    expect(controller.handleToolResult({
      type: 'tool_result',
      id: 'read-1',
      content: 'ok',
    }, msg)).toBe(false);
  });
});
