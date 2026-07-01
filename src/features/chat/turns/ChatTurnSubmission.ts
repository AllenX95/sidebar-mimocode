import type { ProviderCapabilities, ProviderId, TitleGenerationService } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import {
  cloneChatTurnRequest,
  mergeQueuedChatTurns,
  type QueuedChatTurn,
} from '../../../core/runtime/QueuedTurn';
import type { ChatTurnRequest } from '../../../core/runtime/types';
import { TOOL_EXIT_PLAN_MODE } from '../../../core/tools/toolNames';
import type { ChatMessage, StreamChunk } from '../../../core/types';
import type SidebarMimocodePlugin from '../../../main';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import { extractUserDisplayContent } from '../../../utils/context';
import { formatDurationMmSs } from '../../../utils/date';
import type { EditorSelectionContext } from '../../../utils/editor';
import { COMPLETION_FLAVOR_WORDS } from '../constants';
import type { ConversationController } from '../controllers/ConversationController';
import type { SelectionController } from '../controllers/SelectionController';
import type { StreamController } from '../controllers/StreamController';
import type { PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { updateToolCallResult } from '../rendering/ToolCallRenderer';
import type { ChatState } from '../state/ChatState';
import type { QueuedMessage } from '../state/types';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';

type PendingProviderUserMessage = {
  displayContent: string;
  persistedContent?: string;
  currentNote?: string;
  images?: ChatMessage['images'];
};

export type ChatTurnSubmissionResult =
  | { status: 'ignored'; reason: 'empty' | 'conversation-busy' }
  | { status: 'queued' }
  | { status: 'completed' }
  | { status: 'interrupted' }
  | { status: 'invalidated' }
  | { status: 'failed'; message: string };

export interface ChatTurnSubmitOptions {
  editorContextOverride?: EditorSelectionContext | null;
  browserContextOverride?: BrowserSelectionContext | null;
  canvasContextOverride?: CanvasSelectionContext | null;
  content?: string;
  images?: ChatMessage['images'];
  turnRequestOverride?: ChatTurnRequest;
}

export interface ChatTurnQueueIndicatorState {
  canSteer: boolean;
  isPendingSteerOnly: boolean;
  message: QueuedMessage | null;
  steerInFlight: boolean;
}

export interface ChatTurnSubmissionUI {
  clearComposer(): void;
  clearComposerImages(): void;
  dismissPendingInteraction(invalidated: boolean): void;
  getComposerContent(): string;
  getComposerImages(): ChatMessage['images'];
  hasComposerImages(): boolean;
  restoreComposer(message: QueuedMessage | null, options?: { mergeWithComposer?: boolean }): void;
  setComposerContent(content: string): void;
  showNotice(message: string): void;
  showPlanApproval(): Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }>;
  updateQueueIndicator(): void;
}

export interface ChatTurnSubmissionDeps {
  browserSelectionController?: {
    getContext: () => BrowserSelectionContext | null;
  };
  canvasSelectionController: {
    getContext: () => CanvasSelectionContext | null;
  };
  conversationController: ConversationController;
  ensureServiceInitialized?: () => Promise<boolean>;
  generateId: () => string;
  getActiveCapabilities: () => ProviderCapabilities;
  getActiveProviderId: () => ProviderId;
  getAgentService?: () => ChatRuntime | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getMessagesEl: () => HTMLElement;
  getTitleGenerationService: () => TitleGenerationService | null;
  getWelcomeEl: () => HTMLElement | null;
  plugin: SidebarMimocodePlugin;
  renderer: MessageRenderer;
  restorePrePlanPermissionModeIfNeeded?: () => void;
  selectionController: SelectionController;
  state: ChatState;
  streamController: StreamController;
  ui: ChatTurnSubmissionUI;
}

