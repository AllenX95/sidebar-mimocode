import type { SystemPromptSettings } from '../../../core/prompt/mainAgent';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import {
  AcpClientConnection,
  type AcpClientConnectionDelegate,
  type AcpClientConnectionOptions,
  AcpJsonRpcTransport,
  AcpSubprocess,
  type AcpSubprocessLaunchSpec,
  type JsonRpcMessageStreams,
} from '../../acp';
import type { MimoPermissionRules } from '../permissions';
import { buildMimoProcessEnvironment } from './MimoEnvironment';
import {
  type MimoLaunchArtifacts,
  type MimoManagedAgentConfig,
  prepareMimoLaunchArtifacts,
  type PrepareMimoLaunchArtifactsParams,
} from './MimoLaunchArtifacts';
import { buildMimoRuntimeEnv } from './MimoRuntimeEnvironment';

export type MimoAuxAgentProfile = 'passive' | 'readonly';
export type MimoAuxArtifactPurpose = 'inline' | 'instructions' | 'title-gen';

export interface MimoAcpRuntimeHostPlugin {
  getResolvedProviderCliPath(providerId: 'mimo'): string | null;
  manifest?: { version?: string };
  settings: Record<string, unknown>;
}

export type MimoRuntimeHostProfile =
  | {
    databasePathOverride?: string | null;
    kind: 'chat';
    permissionRules?: MimoPermissionRules;
    promptSettings: SystemPromptSettings;
  }
  | {
    agentProfile: MimoAuxAgentProfile;
    artifactPurpose: MimoAuxArtifactPurpose;
    kind: 'auxiliary';
    systemPrompt: string;
  };

export interface MimoAcpRuntimeHostEnsureStartedParams {
  cwd: string;
  delegate?: AcpClientConnectionDelegate;
  force?: boolean;
  profile: MimoRuntimeHostProfile;
}

export interface StartedMimoAcpRuntime {
  connection: AcpClientConnection;
  databasePath: string | null;
  launchKey: string;
  restarted: boolean;
}

export interface MimoAcpRuntimeHostFactories {
  createConnection: (options: AcpClientConnectionOptions) => AcpClientConnection;
  createSubprocess: (spec: AcpSubprocessLaunchSpec) => AcpSubprocess;
  createTransport: (streams: JsonRpcMessageStreams) => AcpJsonRpcTransport;
  prepareLaunchArtifacts: (
    params: PrepareMimoLaunchArtifactsParams,
  ) => Promise<MimoLaunchArtifacts>;
}

export interface MimoAcpRuntimeHostOptions {
  factories?: Partial<MimoAcpRuntimeHostFactories>;
}

type CloseListener = (error?: Error) => void;

interface PreparedLaunch {
  artifacts: MimoLaunchArtifacts;
  command: string;
  launchKey: string;
  profile: MimoRuntimeHostProfile;
  runtimeEnv: NodeJS.ProcessEnv;
}

const MIMO_AUX_AGENT_IDS: Record<MimoAuxAgentProfile, string> = {
  passive: 'sidebar-mimocode-aux-passive',
  readonly: 'sidebar-mimocode-aux-readonly',
};

const MIMO_AUX_READ_PERMISSION = Object.freeze({
  '*': 'allow',
  '*.env': 'deny',
  '*.env.*': 'deny',
  '*.env.example': 'allow',
});

export class MimoAcpRuntimeHostError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MimoAcpRuntimeHostError';
    this.cause = cause;
  }
}

export class MimoAcpRuntimeHost {
  private readonly closeListeners = new Set<CloseListener>();
  private connection: AcpClientConnection | null = null;
  private currentDatabasePath: string | null = null;
  private currentLaunchKey: string | null = null;
  private process: AcpSubprocess | null = null;
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;

  private readonly factories: MimoAcpRuntimeHostFactories;

  constructor(
    private readonly plugin: MimoAcpRuntimeHostPlugin,
    options: MimoAcpRuntimeHostOptions = {},
  ) {
    this.factories = {
      createConnection: options.factories?.createConnection
        ?? ((connectionOptions) => new AcpClientConnection(connectionOptions)),
      createSubprocess: options.factories?.createSubprocess
        ?? ((spec) => new AcpSubprocess(spec)),
      createTransport: options.factories?.createTransport
        ?? ((streams) => new AcpJsonRpcTransport(streams)),
      prepareLaunchArtifacts: options.factories?.prepareLaunchArtifacts
        ?? prepareMimoLaunchArtifacts,
    };
  }

  async ensureStarted(
    params: MimoAcpRuntimeHostEnsureStartedParams,
  ): Promise<StartedMimoAcpRuntime> {
    const launch = await this.prepareLaunch(params.cwd, params.profile);
    const shouldRestart = params.force === true
      || !this.isStarted()
      || this.currentLaunchKey !== launch.launchKey;

    if (!shouldRestart && this.connection) {
      return {
        connection: this.connection,
        databasePath: this.currentDatabasePath,
        launchKey: this.currentLaunchKey ?? launch.launchKey,
        restarted: false,
      };
    }

    await this.shutdown();
    try {
      await this.start({
        cwd: params.cwd,
        delegate: params.delegate,
        launch,
      });
    } catch (error) {
      await this.shutdown();
      throw new MimoAcpRuntimeHostError(
        'Failed to start MiMo-Code ACP runtime.',
        error,
      );
    }

    if (!this.connection || !this.currentLaunchKey) {
      throw new MimoAcpRuntimeHostError('MiMo-Code ACP runtime did not initialize.');
    }

    return {
      connection: this.connection,
      databasePath: this.currentDatabasePath,
      launchKey: this.currentLaunchKey,
      restarted: true,
    };
  }

