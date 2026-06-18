import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { clearMimoDiscoveryState } from '../discoveryState';
import { sameStringList, sameStringMap } from '../internal/compareCollections';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
import {
  decodeMimoModelId,
  encodeMimoModelId,
  extractMimoModelVariantValue,
  isMimoModelSelectionId,
  MIMO_DEFAULT_THINKING_LEVEL,
  resolveMimoBaseModelRawId,
} from '../models';
import {
  getMimoProviderSettings,
  hasLegacyMimoDiscoveryFields,
  normalizeMimoPreferredThinkingByModel,
  normalizeMimoVisibleModels,
  updateMimoProviderSettings,
} from '../settings';
import { getMimoState } from '../types';

interface NormalizedSelection {
  baseModelId: string | null;
  variant: string | null;
}

const MIMO_ENV_HASH_KEYS = [
  'MIMO_CONFIG',
  'MIMO_DB',
  'MIMO_DISABLE_PROJECT_CONFIG',
  'XDG_DATA_HOME',
] as const;

function computeMimoEnvHash(envText: string): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return MIMO_ENV_HASH_KEYS
    .filter((key) => envVars[key])
    .map((key) => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

export const mimoSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return clearMimoDiscoveryState(settings);
  },

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'mimo');
    const currentHash = computeMimoEnvHash(envText);
    const savedHash = getMimoProviderSettings(settings).environmentHash;

    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conversation of conversations) {
      if (conversation.providerId !== 'mimo') {
        continue;
      }

      const state = getMimoState(conversation.providerState);
      if (!conversation.sessionId && !state.databasePath) {
        continue;
      }

      conversation.sessionId = null;
      conversation.providerState = undefined;
      invalidatedConversations.push(conversation);
    }

    updateMimoProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const hadLegacyDiscoveryFields = hasLegacyMimoDiscoveryFields(settings);
    if (hadLegacyDiscoveryFields) {
      updateMimoProviderSettings(settings, {});
    }

    const mimoSettings = getMimoProviderSettings(settings);
    let changed = hadLegacyDiscoveryFields;

    const normalizeSelection = (value: unknown): NormalizedSelection => {
      if (typeof value !== 'string' || !isMimoModelSelectionId(value)) {
        return { baseModelId: null, variant: null };
      }

      const rawModelId = decodeMimoModelId(value);
      if (!rawModelId) {
        return { baseModelId: value, variant: null };
      }

      const baseRawId = resolveMimoBaseModelRawId(rawModelId, mimoSettings.discoveredModels);
      return {
        baseModelId: encodeMimoModelId(baseRawId),
        variant: extractMimoModelVariantValue(rawModelId, mimoSettings.discoveredModels),
      };
    };

    const modelSelection = normalizeSelection(settings.model);
    if (typeof settings.model === 'string' && modelSelection.baseModelId && settings.model !== modelSelection.baseModelId) {
      settings.model = modelSelection.baseModelId;
      changed = true;
    }
    if (
      modelSelection.variant
      && (typeof settings.effortLevel !== 'string' || settings.effortLevel.trim().length === 0)
    ) {
      settings.effortLevel = modelSelection.variant;
      changed = true;
    }

    const titleModelSelection = normalizeSelection(settings.titleGenerationModel);
    if (
      typeof settings.titleGenerationModel === 'string'
      && titleModelSelection.baseModelId
      && settings.titleGenerationModel !== titleModelSelection.baseModelId
    ) {
      settings.titleGenerationModel = titleModelSelection.baseModelId;
      changed = true;
    }

    const savedProviderModelRaw = settings.savedProviderModel;
    if (savedProviderModelRaw && typeof savedProviderModelRaw === 'object' && !Array.isArray(savedProviderModelRaw)) {
      const savedProviderModel = savedProviderModelRaw as Record<string, unknown>;
      const savedSelection = normalizeSelection(savedProviderModel.mimo);
      if (
        typeof savedProviderModel.mimo === 'string'
        && savedSelection.baseModelId
        && savedProviderModel.mimo !== savedSelection.baseModelId
      ) {
        savedProviderModel.mimo = savedSelection.baseModelId;
        changed = true;
      }
      if (savedSelection.variant) {
        const savedEffort = ensureProviderProjectionMap(settings, 'savedProviderEffort');
        if (typeof savedEffort.mimo !== 'string') {
          savedEffort.mimo = savedSelection.variant;
          changed = true;
        }
      }
    }

    const normalizedVisibleModels = normalizeMimoVisibleModels(
      mimoSettings.visibleModels,
      mimoSettings.discoveredModels,
    );
    const normalizedPreferredThinking = normalizeMimoPreferredThinkingByModel(
      mimoSettings.preferredThinkingByModel,
      mimoSettings.discoveredModels,
    );
    const shouldUpdateProviderSettings = !sameStringList(normalizedVisibleModels, mimoSettings.visibleModels)
      || !sameStringMap(normalizedPreferredThinking, mimoSettings.preferredThinkingByModel);
    if (shouldUpdateProviderSettings) {
      updateMimoProviderSettings(settings, {
        preferredThinkingByModel: normalizedPreferredThinking,
        visibleModels: normalizedVisibleModels,
      });
      changed = true;
    }

    if (typeof settings.effortLevel === 'string' && !settings.effortLevel.trim()) {
      settings.effortLevel = MIMO_DEFAULT_THINKING_LEVEL;
      changed = true;
    }

    return changed;
  },
};
