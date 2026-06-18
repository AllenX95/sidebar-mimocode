import * as fs from 'fs';
import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { maybeGetMimoWorkspaceServices } from '../app/MimoWorkspaceServices';
import { clearMimoDiscoveryState } from '../discoveryState';
import { sameStringList } from '../internal/compareCollections';
import {
  buildMimoBaseModels,
  encodeMimoModelId,
  type MimoDiscoveredModel,
  splitMimoModelLabel,
} from '../models';
import { MimoChatRuntime } from '../runtime/MimoChatRuntime';
import {
  getMimoProviderSettings,
  MIMO_DEFAULT_ENVIRONMENT_VARIABLES,
  normalizeMimoVisibleModels,
  updateMimoProviderSettings,
} from '../settings';
import { MimoAgentSettings } from './MimoAgentSettings';

const ALL_PROVIDERS_KEY = 'all';
const MIMO_METADATA_WARMUP_DB = ':memory:';

interface EnrichedModel {
  description: string;
  isAvailable: boolean;
  modelLabel: string;
  providerKey: string;
  providerLabel: string;
  rawId: string;
}

export const mimoSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const mimoWorkspace = maybeGetMimoWorkspaceServices();
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const mimoSettings = getMimoProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName('Setup').setHeading();

    new Setting(container)
      .setName('Enable MiMo-Code')
      .setDesc('Launch `mimo acp` as a provider.')
      .addToggle((toggle) =>
        toggle
          .setValue(mimoSettings.enabled)
          .onChange(async (value) => {
            updateMimoProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    const cliPathSetting = new Setting(container)
      .setName('CLI path')
      .setDesc('Optional absolute path to the MiMo-Code CLI for this computer. Leave empty to use `mimo` from PATH.');

    const validationEl = container.createDiv({
      cls: 'sidebar-mimocode-cli-path-validation sidebar-mimocode-setting-validation sidebar-mimocode-setting-validation-error sidebar-mimocode-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const expandedPath = expandHomePath(trimmed);
      if (!fs.existsSync(expandedPath)) {
        return 'Path does not exist';
      }

      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return 'Path must point to a file';
      }

      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('sidebar-mimocode-hidden', false);
        if (inputEl) {
          inputEl.toggleClass('sidebar-mimocode-input-error', true);
        }
        return false;
      }

      validationEl.toggleClass('sidebar-mimocode-hidden', true);
      if (inputEl) {
        inputEl.toggleClass('sidebar-mimocode-input-error', false);
      }
      return true;
    };

    const cliPathsByHost = { ...mimoSettings.cliPathsByHost };
    const currentValue = mimoSettings.cliPathsByHost[hostnameKey] || '';
    let cliPathInputEl: HTMLInputElement | null = null;

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) {
        return false;
      }

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }

      updateMimoProviderSettings(settingsBag, { cliPathsByHost: { ...cliPathsByHost } });
      clearMimoDiscoveryState(settingsBag);
      await context.plugin.saveSettings();
      mimoWorkspace?.cliResolver?.reset();
      await recycleMimoRuntime();
      return true;
    };

    const recycleMimoRuntime = async (): Promise<void> => {
      for (const view of context.plugin.getAllViews()) {
        const tabManager = view.getTabManager();
        if (tabManager?.broadcastToProviderTabs) {
          await tabManager.broadcastToProviderTabs('mimo', (service) => Promise.resolve(service.cleanup()));
        } else {
          await tabManager?.broadcastToAllTabs(
            (service) => Promise.resolve(service.cleanup()),
          );
        }
        view.invalidateProviderCommandCaches?.(['mimo']);
        view.refreshModelSelector?.();
      }
    };

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder(process.platform === 'win32'
          ? 'C:\\Users\\you\\AppData\\Roaming\\npm\\mimo.cmd'
          : '/usr/local/bin/mimo')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });

      text.inputEl.addClass('sidebar-mimocode-settings-cli-path-input');
      cliPathInputEl = text.inputEl;

      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container).setName('Models').setHeading();

    new Setting(container)
      .setName('Visible models')
      .setDesc('Choose which MiMo-Code models appear in the chat selector. Filter by provider or type to search. The current session model stays pinned even if it is not selected here.');

    const pickerEl = container.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker' });

    let searchQuery = '';
    let providerFilter = ALL_PROVIDERS_KEY;

    const summaryEl = pickerEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-summary' });
    const selectedEl = pickerEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-selected' });
    const catalogEl = pickerEl.createEl('details', { cls: 'sidebar-mimocode-mimo-model-picker-catalog' });
    catalogEl.open = getMimoProviderSettings(settingsBag).visibleModels.length === 0;
    const catalogSummaryEl = catalogEl.createEl('summary', {
      cls: 'sidebar-mimocode-mimo-model-picker-catalog-summary',
    });
    catalogSummaryEl.createSpan({
      cls: 'sidebar-mimocode-mimo-model-picker-catalog-caret',
      text: '▸',
    });
    catalogSummaryEl.createSpan({
      cls: 'sidebar-mimocode-mimo-model-picker-catalog-title',
      text: 'Browse models',
    });
    const catalogSummaryCountEl = catalogSummaryEl.createSpan({
      cls: 'sidebar-mimocode-mimo-model-picker-catalog-count',
    });

    const controlsEl = catalogEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-controls' });

    const searchInput = controlsEl.createEl('input', {
      cls: 'sidebar-mimocode-mimo-model-picker-search',
      type: 'search',
    });
    searchInput.placeholder = 'Filter by model, provider, or ID…';
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderList();
    });

    const providerSelectEl = controlsEl.createEl('select', {
      cls: 'sidebar-mimocode-mimo-model-picker-provider',
    });
    providerSelectEl.addEventListener('change', () => {
      providerFilter = providerSelectEl.value;
      renderList();
    });

    const listEl = catalogEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-list' });
    let loadingModelCatalog = false;
    let modelCatalogLoadFailed = false;

    const getEnrichedModels = (): EnrichedModel[] => {
      const current = getMimoProviderSettings(settingsBag);
      return buildEnrichedModels(current.discoveredModels, current.visibleModels);
    };

    const filterModels = (models: EnrichedModel[]): EnrichedModel[] => {
      return models.filter((model) => {
        if (providerFilter !== ALL_PROVIDERS_KEY && model.providerKey !== providerFilter) {
          return false;
        }

        if (!searchQuery) {
          return true;
        }

        return (
          model.rawId.toLowerCase().includes(searchQuery)
          || model.modelLabel.toLowerCase().includes(searchQuery)
          || model.providerLabel.toLowerCase().includes(searchQuery)
          || model.description.toLowerCase().includes(searchQuery)
        );
      });
    };

    const persistVisibleModels = async (visibleModels: string[]): Promise<void> => {
      const currentVisibleModels = getMimoProviderSettings(settingsBag).visibleModels;
      const normalized = normalizeMimoVisibleModels(
        visibleModels,
        getMimoProviderSettings(settingsBag).discoveredModels,
      );
      if (sameStringList(currentVisibleModels, normalized)) {
        return;
      }

      updateMimoProviderSettings(settingsBag, { visibleModels: normalized });
      await context.plugin.saveSettings();
      renderAll();
      context.refreshModelSelectors();
    };

    const persistModelMetadata = async (rawId: string): Promise<void> => {
      const runtime = new MimoChatRuntime(context.plugin);
      try {
        runtime.syncConversationState({
          providerState: { databasePath: MIMO_METADATA_WARMUP_DB },
          sessionId: null,
        });
        const loaded = await runtime.warmModelMetadata(encodeMimoModelId(rawId));
        if (loaded) {
          context.refreshModelSelectors();
        }
      } catch {
        // Metadata warmup is opportunistic; the first chat turn can still discover it.
      } finally {
        runtime.cleanup();
      }
    };

    const persistModelAliases = async (modelAliases: Record<string, string>): Promise<void> => {
      updateMimoProviderSettings(settingsBag, { modelAliases });
      await context.plugin.saveSettings();
      renderSelected();
      context.refreshModelSelectors();
    };

    const renderSummary = (): void => {
      summaryEl.empty();
      const current = getMimoProviderSettings(settingsBag);
      const enriched = getEnrichedModels();
      const providerCount = new Set(enriched.map((model) => model.providerKey)).size;
      const providerWord = providerCount === 1 ? 'provider' : 'providers';

      summaryEl.createSpan({ text: 'Visible: ' });
      summaryEl.createSpan({
        cls: 'sidebar-mimocode-mimo-model-picker-summary-value',
        text: String(current.visibleModels.length),
      });
      summaryEl.createSpan({
        text: ` of ${current.discoveredModels.length} discovered • ${providerCount} ${providerWord}`,
      });

      let catalogSummary = 'No models discovered yet';
      if (loadingModelCatalog) {
        catalogSummary = 'Loading models...';
      } else if (current.discoveredModels.length > 0) {
        catalogSummary = `${current.discoveredModels.length} available`;
      }
      catalogSummaryCountEl.setText(catalogSummary);
    };

    const renderSelected = (): void => {
      selectedEl.empty();
      const current = getMimoProviderSettings(settingsBag);
      if (current.visibleModels.length === 0) {
        selectedEl.toggleClass('sidebar-mimocode-hidden', true);
        return;
      }

      selectedEl.toggleClass('sidebar-mimocode-hidden', false);
      const enrichedByRawId = new Map(
        getEnrichedModels().map((model) => [model.rawId, model] as const),
      );

      const headerEl = selectedEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-selected-header' });
      headerEl.createEl('span', {
        cls: 'sidebar-mimocode-mimo-model-picker-selected-label',
        text: `Selected (${current.visibleModels.length})`,
      });
      const clearAllBtn = headerEl.createEl('button', {
        cls: 'sidebar-mimocode-mimo-model-picker-selected-clear',
        text: 'Clear all',
      });
      clearAllBtn.setAttribute('aria-label', 'Clear all selected models');
      clearAllBtn.addEventListener('click', () => {
        void persistVisibleModels([]);
      });

      const rowsEl = selectedEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-selected-rows' });

      for (const rawId of current.visibleModels) {
        const enriched = enrichedByRawId.get(rawId);
        const defaultLabel = enriched
          ? `${enriched.providerLabel}/${enriched.modelLabel}`
          : rawId;

        const rowEl = rowsEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-selected-row' });
        if (enriched && !enriched.isAvailable) {
          rowEl.classList.add('sidebar-mimocode-mimo-model-picker-selected-row--unavailable');
        }

        const infoEl = rowEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-selected-info' });
        const titleEl = infoEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-selected-title' });
        if (enriched) {
          titleEl.createEl('span', {
            cls: 'sidebar-mimocode-mimo-model-picker-selected-badge',
            text: enriched.providerLabel,
          });
          titleEl.createEl('span', {
            cls: 'sidebar-mimocode-mimo-model-picker-selected-name',
            text: enriched.modelLabel,
          });
        } else {
          titleEl.createEl('span', {
            cls: 'sidebar-mimocode-mimo-model-picker-selected-name',
            text: rawId,
          });
        }

        if (enriched && !enriched.isAvailable) {
          infoEl.createEl('div', {
            cls: 'sidebar-mimocode-mimo-model-picker-selected-unavailable',
            text: 'Not currently reported by MiMo-Code',
          });
        }

        infoEl.createEl('div', {
          cls: 'sidebar-mimocode-mimo-model-picker-selected-id',
          text: rawId,
        });

        const controlsEl = rowEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-selected-controls' });
        const aliasInput = controlsEl.createEl('input', {
          cls: 'sidebar-mimocode-mimo-model-picker-selected-alias',
          type: 'text',
        });
        aliasInput.placeholder = defaultLabel;
        aliasInput.value = current.modelAliases[rawId] ?? '';
        aliasInput.setAttribute('aria-label', `Alias for ${defaultLabel}`);
        aliasInput.title = 'Custom label shown in the model selector. Leave empty to use the default.';

        const commitAlias = (): void => {
          const latest = getMimoProviderSettings(settingsBag);
          const existing = latest.modelAliases[rawId] ?? '';
          const next = aliasInput.value.trim();
          if (next === existing) {
            aliasInput.value = existing;
            return;
          }

          const nextAliases = { ...latest.modelAliases };
          if (next) {
            nextAliases[rawId] = next;
          } else {
            delete nextAliases[rawId];
          }
          void persistModelAliases(nextAliases);
        };

        aliasInput.addEventListener('blur', commitAlias);
        aliasInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            aliasInput.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            aliasInput.value = getMimoProviderSettings(settingsBag).modelAliases[rawId] ?? '';
            aliasInput.blur();
          }
        });

        const removeBtn = controlsEl.createEl('button', {
          cls: 'sidebar-mimocode-mimo-model-picker-selected-remove',
          text: '×',
        });
        removeBtn.setAttribute('aria-label', `Remove ${defaultLabel}`);
        removeBtn.addEventListener('click', () => {
          void persistVisibleModels(current.visibleModels.filter((entry) => entry !== rawId));
        });
      }
    };

    const renderProviderSelect = (): void => {
      const enriched = getEnrichedModels();
      const providers = new Map<string, { count: number; label: string }>();
      for (const model of enriched) {
        const existing = providers.get(model.providerKey);
        if (existing) {
          existing.count += 1;
        } else {
          providers.set(model.providerKey, { count: 1, label: model.providerLabel });
        }
      }

      providerSelectEl.empty();
      providerSelectEl.createEl('option', {
        text: `All providers (${enriched.length})`,
        value: ALL_PROVIDERS_KEY,
      });

      const sortedProviders = Array.from(providers.entries())
        .sort(([, left], [, right]) => left.label.localeCompare(right.label));
      for (const [key, { count, label }] of sortedProviders) {
        providerSelectEl.createEl('option', {
          text: `${label} (${count})`,
          value: key,
        });
      }

      if (providerFilter !== ALL_PROVIDERS_KEY && !providers.has(providerFilter)) {
        providerFilter = ALL_PROVIDERS_KEY;
      }
      providerSelectEl.value = providerFilter;
    };

    const renderList = (): void => {
      listEl.empty();
      const current = getMimoProviderSettings(settingsBag);
      const selectedIds = new Set(current.visibleModels);
      const enriched = getEnrichedModels();
      const filtered = filterModels(enriched);

      if (filtered.length === 0) {
        const emptyEl = listEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-empty' });
        let emptyText = 'No models match your filter.';
        if (loadingModelCatalog) {
          emptyText = 'Loading MiMo-Code model catalog...';
        } else if (modelCatalogLoadFailed) {
          emptyText = 'Could not load the MiMo-Code model catalog. Check the CLI path and login state, then expand this section again.';
        } else if (enriched.length === 0) {
          emptyText = 'Start MiMo-Code once to load its model catalog. Sidebar MiMo-Code will then let you pick visible models.';
        }
        emptyEl.setText(emptyText);
        return;
      }

      for (const model of filtered) {
        const rowEl = listEl.createEl('label', { cls: 'sidebar-mimocode-mimo-model-picker-row' });
        const isSelected = selectedIds.has(model.rawId);
        if (isSelected) {
          rowEl.classList.add('sidebar-mimocode-mimo-model-picker-row--selected');
        }
        rowEl.title = model.rawId;

        const checkboxEl = rowEl.createEl('input', { type: 'checkbox' });
        checkboxEl.checked = isSelected;
        checkboxEl.addEventListener('change', () => {
          const currentVisibleModels = getMimoProviderSettings(settingsBag).visibleModels;
          const next = checkboxEl.checked
            ? [...currentVisibleModels, model.rawId]
            : currentVisibleModels.filter((id) => id !== model.rawId);
          void (async () => {
            await persistVisibleModels(next);
            if (checkboxEl.checked) {
              await persistModelMetadata(model.rawId);
            }
          })();
        });

        const textEl = rowEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-row-text' });

        const headerEl = textEl.createDiv({ cls: 'sidebar-mimocode-mimo-model-picker-row-header' });
        headerEl.createEl('span', {
          cls: 'sidebar-mimocode-mimo-model-picker-row-name',
          text: model.modelLabel,
        });
        const badgeEl = headerEl.createEl('span', {
          cls: 'sidebar-mimocode-mimo-model-picker-row-badge',
          text: model.providerLabel,
        });
        if (!model.isAvailable) {
          badgeEl.classList.add('sidebar-mimocode-mimo-model-picker-row-badge--unavailable');
          badgeEl.setText('Unavailable');
          badgeEl.title = 'Configured model not currently reported by MiMo-Code';
        }

        textEl.createDiv({
          cls: 'sidebar-mimocode-mimo-model-picker-row-meta',
          text: model.rawId,
        });

        if (model.description) {
          textEl.createDiv({
            cls: 'sidebar-mimocode-mimo-model-picker-row-desc',
            text: model.description,
          });
        }

      }
    };

    const renderAll = (): void => {
      renderSummary();
      renderSelected();
      renderProviderSelect();
      renderList();
    };

    renderAll();

    const loadModelCatalog = async (): Promise<void> => {
      if (loadingModelCatalog || getMimoProviderSettings(settingsBag).discoveredModels.length > 0) {
        return;
      }

      loadingModelCatalog = true;
      modelCatalogLoadFailed = false;
      renderAll();

      const runtime = new MimoChatRuntime(context.plugin);
      try {
        runtime.syncConversationState({
          providerState: { databasePath: MIMO_METADATA_WARMUP_DB },
          sessionId: null,
        });
        const loaded = await runtime.ensureReady({ allowSessionCreation: true });
        modelCatalogLoadFailed = !loaded || getMimoProviderSettings(settingsBag).discoveredModels.length === 0;
        if (!modelCatalogLoadFailed) {
          context.refreshModelSelectors();
        }
      } catch {
        modelCatalogLoadFailed = true;
      } finally {
        loadingModelCatalog = false;
        runtime.cleanup();
        renderAll();
      }
    };

    catalogEl.addEventListener('toggle', () => {
      if (catalogEl.open) {
        void loadModelCatalog();
      }
    });
    if (catalogEl.open) {
      void loadModelCatalog();
    }

    new Setting(container).setName('Commands and skills').setHeading();

    const commandsDesc = container.createDiv({ cls: 'sidebar-mimocode-sp-settings-desc' });
    commandsDesc.createEl('p', {
      cls: 'setting-item-description',
      text: 'MiMo-Code can auto-detect vault-level commands from .opencode/commands/ and skills from .opencode/skills/ and .agents/skills/. This setting only hides entries from the MiMo-Code dropdown.',
    });

    context.renderHiddenProviderCommandSetting(container, 'mimo', {
      name: 'Hidden Commands and Skills',
      desc: 'Hide specific MiMo-Code commands and skills from the dropdown. Enter names without the leading slash, one per line.',
      placeholder: 'compact\nreview\nfix',
    });

    if (mimoWorkspace?.agentStorage) {
      new Setting(container).setName('Subagents').setHeading();

      const subagentsDesc = container.createDiv({ cls: 'sidebar-mimocode-sp-settings-desc' });
      subagentsDesc.createEl('p', {
        cls: 'setting-item-description',
        text: 'Manage vault-level MiMo-Code subagents from .mimocode/agent/ and .mimocode/agents/. Legacy .mimo entries remain readable and move to the official path when edited.',
      });

      const subagentsContainer = container.createDiv({ cls: 'sidebar-mimocode-slash-commands-container' });
      new MimoAgentSettings(
        subagentsContainer,
        mimoWorkspace.agentStorage,
        context.plugin.app,
        async () => {
          await mimoWorkspace.refreshAgentMentions?.();
          await recycleMimoRuntime();
        },
      );
    }

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:mimo',
      heading: 'Environment',
      name: 'Environment Variables',
      desc: 'Extra environment variables passed to MiMo-Code. `MIMOCODE_ENABLE_EXA=1` is enabled by default.',
      placeholder: `${MIMO_DEFAULT_ENVIRONMENT_VARIABLES}\nMIMOCODE_DB=/path/to/mimocode.db`,
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'mimo'),
    });
  },
};

function buildEnrichedModels(
  discoveredModels: MimoDiscoveredModel[],
  visibleModels: string[],
): EnrichedModel[] {
  const enriched: EnrichedModel[] = [];
  const discoveredIds = new Set<string>();
  const baseModels = buildMimoBaseModels(discoveredModels);

  for (const model of baseModels) {
    const { modelLabel, providerLabel } = splitMimoModelLabel(model.label || model.rawId);
    discoveredIds.add(model.rawId);
    enriched.push({
      description: model.description ?? '',
      isAvailable: true,
      modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      rawId: model.rawId,
    });
  }

  for (const rawId of visibleModels) {
    if (discoveredIds.has(rawId)) {
      continue;
    }

    const { modelLabel, providerLabel } = splitMimoModelLabel(rawId);
    enriched.push({
      description: '',
      isAvailable: false,
      modelLabel,
      providerKey: providerLabel.toLowerCase(),
      providerLabel,
      rawId,
    });
  }

  return enriched.sort((left, right) => {
    const providerCmp = left.providerLabel.localeCompare(right.providerLabel);
    if (providerCmp !== 0) {
      return providerCmp;
    }
    return left.modelLabel.localeCompare(right.modelLabel);
  });
}
