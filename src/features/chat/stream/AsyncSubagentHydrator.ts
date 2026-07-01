import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import { isSubagentToolName } from '../../../core/tools/toolNames';
import type { ChatMessage, SubagentInfo, ToolCallInfo } from '../../../core/types';
import type {
  SubagentHydrationResult,
  SubagentProjectionResult,
  SubagentRenderCommand,
} from './SubagentProjection';

type TimeoutHandle = ReturnType<Window['setTimeout']>;

export interface AsyncSubagentHydratorDeps {
  applyHydrationResult: (
    hydration: SubagentHydrationResult,
    msg: ChatMessage,
  ) => SubagentProjectionResult;
  executeCommands: (commands: SubagentRenderCommand[], msg: ChatMessage) => Promise<void>;
  getRuntime: () => ChatRuntime | null;
  getSubagentByTaskId: (subagentId: string) => SubagentInfo | undefined;
  retryDelaysMs?: readonly number[];
  setTimeoutFn?: (callback: () => void, delay: number) => TimeoutHandle;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
}

interface LoadedAsyncSubagentHydration {
  finalResult: string | null;
  finalResultHydrated: boolean;
  hasHydrated: boolean;
  toolCalls?: ToolCallInfo[];
}

export class AsyncSubagentHydrator {
  private static readonly DEFAULT_RESULT_RETRY_DELAYS_MS = [200, 600, 1500] as const;

  private pendingRetryTimers = new Set<TimeoutHandle>();

  constructor(private readonly deps: AsyncSubagentHydratorDeps) {}

  clear(): void {
    for (const timer of this.pendingRetryTimers) {
      this.clearTimeout(timer);
    }
    this.pendingRetryTimers.clear();
  }

  async hydrate(
    subagentId: string,
    agentId: string,
    msg: ChatMessage,
  ): Promise<void> {
    const runtime = this.deps.getRuntime();
    if (!runtime) return;

    const hydration = await this.load(agentId, true, runtime);
    await this.applyHydration(subagentId, agentId, msg, hydration);

    if (!hydration.finalResultHydrated) {
      this.scheduleResultRetry(subagentId, agentId, msg, runtime, 0);
    }
  }

  private async applyHydration(
    subagentId: string,
    agentId: string,
    msg: ChatMessage,
    hydration: LoadedAsyncSubagentHydration,
  ): Promise<void> {
    if (!hydration.hasHydrated) return;

    const result = this.deps.applyHydrationResult({
      subagentId,
      agentId,
      finalResult: hydration.finalResult,
      toolCalls: hydration.toolCalls,
    }, msg);
    if (result.handled) {
      await this.deps.executeCommands(result.commands, msg);
    }
  }

  private clearTimeout(timer: TimeoutHandle): void {
    if (this.deps.clearTimeoutFn) {
      this.deps.clearTimeoutFn(timer);
      return;
    }

    window.clearTimeout(timer);
  }

  private findSubagent(subagentId: string, msg: ChatMessage): SubagentInfo | undefined {
    return this.deps.getSubagentByTaskId(subagentId)
      ?? msg.toolCalls?.find(tc => tc.id === subagentId && isSubagentToolName(tc.name))?.subagent;
  }

  private get retryDelaysMs(): readonly number[] {
    return this.deps.retryDelaysMs ?? AsyncSubagentHydrator.DEFAULT_RESULT_RETRY_DELAYS_MS;
  }

  private isTerminalSubagent(subagentId: string, msg: ChatMessage): boolean {
    const subagent = this.findSubagent(subagentId, msg);
    const asyncStatus = subagent?.asyncStatus ?? subagent?.status;
    return asyncStatus === 'completed' || asyncStatus === 'error';
  }

  private async load(
    agentId: string,
    hydrateToolCalls: boolean,
    runtime: ChatRuntime,
  ): Promise<LoadedAsyncSubagentHydration> {
    let hasHydrated = false;
    let toolCalls: ToolCallInfo[] | undefined;

    if (hydrateToolCalls) {
      const recoveredToolCalls = await runtime.loadSubagentToolCalls?.(agentId) ?? [];
      if (recoveredToolCalls.length > 0) {
        toolCalls = recoveredToolCalls.map((toolCall) => ({
          ...toolCall,
          input: { ...toolCall.input },
        }));
        hasHydrated = true;
      }
    }

    const finalResult = await runtime.loadSubagentFinalResult?.(agentId) ?? null;
    const normalizedFinalResult = finalResult?.trim() ? finalResult : null;
    if (normalizedFinalResult) {
      hasHydrated = true;
    }

    return {
      finalResult: normalizedFinalResult,
      finalResultHydrated: normalizedFinalResult !== null,
      hasHydrated,
      toolCalls,
    };
  }

  private async retryResult(
    subagentId: string,
    agentId: string,
    msg: ChatMessage,
    runtime: ChatRuntime,
    attempt: number,
  ): Promise<void> {
    if (!this.isTerminalSubagent(subagentId, msg)) return;

    const hydration = await this.load(agentId, false, runtime);
    await this.applyHydration(subagentId, agentId, msg, hydration);

    if (!hydration.finalResultHydrated) {
      this.scheduleResultRetry(subagentId, agentId, msg, runtime, attempt + 1);
    }
  }

  private scheduleResultRetry(
    subagentId: string,
    agentId: string,
    msg: ChatMessage,
    runtime: ChatRuntime,
    attempt: number,
  ): void {
    if (attempt >= this.retryDelaysMs.length) return;

    const delay = this.retryDelaysMs[attempt];
    const timer = this.setTimeout(() => {
      this.pendingRetryTimers.delete(timer);
      void this.retryResult(subagentId, agentId, msg, runtime, attempt);
    }, delay);
    this.pendingRetryTimers.add(timer);
  }

  private setTimeout(callback: () => void, delay: number): TimeoutHandle {
    if (this.deps.setTimeoutFn) {
      return this.deps.setTimeoutFn(callback, delay);
    }

    return window.setTimeout(callback, delay);
  }
}
