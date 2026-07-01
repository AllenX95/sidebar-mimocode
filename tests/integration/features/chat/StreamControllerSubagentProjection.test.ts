import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import type { ChatMessage, ToolCallInfo } from '@/core/types';
import { StreamController } from '@/features/chat/controllers/StreamController';
import { ChatState } from '@/features/chat/state/ChatState';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: [],
    contentBlocks: [],
    ...overrides,
  };
}

function createRuntime(overrides: Partial<ChatRuntime> = {}): ChatRuntime {
  return {
    getCapabilities: jest.fn(() => ({ planPathPrefix: '.mimocode/plans' })),
    getSessionId: jest.fn(() => 'session-1'),
    loadSubagentFinalResult: jest.fn(async () => null),
    loadSubagentToolCalls: jest.fn(async () => []),
    providerId: 'mimo',
    ...overrides,
  } as unknown as ChatRuntime;
}

function createHarness(options: { runtime?: ChatRuntime } = {}) {
  const state = new ChatState();
  const messagesEl = createMockEl();
  const contentEl = createMockEl();
  state.currentContentEl = contentEl as HTMLElement;
  state.responseStartTime = 0;

  const runtime = options.runtime ?? createRuntime();
  const controller = new StreamController({
    plugin: {
      settings: {
        enableAutoScroll: false,
      },
    } as never,
    state,
    renderer: {
      addTextCopyButton: jest.fn(),
      renderContent: jest.fn(async () => {}),
    } as never,
    getMessagesEl: () => messagesEl as HTMLElement,
    getFileContextManager: () => null,
    updateQueueIndicator: jest.fn(),
    getAgentService: () => runtime,
  });

  return {
    contentEl,
    controller,
    messagesEl,
    runtime,
    state,
  };
}

describe('StreamController subagent projection integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists a sync subagent turn from stream chunks', async () => {
    const { controller } = createHarness();
    const msg = createMessage();

    try {
      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'task-1',
        name: 'Agent',
        input: { description: 'Review code', prompt: 'Find bugs' },
      }, msg);
      await controller.handleStreamChunk({
        type: 'subagent_tool_use',
        subagentId: 'task-1',
        id: 'read-1',
        name: 'Read',
        input: { file_path: 'src/main.ts' },
      }, msg);
      await controller.handleStreamChunk({
        type: 'subagent_tool_result',
        subagentId: 'task-1',
        id: 'read-1',
        content: 'file contents',
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_result',
        id: 'task-1',
        content: '{"result":"Looks good"}',
      }, msg);
    } finally {
      controller.hideThinkingIndicator();
    }

    expect(msg.contentBlocks).toEqual([
      { type: 'subagent', subagentId: 'task-1' },
    ]);
    expect(msg.toolCalls).toEqual([
      expect.objectContaining({
        id: 'task-1',
        name: 'Agent',
        status: 'completed',
        result: 'Looks good',
        subagent: expect.objectContaining({
          id: 'task-1',
          description: 'Review code',
          prompt: 'Find bugs',
          status: 'completed',
          result: 'Looks good',
          toolCalls: [
            expect.objectContaining({
              id: 'read-1',
              name: 'Read',
              result: 'file contents',
              status: 'completed',
            }),
          ],
        }),
      }),
    ]);
  });

  it('hydrates a completed async subagent from runtime results', async () => {
    const recoveredToolCall: ToolCallInfo = {
      id: 'read-1',
      name: 'Read',
      input: { file_path: 'test.log' },
      status: 'completed',
      result: 'ok',
      isExpanded: false,
    };
    const runtime = createRuntime({
      loadSubagentToolCalls: jest.fn(async () => [recoveredToolCall]),
      loadSubagentFinalResult: jest.fn(async () => 'final hydrated result'),
    });
    const { controller } = createHarness({ runtime });
    const msg = createMessage();

    try {
      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'task-1',
        name: 'Agent',
        input: { description: 'Run tests', run_in_background: true },
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_result',
        id: 'task-1',
        content: '{"agent_id":"agent-1"}',
      }, msg);

      expect(controller.hasRunningSubagents()).toBe(true);

      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'output-1',
        name: 'TaskOutput',
        input: { agent_id: 'agent-1' },
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_result',
        id: 'output-1',
        content: '{"agents":{"agent-1":{"status":"completed","result":"fallback result"}}}',
      }, msg);
    } finally {
      controller.hideThinkingIndicator();
    }

    expect(runtime.loadSubagentToolCalls).toHaveBeenCalledWith('agent-1');
    expect(runtime.loadSubagentFinalResult).toHaveBeenCalledWith('agent-1');
    expect(controller.hasRunningSubagents()).toBe(false);
    expect(msg.contentBlocks).toEqual([
      { type: 'subagent', subagentId: 'task-1', mode: 'async' },
    ]);
    expect(msg.toolCalls?.[0]).toEqual(expect.objectContaining({
      id: 'task-1',
      name: 'Agent',
      status: 'completed',
      result: 'final hydrated result',
      subagent: expect.objectContaining({
        agentId: 'agent-1',
        asyncStatus: 'completed',
        status: 'completed',
        result: 'final hydrated result',
        toolCalls: [
          expect.objectContaining({
            id: 'read-1',
            name: 'Read',
            result: 'ok',
            status: 'completed',
          }),
        ],
      }),
    }));
  });

  it('marks a running async subagent orphaned when the conversation ends', async () => {
    const { controller, state } = createHarness();
    const msg = createMessage();
    state.messages = [msg];

    try {
      await controller.handleStreamChunk({
        type: 'tool_use',
        id: 'task-1',
        name: 'Agent',
        input: { description: 'Run tests', run_in_background: true },
      }, msg);
      await controller.handleStreamChunk({
        type: 'tool_result',
        id: 'task-1',
        content: '{"agent_id":"agent-1"}',
      }, msg);

      expect(controller.hasRunningSubagents()).toBe(true);

      await controller.orphanAllActiveSubagents();
    } finally {
      controller.hideThinkingIndicator();
    }

    expect(controller.hasRunningSubagents()).toBe(false);
    expect(msg.toolCalls?.[0]).toEqual(expect.objectContaining({
      id: 'task-1',
      name: 'Agent',
      status: 'error',
      result: 'Conversation ended before task completed',
      subagent: expect.objectContaining({
        agentId: 'agent-1',
        asyncStatus: 'orphaned',
        status: 'error',
        result: 'Conversation ended before task completed',
      }),
    }));
  });
});
