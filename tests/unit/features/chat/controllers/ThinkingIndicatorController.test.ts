import { createMockEl } from '@test/helpers/mockElement';

import { ThinkingIndicatorController } from '@/features/chat/controllers/ThinkingIndicatorController';
import { ChatState } from '@/features/chat/state/ChatState';

function createHarness() {
  jest.useFakeTimers();

  const state = new ChatState();
  const contentEl = createMockEl();
  const messagesEl = createMockEl();
  const updateQueueIndicator = jest.fn();
  state.currentContentEl = contentEl as HTMLElement;

  const controller = new ThinkingIndicatorController({
    state,
    getMessagesEl: () => messagesEl as HTMLElement,
    updateQueueIndicator,
  });

  return {
    contentEl,
    controller,
    messagesEl,
    state,
    updateQueueIndicator,
  };
}

describe('ThinkingIndicatorController', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the thinking indicator after the debounce delay', () => {
    const { controller, state } = createHarness();
    state.responseStartTime = performance.now();

    controller.show('Compacting...', 'sidebar-mimocode-thinking--compact');

    expect(state.thinkingEl).toBeNull();

    jest.advanceTimersByTime(400);

    expect(state.thinkingEl).not.toBeNull();
    expect(state.thinkingEl?.hasClass('sidebar-mimocode-thinking')).toBe(true);
    expect(state.thinkingEl?.hasClass('sidebar-mimocode-thinking--compact')).toBe(true);
    expect(state.thinkingEl?.children[0]?.textContent).toBe('Compacting...');
  });

  it('cancels a pending indicator when hidden before the delay elapses', () => {
    const { controller, state } = createHarness();

    controller.show();
    expect(state.thinkingIndicatorTimeout).not.toBeNull();

    controller.hide();
    jest.advanceTimersByTime(400);

    expect(state.thinkingIndicatorTimeout).toBeNull();
    expect(state.thinkingEl).toBeNull();
    expect(state.flavorTimerInterval).toBeNull();
  });

  it('re-appends an existing indicator and refreshes the queue indicator', () => {
    const { contentEl, controller, state, updateQueueIndicator } = createHarness();
    const existing = createMockEl();
    state.thinkingEl = existing as HTMLElement;

    controller.show();

    expect(contentEl.children.at(-1)).toBe(existing);
    expect(updateQueueIndicator).toHaveBeenCalledTimes(1);
    expect(state.thinkingIndicatorTimeout).toBeNull();
  });
});
