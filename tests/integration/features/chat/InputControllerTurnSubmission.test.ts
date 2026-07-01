import type { ProviderCapabilities } from '@/core/providers/types';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import type { PreparedChatTurn } from '@/core/runtime/types';
import type { ChatMessage, StreamChunk } from '@/core/types';
import { InputController, type InputControllerDeps } from '@/features/chat/controllers/InputController';
import { ChatState } from '@/features/chat/state/ChatState';

class MockElement {
  attrs = new Map<string, string>();
  children: MockElement[] = [];
  classes = new Set<string>();
  eventHandlers = new Map<string, (event: { stopPropagation: () => void }) => void>();
  tag: string;
  text = '';

  constructor(tag = 'div') {
    this.tag = tag;
  }

  addClass = jest.fn((className: string): void => {
    this.classes.add(className);
  });

  addEventListener = jest.fn((event: string, callback: (event: { stopPropagation: () => void }) => void): void => {
    this.eventHandlers.set(event, callback);
  });

  createDiv = jest.fn((options: { attr?: Record<string, string>; cls?: string; text?: string } = {}): MockElement =>
    this.createChild('div', options)
  );

  createEl = jest.fn((tag: string, options: { attr?: Record<string, string>; cls?: string; text?: string } = {}): MockElement =>
    this.createChild(tag, options)
  );

  createSpan = jest.fn((options: { attr?: Record<string, string>; cls?: string; text?: string } = {}): MockElement =>
    this.createChild('span', options)
  );

  empty = jest.fn((): void => {
    this.children = [];
  });

  focus = jest.fn();

  querySelector = jest.fn((): MockElement => this.createChild('query'));

  removeClass = jest.fn((className: string): void => {
    this.classes.delete(className);
  });

  setAttribute = jest.fn((name: string, value: string): void => {
    this.attrs.set(name, value);
  });

  private createChild(
    tag: string,
    options: { attr?: Record<string, string>; cls?: string; text?: string } = {},
  ): MockElement {
    const child = new MockElement(tag);
    child.text = options.text ?? '';
    if (options.cls) {
      child.classes.add(options.cls);
    }
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      child.attrs.set(name, value);
    }
    this.children.push(child);
    return child;
  }
}

async function* streamChunks(chunks: StreamChunk[]): AsyncGenerator<StreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
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

function createRuntime(options: {
  capabilities?: Partial<ProviderCapabilities>;
  chunks?: StreamChunk[];
} = {}): jest.Mocked<ChatRuntime> {
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
    getCapabilities: jest.fn(() => createCapabilities(options.capabilities)),
    getSessionId: jest.fn(() => 'session-1'),
    getSupportedCommands: jest.fn(async () => []),
    isReady: jest.fn(() => true),
    loadSubagentFinalResult: jest.fn(),
    loadSubagentToolCalls: jest.fn(),
    onReadyStateChange: jest.fn(() => jest.fn()),
    prepareTurn,
    providerId: 'mimo',
    query: jest.fn(() => streamChunks(options.chunks ?? [])),
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
    steer: jest.fn(async () => true),
    syncConversationState: jest.fn(),
  } as unknown as jest.Mocked<ChatRuntime>;
}

function collectText(root: MockElement): string[] {
  return [
    root.text,
    ...root.children.flatMap(child => collectText(child)),
  ].filter(text => text.length > 0);
}

