import { parseTodoInput } from '../../../core/tools/todo';
import { extractResolvedAnswers, extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import {
  isEditTool,
  isSubagentToolName,
  isWriteEditTool,
  skipsBlockedDetection,
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_TODO_WRITE,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { ChatMessage, StreamChunk, ToolCallInfo } from '../../../core/types';
import { extractDiffData } from '../../../utils/diff';
import type { ChatState } from '../state/ChatState';

export type StreamProjectionDeferredReason =
  | 'subagent-deferred'
  | 'unsupported';

export type StreamRenderCommand =
  | { type: 'append_text'; text: string }
  | { type: 'append_thinking'; text: string }
  | { type: 'finalize_text' }
  | { type: 'finalize_thinking' }
  | { type: 'render_pending_tool'; toolId: string }
  | { type: 'clear_pending_tools' }
  | { type: 'render_compact_boundary' }
  | { type: 'update_tool_header'; toolId: string }
  | { type: 'update_tool_result'; toolId: string }
  | { type: 'update_write_edit_diff'; toolId: string }
  | { type: 'finalize_write_edit'; toolId: string; failed: boolean }
  | { type: 'cancel_tool_output_render'; toolId: string }
  | { type: 'schedule_tool_output_render'; toolId: string }
  | { type: 'show_thinking_indicator' }
  | { type: 'hide_thinking_indicator' }
  | { type: 'notify_vault_file_change'; input: Record<string, unknown> }
  | { type: 'notify_apply_patch_file_changes'; input: Record<string, unknown> }
  | { type: 'scroll_to_bottom' };

export type StreamProjectionResult =
  | { handled: true; commands: StreamRenderCommand[] }
  | { handled: false; reason: StreamProjectionDeferredReason; commands: [] };

export interface StreamProjectionOptions {
  state: ChatState;
  getActiveProviderModel: () => string | undefined;
  getCurrentSessionId: () => string | null;
  getPlanPathPrefix: () => string | undefined;
  getSubagentsSpawnedThisStream: () => number;
  isProviderLifecycleTool?: (name: string) => boolean;
  isProviderHiddenTool?: (name: string) => boolean;
}

export class StreamProjection {
  private readonly options: StreamProjectionOptions;

  constructor(options: StreamProjectionOptions) {
    this.options = options;
  }

  apply(chunk: StreamChunk, msg: ChatMessage): StreamProjectionResult {
    switch (chunk.type) {
      case 'thinking':
        return this.handled(this.projectThinking(chunk, msg));

      case 'text':
        return this.handled(this.projectText(chunk, msg));

      case 'tool_use':
        if (this.shouldDeferToolUse(chunk.name)) {
          return this.deferred('subagent-deferred');
        }
        return this.handled(this.projectToolUse(chunk, msg));

      case 'tool_result':
        return this.handled(this.projectToolResult(chunk, msg));

      case 'tool_output':
        return this.handled(this.projectToolOutput(chunk, msg));

      case 'notice':
        return this.handled([
          ...this.flush(msg),
          {
            type: 'append_text',
            text: `\n\n⚠️ **${chunk.level === 'warning' ? 'Blocked' : 'Notice'}:** ${chunk.content}`,
          },
        ]);

      case 'error':
        return this.handled([
          ...this.flush(msg),
          { type: 'append_text', text: `\n\n❌ **Error:** ${chunk.content}` },
        ]);

      case 'done':
        return this.handled(this.flush(msg));

      case 'context_compacted':
        return this.handled(this.projectContextCompacted(msg));

      case 'usage':
        return this.handled(this.projectUsage(chunk));

      case 'subagent_tool_use':
      case 'subagent_tool_result':
      case 'async_subagent_result':
        return this.deferred('subagent-deferred');

      default:
        return this.deferred('unsupported');
    }
  }

  flush(_msg: ChatMessage): StreamRenderCommand[] {
    const { state } = this.options;
    if (state.pendingTools.size === 0) {
      return [];
    }

    const renderCommands: StreamRenderCommand[] = Array.from(
      state.pendingTools.keys(),
      toolId => ({ type: 'render_pending_tool', toolId }),
    );
    return [...renderCommands, { type: 'clear_pending_tools' }];
  }

  reset(): void {
    // Reserved for future projection-local state.
  }

  private projectThinking(
    chunk: Extract<StreamChunk, { type: 'thinking' }>,
    msg: ChatMessage,
  ): StreamRenderCommand[] {
    const { state } = this.options;
    const commands = this.flush(msg);
    if (state.currentTextEl) {
      commands.push({ type: 'finalize_text' });
    }
    commands.push({ type: 'append_thinking', text: chunk.content });
    return commands;
  }

  private projectText(
    chunk: Extract<StreamChunk, { type: 'text' }>,
    msg: ChatMessage,
  ): StreamRenderCommand[] {
    const { state } = this.options;
    const commands = this.flush(msg);
    if (state.currentThinkingState) {
      commands.push({ type: 'finalize_thinking' });
    }
    msg.content += chunk.content;
    commands.push({ type: 'append_text', text: chunk.content });
    return commands;
  }

  private projectToolUse(
    chunk: Extract<StreamChunk, { type: 'tool_use' }>,
    msg: ChatMessage,
  ): StreamRenderCommand[] {
    const { state } = this.options;
    const commands: StreamRenderCommand[] = [];

    if (state.currentThinkingState) {
      commands.push({ type: 'finalize_thinking' });
    }
    commands.push({ type: 'finalize_text' });

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (existingToolCall) {
      const newInput = chunk.input || {};
      if (Object.keys(newInput).length > 0) {
        existingToolCall.input = { ...existingToolCall.input, ...newInput };
        this.applyToolInputSideEffects(existingToolCall.name, existingToolCall.input);
        commands.push({ type: 'update_tool_header', toolId: chunk.id });
      }
      return commands;
    }

    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };

    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });

    this.applyToolInputSideEffects(chunk.name, chunk.input);

    if (state.currentContentEl) {
      state.pendingTools.set(chunk.id, {
        toolCall,
        parentEl: state.currentContentEl,
      });
      commands.push({ type: 'show_thinking_indicator' });
    }

    return commands;
  }

  private projectToolResult(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
    msg: ChatMessage,
  ): StreamRenderCommand[] {
    const { state } = this.options;
    const commands: StreamRenderCommand[] = [];

    if (state.pendingTools.has(chunk.id)) {
      commands.push({ type: 'render_pending_tool', toolId: chunk.id });
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (existingToolCall) {
      const normalizedContent = normalizeToolResultContent(chunk.content);
      const isBlocked = isBlockedToolResultContent(normalizedContent, chunk.isError);

      if (chunk.isError) {
        existingToolCall.status = 'error';
      } else if (!skipsBlockedDetection(existingToolCall.name) && isBlocked) {
        existingToolCall.status = 'blocked';
      } else {
        existingToolCall.status = 'completed';
      }
      existingToolCall.result = normalizedContent;

      if (existingToolCall.name === TOOL_ASK_USER_QUESTION) {
        const answers =
          extractResolvedAnswers(chunk.toolUseResult) ??
          extractResolvedAnswersFromResultText(normalizedContent);
        if (answers) existingToolCall.resolvedAnswers = answers;
      }

      const writeEditState = state.writeEditStates.get(chunk.id);
      if (writeEditState && isWriteEditTool(existingToolCall.name)) {
        if (!chunk.isError && !isBlocked) {
          const diffData = extractDiffData(chunk.toolUseResult, existingToolCall);
          if (diffData) {
            existingToolCall.diffData = diffData;
            commands.push({ type: 'update_write_edit_diff', toolId: chunk.id });
          }
        }
        commands.push({
          type: 'finalize_write_edit',
          toolId: chunk.id,
          failed: Boolean(chunk.isError || isBlocked),
        });
      } else {
        commands.push({ type: 'cancel_tool_output_render', toolId: chunk.id });
        commands.push({ type: 'update_tool_result', toolId: chunk.id });
      }

      if (!chunk.isError && !isBlocked && isEditTool(existingToolCall.name)) {
        commands.push({
          type: 'notify_vault_file_change',
          input: existingToolCall.input,
        });
      }

      if (!chunk.isError && !isBlocked && existingToolCall.name === TOOL_APPLY_PATCH) {
        commands.push({
          type: 'notify_apply_patch_file_changes',
          input: existingToolCall.input,
        });
      }
    }

    commands.push({ type: 'show_thinking_indicator' });
    return commands;
  }

  private projectToolOutput(
    chunk: Extract<StreamChunk, { type: 'tool_output' }>,
    msg: ChatMessage,
  ): StreamRenderCommand[] {
    const { state } = this.options;
    const commands: StreamRenderCommand[] = [];

    if (state.pendingTools.has(chunk.id)) {
      commands.push({ type: 'render_pending_tool', toolId: chunk.id });
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) {
      return commands;
    }

    existingToolCall.result = (existingToolCall.result ?? '') + chunk.content;
    commands.push({ type: 'schedule_tool_output_render', toolId: chunk.id });
    commands.push({ type: 'show_thinking_indicator' });
    return commands;
  }

  private projectContextCompacted(msg: ChatMessage): StreamRenderCommand[] {
    const { state } = this.options;
    const commands = this.flush(msg);
    if (state.currentThinkingState) {
      commands.push({ type: 'finalize_thinking' });
    }
    commands.push({ type: 'finalize_text' });
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'context_compacted' });
    commands.push({ type: 'render_compact_boundary' });
    return commands;
  }

  private projectUsage(chunk: Extract<StreamChunk, { type: 'usage' }>): StreamRenderCommand[] {
    const { state } = this.options;
    const currentSessionId = this.options.getCurrentSessionId();
    const chunkSessionId = chunk.sessionId ?? null;

    if (
      (chunkSessionId && currentSessionId && chunkSessionId !== currentSessionId) ||
      (chunkSessionId && !currentSessionId)
    ) {
      return [];
    }

    if (this.options.getSubagentsSpawnedThisStream() > 0) {
      return [];
    }

    if (!state.ignoreUsageUpdates) {
      const activeModel = this.options.getActiveProviderModel();
      state.usage = activeModel && !chunk.usage.model
        ? { ...chunk.usage, model: activeModel }
        : chunk.usage;
    }

    return [];
  }

  private applyToolInputSideEffects(name: string, input: Record<string, unknown>): void {
    const { state } = this.options;

    if (name === TOOL_TODO_WRITE) {
      const todos = parseTodoInput(input);
      if (todos) {
        state.currentTodos = todos;
      }
    }

    if (name === TOOL_WRITE) {
      this.capturePlanFilePath(input);
    }
  }

  private capturePlanFilePath(input: Record<string, unknown>): void {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return;

    const planPathPrefix = this.options.getPlanPathPrefix();
    if (planPathPrefix && filePath.replace(/\\/g, '/').includes(planPathPrefix)) {
      this.options.state.planFilePath = filePath;
    }
  }

  private shouldDeferToolUse(name: string): boolean {
    if (isSubagentToolName(name)) return true;
    if (name === TOOL_AGENT_OUTPUT) return true;
    if (this.options.isProviderLifecycleTool?.(name)) return true;
    if (this.options.isProviderHiddenTool?.(name)) return true;
    return false;
  }

  private handled(commands: StreamRenderCommand[]): StreamProjectionResult {
    return {
      handled: true,
      commands: [...commands, { type: 'scroll_to_bottom' }],
    };
  }

  private deferred(reason: StreamProjectionDeferredReason): StreamProjectionResult {
    return {
      handled: false,
      reason,
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
