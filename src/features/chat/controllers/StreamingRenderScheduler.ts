import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';

interface PendingStreamingFrame {
  cancelled: boolean;
  frame: ScheduledAnimationFrame | null;
}

export interface StreamingRenderSchedulerDeps<TSnapshot> {
  getOwnerWindow: () => Window | null;
  getSnapshot: () => TSnapshot;
  renderSnapshot: (snapshot: TSnapshot) => Promise<void>;
  shouldRenderAgain: (snapshot: TSnapshot) => boolean;
  scheduleFrame?: typeof scheduleAnimationFrame;
  cancelFrame?: typeof cancelScheduledAnimationFrame;
}

export class StreamingRenderScheduler<TSnapshot> {
  private pendingFrame: PendingStreamingFrame | null = null;
  private pendingPromise: Promise<void> | null = null;
  private resolvePendingRender: (() => void) | null = null;
  private isRenderRunning = false;

  constructor(private readonly deps: StreamingRenderSchedulerDeps<TSnapshot>) {}

  schedule(): Promise<void> {
    if (!this.pendingPromise) {
      this.pendingPromise = new Promise(resolve => {
        this.resolvePendingRender = resolve;
      });
    }

    this.scheduleFrameIfIdle();
    return this.pendingPromise;
  }

  async flush(): Promise<void> {
    const pendingRender = this.pendingPromise;
    if (!pendingRender) return;

    if (this.pendingFrame !== null) {
      this.cancelPendingFrame();
      void this.renderPending();
    }

    await pendingRender;
  }

  cancel(): void {
    this.cancelPendingFrame();
    this.resolvePending();
  }

  private scheduleFrameIfIdle(): void {
    if (this.pendingFrame !== null || this.isRenderRunning) return;

    const pending: PendingStreamingFrame = {
      cancelled: false,
      frame: null,
    };
    this.pendingFrame = pending;

    pending.frame = this.scheduleFrame(() => {
      if (pending.cancelled) return;
      if (this.pendingFrame === pending) {
        this.pendingFrame = null;
      }
      void this.renderPending();
    }, this.deps.getOwnerWindow());
  }

  private async renderPending(): Promise<void> {
    if (this.isRenderRunning) return;
    this.isRenderRunning = true;

    const snapshot = this.deps.getSnapshot();
    try {
      await this.deps.renderSnapshot(snapshot);
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
    } finally {
      this.isRenderRunning = false;
    }

    if (this.deps.shouldRenderAgain(snapshot)) {
      this.scheduleFrameIfIdle();
      return;
    }

    this.resolvePending();
  }

  private cancelPendingFrame(): void {
    const pending = this.pendingFrame;
    if (!pending) return;

    pending.cancelled = true;
    if (pending.frame) {
      this.cancelFrame(pending.frame);
    }
    this.pendingFrame = null;
  }

  private resolvePending(): void {
    const resolve = this.resolvePendingRender;
    this.pendingPromise = null;
    this.resolvePendingRender = null;
    resolve?.();
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
