import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderTabWarmupPolicy,
  ProviderWorkspaceRegistration,
  ProviderWorkspaceServices,
} from '../../../core/providers/types';
import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { MimoAgentMentionProvider } from '../agents/MimoAgentMentionProvider';
import { MimoCommandCatalog } from '../commands/MimoCommandCatalog';
import { MimoCliResolver } from '../runtime/MimoCliResolver';
import { MimoAgentStorage } from '../storage/MimoAgentStorage';
import { mimoSettingsTabRenderer } from '../ui/MimoSettingsTab';
import { MimoRuntimeCommandLoader } from './MimoRuntimeCommandLoader';

export interface MimoWorkspaceServices extends ProviderWorkspaceServices {
  agentStorage: MimoAgentStorage;
  agentMentionProvider: MimoAgentMentionProvider;
  commandCatalog: ProviderCommandCatalog;
}

const mimoTabWarmupPolicy: ProviderTabWarmupPolicy = {
  resolveMode() {
    return 'commands';
  },
};

export async function createMimoWorkspaceServices(
  vaultAdapter: VaultFileAdapter,
): Promise<MimoWorkspaceServices> {
  const agentStorage = new MimoAgentStorage(vaultAdapter);
  const agentMentionProvider = new MimoAgentMentionProvider(agentStorage);
  await agentMentionProvider.loadAgents();

  return {
    agentStorage,
    agentMentionProvider,
    commandCatalog: new MimoCommandCatalog(),
    cliResolver: new MimoCliResolver(),
    runtimeCommandLoader: new MimoRuntimeCommandLoader(),
    settingsTabRenderer: mimoSettingsTabRenderer,
    tabWarmupPolicy: mimoTabWarmupPolicy,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
    },
  };
}

export const mimoWorkspaceRegistration: ProviderWorkspaceRegistration<MimoWorkspaceServices> = {
  initialize: async ({ vaultAdapter }) => createMimoWorkspaceServices(vaultAdapter),
};

export function maybeGetMimoWorkspaceServices(): MimoWorkspaceServices | null {
  return ProviderWorkspaceRegistry.getServices('mimo') as MimoWorkspaceServices | null;
}
