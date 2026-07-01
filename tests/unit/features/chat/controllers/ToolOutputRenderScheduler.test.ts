import type { ToolCallInfo } from '@/core/types';
import { ToolOutputRenderScheduler } from '@/features/chat/controllers/ToolOutputRenderScheduler';
import type { ScheduledAnimationFrame } from '@/utils/animationFrame';

function createToolCall(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
  return {
    id: 'tool-1',
    name: 'Read',
    input: {},
    status: 'running',
    ...overrides,
  };
}

function createHarness() {
  const scheduledFrames: Array<{ callback: () => void; cancelled: boolean }> = [];
  const scheduleFrame = jest.fn((callback: () => void): ScheduledAnimationFrame => {
    scheduledFrames.push({ callback, cancelled: false });
    return {
      id: scheduledFrames.length,
      kind: 'timeout',
      ownerWindow: null,
    };
  });
  const cancelFrame = jest.fn((frame: ScheduledAnimationFrame) => {
    const scheduled = scheduledFrames[frame.id - 1];
    if (scheduled) scheduled.cancelled = true;
  });
  const renderToolOutput = jest.fn();
  const scrollToBottom = jest.fn();

  const scheduler = new ToolOutputRenderScheduler({
    getOwnerWindow: () => null,
    renderToolOutput,
    scrollToBottom,
    scheduleFrame,
    cancelFrame,
  });

  return {
    cancelFrame,
    renderToolOutput,
    runFrame: (index = 0) => {
      const scheduled = scheduledFrames[index];
      if (scheduled && !scheduled.cancelled) scheduled.callback();
    },
    scheduleFrame,
    scheduler,
    scrollToBottom,
  };
}

describe('ToolOutputRenderScheduler', () => {
  it('coalesces repeated output updates for the same tool into one frame', () => {
    const { scheduler, scheduleFrame } = createHarness();
    const toolCall = createToolCall();

    scheduler.schedule('tool-1', toolCall);
    scheduler.schedule('tool-1', toolCall);

    expect(scheduleFrame).toHaveBeenCalledTimes(1);
  });

  it('renders and scrolls when the scheduled frame runs', () => {
    const { renderToolOutput, runFrame, scheduler, scrollToBottom } = createHarness();
    const toolCall = createToolCall({ result: 'partial output' });

    scheduler.schedule('tool-1', toolCall);
    runFrame();

    expect(renderToolOutput).toHaveBeenCalledWith('tool-1', toolCall);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('allows the same tool to be scheduled again after its frame runs', () => {
    const { runFrame, scheduleFrame, scheduler } = createHarness();
    const toolCall = createToolCall();

    scheduler.schedule('tool-1', toolCall);
    runFrame();
    scheduler.schedule('tool-1', toolCall);

    expect(scheduleFrame).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending frame for a single tool', () => {
    const { cancelFrame, renderToolOutput, runFrame, scheduleFrame, scheduler } = createHarness();
    const toolCall = createToolCall();

    scheduler.schedule('tool-1', toolCall);
    scheduler.cancel('tool-1');
    scheduler.cancel('tool-1');
    runFrame();

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalledWith(scheduleFrame.mock.results[0]?.value);
    expect(renderToolOutput).not.toHaveBeenCalled();
  });

  it('cancels all pending tool output frames', () => {
    const { cancelFrame, renderToolOutput, runFrame, scheduler } = createHarness();

    scheduler.schedule('tool-1', createToolCall({ id: 'tool-1' }));
    scheduler.schedule('tool-2', createToolCall({ id: 'tool-2' }));
    scheduler.cancelAll();
    runFrame(0);
    runFrame(1);

    expect(cancelFrame).toHaveBeenCalledTimes(2);
    expect(renderToolOutput).not.toHaveBeenCalled();
  });
});