export class ChatTurnSubmission {
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  private awaitingProviderAssistantStart = false;
  private deps: ChatTurnSubmissionDeps;
  private pendingProviderUserMessages: PendingProviderUserMessage[] = [];
  private pendingSteerMessage: QueuedMessage | null = null;
  private sawInitialProviderUserMessage = false;
  private steerInFlight = false;

  constructor(deps: ChatTurnSubmissionDeps) {
    this.deps = deps;
  }

  async submit(options: ChatTurnSubmitOptions = {}): Promise<ChatTurnSubmissionResult> {
    const {
      plugin,
      state,
      renderer,
      streamController,
      conversationController,
    } = this.deps;

    if (state.isCreatingConversation || state.isSwitchingConversation) {
      return { status: 'ignored', reason: 'conversation-busy' };
    }

    const contentOverride = options.content;
    const shouldUseComposer = contentOverride === undefined;
    const content = (contentOverride ?? this.deps.ui.getComposerContent()).trim();
    const imageOverride = options.images;
    const hasImages = imageOverride !== undefined
      ? imageOverride.length > 0
      : this.deps.ui.hasComposerImages();
    if (!content && !hasImages) {
      return { status: 'ignored', reason: 'empty' };
    }

    if (state.isStreaming) {
      this.queueTurn({ content, hasImages, imageOverride });
      if (shouldUseComposer) {
        this.deps.ui.clearComposer();
        this.deps.ui.clearComposerImages();
      }
      this.deps.ui.updateQueueIndicator();
      return { status: 'queued' };
    }

    if (shouldUseComposer) {
      this.deps.ui.clearComposer();
    }
    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false;
    streamController.resetSubagentSpawnedCount();
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
    const streamGeneration = state.bumpStreamGeneration();

    this.deps.getWelcomeEl()?.addClass('sidebar-mimocode-hidden');
    this.deps.getFileContextManager()?.startSession();

    const images = imageOverride ?? this.deps.ui.getComposerImages() ?? [];
    const imagesForMessage = images.length > 0 ? [...images] : undefined;
    const isCompact = /^\/compact(\s|$)/i.test(content);

    if (shouldUseComposer) {
      this.deps.ui.clearComposerImages();
    }

    const turnSubmission = options.turnRequestOverride
      ? {
        displayContent: content,
        turnRequest: cloneChatTurnRequest(options.turnRequestOverride),
      }
      : this.buildTurnSubmission({
        content,
        images: imagesForMessage,
        editorContextOverride: options.editorContextOverride,
        browserContextOverride: options.browserContextOverride,
        canvasContextOverride: options.canvasContextOverride,
      });
    const { displayContent, turnRequest } = turnSubmission;

    this.deps.getFileContextManager()?.markCurrentNoteSent();

    const userMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'user',
      content: displayContent,
      displayContent,
      timestamp: Date.now(),
      images: imagesForMessage,
    };
    state.addMessage(userMsg);
    state.hasPendingConversationSave = true;
    renderer.addMessage(userMsg);

    await this.triggerTitleGeneration();

    const assistantMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    state.addMessage(assistantMsg);
    this.activeStreamingAssistantMessage = assistantMsg;
    this.activateStreamingAssistantMessage(assistantMsg);
    this.pendingProviderUserMessages = [{
      displayContent,
      images: imagesForMessage,
    }];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = true;

    streamController.showThinkingIndicator(
      isCompact ? 'Compacting...' : undefined,
      isCompact ? 'sidebar-mimocode-thinking--compact' : undefined,
    );
    state.responseStartTime = performance.now();

    let wasInterrupted = false;
    let wasInvalidated = false;
    let didEnqueueToSdk = false;
    let planCompleted = false;
    let queryFailureMessage: string | null = null;

    if (this.deps.ensureServiceInitialized) {
      const ready = await this.deps.ensureServiceInitialized();
      if (!ready) {
        const message = 'Failed to initialize agent service. Please try again.';
        this.deps.ui.showNotice(message);
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        this.activeStreamingAssistantMessage = null;
        this.resetProviderMessageBoundaryState();
        return { status: 'failed', message };
      }
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      const message = 'Agent service not available. Please reload the plugin.';
      this.deps.ui.showNotice(message);
      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
      return { status: 'failed', message };
    }

