import { PassThrough } from 'node:stream';

import type {
  AcpClientConnectionOptions,
  AcpSubprocessLaunchSpec,
  JsonRpcMessageStreams,
} from '@/providers/acp';
import {
  MimoAcpRuntimeHost,
  MimoAcpRuntimeHostError,
  type MimoAcpRuntimeHostPlugin,
} from '@/providers/mimo/runtime/MimoAcpRuntimeHost';

class FakeSubprocess {
  readonly shutdown = jest.fn(async () => {
    this.alive = false;
  });
  readonly start = jest.fn();
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private alive = true;
  private readonly closeListeners = new Set<(error?: Error) => void>();

  constructor(readonly spec: AcpSubprocessLaunchSpec) {}

  getStderrSnapshot(): string {
    return 'stderr snapshot';
  }

  isAlive(): boolean {
    return this.alive;
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  emitClose(error?: Error): void {
    this.alive = false;
    for (const listener of this.closeListeners) {
      listener(error);
    }
  }
}

class FakeTransport {
  readonly dispose = jest.fn((error?: Error) => {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const listener of this.closeListeners) {
      listener(error);
    }
  });
  readonly signal = new AbortController().signal;
  readonly start = jest.fn();
  private closed = false;
  private readonly closeListeners = new Set<(error?: Error) => void>();

  constructor(readonly streams: JsonRpcMessageStreams) {}

  get isClosed(): boolean {
    return this.closed;
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }
}

class FakeConnection {
  readonly dispose = jest.fn();
  readonly initialize = jest.fn(async () => {});

  constructor(readonly options: AcpClientConnectionOptions) {}
}

function createPlugin(): MimoAcpRuntimeHostPlugin {
  return {
    getResolvedProviderCliPath: jest.fn(() => 'mimo-test'),
    manifest: { version: '9.9.9' },
    settings: {
      providerConfigs: {
        mimo: {
          environmentVariables: 'MIMOCODE_DB=:memory:',
        },
      },
      sharedEnvironmentVariables: '',
      userName: 'Ada',
    },
  };
}

function createHarness(options: { initializeError?: Error } = {}) {
  const subprocesses: FakeSubprocess[] = [];
  const transports: FakeTransport[] = [];
  const connections: FakeConnection[] = [];
  const prepareLaunchArtifacts = jest.fn(async () => ({
    configContent: '{"agent":{}}',
    configPath: 'C:\\Vault\\.sidebar-mimocode\\mimo\\config.json',
    databasePath: ':memory:',
    launchKey: 'artifact-one',
    systemPromptPath: 'C:\\Vault\\.sidebar-mimocode\\mimo\\system.md',
  }));
  const plugin = createPlugin();
  const host = new MimoAcpRuntimeHost(plugin, {
    factories: {
      createConnection: (connectionOptions) => {
        const connection = new FakeConnection(connectionOptions);
        if (options.initializeError) {
          connection.initialize.mockRejectedValue(options.initializeError);
        }
        connections.push(connection);
        return connection as never;
      },
      createSubprocess: (spec) => {
        const subprocess = new FakeSubprocess(spec);
        subprocesses.push(subprocess);
        return subprocess as never;
      },
      createTransport: (streams) => {
        const transport = new FakeTransport(streams);
        transports.push(transport);
        return transport as never;
      },
      prepareLaunchArtifacts,
    },
  });

  return {
    connections,
    host,
    plugin,
    prepareLaunchArtifacts,
    subprocesses,
    transports,
  };
}

