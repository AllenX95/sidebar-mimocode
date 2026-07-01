import type { Component } from 'obsidian';

import type { ProviderId } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import type SidebarMimocodePlugin from '../../../main';
import {
  activateTab,
  applyProviderUIGating,
  createTab,
  deactivateTab,
  destroyTab,
  type ForkContext,
  initializeTabControllers,
  initializeTabService,
  initializeTabUI,
  onProviderAvailabilityChanged,
  type ProviderCatalogInfo,
  refreshTabProviderUI,
  setupServiceCallbacks,
  updatePlanModeUI,
  wireTabInputEvents,
} from './TabInternals';
import type { TabData } from './types';

export type ChatTabCreateOptions = Parameters<typeof createTab>[0];

export interface InitializeChatTabOptions {
  component: Component;
  forkRequestCallback?: (forkContext: ForkContext) => Promise<void>;
  getProviderCatalogConfig?: () => ProviderCatalogInfo;
  onProviderChanged?: (providerId: ProviderId) => void | Promise<void>;
  openConversation?: (conversationId: string) => Promise<void>;
}

export interface EnsureChatTabRuntimeOptions {
  conversation?: Conversation | null;
}

export function createChatTab(options: ChatTabCreateOptions): TabData {
  return createTab(options);
}

export function initializeChatTab(
  tab: TabData,
  plugin: SidebarMimocodePlugin,
  options: InitializeChatTabOptions,
): void {
  initializeTabUI(tab, plugin, {
    getProviderCatalogConfig: options.getProviderCatalogConfig,
    onProviderChanged: options.onProviderChanged,
  });
  initializeTabControllers(
    tab,
    plugin,
    options.component,
    options.forkRequestCallback,
    options.openConversation,
    options.getProviderCatalogConfig,
  );
  wireTabInputEvents(tab, plugin);
}

export async function ensureChatTabRuntime(
  tab: TabData,
  plugin: SidebarMimocodePlugin,
  options: EnsureChatTabRuntimeOptions = {},
): Promise<void> {
  await initializeTabService(tab, plugin, options.conversation);
  setupServiceCallbacks(tab, plugin);
}

export function activateChatTab(tab: TabData): void {
  activateTab(tab);
}

export function deactivateChatTab(tab: TabData): void {
  deactivateTab(tab);
}

export async function destroyChatTab(tab: TabData): Promise<void> {
  await destroyTab(tab);
}

export function refreshChatTabProvider(
  tab: TabData,
  plugin: SidebarMimocodePlugin,
): void {
  refreshTabProviderUI(tab, plugin);
  applyProviderUIGating(tab, plugin);
}

export function refreshChatTabAfterProviderAvailabilityChanged(
  tab: TabData,
  plugin: SidebarMimocodePlugin,
): void {
  onProviderAvailabilityChanged(tab, plugin);
}

export function refreshChatTabSelectors(
  tab: TabData,
  plugin: SidebarMimocodePlugin,
): void {
  refreshTabProviderUI(tab, plugin);
}

export function updateChatTabPlanModeUI(
  tab: TabData,
  plugin: SidebarMimocodePlugin,
  mode: string,
): void {
  updatePlanModeUI(tab, plugin, mode);
}
