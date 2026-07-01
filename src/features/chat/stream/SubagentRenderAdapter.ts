import type { SubagentInfo, ToolCallInfo } from '../../../core/types';
import {
  addSubagentToolCall,
  type AsyncSubagentState,
  createAsyncSubagentBlock,
  createSubagentBlock,
  finalizeAsyncSubagent,
  finalizeSubagentBlock,
  markAsyncSubagentOrphaned,
  type SubagentState,
  updateAsyncSubagentRunning,
  updateSubagentToolResult,
} from '../rendering/SubagentRenderer';
import type { ChatState } from '../state/ChatState';

export class SubagentRenderAdapter {
  private asyncSubagentStates = new Map<string, AsyncSubagentState>();
  private syncSubagentStates = new Map<string, SubagentState>();

  constructor(private readonly state: ChatState) {}

  addSyncSubagentTool(subagentId: string, toolCall: ToolCallInfo): void {
    const subagentState = this.syncSubagentStates.get(subagentId);
    if (!subagentState) return;

    addSubagentToolCall(subagentState, toolCall);
  }

  clear(): void {
    this.syncSubagentStates.clear();
    this.asyncSubagentStates.clear();
  }

  createAsyncSubagent(
    subagentId: string,
    input: Record<string, unknown>,
    subagent: SubagentInfo,
  ): void {
    const parentEl = this.state.currentContentEl;
    if (!parentEl) return;

    const domState = createAsyncSubagentBlock(parentEl, subagentId, input);
    domState.info = subagent;
    this.asyncSubagentStates.set(subagentId, domState);
  }

  createSyncSubagent(
    subagentId: string,
    input: Record<string, unknown>,
    subagent: SubagentInfo,
  ): void {
    const parentEl = this.state.currentContentEl;
    if (!parentEl) return;

    const subagentState = createSubagentBlock(parentEl, subagentId, input);
    subagentState.info = subagent;
    this.syncSubagentStates.set(subagentId, subagentState);
  }

  finalizeAsyncSubagent(subagent: SubagentInfo, failed: boolean): void {
    const asyncState = this.findAsyncState(subagent);
    if (!asyncState) return;

    asyncState.info = subagent;
    finalizeAsyncSubagent(asyncState, subagent.result || '', failed);
  }

  finalizeSyncSubagent(subagentId: string, result: string, failed: boolean): void {
    const subagentState = this.syncSubagentStates.get(subagentId);
    if (!subagentState) return;

    finalizeSubagentBlock(subagentState, result, failed);
    this.syncSubagentStates.delete(subagentId);
  }

  markAsyncSubagentOrphaned(subagent: SubagentInfo): void {
    const asyncState = this.findAsyncState(subagent);
    if (!asyncState) return;

    asyncState.info = subagent;
    markAsyncSubagentOrphaned(asyncState);
  }

  refreshAsyncSubagent(subagent: SubagentInfo): void {
    const asyncState = this.findAsyncState(subagent);
    if (!asyncState) return;

    asyncState.info = subagent;
    switch (subagent.asyncStatus) {
      case 'running':
        updateAsyncSubagentRunning(asyncState, subagent.agentId || '');
        break;
      case 'completed':
      case 'error':
        finalizeAsyncSubagent(asyncState, subagent.result || '', subagent.asyncStatus === 'error');
        break;
      case 'orphaned':
        markAsyncSubagentOrphaned(asyncState);
        break;
      default:
        break;
    }
  }

  resetStreamingState(): void {
    this.syncSubagentStates.clear();
  }

  updateAsyncSubagentRunning(subagent: SubagentInfo, agentId: string): void {
    const asyncState = this.findAsyncState(subagent);
    if (!asyncState) return;

    asyncState.info = subagent;
    updateAsyncSubagentRunning(asyncState, agentId);
  }

  updateSubagentLabel(
    subagentId: string,
    input: Record<string, unknown>,
    subagent: SubagentInfo,
  ): void {
    const syncState = this.syncSubagentStates.get(subagentId);
    const asyncState = this.asyncSubagentStates.get(subagentId);
    const wrapperEl = syncState?.wrapperEl ?? asyncState?.wrapperEl;
    if (!wrapperEl) return;

    const description = (input.description as string) || subagent.description;
    const prompt = (input.prompt as string) || subagent.prompt || '';

    const labelEl = wrapperEl.querySelector('.sidebar-mimocode-subagent-label');
    labelEl?.setText(truncateDescription(description));

    const promptEl = wrapperEl.querySelector('.sidebar-mimocode-subagent-prompt-text');
    promptEl?.setText(prompt || 'No prompt provided');

    if (syncState) syncState.info = subagent;
    if (asyncState) asyncState.info = subagent;
  }

  updateSyncSubagentToolResult(
    subagentId: string,
    toolId: string,
    toolCall: ToolCallInfo,
  ): void {
    const subagentState = this.syncSubagentStates.get(subagentId);
    if (!subagentState) return;

    updateSubagentToolResult(subagentState, toolId, toolCall);
  }

  private findAsyncState(subagent: SubagentInfo): AsyncSubagentState | undefined {
    const direct = this.asyncSubagentStates.get(subagent.id);
    if (direct) return direct;

    for (const state of this.asyncSubagentStates.values()) {
      if (state.info.agentId === subagent.agentId) {
        return state;
      }
    }
    return undefined;
  }
}

function truncateDescription(description: string, maxLength = 40): string {
  if (description.length <= maxLength) return description;
  return `${description.substring(0, maxLength)}...`;
}
