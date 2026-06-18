import {
  SIDEBAR_MIMOCODE_SETTINGS_PATH,
} from '../../core/bootstrap/StoragePaths';
import {
  normalizeHiddenProviderCommands,
} from '../../core/providers/commands/hiddenCommands';
import {
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  resolveEnvironmentSnippetScope,
} from '../../core/providers/providerEnvironment';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import {
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  type EnvironmentScope,
  type EnvSnippet,
  type ProviderConfigMap,
  type SidebarMimocodeSettings,
} from '../../core/types/settings';
import {
  getMimoProviderSettings,
  updateMimoProviderSettings,
} from '../../providers/mimo/settings';
import { DEFAULT_SIDEBAR_MIMOCODE_SETTINGS } from './defaultSettings';

export {
  SIDEBAR_MIMOCODE_SETTINGS_PATH,
};

export type StoredSidebarMimocodeSettings = SidebarMimocodeSettings;

const LEGACY_STRIPPED_SETTING_FIELDS = [
  'activeConversationId',
  'show1MModel',
  'hiddenSlashCommands',
  'slashCommands',
  'allowExternalAccess',
  'allowedExportPaths',
  'enableBlocklist',
  'blockedCommands',
  'openInMainTab',
] as const;

function stripLegacyFields(settings: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...settings };
  for (const key of LEGACY_STRIPPED_SETTING_FIELDS) {
    delete cleaned[key];
  }
  return cleaned;
}

function isChatViewPlacement(value: unknown): value is ChatViewPlacement {
  return typeof value === 'string'
    && (CHAT_VIEW_PLACEMENTS as readonly string[]).includes(value);
}

function normalizeChatViewPlacement(
  value: unknown,
  legacyOpenInMainTab: unknown,
): ChatViewPlacement {
  if (isChatViewPlacement(value)) {
    return value;
  }

  if (typeof legacyOpenInMainTab === 'boolean') {
    return legacyOpenInMainTab ? 'main-tab' : 'right-sidebar';
  }

  return DEFAULT_SIDEBAR_MIMOCODE_SETTINGS.chatViewPlacement;
}

function shouldPersistChatViewPlacementMigration(
  stored: Record<string, unknown>,
  normalized: ChatViewPlacement,
): boolean {
  return 'openInMainTab' in stored
    || (
      'chatViewPlacement' in stored
      && stored.chatViewPlacement !== normalized
    );
}

function normalizeProviderConfigs(value: unknown): ProviderConfigMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: ProviderConfigMap = {};
  for (const [providerId, config] of Object.entries(value as Record<string, unknown>)) {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      result[providerId] = { ...(config as Record<string, unknown>) };
    }
  }
  return result;
}

function isEnvironmentScope(value: unknown): value is EnvironmentScope {
  return value === 'shared' || (typeof value === 'string' && value.startsWith('provider:'));
}

function normalizeContextLimits(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
      result[key] = entry;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, alias] of Object.entries(value)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const modelId = key.trim();
    const normalizedAlias = alias.trim();
    if (modelId && normalizedAlias) {
      result[modelId] = normalizedAlias;
    }
  }

  return result;
}

function normalizeEnvSnippets(value: unknown): EnvSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const snippets: EnvSnippet[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.description !== 'string'
      || typeof candidate.envVars !== 'string'
    ) {
      continue;
    }

    const modelAliases = 'modelAliases' in candidate
      ? normalizeModelAliases(candidate.modelAliases)
      : undefined;

    snippets.push({
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      envVars: candidate.envVars,
      scope: resolveEnvironmentSnippetScope(
        candidate.envVars,
        isEnvironmentScope(candidate.scope)
          ? candidate.scope
          : inferEnvironmentSnippetScope(candidate.envVars),
      ),
      contextLimits: normalizeContextLimits(candidate.contextLimits),
      modelAliases,
    });
  }

  return snippets;
}

export class SidebarMimocodeSettingsStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async load(): Promise<StoredSidebarMimocodeSettings> {
    const settingsPath = await this.getLoadPath();
    if (!settingsPath) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(settingsPath);
    const stored = JSON.parse(content) as Record<string, unknown>;
    const hiddenProviderCommands = normalizeHiddenProviderCommands(stored.hiddenProviderCommands);
    const envSnippets = normalizeEnvSnippets(stored.envSnippets);
    const customModelAliases = normalizeModelAliases(stored.customModelAliases);
    const providerConfigs = normalizeProviderConfigs(stored.providerConfigs);
    const chatViewPlacement = normalizeChatViewPlacement(
      stored.chatViewPlacement,
      stored.openInMainTab,
    );
    const legacyProviderSettings = {
      ...stored,
      hiddenProviderCommands,
      providerConfigs,
    };
    const storedWithoutLegacy = stripLegacyFields({
      ...legacyProviderSettings,
    });

    const legacyNormalized = {
      ...storedWithoutLegacy,
      sharedEnvironmentVariables: getSharedEnvironmentVariables(legacyProviderSettings),
      envSnippets,
      customModelAliases,
      hiddenProviderCommands,
      providerConfigs,
      chatViewPlacement,
    };

    const merged = {
      ...this.getDefaults(),
      ...legacyNormalized,
    };

    updateMimoProviderSettings(
      merged,
      getMimoProviderSettings(legacyProviderSettings),
    );

    if (
      settingsPath !== SIDEBAR_MIMOCODE_SETTINGS_PATH
      || (
      'show1MModel' in stored
      || 'slashCommands' in stored
      || 'hiddenSlashCommands' in stored
      || 'activeConversationId' in stored
      || 'allowExternalAccess' in stored
      || 'allowedExportPaths' in stored
      || 'enableBlocklist' in stored
      || 'blockedCommands' in stored
      || shouldPersistChatViewPlacementMigration(stored, chatViewPlacement)
      || JSON.stringify(envSnippets) !== JSON.stringify(stored.envSnippets ?? [])
      || (
        'customModelAliases' in stored
        && JSON.stringify(customModelAliases) !== JSON.stringify(stored.customModelAliases ?? {})
      )
      )
    ) {
      await this.save(merged);
    }

    return merged;
  }

  async save(settings: StoredSidebarMimocodeSettings): Promise<void> {
    const content = JSON.stringify(
      stripLegacyFields(settings),
      null,
      2,
    );
    await this.adapter.write(SIDEBAR_MIMOCODE_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(SIDEBAR_MIMOCODE_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredSidebarMimocodeSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  async setLastModel(model: string, isCustom: boolean): Promise<void> {
    if (isCustom) {
      await this.update({ lastCustomModel: model });
      return;
    }

    await this.update({ model });
  }

  async setLastEnvHash(hash: string): Promise<void> {
    const current = await this.load();
    updateMimoProviderSettings(
      current,
      { environmentHash: hash },
    );
    await this.save(current);
  }

  private getDefaults(): StoredSidebarMimocodeSettings {
    return DEFAULT_SIDEBAR_MIMOCODE_SETTINGS;
  }

  private async getLoadPath(): Promise<string | null> {
    if (await this.adapter.exists(SIDEBAR_MIMOCODE_SETTINGS_PATH)) {
      return SIDEBAR_MIMOCODE_SETTINGS_PATH;
    }

    return null;
  }
}
