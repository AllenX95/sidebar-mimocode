import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type ProviderId,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
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
import type { SDKToolUseResult } from '../../../core/types/diff';
import type SidebarMimocodePlugin from '../../../main';
import { extractDiffData } from '../../../utils/diff';
import { hasStreamingMathDelimiters } from '../../../utils/markdownMath';
import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import {
  createThinkingBlock,
  finalizeThinkingBlock,
  type ThinkingBlockState,
} from '../rendering/ThinkingBlockRenderer';
import {
  isBlockedToolResult,
  updateToolCallResult,
} from '../rendering/ToolCallRenderer';
import type { ChatState } from '../state/ChatState';
import { AsyncSubagentHydrator } from '../stream/AsyncSubagentHydrator';
import { ProviderLifecycleSubagentController } from '../stream/ProviderLifecycleSubagentController';
import {
  StreamProjection,
  type StreamRenderCommand,
} from '../stream/StreamProjection';
import {
  SubagentProjection,
  type SubagentRenderCommand,
} from '../stream/SubagentProjection';
import { SubagentRenderAdapter } from '../stream/SubagentRenderAdapter';
import { ToolRenderAdapter } from '../stream/ToolRenderAdapter';
import type { FileContextManager } from '../ui/FileContext';
import { AutoScrollController } from './AutoScrollController';
import { StreamingRenderScheduler } from './StreamingRenderScheduler';
import { ThinkingIndicatorController } from './ThinkingIndicatorController';
import { ToolOutputRenderScheduler } from './ToolOutputRenderScheduler';
import { VaultFileChangeNotifier } from './VaultFileChangeNotifier';

export interface StreamControllerDeps {
  plugin: SidebarMimocodePlugin;
  state: ChatState;
  renderer: MessageRenderer;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  updateQueueIndicator: () => void;
  /** Get the agent service from the tab. */
  getAgentService?: () => ChatRuntime | null;
}

interface TextRenderSnapshot {
  content: string;
  textEl: HTMLElement | null;
}

interface ThinkingRenderSnapshot {
  content: string;
  thinkingState: ThinkingBlockState | null;
}