    await this.restoreResumeCheckpoint(agentService);

    try {
      const preparedTurn = agentService.prepareTurn(turnRequest);
      userMsg.content = preparedTurn.persistedContent;
      userMsg.currentNote = preparedTurn.isCompact
        ? undefined
        : preparedTurn.request.currentNotePath;

      const previousMessages = state.messages.slice(0, -2);
      for await (const chunk of agentService.query(preparedTurn, previousMessages)) {
        if (state.streamGeneration !== streamGeneration) {
          wasInvalidated = true;
          break;
        }
        if (state.cancelRequested) {
          wasInterrupted = true;
          break;
        }

        if (await this.handleProviderMessageBoundaryChunk(chunk)) {
          continue;
        }

        await streamController.handleStreamChunk(
          chunk,
          this.activeStreamingAssistantMessage ?? assistantMsg,
        );
      }
    } catch (error) {
      queryFailureMessage = error instanceof Error ? error.message : 'Unknown error';
      await streamController.appendText(`\n\n**Error:** ${queryFailureMessage}`);
    } finally {
      const finalAssistantMsg = this.activeStreamingAssistantMessage ?? assistantMsg;
      const turnMetadata = agentService.consumeTurnMetadata();
      userMsg.userMessageId = turnMetadata.userMessageId ?? userMsg.userMessageId;
      finalAssistantMsg.assistantMessageId = turnMetadata.assistantMessageId ?? finalAssistantMsg.assistantMessageId;
      didEnqueueToSdk = didEnqueueToSdk || turnMetadata.wasSent === true;
      planCompleted = planCompleted || turnMetadata.planCompleted === true;

      state.clearFlavorTimerInterval();

      if (!wasInvalidated && state.streamGeneration === streamGeneration) {
        const didCancelThisTurn = wasInterrupted || state.cancelRequested;
        if (didCancelThisTurn && !state.pendingNewSessionPlan) {
          await streamController.appendText('\n\n<span class="sidebar-mimocode-interrupted">Interrupted</span> <span class="sidebar-mimocode-interrupted-hint">· What should MiMo-Code do instead?</span>');
        }
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        state.cancelRequested = false;
        this.restorePendingSteerMessageToQueue();

        this.appendDurationFooterIfNeeded(finalAssistantMsg, didCancelThisTurn);

        state.currentContentEl = null;

        await streamController.finalizeCurrentThinkingBlock(finalAssistantMsg);
        await streamController.finalizeCurrentTextBlock(finalAssistantMsg);
        streamController.resetSubagentStreamingState();

        if (state.currentTodos && state.currentTodos.every(t => t.status === 'completed')) {
          state.currentTodos = null;
        }
        this.syncScrollToBottomAfterRenderUpdates();

        this.markPendingNewSessionPlanToolResult(finalAssistantMsg);

        const planResult = await this.handlePlanApprovalAfterTurn({
          didCancelThisTurn,
          planCompleted,
          streamGeneration,
        });

        if (!planResult.invalidated) {
          const saveExtras = didEnqueueToSdk ? { resumeAtMessageId: undefined } : undefined;
          await conversationController.save(true, saveExtras);

          const userMsgIndex = state.messages.indexOf(userMsg);
          renderer.refreshActionButtons(userMsg, state.messages, userMsgIndex >= 0 ? userMsgIndex : undefined);

          this.scheduleFollowUpSubmit(planResult);
        }
      }

      if (wasInvalidated) {
        this.clearPendingSteerState();
        this.deps.ui.updateQueueIndicator();
      }

      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
    }

