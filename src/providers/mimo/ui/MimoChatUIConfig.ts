import type {
  ProviderChatUIConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { MIMO_PROVIDER_ICON } from '../../../shared/icons';
import {
  buildMimoBaseModels,
  decodeMimoModelId,
  encodeMimoModelId,
  isMimoModelSelectionId,
  MIMO_DEFAULT_THINKING_LEVEL,
  MIMO_SYNTHETIC_MODEL_ID,
  resolveMimoBaseModelRawId,
} from '../models';
import {
  getManagedMimoModes,
  MIMO_BUILD_MODE_ID,
  MIMO_PLAN_MODE_ID,
  resolveMimoModeForPermissionMode,
} from '../modes';
import { MimoChatRuntime } from '../runtime/MimoChatRuntime';
import { getMimoProviderSettings, updateMimoProviderSettings } from '../settings';

const MIMO_MODELS: ProviderUIOption[] = [
  { value: MIMO_SYNTHETIC_MODEL_ID, label: 'MiMo-Code', description: 'ACP runtime' },
];
const DEFAULT_CONTEXT_WINDOW = 200_000;
const MIMO_METADATA_WARMUP_DB = ':memory:';

export const mimoChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const mimoSettings = getMimoProviderSettings(settings);
    const applyAlias = (rawId: string, option: ProviderUIOption): ProviderUIOption => {
      const alias = mimoSettings.modelAliases[rawId];
      return alias ? { ...option, label: alias } : option;
    };
    const discoveredModels = new Map(buildMimoBaseModels(mimoSettings.discoveredModels).map((model) => [
      encodeMimoModelId(model.rawId),
      applyAlias(model.rawId, {
        description: model.description ?? 'ACP runtime',
        label: model.label,
        value: encodeMimoModelId(model.rawId),
      }),
    ]));
    const savedProviderModel = (
      settings.savedProviderModel
      && typeof settings.savedProviderModel === 'object'
      && !Array.isArray(settings.savedProviderModel)
    )
      ? settings.savedProviderModel as Record<string, unknown>
      : null;

    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];
    for (const rawModelId of mimoSettings.visibleModels) {
      const encodedModelId = encodeMimoModelId(rawModelId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        discoveredModels.get(encodedModelId)
          ?? applyAlias(rawModelId, {
            description: 'Configured model',
            label: rawModelId,
            value: encodedModelId,
          }),
      );
    }

    const selectedModelValues = [
      typeof settings.model === 'string' ? settings.model : '',
      typeof savedProviderModel?.mimo === 'string'
        ? savedProviderModel.mimo
        : '',
    ];

    for (const model of selectedModelValues) {
      const rawModelId = decodeMimoModelId(model);
      if (
        !model
        || !isMimoModelSelectionId(model)
        || model === MIMO_SYNTHETIC_MODEL_ID
        || !rawModelId
      ) {
        continue;
      }

      const baseRawId = resolveMimoBaseModelRawId(rawModelId, mimoSettings.discoveredModels);
      const baseModelId = encodeMimoModelId(baseRawId);
      pushOption(
        options,
        seenValues,
        baseModelId,
        discoveredModels.get(baseModelId)
          ?? applyAlias(baseRawId, {
            description: 'Selected in an existing session',
            label: baseRawId,
            value: baseModelId,
          }),
      );
    }

    return options.length > 0 ? options : [...MIMO_MODELS];
  },

  ownsModel(model: string): boolean {
    return isMimoModelSelectionId(model);
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return getMimoThinkingOptions(model, settings).length > 0;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return getMimoThinkingOptions(model, settings)
      .map((variant) => ({
        description: variant.description,
        label: variant.label,
        value: variant.value,
      }));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeMimoModelId(model);
    if (!rawModelId) {
      return MIMO_DEFAULT_THINKING_LEVEL;
    }

    const mimoSettings = getMimoProviderSettings(settings);
    const baseRawId = resolveMimoBaseModelRawId(rawModelId, mimoSettings.discoveredModels);
    return getDefaultThinkingLevelForModel(baseRawId, settings);
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isMimoModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeMimoModelId(model);
    if (!rawModelId) {
      settingsBag.effortLevel = MIMO_DEFAULT_THINKING_LEVEL;
      return;
    }

    const mimoSettings = getMimoProviderSettings(settingsBag);
    const baseRawId = resolveMimoBaseModelRawId(rawModelId, mimoSettings.discoveredModels);
    settingsBag.model = encodeMimoModelId(baseRawId);
    settingsBag.effortLevel = getDefaultThinkingLevelForModel(baseRawId, settingsBag);
  },

  async prepareModelMetadata(model: string, _settings: Record<string, unknown>, context): Promise<void> {
    const rawModelId = decodeMimoModelId(model);
    if (!rawModelId) {
      return;
    }

    const mimoSettings = getMimoProviderSettings(context.plugin.settings);
    const baseRawId = resolveMimoBaseModelRawId(rawModelId, mimoSettings.discoveredModels);
    if (baseRawId && mimoSettings.thinkingOptionsByModel[baseRawId]) {
      return;
    }

    const runtime = new MimoChatRuntime(context.plugin);
    try {
      runtime.syncConversationState({
        providerState: { databasePath: MIMO_METADATA_WARMUP_DB },
        sessionId: null,
      });
      await runtime.warmModelMetadata(model);
    } catch {
      // Metadata warmup is opportunistic; the first real turn can still discover it.
    } finally {
      runtime.cleanup();
    }
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeMimoModelId(model);
    if (!rawModelId) {
      return;
    }

    const mimoSettings = getMimoProviderSettings(settingsBag);
    const baseRawId = resolveMimoBaseModelRawId(rawModelId, mimoSettings.discoveredModels);
    const supportedValues = new Set(
      (mimoSettings.thinkingOptionsByModel[baseRawId] ?? []).map((variant) => variant.value),
    );
    const nextPreferredThinkingByModel = {
      ...mimoSettings.preferredThinkingByModel,
    };

    if (!value || value === MIMO_DEFAULT_THINKING_LEVEL || !supportedValues.has(value)) {
      delete nextPreferredThinkingByModel[baseRawId];
    } else {
      nextPreferredThinkingByModel[baseRawId] = value;
    }

    updateMimoProviderSettings(settingsBag, {
      preferredThinkingByModel: nextPreferredThinkingByModel,
    });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeMimoModelId(model);
    if (!rawModelId) {
      return model;
    }

    const mimoSettings = getMimoProviderSettings(settings);
    const baseRawId = resolveMimoBaseModelRawId(rawModelId, mimoSettings.discoveredModels);
    return encodeMimoModelId(baseRawId);
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(settings) {
    const mimoSettings = getMimoProviderSettings(settings);
    const modes = getManagedMimoModes(mimoSettings.availableModes);
    return {
      activeValue: MIMO_PLAN_MODE_ID,
      label: 'Mode',
      options: modes.map((mode) => ({
        description: mode.description,
        label: mode.id === MIMO_BUILD_MODE_ID ? 'Build' : 'Plan',
        value: mode.id,
      })),
      value: mimoSettings.selectedMode || MIMO_BUILD_MODE_ID,
    };
  },

  getPermissionModeToggle(): null {
    return null;
  },

  applyModeSelection(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const selectedMode = resolveMimoModeForPermissionMode(
      value,
      getMimoProviderSettings(settingsBag).availableModes,
    );
    settingsBag.permissionMode = selectedMode;
    updateMimoProviderSettings(settingsBag, { selectedMode });
  },

  getProviderIcon() {
    return MIMO_PROVIDER_ICON;
  },
};

