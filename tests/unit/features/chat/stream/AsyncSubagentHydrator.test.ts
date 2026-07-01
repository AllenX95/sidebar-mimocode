import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import type { ChatMessage, SubagentInfo, ToolCallInfo } from '@/core/types';
import { AsyncSubagentHydrator } from '@/features/chat/stream/AsyncSubagentHydrator';
import type {
  SubagentHydrationResult,
  SubagentRenderCommand,
} from '@/features/chat/stream/SubagentProjection';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createMessage(subagent?: SubagentInfo): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    toolCalls: [{
      id: 'task-1',
      name: 'Agent',
      input: {},
      status: 'completed',
      subagent,
    }],
    contentBlocks: [],
  };
}

function createRuntime(options: {
  finalResults?: Array<string | null>;
  toolCalls?: ToolCallInfo[];
} = {}): ChatRuntime {
  const finalResults = [...(options.finalResults ?? [])];

  return {
    loadSubagentToolCalls: jest.fn(async () => options.toolCalls ?? []),
    loadSubagentFinalResult: jest.fn(async () => finalResults.shift() ?? null),
  } as Partial<ChatRuntime> as ChatRuntime;
}

function createSubagent(overrides: Partial<SubagentInfo> = {}): SubagentInfo {
  return {
    id: 'task-1',
    description: 'Background task',
    status: 'completed',
    asyncStatus: 'completed',
    isExpanded: false,
    toolCalls: [],
    ...overrides,
  };
}

function createToolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return {
    id: 'read-1',
    name: 'Read',
    input: { file_path: 'a.md' },
    status: 'completed',
    result: 'content',
    ...overrides,
  };
}

function createHarness(options: {
  runtime?: ChatRuntime | null;
  subagent?: SubagentInfo | undefined;
} = {}) {
  let subagent: SubagentInfo | undefined = options.subagent ?? createSubagent();
  const runtime = options.runtime === undefined ? createRuntime() : options.runtime;
  const scheduledTimers = new Map<number, () => void>();
  const scheduledDelays: number[] = [];
  let nextTimerId = 1;
  const setTimeoutFn = jest.fn((callback: () => void, delay: number): number => {
    const timerId = nextTimerId++;
    scheduledTimers.set(timerId, callback);
    scheduledDelays.push(delay);
    return timerId;
  });
  const clearTimeoutFn = jest.fn((timerId: number) => {
    scheduledTimers.delete(timerId);
  });
  const commands: SubagentRenderCommand[] = subagent
    ? [{ type: 'refresh_async_subagent', subagentId: subagent.id, subagent }]
    : [];
  const applyHydrationResult = jest.fn((
    _hydration: SubagentHydrationResult,
  ) => ({
    handled: true as const,
    commands,
  }));
  const executeCommands = jest.fn(async () => undefined);

  const hydrator = new AsyncSubagentHydrator({
    applyHydrationResult,
    clearTimeoutFn,
    executeCommands,
    getRuntime: () => runtime,
    getSubagentByTaskId: () => subagent,
    retryDelaysMs: [200, 600, 1500],
    setTimeoutFn,
  });

  return {
    applyHydrationResult,
    clearTimeoutFn,
    executeCommands,
    hydrator,
    runTimer: (timerId: number) => scheduledTimers.get(timerId)?.(),
    runtime,
    scheduledDelays,
    scheduledTimers,
    setSubagent: (value: SubagentInfo | undefined) => {
      subagent = value;
    },
    setTimeoutFn,
  };
}