describe('MimoAcpRuntimeHost', () => {
  it('starts a chat ACP runtime and returns a started handle', async () => {
    const harness = createHarness();
    const delegate = {};

    const started = await harness.host.ensureStarted({
      cwd: 'C:\\Vault',
      delegate,
      profile: {
        databasePathOverride: null,
        kind: 'chat',
        permissionRules: { read: 'allow' },
        promptSettings: {
          customPrompt: '',
          mediaFolder: '',
          userName: 'Ada',
          vaultPath: 'C:\\Vault',
        },
      },
    });

    expect(started.connection).toBe(harness.connections[0]);
    expect(started.databasePath).toBe(':memory:');
    expect(started.restarted).toBe(true);
    expect(harness.host.isStarted()).toBe(true);
    expect(harness.subprocesses[0].spec).toEqual(expect.objectContaining({
      args: ['acp', '--cwd=C:\\Vault'],
      command: 'mimo-test',
      cwd: 'C:\\Vault',
    }));
    expect(harness.subprocesses[0].spec.env.MIMOCODE_CONFIG)
      .toBe('C:\\Vault\\.sidebar-mimocode\\mimo\\config.json');
    expect(harness.subprocesses[0].spec.env.MIMOCODE_CONFIG_CONTENT).toBeUndefined();
    expect(harness.prepareLaunchArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      permissionRules: { read: 'allow' },
      workspaceRoot: 'C:\\Vault',
    }));
    expect(harness.transports[0].start).toHaveBeenCalledTimes(1);
    expect(harness.connections[0].initialize).toHaveBeenCalledTimes(1);
    expect(harness.connections[0].options.clientInfo).toEqual({
      name: 'sidebar-mimocode',
      version: '9.9.9',
    });
    expect(harness.connections[0].options.delegate).toBe(delegate);
  });

  it('reuses the current runtime when the launch key is unchanged', async () => {
    const harness = createHarness();
    const params = {
      cwd: 'C:\\Vault',
      delegate: {},
      profile: {
        databasePathOverride: null,
        kind: 'chat' as const,
        promptSettings: {
          customPrompt: '',
          mediaFolder: '',
          userName: 'Ada',
          vaultPath: 'C:\\Vault',
        },
      },
    };

    const first = await harness.host.ensureStarted(params);
    const second = await harness.host.ensureStarted(params);

    expect(second.connection).toBe(first.connection);
    expect(second.restarted).toBe(false);
    expect(harness.subprocesses).toHaveLength(1);
    expect(harness.transports).toHaveLength(1);
    expect(harness.connections).toHaveLength(1);
  });

  it('restarts when MiMo launch artifacts change', async () => {
    const harness = createHarness();
    harness.prepareLaunchArtifacts
      .mockResolvedValueOnce({
        configContent: '{"agent":{"one":{}}}',
        configPath: 'C:\\Vault\\.sidebar-mimocode\\mimo\\config.json',
        databasePath: ':memory:',
        launchKey: 'artifact-one',
        systemPromptPath: 'C:\\Vault\\.sidebar-mimocode\\mimo\\system.md',
      })
      .mockResolvedValueOnce({
        configContent: '{"agent":{"two":{}}}',
        configPath: 'C:\\Vault\\.sidebar-mimocode\\mimo\\config.json',
        databasePath: ':memory:',
        launchKey: 'artifact-two',
        systemPromptPath: 'C:\\Vault\\.sidebar-mimocode\\mimo\\system.md',
      });
    const params = {
      cwd: 'C:\\Vault',
      delegate: {},
      profile: {
        databasePathOverride: null,
        kind: 'chat' as const,
        promptSettings: {
          customPrompt: '',
          mediaFolder: '',
          userName: 'Ada',
          vaultPath: 'C:\\Vault',
        },
      },
    };

    await harness.host.ensureStarted(params);
    const restarted = await harness.host.ensureStarted(params);

    expect(restarted.restarted).toBe(true);
    expect(harness.subprocesses).toHaveLength(2);
    expect(harness.transports[0].dispose).toHaveBeenCalledTimes(1);
    expect(harness.subprocesses[0].shutdown).toHaveBeenCalledTimes(1);
  });

  it('throws a host error and cleans up when initialization fails', async () => {
    const initError = new Error('initialize failed');
    const harness = createHarness({ initializeError: initError });

    await expect(harness.host.ensureStarted({
      cwd: 'C:\\Vault',
      delegate: {},
      profile: {
        databasePathOverride: null,
        kind: 'chat',
        promptSettings: {
          customPrompt: '',
          mediaFolder: '',
          userName: 'Ada',
          vaultPath: 'C:\\Vault',
        },
      },
    })).rejects.toThrow(MimoAcpRuntimeHostError);

    expect(harness.host.isStarted()).toBe(false);
    expect(harness.transports[0].dispose).toHaveBeenCalledTimes(1);
    expect(harness.subprocesses[0].shutdown).toHaveBeenCalledTimes(1);
  });

  it('materializes auxiliary launch artifacts and passes config content through the process env', async () => {
    const harness = createHarness();
    harness.prepareLaunchArtifacts.mockResolvedValueOnce({
      configContent: '{"agent":{"sidebar-mimocode-aux-readonly":{}}}',
      configPath: 'C:\\Vault\\.sidebar-mimocode\\mimo\\auxiliary\\inline\\config.json',
      databasePath: ':memory:',
      launchKey: 'aux-artifact',
      systemPromptPath: 'C:\\Vault\\.sidebar-mimocode\\mimo\\auxiliary\\inline\\system.md',
    });

    await harness.host.ensureStarted({
      cwd: 'C:\\Vault',
      delegate: {},
      profile: {
        agentProfile: 'readonly',
        artifactPurpose: 'inline',
        kind: 'auxiliary',
        systemPrompt: 'Refine this note.',
      },
    });

    expect(harness.prepareLaunchArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      artifactsSubdir: 'mimo/auxiliary/inline',
      defaultAgentId: 'sidebar-mimocode-aux-readonly',
      systemPromptKey: 'Refine this note.',
      systemPromptText: 'Refine this note.',
      userName: 'Ada',
      workspaceRoot: 'C:\\Vault',
    }));
    expect(harness.subprocesses[0].spec.env.MIMOCODE_CONFIG_CONTENT)
      .toBe('{"agent":{"sidebar-mimocode-aux-readonly":{}}}');
    expect(harness.connections[0].options.clientInfo).toEqual({
      name: 'sidebar-mimocode-aux',
      version: '9.9.9',
    });
  });

  it('notifies callers when the active transport closes', async () => {
    const harness = createHarness();
    const closeListener = jest.fn();
    harness.host.onClose(closeListener);
    await harness.host.ensureStarted({
      cwd: 'C:\\Vault',
      delegate: {},
      profile: {
        databasePathOverride: null,
        kind: 'chat',
        promptSettings: {
          customPrompt: '',
          mediaFolder: '',
          userName: 'Ada',
          vaultPath: 'C:\\Vault',
        },
      },
    });
    const error = new Error('closed');

    harness.transports[0].dispose(error);

    expect(closeListener).toHaveBeenCalledWith(error);
    expect(harness.host.isStarted()).toBe(false);
    expect(harness.host.getStderrSnapshot()).toBe('stderr snapshot');
  });
});