export class StreamController {
  private deps: StreamControllerDeps;
  private readonly autoScroll: AutoScrollController;
  private readonly asyncSubagentHydrator: AsyncSubagentHydrator;
  private readonly providerLifecycleSubagents: ProviderLifecycleSubagentController;
  private readonly subagentProjection: SubagentProjection;
  private readonly subagentRenderAdapter: SubagentRenderAdapter;
  private readonly streamProjection: StreamProjection;
  private readonly textRenderScheduler: StreamingRenderScheduler<TextRenderSnapshot>;
  private readonly thinkingRenderScheduler: StreamingRenderScheduler<ThinkingRenderSnapshot>;
  private readonly thinkingIndicator: ThinkingIndicatorController;
  private readonly toolRenderAdapter: ToolRenderAdapter;
  private readonly toolOutputRenderScheduler: ToolOutputRenderScheduler;
  private readonly vaultFileChangeNotifier: VaultFileChangeNotifier;

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
    this.autoScroll = new AutoScrollController({
      state: deps.state,
      getMessagesEl: deps.getMessagesEl,
      isAutoScrollEnabled: () => deps.plugin.settings.enableAutoScroll ?? true,
    });
    this.thinkingIndicator = new ThinkingIndicatorController({
      state: deps.state,
      getMessagesEl: deps.getMessagesEl,
      updateQueueIndicator: deps.updateQueueIndicator,
    });
    this.textRenderScheduler = new StreamingRenderScheduler<TextRenderSnapshot>({
      getOwnerWindow: () => this.getStreamingRenderWindow(),
      getSnapshot: () => ({
        textEl: this.deps.state.currentTextEl,
        content: this.deps.state.currentTextContent,
      }),
      renderSnapshot: async ({ textEl, content }) => {
        if (!textEl) return;

        const options = this.getStreamingRenderOptions(content);
        if (options) {
          await this.deps.renderer.renderContent(textEl, content, options);
        } else {
          await this.deps.renderer.renderContent(textEl, content);
        }
        this.scrollToBottom();
      },
      shouldRenderAgain: ({ textEl, content }) =>
        this.deps.state.currentTextEl === textEl && this.deps.state.currentTextContent !== content,
    });
    this.thinkingRenderScheduler = new StreamingRenderScheduler<ThinkingRenderSnapshot>({
      getOwnerWindow: () => this.getThinkingRenderWindow(),
      getSnapshot: () => {
        const thinkingState = this.deps.state.currentThinkingState;
        return {
          thinkingState,
          content: thinkingState?.content ?? '',
        };
      },
      renderSnapshot: async ({ thinkingState, content }) => {
        if (!thinkingState) return;

        const options = this.getStreamingRenderOptions(content);
        if (options) {
          await this.deps.renderer.renderContent(thinkingState.contentEl, content, options);
        } else {
          await this.deps.renderer.renderContent(thinkingState.contentEl, content);
        }
        this.scrollToBottom();
      },
      shouldRenderAgain: ({ thinkingState, content }) =>
        this.deps.state.currentThinkingState === thinkingState
        && thinkingState !== null
        && thinkingState.content !== content,
    });
    this.toolOutputRenderScheduler = new ToolOutputRenderScheduler({
      getOwnerWindow: () => this.getMessagesWindow(),
      renderToolOutput: (toolId, toolCall) => {
        updateToolCallResult(toolId, toolCall, this.deps.state.toolCallElements);
      },
      scrollToBottom: () => this.scrollToBottom(),
    });
    this.toolRenderAdapter = new ToolRenderAdapter({
      state: deps.state,
      shouldExpandFileEditsByDefault: () => this.shouldExpandFileEditsByDefault(),
      scheduleToolOutputRender: (toolId, toolCall) => this.toolOutputRenderScheduler.schedule(toolId, toolCall),
      cancelToolOutputRender: toolId => this.toolOutputRenderScheduler.cancel(toolId),
    });
    this.providerLifecycleSubagents = new ProviderLifecycleSubagentController({
      state: deps.state,
      getProviderId: () => this.getActiveProviderId(),
      flushPendingTools: () => this.toolRenderAdapter.flushPendingTools(),
    });
    this.vaultFileChangeNotifier = new VaultFileChangeNotifier({
      app: deps.plugin.app,
    });
    this.subagentProjection = new SubagentProjection({
      taskResultInterpreter: ProviderRegistry.getTaskResultInterpreter(this.getActiveProviderId()),
    });
    this.subagentRenderAdapter = new SubagentRenderAdapter(deps.state);
    this.asyncSubagentHydrator = new AsyncSubagentHydrator({
      applyHydrationResult: (hydration, msg) => this.subagentProjection.applyHydrationResult(hydration, msg),
      executeCommands: (commands, msg) => this.executeSubagentRenderCommands(commands, msg),
      getRuntime: () => this.deps.getAgentService?.() ?? null,
      getSubagentByTaskId: subagentId => this.subagentProjection.getByTaskId(subagentId),
    });
    this.streamProjection = new StreamProjection({
      state: deps.state,
      getActiveProviderModel: () => this.getActiveProviderModel(),
      getCurrentSessionId: () => this.deps.getAgentService?.()?.getSessionId() ?? null,
      getPlanPathPrefix: () => this.deps.getAgentService?.()?.getCapabilities().planPathPrefix,
      getSubagentsSpawnedThisStream: () => this.subagentProjection.subagentsSpawnedThisStream,
      isProviderLifecycleTool: name => this.providerLifecycleSubagents.isLifecycleTool(name),
      isProviderHiddenTool: name => this.providerLifecycleSubagents.isHiddenTool(name),
    });
  }

  private getActiveProviderId(): ProviderId {
    return this.deps.getAgentService?.()?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
  }

  private normalizeToolResultContent(content: unknown): string {
    return extractToolResultContent(content, { fallbackIndent: 2 });
  }

  hasRunningSubagents(): boolean {
    return this.subagentProjection.hasRunningSubagents();
  }

  async orphanAllActiveSubagents(): Promise<void> {
    const result = this.subagentProjection.orphanAllActive(this.deps.state.messages);
    if (result.handled) {
      await this.executeSubagentRenderCommands(result.commands, this.getLastAssistantMessageForSubagentCommand());
    }
  }

  clearSubagents(): void {
    this.asyncSubagentHydrator.clear();
    this.providerLifecycleSubagents.clear();
    this.subagentProjection.clear();
    this.subagentRenderAdapter.clear();
  }

  resetSubagentSpawnedCount(): void {
    this.subagentProjection.resetSpawnedCount();
  }

  resetSubagentStreamingState(): void {
    this.asyncSubagentHydrator.clear();
    this.providerLifecycleSubagents.clear();
    this.subagentProjection.resetStreamingState();
    this.subagentRenderAdapter.resetStreamingState();
  }

  setSubagentTaskResultInterpreter(
    interpreter: Parameters<SubagentProjection['setTaskResultInterpreter']>[0],
  ): void {
    this.subagentProjection.setTaskResultInterpreter(interpreter);
  }

  private getLastAssistantMessageForSubagentCommand(): ChatMessage {
    for (let i = this.deps.state.messages.length - 1; i >= 0; i--) {
      const msg = this.deps.state.messages[i];
      if (msg.role === 'assistant') return msg;
    }

    return {
      id: 'subagent-command-placeholder',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
  }

  // ============================================
  // Stream Chunk Handling
  // ============================================

  async handleStreamChunk(chunk: StreamChunk, msg: ChatMessage): Promise<void> {
    const { state } = this.deps;

    if (this.shouldUseSubagentProjection(chunk, msg)) {
      const result = this.subagentProjection.apply(chunk, msg);
      if (result.handled) {
        await this.executeSubagentRenderCommands(result.commands, msg);
        return;
      }
    }

    if (!this.shouldUseLegacyStreamPath(chunk, msg)) {
      const result = this.streamProjection.apply(chunk, msg);
      if (result.handled) {
        await this.executeStreamRenderCommands(result.commands, msg);
        return;
      }
    }

    switch (chunk.type) {
      case 'thinking':
        // Flush pending tools before rendering new content type
        this.toolRenderAdapter.flushPendingTools();
        if (state.currentTextEl) {
          await this.finalizeCurrentTextBlock(msg);
        }
        await this.appendThinking(chunk.content);
        break;

      case 'text':
        // Flush pending tools before rendering new content type
        this.toolRenderAdapter.flushPendingTools();
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        msg.content += chunk.content;
        await this.appendText(chunk.content);
        break;

      case 'tool_use': {
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeCurrentTextBlock(msg);

        if (this.providerLifecycleSubagents.handleToolUse(chunk, msg)) {
          break;
        }

        this.handleRegularToolUse(chunk, msg);
        break;
      }

      case 'tool_result': {
        await this.handleToolResult(chunk, msg);
        break;
      }

      case 'subagent_tool_use':
      case 'subagent_tool_result':
        // Task-series subagent chunks are handled by SubagentProjection above.
        break;

      case 'async_subagent_result':
        // Task-series async subagent results are handled by SubagentProjection above.
        break;

      case 'tool_output':
        this.handleToolOutput(chunk, msg);
        break;

      case 'notice':
        this.toolRenderAdapter.flushPendingTools();
        await this.appendText(`\n\n⚠️ **${chunk.level === 'warning' ? 'Blocked' : 'Notice'}:** ${chunk.content}`);
        break;

      case 'error':
        // Flush pending tools before rendering error message
        this.toolRenderAdapter.flushPendingTools();
        await this.appendText(`\n\n❌ **Error:** ${chunk.content}`);
        break;

      case 'done':
        // Flush any remaining pending tools
        this.toolRenderAdapter.flushPendingTools();
        break;

      case 'context_compacted': {
        this.toolRenderAdapter.flushPendingTools();
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeCurrentTextBlock(msg);
        msg.contentBlocks = msg.contentBlocks || [];
        msg.contentBlocks.push({ type: 'context_compacted' });
        this.renderCompactBoundary();
        break;
      }

      case 'usage': {
        // Skip usage updates from other sessions or when flagged (during session reset)
        const currentSessionId = this.deps.getAgentService?.()?.getSessionId() ?? null;
        const chunkSessionId = chunk.sessionId ?? null;
        if (
          (chunkSessionId && currentSessionId && chunkSessionId !== currentSessionId) ||
          (chunkSessionId && !currentSessionId)
        ) {
          break;
        }
        // Skip usage updates when subagents ran (SDK reports cumulative usage including subagents)
        if (this.subagentProjection.subagentsSpawnedThisStream > 0) {
          break;
        }
        if (!state.ignoreUsageUpdates) {
          const activeModel = this.getActiveProviderModel();
          state.usage = activeModel && !chunk.usage.model
            ? { ...chunk.usage, model: activeModel }
            : chunk.usage;
        }
        break;
      }

      default:
        break;
    }

    this.scrollToBottom();
  }

  private shouldUseSubagentProjection(chunk: StreamChunk, msg: ChatMessage): boolean {
    switch (chunk.type) {
      case 'tool_use':
        return isSubagentToolName(chunk.name) || chunk.name === TOOL_AGENT_OUTPUT;

      case 'tool_result': {
        if (this.subagentProjection.hasPendingTask(chunk.id)) return true;
        if (this.subagentProjection.hasSyncSubagent(chunk.id)) return true;
        if (this.subagentProjection.isPendingAsyncTask(chunk.id)) return true;
        if (this.subagentProjection.isLinkedAgentOutputTool(chunk.id)) return true;

        const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
        if (!existingToolCall) return false;
        return isSubagentToolName(existingToolCall.name) || existingToolCall.name === TOOL_AGENT_OUTPUT;
      }

      case 'subagent_tool_use':
      case 'subagent_tool_result':
      case 'async_subagent_result':
        return true;

      default:
        return false;
    }
  }

  private shouldUseLegacyStreamPath(chunk: StreamChunk, msg: ChatMessage): boolean {
    switch (chunk.type) {
      case 'tool_use': {
        if (isSubagentToolName(chunk.name) || chunk.name === TOOL_AGENT_OUTPUT) {
          return true;
        }

        return this.providerLifecycleSubagents.shouldUseLegacyToolUse(chunk.name);
      }

      case 'tool_result':
        return this.shouldHandleToolResultWithLegacy(chunk, msg);

      case 'subagent_tool_use':
      case 'subagent_tool_result':
      case 'async_subagent_result':
        return true;

      default:
        return false;
    }
  }

  private shouldHandleToolResultWithLegacy(
    chunk: Extract<StreamChunk, { type: 'tool_result' }>,
    msg: ChatMessage,
  ): boolean {
    return this.providerLifecycleSubagents.shouldHandleToolResult(chunk.id, msg);
  }

  private async executeStreamRenderCommands(
    commands: StreamRenderCommand[],
    msg: ChatMessage,
  ): Promise<void> {
    for (const command of commands) {
      switch (command.type) {
        case 'append_text':
          await this.appendText(command.text);
          break;

        case 'append_thinking':
          await this.appendThinking(command.text);
          break;

        case 'finalize_text':
          await this.finalizeCurrentTextBlock(msg);
          break;

        case 'finalize_thinking':
          await this.finalizeCurrentThinkingBlock(msg);
          break;

        case 'render_pending_tool':
          this.toolRenderAdapter.renderPendingTool(command.toolId);
          break;

        case 'clear_pending_tools':
          this.toolRenderAdapter.clearPendingTools();
          break;

        case 'render_compact_boundary':
          this.renderCompactBoundary();
          break;

        case 'update_tool_header':
          this.toolRenderAdapter.updateToolHeader(command.toolId, msg);
          break;

        case 'update_tool_result':
          this.toolRenderAdapter.updateToolResult(command.toolId, msg);
          break;

        case 'update_write_edit_diff':
          this.toolRenderAdapter.updateWriteEditDiff(command.toolId, msg);
          break;

        case 'finalize_write_edit':
          this.toolRenderAdapter.finalizeWriteEdit(command.toolId, command.failed);
          break;

        case 'cancel_tool_output_render':
          this.toolRenderAdapter.cancelToolOutputRender(command.toolId);
          break;

        case 'schedule_tool_output_render':
          this.toolRenderAdapter.scheduleToolOutputRender(command.toolId, msg);
          break;

        case 'show_thinking_indicator':
          this.showThinkingIndicator();
          break;

        case 'hide_thinking_indicator':
          this.hideThinkingIndicator();
          break;

        case 'notify_vault_file_change':
          this.vaultFileChangeNotifier.notifyInput(command.input);
          break;

        case 'notify_apply_patch_file_changes':
          this.vaultFileChangeNotifier.notifyApplyPatchInput(command.input);
          break;

        case 'scroll_to_bottom':
          this.scrollToBottom();
          break;

        default:
          break;
      }
    }
  }

  private async executeSubagentRenderCommands(
    commands: SubagentRenderCommand[],
    msg: ChatMessage,
  ): Promise<void> {
    for (const command of commands) {
      switch (command.type) {
        case 'create_sync_subagent':
          this.toolRenderAdapter.flushPendingTools();
          this.subagentRenderAdapter.createSyncSubagent(command.subagentId, command.input, command.subagent);
          break;

        case 'create_async_subagent':
          this.toolRenderAdapter.flushPendingTools();
          this.subagentRenderAdapter.createAsyncSubagent(command.subagentId, command.input, command.subagent);
          break;

        case 'update_subagent_label':
          this.subagentRenderAdapter.updateSubagentLabel(command.subagentId, command.input, command.subagent);
          break;

        case 'add_sync_subagent_tool':
          this.subagentRenderAdapter.addSyncSubagentTool(command.subagentId, command.toolCall);
          break;

        case 'update_sync_subagent_tool_result':
          this.subagentRenderAdapter.updateSyncSubagentToolResult(
            command.subagentId,
            command.toolId,
            command.toolCall,
          );
          break;

        case 'finalize_sync_subagent':
          this.subagentRenderAdapter.finalizeSyncSubagent(command.subagentId, command.result, command.failed);
          break;

        case 'update_async_subagent_running':
          this.subagentRenderAdapter.updateAsyncSubagentRunning(command.subagent, command.agentId);
          break;

        case 'finalize_async_subagent':
          this.subagentRenderAdapter.finalizeAsyncSubagent(command.subagent, command.failed);
          break;

        case 'mark_async_subagent_orphaned':
          this.subagentRenderAdapter.markAsyncSubagentOrphaned(command.subagent);
          break;

        case 'refresh_async_subagent':
          this.subagentRenderAdapter.refreshAsyncSubagent(command.subagent);
          break;

        case 'request_async_subagent_hydration':
          await this.asyncSubagentHydrator.hydrate(command.subagentId, command.agentId, msg);
          break;

        case 'show_thinking_indicator':
          this.showThinkingIndicator();
          break;

        case 'scroll_to_bottom':
          this.scrollToBottom();
          break;

        default:
          break;
      }
    }
  }

  // ============================================
  // Tool Use Handling
  // ============================================

  /**
   * Handles regular tool_use chunks by buffering them.
   * Tools are rendered when flushPendingTools is called (on next content type or tool_result).
   */
  private handleRegularToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state } = this.deps;

    // Check if this is an update to an existing tool call
    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (existingToolCall) {
      const newInput = chunk.input || {};
      if (Object.keys(newInput).length > 0) {
        existingToolCall.input = { ...existingToolCall.input, ...newInput };

        // Re-parse TodoWrite on input updates (streaming may complete the input)
        if (existingToolCall.name === TOOL_TODO_WRITE) {
          const todos = parseTodoInput(existingToolCall.input);
          if (todos) {
            this.deps.state.currentTodos = todos;
          }
        }

        // Capture plan file path on input updates (file_path may arrive in a later chunk)
        if (existingToolCall.name === TOOL_WRITE) {
          this.capturePlanFilePath(existingToolCall.input);
        }

        this.toolRenderAdapter.updateToolHeader(chunk.id, msg);
        // If still pending, the updated input is already in the toolCall object
      }
      return;
    }

    // Create new tool call
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);

    // Add to contentBlocks for ordering
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });

    // TodoWrite: update panel state immediately (side effect), but still buffer render
    if (chunk.name === TOOL_TODO_WRITE) {
      const todos = parseTodoInput(chunk.input);
      if (todos) {
        this.deps.state.currentTodos = todos;
      }
    }

    // Track Write to provider plan directory for plan mode (used by approve-new-session)
    if (chunk.name === TOOL_WRITE) {
      this.capturePlanFilePath(chunk.input);
    }

    // Buffer the tool call instead of rendering immediately
    if (state.currentContentEl) {
      state.pendingTools.set(chunk.id, {
        toolCall,
        parentEl: state.currentContentEl,
      });
      this.showThinkingIndicator();
    }
  }

  private getActiveProviderModel(): string | undefined {
    const providerId = this.deps.getAgentService?.()?.providerId;
    if (!providerId) {
      return undefined;
    }

    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.deps.plugin.settings,
      providerId,
    );
    return typeof settings.model === 'string' ? settings.model : undefined;
  }

  private shouldDeferMathRendering(): boolean {
    return this.deps.plugin.settings.deferMathRenderingDuringStreaming !== false;
  }

  private shouldExpandFileEditsByDefault(): boolean {
    return this.deps.plugin.settings.expandFileEditsByDefault === true;
  }

  private getStreamingRenderOptions(content: string): RenderContentOptions | undefined {
    return this.shouldDeferMathRendering() && hasStreamingMathDelimiters(content)
      ? { deferMath: true }
      : undefined;
  }

  private capturePlanFilePath(input: Record<string, unknown>): void {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return;

    const planPathPrefix = this.deps.getAgentService?.()?.getCapabilities().planPathPrefix;
    if (planPathPrefix && filePath.replace(/\\/g, '/').includes(planPathPrefix)) {
      this.deps.state.planFilePath = filePath;
    }
  }

  private handleToolOutput(
    chunk: { type: 'tool_output'; id: string; content: string },
    msg: ChatMessage,
  ): void {
    const { state } = this.deps;

    if (state.pendingTools.has(chunk.id)) {
      this.toolRenderAdapter.renderPendingTool(chunk.id);
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) {
      return;
    }

    existingToolCall.result = (existingToolCall.result ?? '') + chunk.content;
    this.toolRenderAdapter.scheduleToolOutputRender(chunk.id, msg);
    this.showThinkingIndicator();
  }

  private async handleToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult },
    msg: ChatMessage
  ): Promise<void> {
    const { state } = this.deps;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    if (this.providerLifecycleSubagents.handleToolResult(chunk, msg)) {
      this.showThinkingIndicator();
      return;
    }

    // Check if tool is still pending (buffered) - render it now before applying result
    if (state.pendingTools.has(chunk.id)) {
      this.toolRenderAdapter.renderPendingTool(chunk.id);
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);

    // Regular tool result
    const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);

    if (existingToolCall) {
      // Tools that resolve via dedicated callbacks (not content-based) skip
      // blocked detection — their status is determined solely by isError
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
            this.toolRenderAdapter.updateWriteEditDiff(chunk.id, msg);
          }
        }
        this.toolRenderAdapter.finalizeWriteEdit(chunk.id, chunk.isError || isBlocked);
      } else {
        this.toolRenderAdapter.cancelToolOutputRender(chunk.id);
        this.toolRenderAdapter.updateToolResult(chunk.id, msg);
      }

      // Notify Obsidian vault so the file tree refreshes after Write/Edit/NotebookEdit
      if (!chunk.isError && !isBlocked && isEditTool(existingToolCall.name)) {
        this.vaultFileChangeNotifier.notifyInput(existingToolCall.input);
      }

      // Runtime apply_patch: refresh each changed file path
      if (!chunk.isError && !isBlocked && existingToolCall.name === TOOL_APPLY_PATCH) {
        this.vaultFileChangeNotifier.notifyApplyPatchInput(existingToolCall.input);
      }
    }

    this.showThinkingIndicator();
  }

  // ============================================
  // Text Block Management
  // ============================================

  async appendText(text: string): Promise<void> {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();

    if (!state.currentTextEl) {
      state.currentTextEl = state.currentContentEl.createDiv({ cls: 'sidebar-mimocode-text-block' });
      state.currentTextContent = '';
    }

    state.currentTextContent += text;
    void this.textRenderScheduler.schedule();
  }

  async finalizeCurrentTextBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    await this.textRenderScheduler.flush();

    if (msg && state.currentTextContent) {
      if (
        state.currentTextEl
        && this.shouldDeferMathRendering()
        && hasStreamingMathDelimiters(state.currentTextContent)
      ) {
        await renderer.renderContent(state.currentTextEl, state.currentTextContent);
      }
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({ type: 'text', content: state.currentTextContent });
      // Copy button added here (not during streaming) to match history-loaded messages
      if (state.currentTextEl) {
        renderer.addTextCopyButton(state.currentTextEl, state.currentTextContent);
      }
    }
    state.currentTextEl = null;
    state.currentTextContent = '';
  }

  // ============================================
  // Thinking Block Management
  // ============================================

  async appendThinking(content: string): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();
    if (!state.currentThinkingState) {
      state.currentThinkingState = createThinkingBlock(
        state.currentContentEl,
        (el, md) => renderer.renderContent(el, md)
      );
    }

    state.currentThinkingState.content += content;
    void this.thinkingRenderScheduler.schedule();
  }

  async finalizeCurrentThinkingBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentThinkingState) return;
    await this.thinkingRenderScheduler.flush();

    const thinkingState = state.currentThinkingState;
    if (this.getStreamingRenderOptions(thinkingState.content)) {
      await renderer.renderContent(thinkingState.contentEl, thinkingState.content);
    }

    const durationSeconds = finalizeThinkingBlock(thinkingState);

    if (msg && thinkingState.content) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: 'thinking',
        content: thinkingState.content,
        durationSeconds,
      });
    }

    state.currentThinkingState = null;
  }

  // ============================================
  // Thinking Indicator
  // ============================================

  showThinkingIndicator(overrideText?: string, overrideCls?: string): void {
    this.thinkingIndicator.show(overrideText, overrideCls);
  }

  hideThinkingIndicator(): void {
    this.thinkingIndicator.hide();
  }

  // ============================================
  // Compact Boundary
  // ============================================

  private renderCompactBoundary(): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();
    const el = state.currentContentEl.createDiv({ cls: 'sidebar-mimocode-compact-boundary' });
    el.createSpan({ cls: 'sidebar-mimocode-compact-boundary-label', text: 'Conversation compacted' });
  }

  /** Scrolls messages to bottom if auto-scroll is enabled. */
  private scrollToBottom(): void {
    this.autoScroll.scheduleToBottom();
  }

  private cancelPendingScroll(): void {
    this.autoScroll.cancel();
  }

  private getMessagesWindow(): Window | null {
    return this.deps.getMessagesEl().ownerDocument.defaultView ?? null;
  }

  private getStreamingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentTextEl?.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  private getThinkingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentThinkingState?.contentEl.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  resetStreamingState(): void {
    const { state } = this.deps;
    this.textRenderScheduler.cancel();
    this.thinkingRenderScheduler.cancel();
    this.toolOutputRenderScheduler.cancelAll();
    this.cancelPendingScroll();
    this.hideThinkingIndicator();
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
    this.resetSubagentStreamingState();
    state.pendingTools.clear();
    // Reset response timer (duration already captured at this point)
    state.responseStartTime = null;
  }
}
