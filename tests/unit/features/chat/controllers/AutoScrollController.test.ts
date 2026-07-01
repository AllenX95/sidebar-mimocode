import { createMockEl } from '@test/helpers/mockElement';

import {
  AutoScrollController,
  type AutoScrollControllerDeps,
} from '@/features/chat/controllers/AutoScrollController';
import { ChatState } from '@/features/chat/state/ChatState';
import type { ScheduledAnimationFrame } from '@/utils/animationFrame';

function createHarness(
  overrides: Partial<Pick<AutoScrollControllerDeps, 'isAutoScrollEnabled'>> = {},
) {
  const state = new ChatState();
  const messagesEl = createMockEl();
  messagesEl.scrollHeight = 1000;
  messagesEl.scrollTop = 25;

  const scheduledCallbacks: Array<() => void> = [];
  const scheduleFrame = jest.fn((callback: () => void): ScheduledAnimationFrame => {
    scheduledCallbacks.push(callback);
    return {
      id: scheduledCallbacks.length,
      kind: 'timeout',
      ownerWindow: null,
    };
  });
  const cancelFrame = jest.fn();

  const controller = new AutoScrollController({
    state,
    getMessagesEl: () => messagesEl as HTMLElement,
    isAutoScrollEnabled: overrides.isAutoScrollEnabled ?? (() => true),
    scheduleFrame,
    cancelFrame,
  });

  return {
    cancelFrame,
    controller,
    messagesEl,
    runFrame: (index = 0) => scheduledCallbacks[index]?.(),
    scheduleFrame,
    state,
  };
}

describe('AutoScrollController', () => {
  it('coalesces scroll requests into one animation frame', () => {
    const { controller, messagesEl, runFrame, scheduleFrame } = createHarness();

    controller.scheduleToBottom();
    controller.scheduleToBottom();

    expect(scheduleFrame).toHaveBeenCalledTimes(1);

    runFrame();

    expect(messagesEl.scrollTop).toBe(1000);
  });

  it('does not scroll when plugin auto-scroll is disabled', () => {
    const { controller, messagesEl, runFrame } = createHarness({
      isAutoScrollEnabled: () => false,
    });

    controller.scheduleToBottom();
    runFrame();

    expect(messagesEl.scrollTop).toBe(25);
  });

  it('does not scroll when the user paused auto-scroll', () => {
    const { controller, messagesEl, runFrame, state } = createHarness();
    state.autoScrollEnabled = false;

    controller.scheduleToBottom();
    runFrame();

    expect(messagesEl.scrollTop).toBe(25);
  });

  it('cancels a pending scroll frame', () => {
    const { cancelFrame, controller, scheduleFrame } = createHarness();

    controller.scheduleToBottom();
    controller.cancel();
    controller.cancel();

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalledWith(scheduleFrame.mock.results[0]?.value);
  });
});
