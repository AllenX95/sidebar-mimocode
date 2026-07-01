import type {
  ProviderId,
  ProviderSubagentLifecycleAdapter,
} from '../../../core/providers/types';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import {
  createSubagentBlock,
  finalizeSubagentBlock,
  type SubagentState,
} from '../rendering/SubagentRenderer';
import type { ChatState } from '../state/ChatState';

export interface ProviderLifecycleSubagentControllerDeps {
  state: ChatState;
  getProviderId: () => ProviderId;
  flushPendingTools: () => void;
  resolveAdapter?: (
    providerId: ProviderId,
    toolName?: string,
  ) => ProviderSubagentLifecycleAdapter | null;
}

type ProviderLifecycleToolUseChunk = {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type ProviderLifecycleToolResultChunk = {
  type: 'tool_result';
  id: string;
  content: string;
  isError?: boolean;
};

export class ProviderLifecycleSubagentController {
  private readonly agentIdToSpawnId = new Map<string, string>();
  private readonly subagentStates = new Map<string, SubagentState>();

  constructor(private readonly deps: ProviderLifecycleSubagentControllerDeps) {}

  clear(): void {
    this.agentIdToSpawnId.clear();
    this.subagentStates.clear();
  }

  handleToolResult(
    chunk: ProviderLifecycleToolResultChunk,
    msg: ChatMessage,
  ): boolean {
    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) return false;

    const adapter = this.getAdapter(existingToolCall.name);
    if (!adapter) return false;

    const normalizedContent = normalizeToolResultContent(chunk.content);

    if (adapter.isSpawnTool(existingToolCall.name)) {
      this.handleSpawnResult(existingToolCall, chunk, normalizedContent, msg, adapter);
      return true;
    }

    if (adapter.isWaitTool(existingToolCall.name)) {
      this.handleWaitResult(existingToolCall, chunk, normalizedContent, msg, adapter);
      return true;
    }

    if (adapter.isCloseTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      return true;
    }

    return false;
  }

  handleToolUse(
    chunk: ProviderLifecycleToolUseChunk,
    msg: ChatMessage,
  ): boolean {
    const adapter = this.getAdapter(chunk.name);
    if (!adapter) return false;

    if (adapter.isSpawnTool(chunk.name)) {
      this.handleSpawnToolUse(chunk, msg, adapter);
      return true;
    }

    if (adapter.isHiddenTool(chunk.name)) {
      this.addHiddenToolCall(chunk, msg);
      return true;
    }

    return false;
  }

  isHiddenTool(name: string): boolean {
    return this.getAdapter(name)?.isHiddenTool(name) === true;
  }

  isLifecycleTool(name: string): boolean {
    const adapter = this.getAdapter(name);
    return Boolean(
      adapter?.isSpawnTool(name) ||
      adapter?.isWaitTool(name) ||
      adapter?.isCloseTool(name)
    );
  }

  shouldHandleToolResult(toolId: string, msg: ChatMessage): boolean {
    const toolCall = msg.toolCalls?.find(tc => tc.id === toolId);
    if (!toolCall) return false;

    return this.ownsTool(toolCall.name);
  }

  shouldUseLegacyToolUse(name: string): boolean {
    return this.isLifecycleTool(name) || this.isHiddenTool(name);
  }

  private addHiddenToolCall(
    chunk: ProviderLifecycleToolUseChunk,
    msg: ChatMessage,
  ): void {
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(createToolCall(chunk));
  }

  private getAdapter(toolName?: string): ProviderSubagentLifecycleAdapter | null {
    return (this.deps.resolveAdapter ?? resolveSubagentLifecycleAdapter)(
      this.deps.getProviderId(),
      toolName,
    );
  }

  private handleSpawnResult(
    existingToolCall: ToolCallInfo,
    chunk: ProviderLifecycleToolResultChunk,
    normalizedContent: string,
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
  ): void {
    existingToolCall.status = chunk.isError ? 'error' : 'completed';
    existingToolCall.result = normalizedContent;

    const spawnResult = adapter.extractSpawnResult(normalizedContent);
    if (spawnResult.agentId) {
      this.agentIdToSpawnId.set(spawnResult.agentId, chunk.id);
    }

    this.refreshSpawnSubagentInfo(chunk.id, existingToolCall, msg, adapter);

    if (chunk.isError) {
      const subagentState = this.subagentStates.get(chunk.id);
      if (subagentState) {
        finalizeSubagentBlock(subagentState, normalizedContent || 'Error', true);
      }
    }
  }

  private handleSpawnToolUse(
    chunk: ProviderLifecycleToolUseChunk,
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
  ): void {
    const { state } = this.deps;
    const toolCall = createToolCall(chunk);

    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });

    if (!state.currentContentEl) return;

    this.deps.flushPendingTools();
    const subagentInfo = adapter.buildSubagentInfo(toolCall, msg.toolCalls);
    const subagentState = createSubagentBlock(state.currentContentEl, chunk.id, {
      description: subagentInfo.description,
      prompt: subagentInfo.prompt,
    });
    this.subagentStates.set(chunk.id, subagentState);
  }

  private handleWaitResult(
    existingToolCall: ToolCallInfo,
    chunk: ProviderLifecycleToolResultChunk,
    normalizedContent: string,
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
  ): void {
    existingToolCall.status = chunk.isError ? 'error' : 'completed';
    existingToolCall.result = normalizedContent;

    for (const spawnId of adapter.resolveSpawnToolIds(
      existingToolCall,
      this.agentIdToSpawnId,
    )) {
      const spawnToolCall = msg.toolCalls?.find(tc => tc.id === spawnId);
      if (!spawnToolCall) continue;

      this.refreshSpawnSubagentInfo(spawnId, spawnToolCall, msg, adapter);
      const subagentInfo = adapter.buildSubagentInfo(spawnToolCall, msg.toolCalls ?? []);
      const subagentState = this.subagentStates.get(spawnId);
      if (!subagentState) continue;

      if (subagentInfo.status === 'completed' || subagentInfo.status === 'error') {
        finalizeSubagentBlock(
          subagentState,
          subagentInfo.result || (subagentInfo.status === 'error' ? 'Error' : 'DONE'),
          subagentInfo.status === 'error',
        );
      }
    }
  }

  private ownsTool(name: string): boolean {
    const adapter = this.getAdapter(name);
    return Boolean(
      adapter?.isSpawnTool(name) ||
      adapter?.isWaitTool(name) ||
      adapter?.isCloseTool(name) ||
      adapter?.isHiddenTool(name)
    );
  }

  private refreshSpawnSubagentInfo(
    spawnId: string,
    spawnToolCall: ToolCallInfo,
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
  ): void {
    const subagentState = this.subagentStates.get(spawnId);
    if (!subagentState) return;

    const subagentInfo = adapter.buildSubagentInfo(spawnToolCall, msg.toolCalls ?? []);
    subagentState.info.description = subagentInfo.description;
    subagentState.info.prompt = subagentInfo.prompt;
    subagentState.labelEl.setText(truncateDescription(subagentInfo.description));
  }
}

function createToolCall(chunk: ProviderLifecycleToolUseChunk): ToolCallInfo {
  return {
    id: chunk.id,
    name: chunk.name,
    input: chunk.input,
    status: 'running',
    isExpanded: false,
  };
}

function normalizeToolResultContent(content: unknown): string {
  return extractToolResultContent(content, { fallbackIndent: 2 });
}

function truncateDescription(description: string, maxLength = 40): string {
  return description.length > maxLength
    ? `${description.substring(0, maxLength)}...`
    : description;
}
