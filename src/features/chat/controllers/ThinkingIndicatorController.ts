import { formatDurationMmSs } from '../../../utils/date';
import { FLAVOR_TEXTS } from '../constants';
import type { ChatState } from '../state/ChatState';

export interface ThinkingIndicatorControllerDeps {
  state: ChatState;
  getMessagesEl: () => HTMLElement;
  updateQueueIndicator: () => void;
}

export class ThinkingIndicatorController {
  private static readonly THINKING_INDICATOR_DELAY = 400;

  constructor(private readonly deps: ThinkingIndicatorControllerDeps) {}

  /**
   * Schedules showing the thinking indicator after a delay. If content arrives
   * before the delay, the indicator stays hidden.
   */
  show(overrideText?: string, overrideCls?: string): void {
    const { state } = this.deps;

    if (!state.currentContentEl) return;

    if (state.thinkingIndicatorTimeout) {
      const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(timerWindow);
    }

    if (state.currentThinkingState) {
      return;
    }

    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator();
      return;
    }

    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
      state.setThinkingIndicatorTimeout(null, null);
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const cls = overrideCls
        ? `sidebar-mimocode-thinking ${overrideCls}`
        : 'sidebar-mimocode-thinking';
      state.thinkingEl = state.currentContentEl.createDiv({ cls });
      const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      state.thinkingEl.createSpan({ text });

      const timerSpan = state.thinkingEl.createSpan({ cls: 'sidebar-mimocode-thinking-hint' });
      const updateTimer = () => {
        if (!state.responseStartTime) return;
        if (!timerSpan.isConnected) {
          if (state.flavorTimerInterval) {
            state.clearFlavorTimerInterval();
          }
          return;
        }
        const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
        timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
      };
      updateTimer();

      if (state.flavorTimerInterval) {
        state.clearFlavorTimerInterval();
      }
      const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? timerWindow;
      state.setFlavorTimerInterval(thinkingWindow.setInterval(updateTimer, 1000), thinkingWindow);
    }, ThinkingIndicatorController.THINKING_INDICATOR_DELAY), timerWindow);
  }

  hide(): void {
    const { state } = this.deps;

    if (state.thinkingIndicatorTimeout) {
      const activeWindow = this.deps.getMessagesEl().ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(activeWindow);
    }

    state.clearFlavorTimerInterval();

    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
  }
}
