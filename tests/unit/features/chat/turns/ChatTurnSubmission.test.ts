import type { ProviderCapabilities } from '@/core/providers/types';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import type { PreparedChatTurn } from '@/core/runtime/types';
import type { ChatMessage, StreamChunk } from '@/core/types';
import { ChatState } from '@/features/chat/state/ChatState';
import {
  ChatTurnSubmission,
  type ChatTurnSubmissionDeps,
  type ChatTurnSubmissionUI,
} from '@/features/chat/turns/ChatTurnSubmission';

function createElementMock(): HTMLElement {
  const element = {
    addClass: jest.fn(),
    removeClass: jest.fn(),
    createDiv: jest.fn(() => createElementMock()),
    createSpan: jest.fn(() => createElementMock()),
    querySelector: jest.fn(() => createElementMock()),
    scrollHeight: 0,
    scrollTop: 0,
  };
  return element as unknown as HTMLElement;
}

async function* streamChunks(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function createRuntime(chunks: StreamChunk[] = []): jest.Mocked<ChatRuntime> {
  const prepareTurn = jest.fn((request): PreparedChatTurn => ({
    isCompact: false,
    mcpMentions: new Set(),
    persistedContent: `persisted:${request.text}`,
    prompt: request.text,
    request,
  }));

  return {
    buildSessionUpdates: jest.fn(),
    cancel: jest.fn(),
    cleanup: jest.fn(),
    consumeSessionInvalidation: jest.fn(() => false),
    consumeTurnMetadata: jest.fn(() => ({ wasSent: true })),
    ensureReady: jest.fn(async () => true),
    getAuxiliaryModel: jest.fn(() => null),
    getCapabilities: jest.fn(() => createCapabilities()),
    getSessionId: jest.fn(() => 'session-1'),
    getSupportedCommands: jest.fn(async () => []),
    isReady: jest.fn(() => true),
    loadSubagentFinalResult: jest.fn(),
    loadSubagentToolCalls: jest.fn(),
    onReadyStateChange: jest.fn(() => jest.fn()),
    prepareTurn,
    providerId: 'mimo',
    query: jest.fn(() => streamChunks(chunks)),
    reloadMcpServers: jest.fn(async () => {}),
    resetSession: jest.fn(),
    resolveSessionIdForFork: jest.fn(() => null),
    rewind: jest.fn(),
    setApprovalCallback: jest.fn(),
    setApprovalDismisser: jest.fn(),
    setAskUserQuestionCallback: jest.fn(),
    setAutoTurnCallback: jest.fn(),
    setExitPlanModeCallback: jest.fn(),
    setPermissionModeSyncCallback: jest.fn(),
    setResumeCheckpoint: jest.fn(),
    setSubagentHookProvider: jest.fn(),
    steer: jest.fn(),
    syncConversationState: jest.fn(),
  } as unknown as jest.Mocked<ChatRuntime>;
}

function createCapabilities(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    providerId: 'mimo',
    reasoningControl: 'none',
    supportsFork: false,
    supportsImageAttachments: true,
    supportsInstructionMode: false,
    supportsMcpTools: true,
    supportsNativeHistory: false,
    supportsPersistentRuntime: true,
    supportsPlanMode: true,
    supportsProviderCommands: true,
    supportsRewind: false,
    supportsTurnSteer: false,
    ...overrides,
  };
}

function createHarness(options: {
  chunks?: StreamChunk[];
  composerContent?: string;
  ensureReady?: boolean;
  runtime?: jest.Mocked<ChatRuntime>;
} = {}) {
  const state = new ChatState();
  const runtime = options.runtime ?? createRuntime(options.chunks ?? []);
  const composer = {
    content: options.composerContent ?? 'Build this',
    images: [] as ChatMessage['images'],
  };
  const ui: jest.Mocked<ChatTurnSubmissionUI> = {
    clearComposer: jest.fn(() => {
      composer.content = '';
    }),
    clearComposerImages: jest.fn(() => {
      composer.images = [];
    }),
    dismissPendingInteraction: jest.fn(),
    getComposerContent: jest.fn(() => composer.content),
    getComposerImages: jest.fn(() => composer.images ?? []),
    hasComposerImages: jest.fn(() => (composer.images?.length ?? 0) > 0),
    restoreComposer: jest.fn(),
    setComposerContent: jest.fn((content) => {
      composer.content = content;
    }),
    showNotice: jest.fn(),
    showPlanApproval: jest.fn(async () => ({ decision: null, invalidated: false })),
    updateQueueIndicator: jest.fn(),
  };
  const renderer = {
    addMessage: jest.fn(() => createElementMock()),
    refreshActionButtons: jest.fn(),
    removeMessage: jest.fn(),
  };
  const streamController = {
    appendText: jest.fn(async () => {}),
    finalizeCurrentTextBlock: jest.fn(async () => {}),
    finalizeCurrentThinkingBlock: jest.fn(async () => {}),
    handleStreamChunk: jest.fn(async () => {}),
    hideThinkingIndicator: jest.fn(),
    resetSubagentSpawnedCount: jest.fn(),
    resetSubagentStreamingState: jest.fn(),
    showThinkingIndicator: jest.fn(),
  };
  const conversationController = {
    createNew: jest.fn(async () => {}),
    generateFallbackTitle: jest.fn(() => 'Build this'),
    save: jest.fn(async () => {}),
    updateHistoryDropdown: jest.fn(),
  };
  const plugin = {
    createConversation: jest.fn(async () => ({ id: 'conversation-1' })),
    getConversationById: jest.fn(async () => null),
    getConversationSync: jest.fn(() => null),
    renameConversation: jest.fn(async () => {}),
    settings: {
      enableAutoScroll: false,
      enableAutoTitleGeneration: false,
    },
    updateConversation: jest.fn(async () => {}),
  };
  const deps: ChatTurnSubmissionDeps = {
    canvasSelectionController: { getContext: jest.fn(() => null) },
    conversationController: conversationController as never,
    ensureServiceInitialized: jest.fn(async () => options.ensureReady ?? true),
    generateId: jest.fn()
      .mockReturnValueOnce('user-1')
      .mockReturnValueOnce('assistant-1')
      .mockReturnValueOnce('user-2')
      .mockReturnValueOnce('assistant-2'),
    getActiveCapabilities: () => createCapabilities(),
    getActiveProviderId: () => 'mimo',
    getAgentService: () => runtime,
    getExternalContextSelector: () => null,
    getFileContextManager: () => null,
    getImageContextManager: () => null,
    getMcpServerSelector: () => null,
    getMessagesEl: () => createElementMock(),
    getTitleGenerationService: () => null,
    getWelcomeEl: () => createElementMock(),
    plugin: plugin as never,
    renderer: renderer as never,
    restorePrePlanPermissionModeIfNeeded: jest.fn(),
    selectionController: { getContext: jest.fn(() => null) } as never,
    state,
    streamController: streamController as never,
    ui,
  };

  return {
    composer,
    conversationController,
    deps,
    plugin,
    renderer,
    runtime,
    state,
    streamController,
    submission: new ChatTurnSubmission(deps),
    ui,
  };
}

