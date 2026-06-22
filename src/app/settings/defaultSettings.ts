import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { type SidebarMimocodeSettings } from '../../core/types/settings';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';
import { MIMO_SYNTHETIC_MODEL_ID } from '../../providers/mimo/models';

export const DEFAULT_SIDEBAR_MIMOCODE_SETTINGS: SidebarMimocodeSettings = {
  userName: '',

  permissionMode: 'build',

  model: MIMO_SYNTHETIC_MODEL_ID,
  thinkingBudget: 'off',
  effortLevel: 'high',
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',
  persistentExternalContextPaths: [],

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  locale: 'en',

  providerConfigs: getBuiltInProviderDefaultConfigs(),

  settingsProvider: 'mimo',
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},

  lastCustomModel: '',

  maxTabs: 3,
  enableAutoScroll: true,
  deferMathRenderingDuringStreaming: true,
  expandFileEditsByDefault: false,
  chatViewPlacement: 'right-sidebar',

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),
};
