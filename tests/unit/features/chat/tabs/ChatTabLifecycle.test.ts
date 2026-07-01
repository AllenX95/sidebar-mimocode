import {
  activateChatTab,
  createChatTab,
  deactivateChatTab,
  destroyChatTab,
  ensureChatTabRuntime,
  initializeChatTab,
  refreshChatTabAfterProviderAvailabilityChanged,
  refreshChatTabProvider,
  refreshChatTabSelectors,
} from '@/features/chat/tabs/ChatTabLifecycle';
import * as tabInternals from '@/features/chat/tabs/TabInternals';
import type { TabData } from '@/features/chat/tabs/types';

jest.mock('@/features/chat/tabs/TabInternals', () => ({
  activateTab: jest.fn(),
  applyProviderUIGating: jest.fn(),
  createTab: jest.fn(),
  deactivateTab: jest.fn(),
  destroyTab: jest.fn(),
  initializeTabControllers: jest.fn(),
  initializeTabService: jest.fn(),
  initializeTabUI: jest.fn(),
  onProviderAvailabilityChanged: jest.fn(),
  refreshTabProviderUI: jest.fn(),
  setupServiceCallbacks: jest.fn(),
  updatePlanModeUI: jest.fn(),
  wireTabInputEvents: jest.fn(),
}));

function createTabData(): TabData {
  return {
    id: 'tab-1',
  } as TabData;
}

describe('ChatTabLifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a chat tab through the lifecycle seam', () => {
    const tab = createTabData();
    jest.mocked(tabInternals.createTab).mockReturnValue(tab);
    const options = { plugin: {}, containerEl: {} } as Parameters<typeof createChatTab>[0];

    expect(createChatTab(options)).toBe(tab);
    expect(tabInternals.createTab).toHaveBeenCalledWith(options);
  });

  it('initializes UI, controllers, and input events through one entry point', () => {
    const tab = createTabData();
    const plugin = {};
    const component = {};
    const forkRequestCallback = jest.fn();
    const openConversation = jest.fn();
    const getProviderCatalogConfig = jest.fn();
    const onProviderChanged = jest.fn();

    initializeChatTab(tab, plugin as never, {
      component: component as never,
      forkRequestCallback,
      getProviderCatalogConfig,
      onProviderChanged,
      openConversation,
    });

    expect(tabInternals.initializeTabUI).toHaveBeenCalledWith(tab, plugin, {
      getProviderCatalogConfig,
      onProviderChanged,
    });
    expect(tabInternals.initializeTabControllers).toHaveBeenCalledWith(
      tab,
      plugin,
      component,
      forkRequestCallback,
      openConversation,
      getProviderCatalogConfig,
    );
    expect(tabInternals.wireTabInputEvents).toHaveBeenCalledWith(tab, plugin);
  });

  it('initializes runtime and wires callbacks through one entry point', async () => {
    const tab = createTabData();
    const plugin = {};
    const conversation = { id: 'conversation-1', messages: [] };

    await ensureChatTabRuntime(tab, plugin as never, {
      conversation: conversation as never,
    });

    expect(tabInternals.initializeTabService).toHaveBeenCalledWith(tab, plugin, conversation);
    expect(tabInternals.setupServiceCallbacks).toHaveBeenCalledWith(tab, plugin);
  });

  it('delegates activation and teardown through lifecycle commands', async () => {
    const tab = createTabData();

    activateChatTab(tab);
    deactivateChatTab(tab);
    await destroyChatTab(tab);

    expect(tabInternals.activateTab).toHaveBeenCalledWith(tab);
    expect(tabInternals.deactivateTab).toHaveBeenCalledWith(tab);
    expect(tabInternals.destroyTab).toHaveBeenCalledWith(tab);
  });

  it('keeps provider refresh and selector refresh behind lifecycle helpers', () => {
    const tab = createTabData();
    const plugin = {};

    refreshChatTabProvider(tab, plugin as never);
    refreshChatTabSelectors(tab, plugin as never);
    refreshChatTabAfterProviderAvailabilityChanged(tab, plugin as never);

    expect(tabInternals.refreshTabProviderUI).toHaveBeenCalledTimes(2);
    expect(tabInternals.refreshTabProviderUI).toHaveBeenCalledWith(tab, plugin);
    expect(tabInternals.applyProviderUIGating).toHaveBeenCalledWith(tab, plugin);
    expect(tabInternals.onProviderAvailabilityChanged).toHaveBeenCalledWith(tab, plugin);
  });
});
