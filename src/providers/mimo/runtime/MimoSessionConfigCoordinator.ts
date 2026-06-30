import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ChatRuntimeQueryOptions } from '../../../core/runtime/types';
import type {
  AcpSessionConfigOption,
  AcpSessionModelState,
  AcpSessionModeState,
  AcpSetSessionConfigOptionRequest,
  AcpSetSessionConfigOptionResponse,
} from '../../acp';
import {
  extractAcpSessionModelState,
  extractAcpSessionModeState,
  extractAcpSessionThoughtLevelState,
} from '../../acp';
import { updateMimoDiscoveryState } from '../discoveryState';
import {
  sameDiscoveredModels,
  sameModes,
  sameStringList,
  sameStringMap,
  sameThinkingOptionsByModel,
} from '../internal/compareCollections';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
import {
  decodeMimoModelId,
  encodeMimoModelId,
  isMimoModelSelectionId,
  MIMO_DEFAULT_THINKING_LEVEL,
  MIMO_SYNTHETIC_MODEL_ID,
  normalizeMimoDiscoveredModels,
  normalizeMimoModelVariants,
  resolveMimoBaseModelRawId,
} from '../models';
import {
  getManagedMimoModes,
  isManagedMimoModeId,
  normalizeMimoAvailableModes,
  resolveMimoModeForPermissionMode,
  resolvePermissionModeForManagedMimoMode,
} from '../modes';
import { getMimoProviderSettings, updateMimoProviderSettings } from '../settings';

export interface MimoSessionConfigConnection {
  setConfigOption(
    request: AcpSetSessionConfigOptionRequest,
  ): Promise<AcpSetSessionConfigOptionResponse>;
}

export interface MimoSessionConfigCoordinatorDeps {
  onPermissionModeSync: (permissionMode: string) => void;
  refreshModelSelectors: () => void;
  saveSettings: () => Promise<void>;
  settings: Record<string, unknown>;
}

export class MimoSessionConfigCoordinator {
  private readonly providerId = 'mimo' as const;
  private currentSessionEffortConfigId: string | null = null;
  private currentSessionEffortValue: string | null = null;
  private currentSessionEffortValues = new Set<string>();
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;

  constructor(private readonly deps: MimoSessionConfigCoordinatorDeps) {}

  resetSessionState(): void {
    this.currentSessionEffortConfigId = null;
    this.currentSessionEffortValue = null;
    this.currentSessionEffortValues = new Set<string>();
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
  }