    if (queryFailureMessage) {
      return { status: 'failed', message: queryFailureMessage };
    }
    if (wasInvalidated) {
      return { status: 'invalidated' };
    }
    if (wasInterrupted) {
      return { status: 'interrupted' };
    }
    return { status: 'completed' };
  }

  cancel(): void {
    const { state, streamController } = this.deps;
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    this.restorePendingTurnsToComposer();
    this.getAgentService()?.cancel();
    streamController.hideThinkingIndicator();
    this.deps.ui.dismissPendingInteraction(true);
  }

  clearQueuedTurn(): void {
    this.deps.state.queuedMessage = null;
    this.deps.ui.updateQueueIndicator();
  }

  dismissPendingInteraction(): void {
    this.deps.ui.dismissPendingInteraction(true);
  }

  getQueueIndicatorState(): ChatTurnQueueIndicatorState {
    const { state } = this.deps;
    const message = state.queuedMessage ?? this.pendingSteerMessage;
    return {
      canSteer: this.canSteerQueuedTurn(),
      isPendingSteerOnly: !state.queuedMessage && !!this.pendingSteerMessage,
      message,
      steerInFlight: this.steerInFlight,
    };
  }

  async steerQueuedTurn(): Promise<void> {
    if (this.steerInFlight) {
      return;
    }

    const { state } = this.deps;
    const agentService = this.getAgentService();
    if (!state.queuedMessage || !this.canSteerQueuedTurn() || !agentService?.steer) {
      return;
    }

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.pendingSteerMessage = queuedMessage;
    this.steerInFlight = true;
    this.deps.ui.updateQueueIndicator();

    try {
      const { displayContent, request } = this.toQueuedChatTurn(queuedMessage);

      const preparedTurn = agentService.prepareTurn(request);
      const accepted = await agentService.steer(preparedTurn);
      if (state.cancelRequested || !this.pendingSteerMessage) {
        return;
      }
      if (!accepted) {
        this.restoreQueuedTurnAfterSteerFailure(queuedMessage);
        return;
      }

      this.deps.getFileContextManager()?.markCurrentNoteSent();

      this.pendingProviderUserMessages.push({
        displayContent,
        persistedContent: preparedTurn.persistedContent,
        currentNote: preparedTurn.isCompact
          ? undefined
          : preparedTurn.request.currentNotePath,
        images: request.images,
      });
    } catch {
      this.restoreQueuedTurnAfterSteerFailure(queuedMessage);
      this.deps.ui.showNotice('Failed to steer the queued MiMo-Code message. It is still available.');
    }
  }

  withdrawQueuedTurnToComposer(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.deps.ui.restoreComposer(queuedMessage, { mergeWithComposer: true });
    this.deps.ui.updateQueueIndicator();
  }

  private activateStreamingAssistantMessage(message: ChatMessage): void {
    const { state, renderer } = this.deps;
    const msgEl = renderer.addMessage(message);
    const contentEl = msgEl.querySelector<HTMLElement>('.sidebar-mimocode-message-content');

    if (!contentEl) {
      return;
    }

    if (!state.currentContentEl) {
      state.toolCallElements.clear();
    }

    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  private appendDurationFooterIfNeeded(finalAssistantMsg: ChatMessage, didCancelThisTurn: boolean): void {
    const { state } = this.deps;
    const hasCompactBoundary = finalAssistantMsg.contentBlocks?.some(b => b.type === 'context_compacted');
    if (didCancelThisTurn || hasCompactBoundary) {
      return;
    }

    const durationSeconds = state.responseStartTime
      ? Math.floor((performance.now() - state.responseStartTime) / 1000)
      : 0;
    if (durationSeconds <= 0) {
      return;
    }

    const flavorWord =
      COMPLETION_FLAVOR_WORDS[Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)];
    finalAssistantMsg.durationSeconds = durationSeconds;
    finalAssistantMsg.durationFlavorWord = flavorWord;
    if (state.currentContentEl) {
      const footerEl = state.currentContentEl.createDiv({ cls: 'sidebar-mimocode-response-footer' });
      footerEl.createSpan({
        text: `* ${flavorWord} for ${formatDurationMmSs(durationSeconds)}`,
        cls: 'sidebar-mimocode-baked-duration',
      });
    }
  }

  private buildTurnSubmission(options: {
    content: string;
    images?: ChatMessage['images'];
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
  }): {
    displayContent: string;
    turnRequest: ChatTurnRequest;
  } {
    const {
      selectionController,
      browserSelectionController,
      canvasSelectionController,
    } = this.deps;

    const fileContextManager = this.deps.getFileContextManager();
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const externalContextSelector = this.deps.getExternalContextSelector();

    const currentNotePath = fileContextManager?.getCurrentNotePath() || null;
    const shouldSendCurrentNote = fileContextManager?.shouldSendCurrentNote(currentNotePath) ?? false;

    const editorContext = options.editorContextOverride !== undefined
      ? options.editorContextOverride
      : selectionController.getContext();
    const browserContext = options.browserContextOverride !== undefined
      ? options.browserContextOverride
      : (browserSelectionController?.getContext() ?? null);
    const canvasContext = options.canvasContextOverride !== undefined
      ? options.canvasContextOverride
      : canvasSelectionController.getContext();

    const externalContextPaths = externalContextSelector?.getExternalContexts();
    const isCompact = /^\/compact(\s|$)/i.test(options.content);
    const transformedText = !isCompact && fileContextManager
      ? fileContextManager.transformContextMentions(options.content)
      : options.content;
    const enabledMcpServers = mcpServerSelector?.getEnabledServers();

    return {
      displayContent: options.content,
      turnRequest: {
        text: transformedText,
        images: options.images,
        currentNotePath: shouldSendCurrentNote && currentNotePath ? currentNotePath : undefined,
        editorSelection: editorContext,
        browserSelection: browserContext,
        canvasSelection: canvasContext,
        externalContextPaths: externalContextPaths && externalContextPaths.length > 0
          ? externalContextPaths
          : undefined,
        enabledMcpServers: enabledMcpServers && enabledMcpServers.size > 0
          ? enabledMcpServers
          : undefined,
      },
    };
  }

  private canSteerQueuedTurn(): boolean {
    const agentService = this.getAgentService();
    return this.deps.state.isStreaming
      && this.deps.getActiveCapabilities().supportsTurnSteer === true
      && typeof agentService?.steer === 'function';
  }

  private clearPendingSteerState(): void {
    this.pendingSteerMessage = null;
    this.steerInFlight = false;
  }

  private cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
    return {
      ...message,
      images: message.images ? [...message.images] : undefined,
      turnRequest: message.turnRequest
        ? cloneChatTurnRequest(message.turnRequest)
        : undefined,
    };
  }

  private createQueuedMessage(displayContent: string, turnRequest: ChatTurnRequest): QueuedMessage {
    const request = cloneChatTurnRequest(turnRequest);
    return {
      content: displayContent,
      images: request.images,
      editorContext: request.editorSelection ?? null,
      browserContext: request.browserSelection ?? null,
      canvasContext: request.canvasSelection ?? null,
      turnRequest: request,
    };
  }

  private discardStreamingAssistantMessage(messageId: string): void {
    const { state, renderer } = this.deps;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    renderer.removeMessage(messageId);
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  private async handlePlanApprovalAfterTurn(params: {
    didCancelThisTurn: boolean;
    planCompleted: boolean;
    streamGeneration: number;
  }): Promise<{
    invalidated: boolean;
    planAutoSendContent: string | null;
    shouldProcessQueuedTurn: boolean;
  }> {
    const { state } = this.deps;
    let planAutoSendContent: string | null = null;
    let invalidated = false;
    let shouldProcessQueuedTurn = true;

    if (params.planCompleted && !params.didCancelThisTurn) {
      const { decision, invalidated: approvalInvalidated } = await this.deps.ui.showPlanApproval();

      if (state.streamGeneration !== params.streamGeneration || approvalInvalidated) {
        invalidated = true;
      } else if (decision?.type === 'implement') {
        this.deps.restorePrePlanPermissionModeIfNeeded?.();
        planAutoSendContent = 'Implement the plan.';
      } else if (decision?.type === 'revise') {
        this.deps.ui.setComposerContent(decision.text);
        shouldProcessQueuedTurn = false;
      } else {
        this.deps.restorePrePlanPermissionModeIfNeeded?.();
      }
    }

    return {
      invalidated,
      planAutoSendContent,
      shouldProcessQueuedTurn,
    };
  }

  private async handleProviderAssistantMessageStart(): Promise<void> {
    if (this.awaitingProviderAssistantStart) {
      this.awaitingProviderAssistantStart = false;
      return;
    }

    const previousAssistant = this.activeStreamingAssistantMessage;
    if (previousAssistant) {
      await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
      await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
  }

  private async handleProviderMessageBoundaryChunk(chunk: StreamChunk): Promise<boolean> {
    switch (chunk.type) {
      case 'user_message_start':
        await this.handleProviderUserMessageStart(chunk);
        return true;
      case 'assistant_message_start':
        await this.handleProviderAssistantMessageStart();
        return true;
      default:
        return false;
    }
  }

  private async handleProviderUserMessageStart(
    chunk: Extract<StreamChunk, { type: 'user_message_start' }>,
  ): Promise<void> {
    const expected = this.pendingProviderUserMessages.shift();
    if (!this.sawInitialProviderUserMessage) {
      this.sawInitialProviderUserMessage = true;
      return;
    }

    this.clearPendingSteerState();
    this.deps.ui.updateQueueIndicator();

    const previousAssistant = this.activeStreamingAssistantMessage;
    const shouldDiscardPlaceholder = this.shouldDiscardPendingAssistantPlaceholder(previousAssistant);
    if (previousAssistant) {
      if (shouldDiscardPlaceholder) {
        this.discardStreamingAssistantMessage(previousAssistant.id);
      } else {
        await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
        await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
      }
    }
    this.deps.streamController.hideThinkingIndicator();

    const displayContent = expected?.displayContent ?? chunk.content;
    const persistedContent = expected?.persistedContent ?? displayContent;
    const images = expected?.images;
    if (displayContent || (images?.length ?? 0) > 0) {
      const userMessage: ChatMessage = {
        id: this.deps.generateId(),
        role: 'user',
        content: persistedContent,
        displayContent,
        timestamp: Date.now(),
        currentNote: expected?.currentNote,
        images,
      };
      this.deps.state.addMessage(userMessage);
      this.deps.renderer.addMessage(userMessage);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
    this.deps.state.responseStartTime = performance.now();
    this.awaitingProviderAssistantStart = true;
  }

  private markPendingNewSessionPlanToolResult(finalAssistantMsg: ChatMessage): void {
    const { state } = this.deps;
    if (!state.pendingNewSessionPlan || !finalAssistantMsg.toolCalls) {
      return;
    }

    for (const tc of finalAssistantMsg.toolCalls) {
      if (tc.name === TOOL_EXIT_PLAN_MODE && !tc.result) {
        tc.status = 'completed';
        tc.result = 'User approved the plan and started a new session.';
        updateToolCallResult(tc.id, tc, state.toolCallElements);
      }
    }
  }

  private mergePendingTurns(
    first: QueuedMessage | null,
    second: QueuedMessage | null,
  ): QueuedMessage | null {
    if (first && second) {
      return this.mergeQueuedMessages(first, second);
    }

    if (first) {
      return this.cloneQueuedMessage(first);
    }

    if (second) {
      return this.cloneQueuedMessage(second);
    }

    return null;
  }

  private mergeQueuedMessages(
    existing: QueuedMessage | null,
    incoming: QueuedMessage,
  ): QueuedMessage {
    if (!existing) {
      return this.cloneQueuedMessage(incoming);
    }

    const mergedTurn = mergeQueuedChatTurns(
      this.toQueuedChatTurn(existing),
      this.toQueuedChatTurn(incoming),
    );
    return this.createQueuedMessage(mergedTurn.displayContent, mergedTurn.request);
  }

  private queueTurn(params: {
    content: string;
    hasImages: boolean;
    imageOverride?: ChatMessage['images'];
  }): void {
    const images = params.hasImages
      ? [...(params.imageOverride ?? this.deps.ui.getComposerImages() ?? [])]
      : undefined;
    const editorContext = this.deps.selectionController.getContext();
    const browserContext = this.deps.browserSelectionController?.getContext() ?? null;
    const canvasContext = this.deps.canvasSelectionController.getContext();
    const { displayContent, turnRequest } = this.buildTurnSubmission({
      content: params.content,
      images,
      editorContextOverride: editorContext,
      browserContextOverride: browserContext,
      canvasContextOverride: canvasContext,
    });
    this.deps.state.queuedMessage = this.mergeQueuedMessages(
      this.deps.state.queuedMessage,
      this.createQueuedMessage(displayContent, turnRequest),
    );
  }

  private resetProviderMessageBoundaryState(): void {
    this.pendingProviderUserMessages = [];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = false;
  }

  private restorePendingSteerMessageToQueue(): void {
    if (!this.pendingSteerMessage) {
      return;
    }

    const { state } = this.deps;
    const pendingSteerMessage = this.cloneQueuedMessage(this.pendingSteerMessage);
    this.clearPendingSteerState();
    state.queuedMessage = state.queuedMessage
      ? this.mergeQueuedMessages(pendingSteerMessage, state.queuedMessage)
      : pendingSteerMessage;
    this.deps.ui.updateQueueIndicator();
  }

  private restorePendingTurnsToComposer(): void {
    const { state } = this.deps;
    const combinedMessage = this.mergePendingTurns(
      this.pendingSteerMessage,
      state.queuedMessage,
    );
    this.deps.ui.restoreComposer(combinedMessage, { mergeWithComposer: true });
    state.queuedMessage = null;
    this.clearPendingSteerState();
    this.deps.ui.updateQueueIndicator();
  }

  private restoreQueuedTurnAfterSteerFailure(
    message: QueuedMessage,
  ): void {
    const { state } = this.deps;
    this.clearPendingSteerState();
    if (state.cancelRequested) {
      this.deps.ui.updateQueueIndicator();
      return;
    }

    if (state.isStreaming) {
      state.queuedMessage = state.queuedMessage
        ? this.mergeQueuedMessages(message, state.queuedMessage)
        : message;
      this.deps.ui.updateQueueIndicator();
      return;
    }

    this.deps.ui.restoreComposer(message, { mergeWithComposer: true });
    this.deps.ui.updateQueueIndicator();
  }

  private async restoreResumeCheckpoint(agentService: ChatRuntime): Promise<void> {
    const { plugin, state } = this.deps;
    const conversationIdForSend = state.currentConversationId;
    if (!conversationIdForSend) {
      return;
    }

    const conv = plugin.getConversationSync(conversationIdForSend);
    if (!conv?.resumeAtMessageId) {
      return;
    }

    if (this.isResumeSessionAtStillNeeded(conv.resumeAtMessageId, state.messages.slice(0, -2))) {
      agentService.setResumeCheckpoint(conv.resumeAtMessageId);
      return;
    }

    try {
      await plugin.updateConversation(conversationIdForSend, { resumeAtMessageId: undefined });
    } catch {
      // Best-effort; do not block send.
    }
  }

  private scheduleFollowUpSubmit(params: {
    planAutoSendContent: string | null;
    shouldProcessQueuedTurn: boolean;
  }): void {
    const { state, conversationController } = this.deps;

    if (params.planAutoSendContent) {
      window.setTimeout(() => {
        void this.submit({ content: params.planAutoSendContent ?? undefined }).catch(() => {});
      }, 0);
      return;
    }

    const planContent = state.pendingNewSessionPlan;
    if (planContent) {
      state.pendingNewSessionPlan = null;
      void conversationController.createNew()
        .then(() => this.submit({ content: planContent }))
        .catch(() => {
          // submit() handles expected errors internally; this prevents
          // unhandled rejection if an unexpected error slips through.
        });
      return;
    }

    if (params.shouldProcessQueuedTurn) {
      this.submitQueuedTurn();
    }
  }

  private shouldDiscardPendingAssistantPlaceholder(message: ChatMessage | null): boolean {
    return this.awaitingProviderAssistantStart
      && !!message
      && !message.content.trim()
      && (message.toolCalls?.length ?? 0) === 0
      && (message.contentBlocks?.length ?? 0) === 0;
  }

  private submitQueuedTurn(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.deps.ui.updateQueueIndicator();

    window.setTimeout(
      () => {
        void this.submit({
          content: queuedMessage.content,
          images: queuedMessage.images,
          turnRequestOverride: this.toQueuedChatTurn(queuedMessage).request,
        });
      },
      0
    );
  }

  private syncScrollToBottomAfterRenderUpdates(): void {
    const { plugin, state } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    window.requestAnimationFrame(() => {
      if (!(this.deps.plugin.settings.enableAutoScroll ?? true)) return;
      if (!this.deps.state.autoScrollEnabled) return;

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  private toQueuedChatTurn(message: QueuedMessage): QueuedChatTurn {
    if (message.turnRequest) {
      return {
        displayContent: message.content,
        request: cloneChatTurnRequest(message.turnRequest),
      };
    }

    return {
      displayContent: message.content,
      request: {
        text: message.content,
        images: message.images ? [...message.images] : undefined,
        editorSelection: message.editorContext,
        browserSelection: message.browserContext ?? null,
        canvasSelection: message.canvasContext,
      },
    };
  }

  private async triggerTitleGeneration(): Promise<void> {
    const { plugin, state, conversationController } = this.deps;

    if (state.messages.length !== 1) {
      return;
    }

    if (!state.currentConversationId) {
      const sessionId = this.getAgentService()?.getSessionId() ?? undefined;
      const conversation = await plugin.createConversation({
        providerId: this.deps.getActiveProviderId(),
        sessionId,
      });
      state.currentConversationId = conversation.id;
    }

    const firstUserMsg = state.messages.find(m => m.role === 'user');

    if (!firstUserMsg) {
      return;
    }

    const userContent = firstUserMsg.displayContent
      ?? extractUserDisplayContent(firstUserMsg.content)
      ?? firstUserMsg.content;

    const fallbackTitle = conversationController.generateFallbackTitle(userContent);
    await plugin.renameConversation(state.currentConversationId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      return;
    }

    await plugin.updateConversation(state.currentConversationId, { titleGenerationStatus: 'pending' });
    conversationController.updateHistoryDropdown();

    const expectedTitle = fallbackTitle;

    titleService.generateTitle(
      state.currentConversationId,
      userContent,
      async (conversationId, result) => {
        const currentConv = await plugin.getConversationById(conversationId);
        if (!currentConv) return;

        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(conversationId, result.title);
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'failed' });
        } else {
          await plugin.updateConversation(conversationId, { titleGenerationStatus: undefined });
        }
        conversationController.updateHistoryDropdown();
      }
    ).catch(() => {
      // Silently ignore title generation errors.
    });
  }

  private isResumeSessionAtStillNeeded(resumeUuid: string, previousMessages: ChatMessage[]): boolean {
    for (let i = previousMessages.length - 1; i >= 0; i--) {
      if (previousMessages[i].role === 'assistant' && previousMessages[i].assistantMessageId === resumeUuid) {
        return i === previousMessages.length - 1;
      }
    }
    return false;
  }
}