function getDefaultThinkingLevelForModel(
  baseRawId: string,
  settings: Record<string, unknown>,
): string {
  const mimoSettings = getMimoProviderSettings(settings);
  const preferred = mimoSettings.preferredThinkingByModel[baseRawId];
  const supportedValues = new Set(
    (mimoSettings.thinkingOptionsByModel[baseRawId] ?? []).map((variant) => variant.value),
  );
  if (preferred && supportedValues.has(preferred)) {
    return preferred;
  }

  return mimoSettings.thinkingOptionsByModel[baseRawId]?.[0]?.value
    ?? MIMO_DEFAULT_THINKING_LEVEL;
}

function getMimoThinkingOptions(
  model: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  const rawModelId = decodeMimoModelId(model);
  if (!rawModelId) {
    return [];
  }

  const mimoSettings = getMimoProviderSettings(settings);
  const baseRawId = resolveMimoBaseModelRawId(rawModelId, mimoSettings.discoveredModels);
  return mimoSettings.thinkingOptionsByModel[baseRawId] ?? [];
}

function pushOption(
  target: ProviderUIOption[],
  seenValues: Set<string>,
  value: string,
  option: ProviderUIOption,
): void {
  if (seenValues.has(value)) {
    return;
  }

  seenValues.add(value);
  target.push(option);
}