function createHarness(options: {
  capabilities?: Partial<ProviderCapabilities>;
  chunks?: StreamChunk[];
  inputValue?: string;
} = {}) {
  const state = new ChatState();
  const runtime = createRuntime({
    capabilities: options.capabilities,
    chunks: options.chunks,
  });
  const inputEl = {
    focus: jest.fn(),
    value: options.inputValue ?? 'Build this',
  } as unknown as HTMLTextAreaElement;
  const queueIndicatorEl = new MockElement();
  state.queueIndicatorEl = queueIndicatorEl as unknown as HTMLElement;

  const imageContextManager = {
    clearImages: jest.fn(),
    getAttachedImages: jest.fn(() => [] as ChatMessage['images']),
    hasImages: jest.fn(() => false),
    setImages: jest.fn(),
  };
  const renderer = {
    addMessage: jest.fn(() => new MockElement() as unknown as HTMLElement),
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
      systemPrompt: '',
    },
    updateConversation: jest.fn(async () => {}),
  };
  const deps: InputControllerDeps = {
    canvasSelectionController: { getContext: jest.fn(() => null) } as never,
    conversationController: conversationController as never,
    ensureServiceInitialized: jest.fn(async () => true),
    generateId: jest.fn()
      .mockReturnValueOnce('user-1')
      .mockReturnValueOnce('assistant-1')
      .mockReturnValueOnce('user-2')
      .mockReturnValueOnce('assistant-2'),
    getAgentService: () => runtime,
    getExternalContextSelector: () => null,
    getFileContextManager: () => null,
    getImageContextManager: () => imageContextManager as never,
    getInputContainerEl: () => new MockElement() as unknown as HTMLElement,
    getInputEl: () => inputEl,
    getInstructionModeManager: () => null,
    getInstructionRefineService: () => null,
    getMcpServerSelector: () => null,
    getMessagesEl: () => new MockElement() as unknown as HTMLElement,
    getStatusPanel: () => null,
    getTitleGenerationService: () => null,
    getWelcomeEl: () => new MockElement() as unknown as HTMLElement,
    plugin: plugin as never,
    renderer: renderer as never,
    resetInputHeight: jest.fn(),
    selectionController: { getContext: jest.fn(() => null) } as never,
    state,
    streamController: streamController as never,
  };
  const controller = new InputController(deps);

  return {
    controller,
    conversationController,
    deps,
    imageContextManager,
    inputEl,
    plugin,
    queueIndicatorEl,
    renderer,
    runtime,
    state,
    streamController,
  };
}

describe('InputController chat turn submission integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('submits a composer turn through ChatTurnSubmission and saves the conversation', async () => {
    const { controller, conversationController, deps, inputEl, runtime, state } = createHarness({
      chunks: [{ type: 'text', content: 'Done' }],
      inputValue: 'Build this',
    });

    await expect(controller.sendMessage()).resolves.toEqual({ status: 'completed' });

    expect(inputEl.value).toBe('');
    expect(deps.resetInputHeight).toHaveBeenCalled();
    expect(runtime.prepareTurn).toHaveBeenCalledWith(expect.objectContaining({ text: 'Build this' }));
    expect(runtime.query).toHaveBeenCalledTimes(1);
    expect(conversationController.save).toHaveBeenCalledWith(true, { resumeAtMessageId: undefined });
    expect(state.messages.map(message => message.role)).toEqual(['user', 'assistant']);
  });

  it('queues a composer turn during streaming and keeps the queue indicator behavior', async () => {
    const { controller, deps, inputEl, queueIndicatorEl, runtime, state } = createHarness({
      capabilities: { supportsTurnSteer: true },
      inputValue: 'Second turn',
    });
    state.isStreaming = true;

    await expect(controller.sendMessage()).resolves.toEqual({ status: 'queued' });

    expect(inputEl.value).toBe('');
    expect(deps.resetInputHeight).toHaveBeenCalled();
    expect(state.queuedMessage?.content).toBe('Second turn');
    expect(runtime.prepareTurn).not.toHaveBeenCalled();
    expect(queueIndicatorEl.empty).toHaveBeenCalled();
    expect(queueIndicatorEl.classes.has('sidebar-mimocode-visible-flex')).toBe(true);
    expect(queueIndicatorEl.classes.has('sidebar-mimocode-hidden')).toBe(false);
    expect(collectText(queueIndicatorEl)).toEqual(expect.arrayContaining([
      '⌙ Queued: Second turn',
      'Steer Now',
    ]));
    expect(
      queueIndicatorEl.children.flatMap(child => child.children).map(child => child.attrs.get('aria-label')),
    ).toEqual(expect.arrayContaining(['Edit queued message', 'Discard queued message']));
  });

  it('restores queued composer content when canceling an active turn', async () => {
    const { controller, inputEl, runtime, state, streamController } = createHarness({
      inputValue: 'Queued turn',
    });
    state.isStreaming = true;
    await expect(controller.sendMessage()).resolves.toEqual({ status: 'queued' });
    inputEl.value = 'manual edit';

    controller.cancelStreaming();

    expect(state.cancelRequested).toBe(true);
    expect(state.queuedMessage).toBeNull();
    expect(inputEl.value).toBe('Queued turn\n\nmanual edit');
    expect(runtime.cancel).toHaveBeenCalled();
    expect(streamController.hideThinkingIndicator).toHaveBeenCalled();
  });
});