describe('AsyncSubagentHydrator', () => {
  it('hydrates tool calls and final result immediately when both are available', async () => {
    const sourceToolCall = createToolCall();
    const runtime = createRuntime({
      toolCalls: [sourceToolCall],
      finalResults: ['final answer'],
    });
    const { applyHydrationResult, executeCommands, hydrator, setTimeoutFn } = createHarness({
      runtime,
    });
    const msg = createMessage(createSubagent());

    await hydrator.hydrate('task-1', 'agent-1', msg);

    expect(runtime.loadSubagentToolCalls).toHaveBeenCalledWith('agent-1');
    expect(runtime.loadSubagentFinalResult).toHaveBeenCalledWith('agent-1');
    expect(applyHydrationResult).toHaveBeenCalledWith({
      subagentId: 'task-1',
      agentId: 'agent-1',
      finalResult: 'final answer',
      toolCalls: [expect.objectContaining({ id: 'read-1' })],
    }, msg);
    const hydration = applyHydrationResult.mock.calls[0]?.[0] as SubagentHydrationResult;
    expect(hydration.toolCalls?.[0]).not.toBe(sourceToolCall);
    expect(hydration.toolCalls?.[0]?.input).not.toBe(sourceToolCall.input);
    expect(executeCommands).toHaveBeenCalledTimes(1);
    expect(setTimeoutFn).not.toHaveBeenCalled();
  });

  it('schedules a retry when the final result is not available yet', async () => {
    const runtime = createRuntime({
      toolCalls: [createToolCall()],
      finalResults: [null, 'late final answer'],
    });
    const { applyHydrationResult, executeCommands, hydrator, runTimer, scheduledDelays } = createHarness({
      runtime,
    });
    const msg = createMessage(createSubagent());

    await hydrator.hydrate('task-1', 'agent-1', msg);

    expect(scheduledDelays).toEqual([200]);
    expect(applyHydrationResult).toHaveBeenCalledTimes(1);

    runTimer(1);
    await flushMicrotasks();

    expect(runtime.loadSubagentToolCalls).toHaveBeenCalledTimes(1);
    expect(runtime.loadSubagentFinalResult).toHaveBeenCalledTimes(2);
    expect(applyHydrationResult).toHaveBeenCalledTimes(2);
    expect(applyHydrationResult.mock.calls[1]?.[0]).toEqual({
      subagentId: 'task-1',
      agentId: 'agent-1',
      finalResult: 'late final answer',
      toolCalls: undefined,
    });
    expect(executeCommands).toHaveBeenCalledTimes(2);
  });

  it('does not retry if the subagent is no longer terminal', async () => {
    const runtime = createRuntime({
      toolCalls: [createToolCall()],
      finalResults: [null, 'late final answer'],
    });
    const subagent = createSubagent();
    const { applyHydrationResult, hydrator, runTimer } = createHarness({
      runtime,
      subagent,
    });
    const msg = createMessage(subagent);

    await hydrator.hydrate('task-1', 'agent-1', msg);
    subagent.asyncStatus = 'running';
    subagent.status = 'running';

    runTimer(1);
    await flushMicrotasks();

    expect(runtime.loadSubagentFinalResult).toHaveBeenCalledTimes(1);
    expect(applyHydrationResult).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying until the retry budget is exhausted', async () => {
    const runtime = createRuntime({
      toolCalls: [],
      finalResults: [null, null, null, null],
    });
    const { applyHydrationResult, hydrator, runTimer, scheduledDelays } = createHarness({
      runtime,
    });
    const msg = createMessage(createSubagent());

    await hydrator.hydrate('task-1', 'agent-1', msg);
    runTimer(1);
    await flushMicrotasks();
    runTimer(2);
    await flushMicrotasks();
    runTimer(3);
    await flushMicrotasks();

    expect(scheduledDelays).toEqual([200, 600, 1500]);
    expect(runtime.loadSubagentFinalResult).toHaveBeenCalledTimes(4);
    expect(applyHydrationResult).not.toHaveBeenCalled();
  });

  it('clears pending retry timers', async () => {
    const runtime = createRuntime({
      toolCalls: [createToolCall()],
      finalResults: [null, 'late final answer'],
    });
    const { applyHydrationResult, clearTimeoutFn, hydrator, runTimer, scheduledTimers } = createHarness({
      runtime,
    });
    const msg = createMessage(createSubagent());

    await hydrator.hydrate('task-1', 'agent-1', msg);
    hydrator.clear();

    expect(clearTimeoutFn).toHaveBeenCalledWith(1);
    expect(scheduledTimers.has(1)).toBe(false);

    runTimer(1);
    await flushMicrotasks();

    expect(runtime.loadSubagentFinalResult).toHaveBeenCalledTimes(1);
    expect(applyHydrationResult).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no runtime is available', async () => {
    const { applyHydrationResult, hydrator, setTimeoutFn } = createHarness({
      runtime: null,
    });

    await hydrator.hydrate('task-1', 'agent-1', createMessage(createSubagent()));

    expect(applyHydrationResult).not.toHaveBeenCalled();
    expect(setTimeoutFn).not.toHaveBeenCalled();
  });
});