  isStarted(): boolean {
    return !!this.process
      && !!this.transport
      && !!this.connection
      && this.process.isAlive()
      && !this.transport.isClosed;
  }

  getStderrSnapshot(): string {
    return this.process?.getStderrSnapshot() ?? '';
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  async shutdown(): Promise<void> {
    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;

    this.connection?.dispose();
    this.connection = null;

    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown().catch(() => {});
      this.process = null;
    }

    this.currentDatabasePath = null;
    this.currentLaunchKey = null;
  }

  private async prepareLaunch(
    cwd: string,
    profile: MimoRuntimeHostProfile,
  ): Promise<PreparedLaunch> {
    const command = this.plugin.getResolvedProviderCliPath('mimo') ?? 'mimo';
    const runtimeEnv = buildMimoRuntimeEnv(
      this.plugin.settings,
      command,
      profile.kind === 'chat'
        ? profile.databasePathOverride
        : undefined,
    );
    const artifacts = await this.prepareArtifacts({
      cwd,
      profile,
      runtimeEnv,
    });
    const launchKey = JSON.stringify({
      artifactKey: artifacts.launchKey,
      command,
      configPath: artifacts.configPath,
      envText: getRuntimeEnvironmentText(this.plugin.settings, 'mimo'),
      profileKind: profile.kind,
    });

    return {
      artifacts,
      command,
      launchKey,
      profile,
      runtimeEnv,
    };
  }

  private async prepareArtifacts(params: {
    cwd: string;
    profile: MimoRuntimeHostProfile;
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<MimoLaunchArtifacts> {
    if (params.profile.kind === 'chat') {
      return this.factories.prepareLaunchArtifacts({
        permissionRules: params.profile.permissionRules,
        runtimeEnv: params.runtimeEnv,
        settings: params.profile.promptSettings,
        workspaceRoot: params.cwd,
      });
    }

    return this.factories.prepareLaunchArtifacts({
      artifactsSubdir: `mimo/auxiliary/${params.profile.artifactPurpose}`,
      defaultAgentId: resolveMimoAuxAgentId(params.profile.agentProfile),
      managedAgents: [buildMimoAuxAgentConfig(params.profile.agentProfile)],
      runtimeEnv: params.runtimeEnv,
      systemPromptKey: params.profile.systemPrompt,
      systemPromptText: params.profile.systemPrompt,
      userName: typeof this.plugin.settings.userName === 'string'
        ? this.plugin.settings.userName
        : undefined,
      workspaceRoot: params.cwd,
    });
  }

  private async start(params: {
    cwd: string;
    delegate?: AcpClientConnectionDelegate;
    launch: PreparedLaunch;
  }): Promise<void> {
    const processEnv = buildMimoProcessEnvironment({
      command: params.launch.command,
      ...(params.launch.profile.kind === 'auxiliary'
        ? { configContent: params.launch.artifacts.configContent }
        : {}),
      configPath: params.launch.artifacts.configPath,
      runtimeEnv: params.launch.runtimeEnv,
    });
    const subprocess = this.factories.createSubprocess({
      args: ['acp', `--cwd=${params.cwd}`],
      command: params.launch.command,
      cwd: params.cwd,
      env: processEnv,
    });
    subprocess.start();

    const transport = this.factories.createTransport({
      input: subprocess.stdout,
      onClose: (listener) => subprocess.onClose(listener),
      output: subprocess.stdin,
    });
    const connection = this.factories.createConnection({
      clientInfo: {
        name: params.launch.profile.kind === 'chat'
          ? 'sidebar-mimocode'
          : 'sidebar-mimocode-aux',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: params.delegate,
      transport,
    });

    this.process = subprocess;
    this.transport = transport;
    this.connection = connection;
    this.currentDatabasePath = params.launch.artifacts.databasePath;
    this.currentLaunchKey = params.launch.launchKey;
    this.unregisterTransportClose = transport.onClose((error) => {
      if (this.transport === transport) {
        this.notifyClose(error);
      }
    });

    transport.start();
    await connection.initialize();
  }

  private notifyClose(error?: Error): void {
    for (const listener of this.closeListeners) {
      try {
        listener(error);
      } catch {
        // Close notifications are best-effort and must not mask the runtime close.
      }
    }
  }
}

export function resolveMimoAuxAgentId(profile: MimoAuxAgentProfile): string {
  return MIMO_AUX_AGENT_IDS[profile];
}

function buildMimoAuxAgentConfig(profile: MimoAuxAgentProfile): MimoManagedAgentConfig {
  const id = resolveMimoAuxAgentId(profile);
  if (profile === 'readonly') {
    return {
      definition: {
        description: 'Internal Sidebar MiMo-Code read-only agent for auxiliary tasks.',
        mode: 'primary',
        permission: {
          '*': 'deny',
          codesearch: 'allow',
          external_directory: 'deny',
          glob: 'allow',
          grep: 'allow',
          lsp: 'allow',
          read: MIMO_AUX_READ_PERMISSION,
          webfetch: 'allow',
          websearch: 'allow',
        },
      },
      id,
    };
  }

  return {
    definition: {
      description: 'Internal Sidebar MiMo-Code no-tool agent for auxiliary tasks.',
      mode: 'primary',
      permission: {
        '*': 'deny',
        external_directory: 'deny',
      },
    },
    id,
  };
}