describe('ChatTurnSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('ignores empty submissions without touching the runtime', async () => {
    const { runtime, submission } = createHarness({ composerContent: '' });

    await expect(submission.submit()).resolves.toEqual({
      status: 'ignored',
      reason: 'empty',
    });
    expect(runtime.prepareTurn).not.toHaveBeenCalled();
    expect(runtime.query).not.toHaveBeenCalled();
  });

  it('queues a turn while streaming without calling the runtime', async () => {
    const { runtime, state, submission, ui } = createHarness({ composerContent: 'Second turn' });
    state.isStreaming = true;

    await expect(submission.submit()).resolves.toEqual({ status: 'queued' });

    expect(state.queuedMessage?.content).toBe('Second turn');
    expect(state.queuedMessage?.turnRequest?.text).toBe('Second turn');
    expect(runtime.prepareTurn).not.toHaveBeenCalled();
    expect(ui.updateQueueIndicator).toHaveBeenCalled();
  });

  it('submits a normal turn through runtime query and saves the conversation', async () => {
    const { conversationController, runtime, state, submission } = createHarness({
      chunks: [{ type: 'text', content: 'Done' }],
      composerContent: 'Build this',
    });

    await expect(submission.submit()).resolves.toEqual({ status: 'completed' });

    expect(runtime.prepareTurn).toHaveBeenCalledWith(expect.objectContaining({ text: 'Build this' }));
    expect(runtime.query).toHaveBeenCalledTimes(1);
    expect(conversationController.save).toHaveBeenCalledWith(true, { resumeAtMessageId: undefined });
    expect(state.messages.map(message => message.role)).toEqual(['user', 'assistant']);
  });

  it('returns failed when runtime initialization fails', async () => {
    const { state, streamController, submission, ui } = createHarness({
      ensureReady: false,
    });

    await expect(submission.submit()).resolves.toEqual({
      status: 'failed',
      message: 'Failed to initialize agent service. Please try again.',
    });
    expect(state.isStreaming).toBe(false);
    expect(streamController.hideThinkingIndicator).toHaveBeenCalled();
    expect(ui.showNotice).toHaveBeenCalledWith('Failed to initialize agent service. Please try again.');
  });

  it('keeps provider message boundary handling inside the turn submission flow', async () => {
    const { renderer, state, streamController, submission } = createHarness({
      chunks: [
        { type: 'user_message_start', content: 'Build this' },
        { type: 'user_message_start', content: 'Steered turn' },
      ],
      composerContent: 'Build this',
    });

    await expect(submission.submit()).resolves.toEqual({ status: 'completed' });

    expect(streamController.handleStreamChunk).not.toHaveBeenCalled();
    expect(renderer.removeMessage).toHaveBeenCalledWith('assistant-1');
    expect(state.messages.map(message => [message.role, message.content])).toEqual([
      ['user', 'persisted:Build this'],
      ['user', 'Steered turn'],
      ['assistant', ''],
    ]);
  });

  it('auto-submits implementation after plan approval', async () => {
    jest.useFakeTimers();
    const runtime = createRuntime([]);
    jest.mocked(runtime.consumeTurnMetadata)
      .mockReturnValueOnce({ wasSent: true, planCompleted: true })
      .mockReturnValue({ wasSent: true });
    const harness = createHarness({
      composerContent: 'Create a plan',
      runtime,
    });
    harness.ui.showPlanApproval.mockResolvedValue({
      decision: { type: 'implement' },
      invalidated: false,
    });

    await expect(harness.submission.submit()).resolves.toEqual({ status: 'completed' });
    await jest.runOnlyPendingTimersAsync();

    expect(harness.deps.restorePrePlanPermissionModeIfNeeded).toHaveBeenCalled();
    expect(runtime.prepareTurn).toHaveBeenCalledTimes(2);
    expect(runtime.prepareTurn).toHaveBeenLastCalledWith(expect.objectContaining({
      text: 'Implement the plan.',
    }));
  });
});
