import type { ProviderTaskResultInterpreter } from '../../../core/providers/types';
import {
  isSubagentToolName,
  TOOL_AGENT_OUTPUT,
  TOOL_TASK,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { ChatMessage, StreamChunk, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { extractFinalResultFromSubagentJsonl } from '../../../utils/subagentJsonl';

export type SubagentProjectionResult =
  | { handled: true; commands: SubagentRenderCommand[] }
  | { handled: false; commands: [] };

export type SubagentRenderCommand =
  | { type: 'create_sync_subagent'; subagentId: string; input: Record<string, unknown>; subagent: SubagentInfo }
  | { type: 'create_async_subagent'; subagentId: string; input: Record<string, unknown>; subagent: SubagentInfo }
  | { type: 'update_subagent_label'; subagentId: string; input: Record<string, unknown>; subagent: SubagentInfo }
  | { type: 'add_sync_subagent_tool'; subagentId: string; toolCall: ToolCallInfo }
  | { type: 'update_sync_subagent_tool_result'; subagentId: string; toolId: string; toolCall: ToolCallInfo }
  | { type: 'finalize_sync_subagent'; subagentId: string; result: string; failed: boolean; subagent: SubagentInfo }
  | { type: 'update_async_subagent_running'; subagentId: string; agentId: string; subagent: SubagentInfo }
  | { type: 'finalize_async_subagent'; subagentId: string; failed: boolean; subagent: SubagentInfo }
  | { type: 'mark_async_subagent_orphaned'; subagentId: string; subagent: SubagentInfo }
  | { type: 'refresh_async_subagent'; subagentId: string; subagent: SubagentInfo }
  | { type: 'request_async_subagent_hydration'; subagentId: string; agentId: string; subagent: SubagentInfo }
  | { type: 'show_thinking_indicator' }
  | { type: 'scroll_to_bottom' };

export interface SubagentHydrationResult {
  agentId?: string;
  finalResult?: string | null;
  subagentId: string;
  toolCalls?: ToolCallInfo[];
}

export interface SubagentProjectionOptions {
  now?: () => number;
  taskResultInterpreter: ProviderTaskResultInterpreter;
}

interface PendingTask {
  toolCall: ToolCallInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export class SubagentProjection {
  private activeAsyncSubagents = new Map<string, SubagentInfo>();
  private outputToolIdToAgentId = new Map<string, string>();
  private pendingAsyncSubagents = new Map<string, SubagentInfo>();
  private pendingTasks = new Map<string, PendingTask>();
  private spawnedThisStream = 0;
  private syncSubagents = new Map<string, SubagentInfo>();
  private taskIdToAgentId = new Map<string, string>();

  constructor(private options: SubagentProjectionOptions) {}

  get subagentsSpawnedThisStream(): number {
    return this.spawnedThisStream;
  }

  apply(chunk: StreamChunk, msg: ChatMessage): SubagentProjectionResult {
    switch (chunk.type) {
      case 'tool_use':
        if (isSubagentToolName(chunk.name)) {
          return this.handled(this.projectTaskToolUse(chunk, msg));
        }
        if (chunk.name === TOOL_AGENT_OUTPUT) {
          return this.projectAgentOutputToolUse(chunk);
        }
        return this.notHandled();

      case 'tool_result':
        return this.projectToolResult(chunk, msg);

      case 'subagent_tool_use':
      case 'subagent_tool_result':
        return this.handled(this.projectSubagentChunk(chunk, msg));

      case 'async_subagent_result':
        return this.projectAsyncSubagentResult(chunk);

      default:
        return this.notHandled();
    }
  }

  applyHydrationResult(
    hydration: SubagentHydrationResult,
    msg: ChatMessage,
  ): SubagentProjectionResult {
    const subagent = this.findMessageSubagent(msg, hydration.subagentId);
    if (!subagent) return this.notHandled();

    if (hydration.toolCalls && hydration.toolCalls.length > 0 && !subagent.toolCalls?.length) {
      subagent.toolCalls = hydration.toolCalls.map((toolCall) => ({
        ...toolCall,
        input: { ...toolCall.input },
      }));
    }

    const finalResult = hydration.finalResult?.trim();
    if (finalResult) {
      subagent.result = finalResult;
      const taskToolCall = this.ensureTaskToolCall(msg, hydration.subagentId);
      this.applySubagentToTaskToolCall(taskToolCall, subagent);
    }

    return this.handled([
      {
        type: 'refresh_async_subagent',
        subagentId: hydration.subagentId,
        subagent,
      },
    ]);
  }

  clear(): void {
    this.syncSubagents.clear();
    this.pendingTasks.clear();
    this.pendingAsyncSubagents.clear();
    this.activeAsyncSubagents.clear();
    this.taskIdToAgentId.clear();
    this.outputToolIdToAgentId.clear();
  }

  getByTaskId(taskToolId: string): SubagentInfo | undefined {
    const pending = this.pendingAsyncSubagents.get(taskToolId);
    if (pending) return pending;

    const activeAgentId = this.taskIdToAgentId.get(taskToolId);
    if (activeAgentId) {
      return this.activeAsyncSubagents.get(activeAgentId);
    }

    return this.syncSubagents.get(taskToolId);
  }

  hasPendingTask(toolId: string): boolean {
    return this.pendingTasks.has(toolId);
  }

  hasRunningSubagents(): boolean {
    return this.pendingAsyncSubagents.size > 0 || this.activeAsyncSubagents.size > 0;
  }

  hasSyncSubagent(toolId: string): boolean {
    return this.syncSubagents.has(toolId);
  }

  isLinkedAgentOutputTool(toolId: string): boolean {
    return this.outputToolIdToAgentId.has(toolId);
  }

  isPendingAsyncTask(taskToolId: string): boolean {
    return this.pendingAsyncSubagents.has(taskToolId);
  }

  orphanAllActive(messages: ChatMessage[] = []): SubagentProjectionResult {
    const commands: SubagentRenderCommand[] = [];
    const orphan = (subagent: SubagentInfo) => {
      subagent.asyncStatus = 'orphaned';
      subagent.status = 'error';
      subagent.result = 'Conversation ended before task completed';
      subagent.completedAt = this.now();
      this.updateSubagentInMessages(messages, subagent);
      commands.push({
        type: 'mark_async_subagent_orphaned',
        subagentId: subagent.id,
        subagent,
      });
    };

    for (const subagent of this.pendingAsyncSubagents.values()) {
      orphan(subagent);
    }

    for (const subagent of this.activeAsyncSubagents.values()) {
      if (subagent.asyncStatus === 'running') {
        orphan(subagent);
      }
    }

    this.pendingAsyncSubagents.clear();
    this.activeAsyncSubagents.clear();
    this.taskIdToAgentId.clear();
    this.outputToolIdToAgentId.clear();

    return this.handled(commands);
  }

  resetSpawnedCount(): void {
    this.spawnedThisStream = 0;
  }

  resetStreamingState(): void {
    this.syncSubagents.clear();
    this.pendingTasks.clear();
  }

  setTaskResultInterpreter(taskResultInterpreter: ProviderTaskResultInterpreter): void {
    this.options = {
      ...this.options,
      taskResultInterpreter,
    };
  }

  private projectTaskToolUse(
    chunk: Extract<StreamChunk, { type: 'tool_use' }>,
    msg: ChatMessage,
  ): SubagentRenderCommand[] {
    const taskToolCall = this.ensureTaskToolCall(msg, chunk.id, chunk.input);
    const input = taskToolCall.input;

    const existingSync = this.syncSubagents.get(chunk.id);
    if (existingSync) {
      this.updateSubagentInput(existingSync, chunk.input);
      return [{
        type: 'update_subagent_label',
        subagentId: chunk.id,
        input,
        subagent: existingSync,
      }];
    }

    const existingAsync = this.getAsyncByTaskId(chunk.id);
    if (existingAsync) {
      this.updateSubagentInput(existingAsync, chunk.input);
      return [{
        type: 'update_subagent_label',
        subagentId: chunk.id,
        input,
        subagent: existingAsync,
      }];
    }

    const pending = this.pendingTasks.get(chunk.id);
    if (pending) {
      pending.toolCall.input = input;
      const mode = this.resolveTaskMode(input);
      if (!mode) {
        return [{ type: 'show_thinking_indicator' }];
      }
      return this.createTaskSubagent(chunk.id, input, msg, mode);
    }

    const mode = this.resolveTaskMode(input);
    if (!mode) {
      this.pendingTasks.set(chunk.id, { toolCall: taskToolCall });
      return [{ type: 'show_thinking_indicator' }];
    }

    return this.createTaskSubagent(chunk.id, input, msg, mode);
  }

  private projectSubagentChunk(
    chunk: Extract<StreamChunk, { type: 'subagent_tool_use' | 'subagent_tool_result' }>,
    msg: ChatMessage,
  ): SubagentRenderCommand[] {
    const parentToolUseId = chunk.subagentId;
    const commands: SubagentRenderCommand[] = [];

    if (this.pendingTasks.has(parentToolUseId)) {
      commands.push(...this.createPendingTaskSubagent(parentToolUseId, msg, 'sync'));
    }

    const subagent = this.syncSubagents.get(parentToolUseId);
    if (!subagent) {
      return commands;
    }

    if (chunk.type === 'subagent_tool_use') {
      const toolCall = this.addOrMergeSyncToolCall(subagent, {
        id: chunk.id,
        name: chunk.name,
        input: chunk.input,
        status: 'running',
        isExpanded: false,
      });
      commands.push({
        type: 'add_sync_subagent_tool',
        subagentId: parentToolUseId,
        toolCall,
      });
      commands.push({ type: 'show_thinking_indicator' });
      return commands;
    }

    const toolCall = subagent.toolCalls.find(tc => tc.id === chunk.id);
    if (toolCall) {
      const normalizedContent = normalizeToolResultContent(chunk.content);
      const isBlocked = isBlockedToolResultContent(normalizedContent, chunk.isError);
      toolCall.status = isBlocked ? 'blocked' : (chunk.isError ? 'error' : 'completed');
      toolCall.result = normalizedContent;
      commands.push({
        type: 'update_sync_subagent_tool_result',
        subagentId: parentToolUseId,
        toolId: chunk.id,
        toolCall,
      });
    }
    return commands;
  }

  private projectToolResult(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
    msg: ChatMessage,
  ): SubagentProjectionResult {
    const commands: SubagentRenderCommand[] = [];

    if (this.pendingTasks.has(chunk.id)) {
      const mode = this.resolvePendingTaskModeFromResult(chunk);
      commands.push(...this.createPendingTaskSubagent(chunk.id, msg, mode));
    }

    if (this.syncSubagents.has(chunk.id)) {
      commands.push(...this.finalizeSyncSubagent(chunk, msg));
      return this.handled(commands);
    }

    if (this.pendingAsyncSubagents.has(chunk.id)) {
      commands.push(...this.handleAsyncTaskToolResult(chunk, msg));
      return this.handled(commands);
    }

    if (this.outputToolIdToAgentId.has(chunk.id) || this.inferAgentIdFromResult(normalizeToolResultContent(chunk.content))) {
      const result = this.handleAgentOutputToolResult(chunk, msg);
      if (!result.handled) return result;
      return commands.length > 0
        ? this.handled([...commands, ...withoutScrollCommand(result.commands)])
        : result;
    }

    return commands.length > 0 ? this.handled(commands) : this.notHandled();
  }

  private projectAgentOutputToolUse(
    chunk: Extract<StreamChunk, { type: 'tool_use' }>,
  ): SubagentProjectionResult {
    const agentId = this.extractAgentIdFromInput(chunk.input);
    if (!agentId) return this.handled([{ type: 'show_thinking_indicator' }]);

    const subagent = this.activeAsyncSubagents.get(agentId);
    if (!subagent) return this.handled([{ type: 'show_thinking_indicator' }]);

    subagent.outputToolId = chunk.id;
    this.outputToolIdToAgentId.set(chunk.id, agentId);
    return this.handled([{ type: 'show_thinking_indicator' }]);
  }

  private projectAsyncSubagentResult(
    chunk: Extract<StreamChunk, { type: 'async_subagent_result' }>,
  ): SubagentProjectionResult {
    const subagent = this.activeAsyncSubagents.get(chunk.agentId);
    if (!subagent || subagent.asyncStatus !== 'running') {
      return this.notHandled();
    }

    subagent.agentId = subagent.agentId || chunk.agentId;
    subagent.asyncStatus = chunk.status;
    subagent.status = chunk.status;
    subagent.result = chunk.result?.trim() || (chunk.status === 'error'
      ? 'Background task failed.'
      : 'Background task completed.');
    subagent.completedAt = this.now();

    this.activeAsyncSubagents.delete(chunk.agentId);
    for (const [toolId, mappedAgentId] of this.outputToolIdToAgentId.entries()) {
      if (mappedAgentId === chunk.agentId) {
        this.outputToolIdToAgentId.delete(toolId);
      }
    }

    return this.handled([
      {
        type: 'finalize_async_subagent',
        subagentId: subagent.id,
        failed: chunk.status === 'error',
        subagent,
      },
      {
        type: 'request_async_subagent_hydration',
        subagentId: subagent.id,
        agentId: chunk.agentId,
        subagent,
      },
      { type: 'show_thinking_indicator' },
    ]);
  }

  private createPendingTaskSubagent(
    taskToolId: string,
    msg: ChatMessage,
    mode: 'sync' | 'async',
  ): SubagentRenderCommand[] {
    const pending = this.pendingTasks.get(taskToolId);
    if (!pending) return [];

    this.pendingTasks.delete(taskToolId);
    return this.createTaskSubagent(taskToolId, pending.toolCall.input, msg, mode);
  }

  private createTaskSubagent(
    taskToolId: string,
    taskInput: Record<string, unknown>,
    msg: ChatMessage,
    mode: 'sync' | 'async',
  ): SubagentRenderCommand[] {
    this.spawnedThisStream++;
    if (mode === 'async') {
      const subagent = this.createAsyncInfo(taskToolId, taskInput);
      this.pendingAsyncSubagents.set(taskToolId, subagent);
      this.recordSubagentInMessage(msg, subagent, taskToolId, 'async');
      return [
        {
          type: 'create_async_subagent',
          subagentId: taskToolId,
          input: taskInput,
          subagent,
        },
        { type: 'show_thinking_indicator' },
      ];
    }

    const subagent = this.createSyncInfo(taskToolId, taskInput);
    this.syncSubagents.set(taskToolId, subagent);
    this.recordSubagentInMessage(msg, subagent, taskToolId);
    return [
      {
        type: 'create_sync_subagent',
        subagentId: taskToolId,
        input: taskInput,
        subagent,
      },
      { type: 'show_thinking_indicator' },
    ];
  }

  private finalizeSyncSubagent(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
    msg: ChatMessage,
  ): SubagentRenderCommand[] {
    const subagent = this.syncSubagents.get(chunk.id);
    if (!subagent) return [];

    const isError = chunk.isError || false;
    const normalizedContent = normalizeToolResultContent(chunk.content);
    const extractedResult = this.extractAgentResult(normalizedContent, '', chunk.toolUseResult);

    subagent.status = isError ? 'error' : 'completed';
    subagent.result = extractedResult;
    this.syncSubagents.delete(chunk.id);

    const taskToolCall = this.ensureTaskToolCall(msg, chunk.id);
    taskToolCall.status = isError ? 'error' : 'completed';
    taskToolCall.result = extractedResult;
    this.applySubagentToTaskToolCall(taskToolCall, subagent);

    return [
      {
        type: 'finalize_sync_subagent',
        subagentId: chunk.id,
        result: extractedResult,
        failed: isError,
        subagent,
      },
      { type: 'show_thinking_indicator' },
    ];
  }

  private handleAsyncTaskToolResult(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
    msg: ChatMessage,
  ): SubagentRenderCommand[] {
    const subagent = this.pendingAsyncSubagents.get(chunk.id);
    if (!subagent) return [];

    const resultText = normalizeToolResultContent(chunk.content);
    if (chunk.isError) {
      this.transitionAsyncToError(subagent, chunk.id, resultText || 'Task failed to start', msg);
      return [
        {
          type: 'finalize_async_subagent',
          subagentId: subagent.id,
          failed: true,
          subagent,
        },
        { type: 'show_thinking_indicator' },
      ];
    }

    const agentId = this.options.taskResultInterpreter.extractAgentId(chunk.toolUseResult)
      ?? this.parseAgentId(resultText);

    if (!agentId) {
      const truncatedResult = resultText.length > 100 ? `${resultText.substring(0, 100)}...` : resultText;
      this.transitionAsyncToError(
        subagent,
        chunk.id,
        `Failed to parse agent_id. Result: ${truncatedResult}`,
        msg,
      );
      return [
        {
          type: 'finalize_async_subagent',
          subagentId: subagent.id,
          failed: true,
          subagent,
        },
        { type: 'show_thinking_indicator' },
      ];
    }

    subagent.asyncStatus = 'running';
    subagent.agentId = agentId;
    subagent.startedAt = this.now();

    this.pendingAsyncSubagents.delete(chunk.id);
    this.activeAsyncSubagents.set(agentId, subagent);
    this.taskIdToAgentId.set(chunk.id, agentId);
    this.linkTaskToolCallToSubagent(msg, subagent);

    return [
      {
        type: 'update_async_subagent_running',
        subagentId: subagent.id,
        agentId,
        subagent,
      },
      { type: 'show_thinking_indicator' },
    ];
  }

  private handleAgentOutputToolResult(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
    msg: ChatMessage,
  ): SubagentProjectionResult {
    const resultText = normalizeToolResultContent(chunk.content);
    let agentId = this.outputToolIdToAgentId.get(chunk.id);
    let subagent = agentId ? this.activeAsyncSubagents.get(agentId) : undefined;

    if (!subagent) {
      const inferredAgentId = this.inferAgentIdFromResult(resultText);
      if (inferredAgentId) {
        agentId = inferredAgentId;
        subagent = this.activeAsyncSubagents.get(inferredAgentId);
      }
    }

    if (!subagent) return this.notHandled();

    if (agentId) {
      subagent.agentId = subagent.agentId || agentId;
      this.outputToolIdToAgentId.set(chunk.id, agentId);
    }

    if (subagent.asyncStatus !== 'running') {
      return this.handled([{ type: 'show_thinking_indicator' }]);
    }

    const stillRunning = this.isStillRunningResult(resultText, chunk.isError || false);
    if (stillRunning) {
      this.outputToolIdToAgentId.delete(chunk.id);
      return this.handled([{ type: 'show_thinking_indicator' }]);
    }

    const extractedResult = this.extractAgentResult(resultText, agentId ?? '', chunk.toolUseResult);
    const finalStatus = this.options.taskResultInterpreter.resolveTerminalStatus(
      chunk.toolUseResult,
      chunk.isError ? 'error' : 'completed',
    );

    subagent.asyncStatus = finalStatus;
    subagent.status = finalStatus;
    subagent.result = extractedResult;
    subagent.completedAt = this.now();

    if (agentId) this.activeAsyncSubagents.delete(agentId);
    this.outputToolIdToAgentId.delete(chunk.id);
    this.linkTaskToolCallToSubagent(msg, subagent);

    return this.handled([
      {
        type: 'finalize_async_subagent',
        subagentId: subagent.id,
        failed: finalStatus === 'error',
        subagent,
      },
      ...(agentId
        ? [{
          type: 'request_async_subagent_hydration' as const,
          subagentId: subagent.id,
          agentId,
          subagent,
        }]
        : []),
      { type: 'show_thinking_indicator' },
    ]);
  }

  private resolvePendingTaskModeFromResult(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
  ): 'sync' | 'async' {
    const pending = this.pendingTasks.get(chunk.id);
    const input = pending?.toolCall.input ?? {};
    const explicitMode = this.resolveTaskMode(input);
    if (explicitMode) return explicitMode;

    const taskResultText = normalizeToolResultContent(chunk.content);
    if (chunk.isError) return 'sync';
    if (this.options.taskResultInterpreter.hasAsyncLaunchMarker(chunk.toolUseResult)) {
      return 'async';
    }
    return this.parseAgentIdStrict(taskResultText) ? 'async' : 'sync';
  }

  private addOrMergeSyncToolCall(subagent: SubagentInfo, toolCall: ToolCallInfo): ToolCallInfo {
    const existing = subagent.toolCalls.find(tc => tc.id === toolCall.id);
    if (!existing) {
      subagent.toolCalls.push(toolCall);
      return toolCall;
    }

    existing.input = {
      ...existing.input,
      ...toolCall.input,
    };
    existing.result = toolCall.result ?? existing.result;
    existing.status = toolCall.status;
    existing.isExpanded = toolCall.isExpanded ?? existing.isExpanded;
    return existing;
  }

  private createAsyncInfo(taskToolId: string, taskInput: Record<string, unknown>): SubagentInfo {
    return {
      id: taskToolId,
      description: (taskInput.description as string) || 'Background task',
      prompt: (taskInput.prompt as string) || '',
      mode: 'async',
      isExpanded: false,
      status: 'running',
      toolCalls: [],
      asyncStatus: 'pending',
    };
  }

  private createSyncInfo(taskToolId: string, taskInput: Record<string, unknown>): SubagentInfo {
    return {
      id: taskToolId,
      description: (taskInput.description as string) || 'Subagent task',
      prompt: (taskInput.prompt as string) || '',
      status: 'running',
      toolCalls: [],
      isExpanded: false,
    };
  }

  private ensureTaskToolCall(
    msg: ChatMessage,
    toolId: string,
    input?: Record<string, unknown>,
  ): ToolCallInfo {
    msg.toolCalls = msg.toolCalls || [];
    const existing = msg.toolCalls.find(
      tc => tc.id === toolId && isSubagentToolName(tc.name),
    );
    if (existing) {
      if (input && Object.keys(input).length > 0) {
        existing.input = { ...existing.input, ...input };
      }
      return existing;
    }

    const taskToolCall: ToolCallInfo = {
      id: toolId,
      name: TOOL_TASK,
      input: input ? { ...input } : {},
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls.push(taskToolCall);
    return taskToolCall;
  }

  private recordSubagentInMessage(
    msg: ChatMessage,
    subagent: SubagentInfo,
    toolId: string,
    mode?: 'async',
  ): void {
    const taskToolCall = this.ensureTaskToolCall(msg, toolId);
    this.applySubagentToTaskToolCall(taskToolCall, subagent);

    msg.contentBlocks = msg.contentBlocks || [];
    const existingBlock = msg.contentBlocks.find(
      block => block.type === 'subagent' && block.subagentId === toolId,
    );
    if (existingBlock && mode && existingBlock.type === 'subagent') {
      existingBlock.mode = mode;
    } else if (!existingBlock) {
      msg.contentBlocks.push(mode
        ? { type: 'subagent', subagentId: toolId, mode }
        : { type: 'subagent', subagentId: toolId });
    }
  }

  private applySubagentToTaskToolCall(taskToolCall: ToolCallInfo, subagent: SubagentInfo): void {
    taskToolCall.subagent = subagent;
    if (subagent.status === 'completed') taskToolCall.status = 'completed';
    else if (subagent.status === 'error') taskToolCall.status = 'error';
    else taskToolCall.status = 'running';
    if (subagent.result !== undefined) {
      taskToolCall.result = subagent.result;
    }
  }

  private findMessageSubagent(msg: ChatMessage, subagentId: string): SubagentInfo | null {
    return msg.toolCalls?.find(
      tc => tc.id === subagentId && isSubagentToolName(tc.name),
    )?.subagent ?? null;
  }

  private linkTaskToolCallToSubagent(msg: ChatMessage, subagent: SubagentInfo): boolean {
    const taskToolCall = msg.toolCalls?.find(
      tc => tc.id === subagent.id && isSubagentToolName(tc.name),
    );
    if (!taskToolCall) return false;
    this.applySubagentToTaskToolCall(taskToolCall, subagent);
    return true;
  }

  private updateSubagentInMessages(messages: ChatMessage[], subagent: SubagentInfo): void {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;
      if (this.linkTaskToolCallToSubagent(msg, subagent)) return;
    }
  }

  private getAsyncByTaskId(taskToolId: string): SubagentInfo | undefined {
    const pending = this.pendingAsyncSubagents.get(taskToolId);
    if (pending) return pending;

    const agentId = this.taskIdToAgentId.get(taskToolId);
    return agentId ? this.activeAsyncSubagents.get(agentId) : undefined;
  }

  private updateSubagentInput(subagent: SubagentInfo, input: Record<string, unknown>): void {
    const description = (input.description as string) || '';
    if (description) {
      subagent.description = description;
    }
    const prompt = (input.prompt as string) || '';
    if (prompt) {
      subagent.prompt = prompt;
    }
  }

  private transitionAsyncToError(
    subagent: SubagentInfo,
    taskToolId: string,
    errorResult: string,
    msg: ChatMessage,
  ): void {
    subagent.asyncStatus = 'error';
    subagent.status = 'error';
    subagent.result = errorResult;
    subagent.completedAt = this.now();
    this.pendingAsyncSubagents.delete(taskToolId);
    this.linkTaskToolCallToSubagent(msg, subagent);
  }

  private resolveTaskMode(taskInput: Record<string, unknown>): 'sync' | 'async' | null {
    if (!Object.prototype.hasOwnProperty.call(taskInput, 'run_in_background')) {
      return null;
    }
    if (taskInput.run_in_background === true) return 'async';
    if (taskInput.run_in_background === false) return 'sync';
    return null;
  }

  private parseAgentIdStrict(result: string): string | null {
    const payload = this.unwrapTextPayload(result).trim();
    if (!payload) return null;

    const parsed = parseJsonRecord(payload);
    if (parsed) {
      if (this.hasTerminalTaskStatus(parsed)) return null;

      const directAgentId = this.extractAgentIdFromRecord(parsed);
      if (directAgentId) return directAgentId;

      const taskRecord = parsed.task;
      if (isRecord(taskRecord)) {
        return this.extractAgentIdFromRecord(taskRecord);
      }
    }

    const xmlStatus = this.options.taskResultInterpreter.extractTagValue(payload, 'retrieval_status')
      ?? this.options.taskResultInterpreter.extractTagValue(payload, 'status');
    if (this.isTerminalTaskStatusValue(xmlStatus)) return null;

    const exactLineMatch = payload.match(/^\s*(?:agent_id|agentId)\s*[=:]\s*"?([a-zA-Z0-9_-]+)"?\s*$/i);
    return exactLineMatch?.[1] ?? null;
  }

  private hasTerminalTaskStatus(value: unknown): boolean {
    if (!isRecord(value)) return false;

    const rawStatus = value.retrieval_status ?? value.status;
    return this.isTerminalTaskStatusValue(rawStatus);
  }

  private isTerminalTaskStatusValue(rawStatus: unknown): boolean {
    if (typeof rawStatus !== 'string') return false;

    const normalized = rawStatus.toLowerCase();
    return normalized === 'completed' || normalized === 'success' || normalized === 'error';
  }

  private extractAgentIdFromRecord(record: Record<string, unknown>): string | null {
    const direct = record.agent_id ?? record.agentId;
    if (typeof direct === 'string' && direct.length > 0) return direct;

    const data = record.data;
    if (!isRecord(data)) return null;

    const nested = data.agent_id ?? data.agentId;
    return typeof nested === 'string' && nested.length > 0 ? nested : null;
  }

  private parseAgentId(result: string): string | null {
    const regexPatterns = [
      /"agent_id"\s*:\s*"([^"]+)"/,
      /"agentId"\s*:\s*"([^"]+)"/,
      /agent_id[=:]\s*"?([a-zA-Z0-9_-]+)"?/i,
      /agentId[=:]\s*"?([a-zA-Z0-9_-]+)"?/i,
      /\b([a-f0-9]{8})\b/,
    ];

    for (const pattern of regexPatterns) {
      const match = result.match(pattern);
      if (match?.[1]) return match[1];
    }

    const parsed = parseJsonRecord(result);
    if (parsed) {
      const agentId = parsed.agent_id ?? parsed.agentId;
      if (typeof agentId === 'string' && agentId.length > 0) return agentId;

      const data = parsed.data;
      if (isRecord(data) && typeof data.agent_id === 'string') return data.agent_id;

      if (typeof parsed.id === 'string') return parsed.id;
    }

    return null;
  }

  private inferAgentIdFromResult(result: string): string | null {
    const parsed = parseJsonRecord(result);
    if (parsed) {
      const agents = isRecord(parsed.agents) ? parsed.agents : null;
      if (agents) return Object.keys(agents)[0] ?? null;
    }
    return null;
  }

  private isStillRunningResult(result: string, isError: boolean): boolean {
    const trimmed = result?.trim() || '';
    const payload = this.unwrapTextPayload(trimmed);

    if (isError) return false;
    if (!trimmed) return false;

    const parsed = parseJsonRecord(payload);
    if (parsed) {
      const status = parsed.retrieval_status ?? parsed.status;
      const agents = isRecord(parsed.agents) ? parsed.agents : null;
      const hasAgents = agents !== null && Object.keys(agents).length > 0;

      if (status === 'not_ready' || status === 'running' || status === 'pending') {
        return true;
      }

      if (hasAgents && agents) {
        const agentStatuses = Object.values(agents)
          .map((agent) => (isRecord(agent) && typeof agent.status === 'string') ? agent.status.toLowerCase() : '');
        return agentStatuses.some(s =>
          s === 'running' || s === 'pending' || s === 'not_ready',
        );
      }

      if (status === 'success' || status === 'completed') return false;

      return false;
    }

    const lowerResult = payload.toLowerCase();
    if (lowerResult.includes('not_ready') || lowerResult.includes('not ready')) {
      return true;
    }

    const xmlStatusMatch = lowerResult.match(/<status>([^<]+)<\/status>/);
    if (xmlStatusMatch) {
      const status = xmlStatusMatch[1].trim();
      if (status === 'running' || status === 'pending' || status === 'not_ready') {
        return true;
      }
    }

    return false;
  }

  private extractAgentResult(result: string, agentId: string, toolUseResult?: unknown): string {
    const structuredResult = this.options.taskResultInterpreter.extractStructuredResult(toolUseResult);
    const normalizedStructuredResult = this.extractResultFromCandidateString(structuredResult);
    if (normalizedStructuredResult) return normalizedStructuredResult;
    if (structuredResult) return structuredResult;

    const payload = this.unwrapTextPayload(result);

    const parsed = parseJsonRecord(payload);
    if (parsed) {
      const taskResult = this.extractResultFromTaskObject(parsed.task);
      if (taskResult) return taskResult;

      const agents = isRecord(parsed.agents) ? parsed.agents : null;
      const agentData = agents && agentId ? agents[agentId] : null;
      if (isRecord(agentData)) {
        const parsedResult = this.extractResultFromCandidateString(agentData.result);
        if (parsedResult) return parsedResult;
        const parsedOutput = this.extractResultFromCandidateString(agentData.output);
        if (parsedOutput) return parsedOutput;
        return JSON.stringify(agentData, null, 2);
      }

      if (agents) {
        const agentIds = Object.keys(agents);
        if (agentIds.length > 0) {
          const firstAgent = agents[agentIds[0]];
          if (isRecord(firstAgent)) {
            const parsedResult = this.extractResultFromCandidateString(firstAgent.result);
            if (parsedResult) return parsedResult;
            const parsedOutput = this.extractResultFromCandidateString(firstAgent.output);
            if (parsedOutput) return parsedOutput;
          }
          return JSON.stringify(firstAgent, null, 2);
        }
      }

      const parsedResult = this.extractResultFromCandidateString(parsed.result);
      if (parsedResult) return parsedResult;

      const parsedOutput = this.extractResultFromCandidateString(parsed.output);
      if (parsedOutput) return parsedOutput;
    }

    const taggedResult = this.extractResultFromTaggedPayload(payload);
    if (taggedResult) return taggedResult;

    return payload;
  }

  private extractResultFromTaskObject(task: unknown): string | null {
    if (!isRecord(task)) return null;

    return this.extractResultFromCandidateString(task.result)
      ?? this.extractResultFromCandidateString(task.output);
  }

  private extractResultFromCandidateString(candidate: unknown): string | null {
    if (typeof candidate !== 'string') return null;

    const trimmed = candidate.trim();
    if (!trimmed) return null;

    const taggedResult = this.extractResultFromTaggedPayload(trimmed);
    if (taggedResult) return taggedResult;

    const jsonlResult = extractFinalResultFromSubagentJsonl(trimmed);
    if (jsonlResult) return jsonlResult;

    return trimmed;
  }

  private extractResultFromTaggedPayload(payload: string): string | null {
    const directResult = this.options.taskResultInterpreter.extractTagValue(payload, 'result');
    if (directResult) return directResult;

    const outputContent = this.options.taskResultInterpreter.extractTagValue(payload, 'output');
    if (!outputContent) return null;

    const extractedFromJsonl = extractFinalResultFromSubagentJsonl(outputContent);
    if (extractedFromJsonl) return extractedFromJsonl;

    const nestedResult = this.options.taskResultInterpreter.extractTagValue(outputContent, 'result');
    if (nestedResult) return nestedResult;

    const trimmed = outputContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private unwrapTextPayload(raw: string): string {
    const parsed = parseJsonValue(raw);
    if (parsed !== null) {
      if (Array.isArray(parsed)) {
        const textBlock = parsed.find((block) => isRecord(block) && typeof block.text === 'string');
        if (isRecord(textBlock) && typeof textBlock.text === 'string') return textBlock.text;
      } else if (isRecord(parsed) && typeof parsed.text === 'string') {
        return parsed.text;
      }
    }
    return raw;
  }

  private extractAgentIdFromInput(input: Record<string, unknown>): string | null {
    const agentId = (input.task_id as string) || (input.agentId as string) || (input.agent_id as string);
    return agentId || null;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private handled(commands: SubagentRenderCommand[]): SubagentProjectionResult {
    return {
      handled: true,
      commands: [...commands, { type: 'scroll_to_bottom' }],
    };
  }

  private notHandled(): SubagentProjectionResult {
    return {
      handled: false,
      commands: [],
    };
  }
}

function normalizeToolResultContent(content: unknown): string {
  return extractToolResultContent(content, { fallbackIndent: 2 });
}

function isBlockedToolResultContent(content: unknown, isError?: boolean): boolean {
  const lower = normalizeToolResultContent(content).toLowerCase();
  if (lower.includes('outside the vault')) return true;
  if (lower.includes('access denied')) return true;
  if (lower.includes('user denied')) return true;
  if (lower.includes('approval')) return true;
  if (isError && lower.includes('deny')) return true;
  return false;
}

function withoutScrollCommand(commands: SubagentRenderCommand[]): SubagentRenderCommand[] {
  return commands.filter(command => command.type !== 'scroll_to_bottom');
}
