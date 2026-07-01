import { StreamingRenderScheduler } from '@/features/chat/controllers/StreamingRenderScheduler';
import type { ScheduledAnimationFrame } from '@/utils/animationFrame';

interface Snapshot {
  content: string;
  target: string | null;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(
  overrides: Partial<{
    renderSnapshot: (snapshot: Snapshot) => Promise<void>;
    shouldRenderAgain: (snapshot: Snapshot) => boolean;
  }> = {},
) {
  let currentSnapshot: Snapshot = {
    content: 'first',
    target: 'text-el',
  };
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
  const renderSnapshot = jest.fn(
    overrides.renderSnapshot ?? (async () => undefined),
  );
  const shouldRenderAgain = jest.fn(
    overrides.shouldRenderAgain ?? ((snapshot: Snapshot) =>
      currentSnapshot.target === snapshot.target && currentSnapshot.content !== snapshot.content),
  );

  const scheduler = new StreamingRenderScheduler<Snapshot>({
    getOwnerWindow: () => null,
    getSnapshot: () => ({ ...currentSnapshot }),
    renderSnapshot,
    shouldRenderAgain,
    scheduleFrame,
    cancelFrame,
  });

  return {
    cancelFrame,
    renderSnapshot,
    runFrame: (index = 0) => {
      const scheduled = scheduledFrames[index];
      if (scheduled && !scheduled.cancelled) scheduled.callback();
    },
    scheduleFrame,
    scheduler,
    setSnapshot: (snapshot: Partial<Snapshot>) => {
      currentSnapshot = {
        ...currentSnapshot,
        ...snapshot,
      };
    },
    shouldRenderAgain,
  };
}

describe('StreamingRenderScheduler', () => {
  it('coalesces repeated schedule calls into one frame', () => {
    const { scheduleFrame, scheduler } = createHarness();

    void scheduler.schedule();
    void scheduler.schedule();

    expect(scheduleFrame).toHaveBeenCalledTimes(1);
  });

  it('renders the current snapshot when the frame runs', async () => {
    const { renderSnapshot, runFrame, scheduler } = createHarness();

    const pendingRender = scheduler.schedule();
    runFrame();
    await pendingRender;

    expect(renderSnapshot).toHaveBeenCalledWith({
      content: 'first',
      target: 'text-el',
    });
  });

  it('flushes a pending frame by cancelling it and rendering immediately', async () => {
    const { cancelFrame, renderSnapshot, scheduleFrame, scheduler } = createHarness();

    void scheduler.schedule();
    await scheduler.flush();

    expect(cancelFrame).toHaveBeenCalledWith(scheduleFrame.mock.results[0]?.value);
    expect(renderSnapshot).toHaveBeenCalledTimes(1);
  });

  it('schedules another frame when content changes during render', async () => {
    let updateSnapshot: ((snapshot: Partial<Snapshot>) => void) | null = null;
    const harness = createHarness({
      renderSnapshot: async () => {
        updateSnapshot?.({ content: 'second' });
      },
    });
    updateSnapshot = harness.setSnapshot;

    const pendingRender = harness.scheduler.schedule();
    harness.runFrame();
    await flushMicrotasks();

    expect(harness.renderSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.scheduleFrame).toHaveBeenCalledTimes(2);

    harness.runFrame(1);
    await pendingRender;

    expect(harness.renderSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.renderSnapshot).toHaveBeenLastCalledWith({
      content: 'second',
      target: 'text-el',
    });
  });

  it('cancels a pending frame and resolves the pending render', async () => {
    const { cancelFrame, renderSnapshot, scheduler } = createHarness();

    const pendingRender = scheduler.schedule();
    scheduler.cancel();
    await pendingRender;

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(renderSnapshot).not.toHaveBeenCalled();
  });

  it('swallows render errors and resolves the pending render', async () => {
    const { renderSnapshot, runFrame, scheduler } = createHarness({
      renderSnapshot: async () => {
        throw new Error('render failed');
      },
    });

    const pendingRender = scheduler.schedule();
    runFrame();
    await pendingRender;

    expect(renderSnapshot).toHaveBeenCalledTimes(1);
  });
});
