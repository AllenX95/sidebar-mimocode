import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import type { ChatState } from '../state/ChatState';

export interface AutoScrollControllerDeps {
  state: ChatState;
  getMessagesEl: () => HTMLElement;
  isAutoScrollEnabled: () => boolean;
  scheduleFrame?: typeof scheduleAnimationFrame;
  cancelFrame?: typeof cancelScheduledAnimationFrame;
}

export class AutoScrollController {
  private pendingFrame: ScheduledAnimationFrame | null = null;

  constructor(private readonly deps: AutoScrollControllerDeps) {}

  scheduleToBottom(): void {
    if (this.pendingFrame !== null) return;

    this.pendingFrame = this.scheduleFrame(() => {
      this.pendingFrame = null;
      this.applyToBottom();
    }, this.getMessagesWindow());
  }

  cancel(): void {
    if (this.pendingFrame === null) return;

    this.cancelFrame(this.pendingFrame);
    this.pendingFrame = null;
  }

  private applyToBottom(): void {
    if (!this.deps.isAutoScrollEnabled()) return;
    if (!this.deps.state.autoScrollEnabled) return;

    const messagesEl = this.deps.getMessagesEl();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  private getMessagesWindow(): Window | null {
    return this.deps.getMessagesEl().ownerDocument.defaultView ?? null;
  }

  private scheduleFrame(
    callback: () => void,
    ownerWindow: Window | null,
  ): ScheduledAnimationFrame {
    return (this.deps.scheduleFrame ?? scheduleAnimationFrame)(callback, ownerWindow);
  }

  private cancelFrame(frame: ScheduledAnimationFrame): void {
    (this.deps.cancelFrame ?? cancelScheduledAnimationFrame)(frame);
  }
}
