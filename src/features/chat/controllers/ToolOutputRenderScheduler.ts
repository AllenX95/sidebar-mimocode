import type { ToolCallInfo } from '../../../core/types';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';

interface PendingToolOutputFrame {
  frame: ScheduledAnimationFrame | null;
}

export interface ToolOutputRenderSchedulerDeps {
  getOwnerWindow: () => Window | null;
  renderToolOutput: (toolId: string, toolCall: ToolCallInfo) => void;
  scrollToBottom: () => void;
  scheduleFrame?: typeof scheduleAnimationFrame;
  cancelFrame?: typeof cancelScheduledAnimationFrame;
}

export class ToolOutputRenderScheduler {
  private pendingFrames = new Map<string, PendingToolOutputFrame>();

  constructor(private readonly deps: ToolOutputRenderSchedulerDeps) {}

  schedule(toolId: string, toolCall: ToolCallInfo): void {
    if (this.pendingFrames.has(toolId)) return;

    const pending: PendingToolOutputFrame = { frame: null };
    this.pendingFrames.set(toolId, pending);

    pending.frame = this.scheduleFrame(() => {
      this.pendingFrames.delete(toolId);
      this.deps.renderToolOutput(toolId, toolCall);
      this.deps.scrollToBottom();
    }, this.deps.getOwnerWindow());
  }

  cancel(toolId: string): void {
    const pending = this.pendingFrames.get(toolId);
    if (!pending) return;

    if (pending.frame) {
      this.cancelFrame(pending.frame);
    }
    this.pendingFrames.delete(toolId);
  }

  cancelAll(): void {
    for (const pending of this.pendingFrames.values()) {
      if (pending.frame) {
        this.cancelFrame(pending.frame);
      }
    }
    this.pendingFrames.clear();
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