  async syncFromSessionStart(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    models?: AcpSessionModelState | null;
    modes?: AcpSessionModeState | null;
  }): Promise<void> {
    await this.syncSessionModelState({
      configOptions: params.configOptions ?? null,
      models: params.models ?? null,
    });
    await this.syncSessionModeState({
      configOptions: params.configOptions ?? null,
      modes: params.modes ?? null,
    });
  }

  async syncFromConfigOptions(params: {
    configOptions: AcpSessionConfigOption[];
  }): Promise<void> {
    await this.syncSessionModelState({
      configOptions: params.configOptions,
    });
    await this.syncSessionModeState({
      configOptions: params.configOptions,
    });
  }

  async syncCurrentMode(params: {
    currentModeId: string | null;
  }): Promise<void> {
    await this.syncSessionModeState({
      currentModeId: params.currentModeId,
    });
  }

  async applyBeforePrompt(params: {
    connection: MimoSessionConfigConnection;
    queryOptions?: ChatRuntimeQueryOptions;
    sessionId: string;
  }): Promise<void> {
    await this.applySelectedMode(params.connection, params.sessionId);
    await this.applySelectedModel(params.connection, params.sessionId, params.queryOptions);
    await this.applySelectedEffort(params.connection, params.sessionId);
  }

  getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string | undefined {
    const providerSettings = this.getProviderSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (
      selectedModel
      && selectedModel !== MIMO_SYNTHETIC_MODEL_ID
      && isMimoModelSelectionId(selectedModel)
    ) {
      const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
      return selectedRawModelId
        ? encodeMimoModelId(selectedRawModelId)
        : selectedModel;
    }

    return this.currentSessionModelId
      ? encodeMimoModelId(this.currentSessionModelId)
      : (selectedModel && isMimoModelSelectionId(selectedModel) ? selectedModel : undefined);
  }

  async warmModelMetadata(params: {
    connection: MimoSessionConfigConnection;
    model: string;
    sessionId: string;
  }): Promise<boolean> {
    const selectedRawModelId = decodeMimoModelId(params.model);
    if (!selectedRawModelId) {
      return false;
    }

    const discoveredModels = getMimoProviderSettings(this.deps.settings).discoveredModels;
    const selectedBaseRawModelId = resolveMimoBaseModelRawId(selectedRawModelId, discoveredModels);
    if (!selectedBaseRawModelId) {
      return false;
    }

    const availableModelIds = new Set(discoveredModels.map((entry) => entry.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(selectedBaseRawModelId)) {
      return false;
    }

    const response = await params.connection.setConfigOption({
      configId: 'model',
      sessionId: params.sessionId,
      type: 'select',
      value: selectedBaseRawModelId,
    });
    this.currentSessionModelId = selectedBaseRawModelId;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    });
    return true;
  }

  private getProviderSettings(): Record<string, unknown> {
    return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.deps.settings,
      this.providerId,
    );
  }

  private resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const providerSettings = this.getProviderSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (!isMimoModelSelectionId(selectedModel)) {
      return null;
    }

    const selectedBaseRawModelId = decodeMimoModelId(selectedModel);
    if (!selectedBaseRawModelId) {
      return null;
    }

    const discoveredModels = getMimoProviderSettings(providerSettings).discoveredModels;
    const normalizedBaseRawModelId = resolveMimoBaseModelRawId(selectedBaseRawModelId, discoveredModels);
    if (!normalizedBaseRawModelId) {
      return null;
    }

    const availableModelIds = new Set(discoveredModels.map((model) => model.rawId));
    if (availableModelIds.size > 0 && !availableModelIds.has(normalizedBaseRawModelId)) {
      return null;
    }

    return normalizedBaseRawModelId;
  }

  private resolveSelectedModeId(): string | null {
    const providerSettings = this.getProviderSettings();
    const mimoSettings = getMimoProviderSettings(providerSettings);
    const availableModes = getManagedMimoModes(mimoSettings.availableModes);
    const mappedModeId = resolveMimoModeForPermissionMode(
      providerSettings.permissionMode,
      mimoSettings.availableModes,
    );
    if (mappedModeId) {
      return mappedModeId;
    }

    if (mimoSettings.selectedMode) {
      if (
        availableModes.some((mode) => mode.id === mimoSettings.selectedMode)
      ) {
        return mimoSettings.selectedMode;
      }
    }

    return availableModes[0]?.id || null;
  }

  private async applySelectedMode(
    connection: MimoSessionConfigConnection,
    sessionId: string,
  ): Promise<void> {
    const selectedModeId = this.resolveSelectedModeId();
    if (!selectedModeId || selectedModeId === this.currentSessionModeId) {
      return;
    }

    const response = await connection.setConfigOption({
      configId: 'mode',
      sessionId,
      type: 'select',
      value: selectedModeId,
    });
    this.currentSessionModeId = selectedModeId;
    await this.syncSessionModeState({
      configOptions: response.configOptions,
    });
  }

  private async applySelectedModel(
    connection: MimoSessionConfigConnection,
    sessionId: string,
    queryOptions?: ChatRuntimeQueryOptions,
  ): Promise<void> {
    const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
    if (!selectedRawModelId || selectedRawModelId === this.currentSessionModelId) {
      return;
    }

    const response = await connection.setConfigOption({
      configId: 'model',
      sessionId,
      type: 'select',
      value: selectedRawModelId,
    });
    this.currentSessionModelId = selectedRawModelId;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    });
  }

  private resolveSelectedEffortValue(): string | null {
    const providerSettings = this.getProviderSettings();
    const selectedEffort = typeof providerSettings.effortLevel === 'string'
      ? providerSettings.effortLevel.trim()
      : '';
    if (!selectedEffort || selectedEffort === MIMO_DEFAULT_THINKING_LEVEL) {
      return null;
    }

    return this.currentSessionEffortValues.has(selectedEffort)
      ? selectedEffort
      : null;
  }

  private async applySelectedEffort(
    connection: MimoSessionConfigConnection,
    sessionId: string,
  ): Promise<void> {
    if (!this.currentSessionEffortConfigId) {
      return;
    }

    const selectedEffort = this.resolveSelectedEffortValue();
    if (!selectedEffort || selectedEffort === this.currentSessionEffortValue) {
      return;
    }

    const response = await connection.setConfigOption({
      configId: this.currentSessionEffortConfigId,
      sessionId,
      type: 'select',
      value: selectedEffort,
    });
    this.currentSessionEffortValue = selectedEffort;
    await this.syncSessionModelState({
      configOptions: response.configOptions,
    });
  }

  private async syncSessionModelState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    models?: AcpSessionModelState | null;
  }): Promise<void> {
    const acpState = extractAcpSessionModelState(params);
    const currentRawModelId = acpState.currentModelId ?? this.currentSessionModelId;
    const discoveredModels = normalizeMimoDiscoveredModels(
      acpState.availableModels.map((model) => ({
        ...(model.description ? { description: model.description } : {}),
        label: model.name,
        rawId: model.id,
      })),
    );
    if (currentRawModelId) {
      this.currentSessionModelId = currentRawModelId;
    }

    const settingsBag = this.deps.settings;
    const currentSettings = getMimoProviderSettings(settingsBag);
    const currentBaseRawModelId = currentRawModelId
      ? resolveMimoBaseModelRawId(currentRawModelId, discoveredModels)
      : null;
    const thoughtLevelState = extractAcpSessionThoughtLevelState(params);
    const currentThinkingOptions = normalizeMimoModelVariants(
      thoughtLevelState.availableLevels.map((level) => ({
        ...(level.description ? { description: level.description } : {}),
        label: level.name,
        value: level.id,
      })),
    );
    const currentThinkingLevel = thoughtLevelState.currentLevel;
    this.currentSessionEffortConfigId = currentThinkingOptions.length > 0
      ? thoughtLevelState.configId
      : null;
    this.currentSessionEffortValue = currentThinkingOptions.length > 0
      ? currentThinkingLevel
      : null;
    this.currentSessionEffortValues = new Set(currentThinkingOptions.map((option) => option.value));

    const nextThinkingOptionsByModel = { ...currentSettings.thinkingOptionsByModel };
    if (currentBaseRawModelId) {
      if (currentThinkingOptions.length > 0) {
        nextThinkingOptionsByModel[currentBaseRawModelId] = currentThinkingOptions;
      } else {
        delete nextThinkingOptionsByModel[currentBaseRawModelId];
      }
    }

    const nextVisibleModels = currentSettings.visibleModels.length === 0 && currentBaseRawModelId
      ? [currentBaseRawModelId]
      : currentSettings.visibleModels;
    const currentPreferredThinking = currentBaseRawModelId
      ? currentSettings.preferredThinkingByModel[currentBaseRawModelId]
      : '';
    const shouldSeedCurrentThinking = currentBaseRawModelId
      && currentThinkingLevel
      && (
        !currentPreferredThinking
        || (
          currentThinkingOptions.length > 0
          && !this.currentSessionEffortValues.has(currentPreferredThinking)
        )
      );
    const nextPreferredThinkingByModel = shouldSeedCurrentThinking && currentBaseRawModelId && currentThinkingLevel
      ? {
        ...currentSettings.preferredThinkingByModel,
        [currentBaseRawModelId]: currentThinkingLevel,
      }
      : currentSettings.preferredThinkingByModel;
    const shouldSeedVisibleModels = !sameStringList(currentSettings.visibleModels, nextVisibleModels);
    const shouldSeedPreferredThinking = !sameStringMap(
      currentSettings.preferredThinkingByModel,
      nextPreferredThinkingByModel,
    );
    const shouldUpdateDiscoveredModels = discoveredModels.length > 0
      && !sameDiscoveredModels(currentSettings.discoveredModels, discoveredModels);
    const shouldUpdateThinkingOptions = !sameThinkingOptionsByModel(
      currentSettings.thinkingOptionsByModel,
      nextThinkingOptionsByModel,
    );
    const discoveryChanged = shouldUpdateDiscoveredModels
      && updateMimoDiscoveryState(settingsBag, { discoveredModels });
    let changed = shouldSeedVisibleModels || shouldSeedPreferredThinking;

    if (currentBaseRawModelId) {
      const seeded = this.seedActiveModelSelection(
        settingsBag,
        encodeMimoModelId(currentBaseRawModelId),
        currentThinkingLevel,
      );
      changed = changed || seeded;
    }

    if (shouldUpdateThinkingOptions || shouldSeedPreferredThinking || shouldSeedVisibleModels) {
      updateMimoProviderSettings(settingsBag, {
        ...(shouldSeedPreferredThinking ? { preferredThinkingByModel: nextPreferredThinkingByModel } : {}),
        ...(shouldUpdateThinkingOptions ? { thinkingOptionsByModel: nextThinkingOptionsByModel } : {}),
        ...(shouldSeedVisibleModels ? { visibleModels: nextVisibleModels } : {}),
      });
    }

    if (!changed && !discoveryChanged && !shouldUpdateThinkingOptions) {
      return;
    }

    if (changed || shouldUpdateThinkingOptions) {
      await this.deps.saveSettings();
    }
    this.deps.refreshModelSelectors();
  }

  private seedActiveModelSelection(
    settingsBag: Record<string, unknown>,
    modelSelection: string,
    thinkingLevel: string | null,
  ): boolean {
    let changed = false;
    const savedProviderModel = ensureProviderProjectionMap(settingsBag, 'savedProviderModel');
    const savedModel = typeof savedProviderModel.mimo === 'string'
      ? savedProviderModel.mimo
      : '';
    if (!savedModel || savedModel === MIMO_SYNTHETIC_MODEL_ID) {
      savedProviderModel.mimo = modelSelection;
      changed = true;
    }

    if (thinkingLevel) {
      const savedProviderEffort = ensureProviderProjectionMap(settingsBag, 'savedProviderEffort');
      const savedEffort = typeof savedProviderEffort.mimo === 'string'
        ? savedProviderEffort.mimo.trim()
        : '';
      if (!savedEffort || savedEffort === MIMO_DEFAULT_THINKING_LEVEL) {
        savedProviderEffort.mimo = thinkingLevel;
        changed = true;
      }
    }

    if (ProviderRegistry.resolveSettingsProviderId(settingsBag) !== this.providerId) {
      return changed;
    }

    const activeModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
    if (!activeModel || activeModel === MIMO_SYNTHETIC_MODEL_ID) {
      settingsBag.model = modelSelection;
      changed = true;
    }
    if (thinkingLevel) {
      const activeEffort = typeof settingsBag.effortLevel === 'string' ? settingsBag.effortLevel : '';
      if (!activeEffort || activeEffort === MIMO_DEFAULT_THINKING_LEVEL) {
        settingsBag.effortLevel = thinkingLevel;
        changed = true;
      }
    }
    return changed;
  }

  private async syncSessionModeState(params: {
    configOptions?: AcpSessionConfigOption[] | null;
    currentModeId?: string | null;
    modes?: AcpSessionModeState | null;
  }): Promise<void> {
    const acpState = extractAcpSessionModeState(params);
    const availableModes = normalizeMimoAvailableModes(acpState.availableModes);
    const currentModeId = params.currentModeId ?? acpState.currentModeId;
    if (currentModeId) {
      this.currentSessionModeId = currentModeId;
      this.emitPermissionModeSync(currentModeId);
    }

    const settingsBag = this.deps.settings;
    const currentSettings = getMimoProviderSettings(settingsBag);
    const shouldSeedSelectedMode = typeof currentModeId === 'string'
      && !currentSettings.selectedMode
      && isManagedMimoModeId(currentModeId);
    const discoveryChanged = availableModes.length > 0
      && !sameModes(currentSettings.availableModes, availableModes)
      && updateMimoDiscoveryState(settingsBag, { availableModes });

    if (!discoveryChanged && !shouldSeedSelectedMode) {
      return;
    }

    if (shouldSeedSelectedMode && currentModeId) {
      updateMimoProviderSettings(settingsBag, { selectedMode: currentModeId });
      await this.deps.saveSettings();
    }
    this.deps.refreshModelSelectors();
  }

  private emitPermissionModeSync(modeId: string): void {
    const permissionMode = resolvePermissionModeForManagedMimoMode(modeId);
    if (!permissionMode) {
      return;
    }

    this.deps.onPermissionModeSync(permissionMode);
  }
}
