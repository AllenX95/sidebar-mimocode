import type { ProviderTaskResultInterpreter } from '@/core/providers/types';
import type { ChatMessage, ToolCallInfo } from '@/core/types';
import {
  SubagentProjection,
  type SubagentProjectionOptions,
} from '@/features/chat/stream/SubagentProjection';

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

function createInterpreter(
  overrides: Partial<ProviderTaskResultInterpreter> = {},
): ProviderTaskResultInterpreter {
  return {
    extractAgentId: jest.fn(() => null),
    extractStructuredResult: jest.fn(() => null),
    extractTagValue: jest.fn(() => null),
    hasAsyncLaunchMarker: jest.fn(() => false),
    resolveTerminalStatus: jest.fn((_toolUseResult, fallback) => fallback),
    ...overrides,
  };
}

function createProjection(overrides: Partial<SubagentProjectionOptions> = {}): SubagentProjection {
  return new SubagentProjection({
    now: () => 1000,
    taskResultInterpreter: createInterpreter(),
    ...overrides,
  });
}

describe('SubagentProjection', () => {
  it('buffers an Agent tool call until a child chunk confirms sync mode', () => {
    const projection = createProjection();
    const msg = createMessage();

    const first = projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: { description: 'Review code', prompt: 'Find bugs' },
    }, msg);

    expect(first.handled).toBe(true);
    expect(first.commands).toEqual([
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
    expect(msg.toolCalls?.[0]).toEqual(expect.objectContaining({
      id: 'task-1',
      name: 'Agent',
      status: 'running',
    }));
    expect(msg.contentBlocks).toEqual([]);

    const second = projection.apply({
      type: 'subagent_tool_use',
      subagentId: 'task-1',
      id: 'read-1',
      name: 'Read',
      input: { file_path: 'src/main.ts' },
    }, msg);

    expect(second.handled).toBe(true);
    expect(second.commands).toEqual([
      {
        type: 'create_sync_subagent',
        subagentId: 'task-1',
        input: { description: 'Review code', prompt: 'Find bugs' },
        subagent: expect.objectContaining({
          id: 'task-1',
          description: 'Review code',
          status: 'running',
        }),
      },
      { type: 'show_thinking_indicator' },
      {
        type: 'add_sync_subagent_tool',
        subagentId: 'task-1',
        toolCall: expect.objectContaining({
          id: 'read-1',
          name: 'Read',
          status: 'running',
        }),
      },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
    expect(msg.toolCalls?.[0].subagent).toEqual(expect.objectContaining({
      id: 'task-1',
      toolCalls: [expect.objectContaining({ id: 'read-1' })],
    }));
    expect(msg.contentBlocks).toEqual([{ type: 'subagent', subagentId: 'task-1' }]);
    expect(projection.subagentsSpawnedThisStream).toBe(1);
  });

  it('updates sync child tool results and detects blocked results', () => {
    const projection = createProjection();
    const msg = createMessage();

    projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: { description: 'Review code', run_in_background: false },
    }, msg);
    projection.apply({
      type: 'subagent_tool_use',
      subagentId: 'task-1',
      id: 'read-1',
      name: 'Read',
      input: {},
    }, msg);

    const result = projection.apply({
      type: 'subagent_tool_result',
      subagentId: 'task-1',
      id: 'read-1',
      content: 'Access denied',
    }, msg);

    const childTool = msg.toolCalls?.[0].subagent?.toolCalls[0];
    expect(childTool).toEqual(expect.objectContaining({
      id: 'read-1',
      result: 'Access denied',
      status: 'blocked',
    }));
    expect(result.commands).toEqual([
      {
        type: 'update_sync_subagent_tool_result',
        subagentId: 'task-1',
        toolId: 'read-1',
        toolCall: expect.objectContaining({ status: 'blocked' }),
      },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('finalizes sync subagents and writes the result back to the task tool call', () => {
    const projection = createProjection();
    const msg = createMessage();

    projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: { description: 'Review code', run_in_background: false },
    }, msg);

    const result = projection.apply({
      type: 'tool_result',
      id: 'task-1',
      content: '{"result":"Looks good"}',
    }, msg);

    expect(msg.toolCalls?.[0]).toEqual(expect.objectContaining({
      id: 'task-1',
      status: 'completed',
      result: 'Looks good',
      subagent: expect.objectContaining({
        status: 'completed',
        result: 'Looks good',
      }),
    }));
    expect(result.commands).toEqual([
      {
        type: 'finalize_sync_subagent',
        subagentId: 'task-1',
        result: 'Looks good',
        failed: false,
        subagent: expect.objectContaining({ result: 'Looks good' }),
      },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('creates async subagents and transitions them to running from the Agent result', () => {
    const projection = createProjection();
    const msg = createMessage();

    const created = projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: { description: 'Run tests', prompt: 'npm test', run_in_background: true },
    }, msg);

    expect(created.commands).toEqual([
      {
        type: 'create_async_subagent',
        subagentId: 'task-1',
        input: { description: 'Run tests', prompt: 'npm test', run_in_background: true },
        subagent: expect.objectContaining({
          mode: 'async',
          asyncStatus: 'pending',
        }),
      },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);

    const running = projection.apply({
      type: 'tool_result',
      id: 'task-1',
      content: '{"agent_id":"agent-1"}',
    }, msg);

    expect(msg.toolCalls?.[0].subagent).toEqual(expect.objectContaining({
      id: 'task-1',
      agentId: 'agent-1',
      asyncStatus: 'running',
      startedAt: 1000,
    }));
    expect(running.commands).toEqual([
      {
        type: 'update_async_subagent_running',
        subagentId: 'task-1',
        agentId: 'agent-1',
        subagent: expect.objectContaining({ asyncStatus: 'running' }),
      },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
    expect(projection.hasRunningSubagents()).toBe(true);
  });

  it('links TaskOutput to a running async subagent and requests hydration when it completes', () => {
    const projection = createProjection();
    const msg = createMessage();

    projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: { description: 'Run tests', run_in_background: true },
    }, msg);
    projection.apply({
      type: 'tool_result',
      id: 'task-1',
      content: '{"agent_id":"agent-1"}',
    }, msg);

    projection.apply({
      type: 'tool_use',
      id: 'output-1',
      name: 'TaskOutput',
      input: { agent_id: 'agent-1' },
    }, msg);
    const completed = projection.apply({
      type: 'tool_result',
      id: 'output-1',
      content: '{"agents":{"agent-1":{"status":"completed","result":"all green"}}}',
    }, msg);

    expect(msg.toolCalls?.[0].subagent).toEqual(expect.objectContaining({
      asyncStatus: 'completed',
      status: 'completed',
      result: 'all green',
      completedAt: 1000,
    }));
    expect(completed.commands).toEqual([
      {
        type: 'finalize_async_subagent',
        subagentId: 'task-1',
        failed: false,
        subagent: expect.objectContaining({ result: 'all green' }),
      },
      {
        type: 'request_async_subagent_hydration',
        subagentId: 'task-1',
        agentId: 'agent-1',
        subagent: expect.objectContaining({ result: 'all green' }),
      },
      { type: 'show_thinking_indicator' },
      { type: 'scroll_to_bottom' },
    ]);
    expect(projection.hasRunningSubagents()).toBe(false);
  });

  it('applies async hydration results back into the message subagent', () => {
    const projection = createProjection();
    const msg = createMessage();

    projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: { description: 'Run tests', run_in_background: true },
    }, msg);
    projection.apply({ type: 'tool_result', id: 'task-1', content: '{"agent_id":"agent-1"}' }, msg);
    projection.apply({
      type: 'async_subagent_result',
      agentId: 'agent-1',
      status: 'completed',
      result: 'fallback',
    }, msg);

    const hydratedTool: ToolCallInfo = {
      id: 'read-1',
      name: 'Read',
      input: { file_path: 'test.log' },
      status: 'completed',
      result: 'ok',
      isExpanded: false,
    };
    const hydrated = projection.applyHydrationResult({
      subagentId: 'task-1',
      agentId: 'agent-1',
      toolCalls: [hydratedTool],
      finalResult: 'final result',
    }, msg);

    expect(msg.toolCalls?.[0].subagent).toEqual(expect.objectContaining({
      result: 'final result',
      toolCalls: [expect.objectContaining({ id: 'read-1' })],
    }));
    expect(hydrated.commands).toEqual([
      {
        type: 'refresh_async_subagent',
        subagentId: 'task-1',
        subagent: expect.objectContaining({
          result: 'final result',
          toolCalls: [expect.objectContaining({ id: 'read-1' })],
        }),
      },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('marks active async subagents orphaned', () => {
    const projection = createProjection();
    const msg = createMessage();

    projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: { description: 'Run tests', run_in_background: true },
    }, msg);

    const orphaned = projection.orphanAllActive([msg]);

    expect(msg.toolCalls?.[0].subagent).toEqual(expect.objectContaining({
      asyncStatus: 'orphaned',
      status: 'error',
      result: 'Conversation ended before task completed',
    }));
    expect(orphaned.commands).toEqual([
      {
        type: 'mark_async_subagent_orphaned',
        subagentId: 'task-1',
        subagent: expect.objectContaining({ asyncStatus: 'orphaned' }),
      },
      { type: 'scroll_to_bottom' },
    ]);
  });

  it('does not handle unrelated tool results', () => {
    const projection = createProjection();

    const result = projection.apply({
      type: 'tool_result',
      id: 'read-1',
      content: 'ok',
    }, createMessage());

    expect(result).toEqual({ handled: false, commands: [] });
  });

  it('uses the provider interpreter for structured async terminal status', () => {
    const interpreter = createInterpreter({
      resolveTerminalStatus: jest.fn(() => 'error'),
      extractStructuredResult: jest.fn(() => 'structured failure'),
    });
    const projection = createProjection({ taskResultInterpreter: interpreter });
    const msg = createMessage();

    projection.apply({
      type: 'tool_use',
      id: 'task-1',
      name: 'Agent',
      input: { description: 'Run tests', run_in_background: true },
    }, msg);
    projection.apply({ type: 'tool_result', id: 'task-1', content: '{"agent_id":"agent-1"}' }, msg);
    projection.apply({ type: 'tool_use', id: 'output-1', name: 'TaskOutput', input: { agent_id: 'agent-1' } }, msg);
    projection.apply({ type: 'tool_result', id: 'output-1', content: 'raw result', toolUseResult: {} }, msg);

    expect(msg.toolCalls?.[0].subagent).toEqual(expect.objectContaining({
      status: 'error',
      asyncStatus: 'error',
      result: 'structured failure',
    }));
  });
});
