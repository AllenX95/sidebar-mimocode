import '@/providers';

import type { AcpSessionConfigOption } from '@/providers/acp';
import {
  type MimoSessionConfigConnection,
  MimoSessionConfigCoordinator,
} from '@/providers/mimo/runtime/MimoSessionConfigCoordinator';
import { getMimoProviderSettings } from '@/providers/mimo/settings';

function createModelConfig(currentValue: string): AcpSessionConfigOption {
  return {
    category: 'model',
    currentValue,
    id: 'model',
    name: 'Model',
    options: [
      { name: 'Old Model', value: 'mimo/old-model' },
      { name: 'New Model', value: 'mimo/new-model' },
    ],
    type: 'select',
  };
}

function createModeConfig(currentValue: string): AcpSessionConfigOption {
  return {
    category: 'mode',
    currentValue,
    id: 'mode',
    name: 'Mode',
    options: [
      { name: 'build', value: 'build' },
      { name: 'plan', value: 'plan' },
    ],
    type: 'select',
  };
}

function createEffortConfig(currentValue: string): AcpSessionConfigOption {
  return {
    category: 'thought_level',
    currentValue,
    id: 'effort',
    name: 'Effort',
    options: [
      { name: 'medium', value: 'medium' },
      { name: 'high', value: 'high' },
    ],
    type: 'select',
  };
}

function createConfigOptions(values: {
  effort?: string;
  model?: string;
  mode?: string;
} = {}): AcpSessionConfigOption[] {
  return [
    createModelConfig(values.model ?? 'mimo/old-model'),
    createModeConfig(values.mode ?? 'build'),
    createEffortConfig(values.effort ?? 'medium'),
  ];
}

function createHarness(settingsOverrides: Record<string, unknown> = {}) {
  const settings: Record<string, unknown> = {
    effortLevel: 'high',
    model: 'mimo:mimo/new-model',
    permissionMode: 'plan',
    providerConfigs: {
      mimo: {
        enabled: true,
        visibleModels: ['mimo/new-model'],
      },
    },
    savedProviderEffort: { mimo: 'high' },
    savedProviderModel: { mimo: 'mimo:mimo/new-model' },
    savedProviderPermissionMode: { mimo: 'plan' },
    settingsProvider: 'mimo',
    ...settingsOverrides,
  };
  const refreshModelSelectors = jest.fn();
  const saveSettings = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const onPermissionModeSync = jest.fn();
  const coordinator = new MimoSessionConfigCoordinator({
    onPermissionModeSync,
    refreshModelSelectors,
    saveSettings,
    settings,
  });

  return {
    coordinator,
    onPermissionModeSync,
    refreshModelSelectors,
    saveSettings,
    settings,
  };
}

function createConnection(initialValues: {
  effort?: string;
  model?: string;
  mode?: string;
} = {}): MimoSessionConfigConnection {
  const values = {
    effort: initialValues.effort ?? 'medium',
    model: initialValues.model ?? 'mimo/old-model',
    mode: initialValues.mode ?? 'build',
  };

  return {
    setConfigOption: jest.fn(async (request) => {
      if (request.configId === 'model' && request.type === 'select') {
        values.model = request.value;
      }
      if (request.configId === 'mode' && request.type === 'select') {
        values.mode = request.value;
      }
      if (request.configId === 'effort' && request.type === 'select') {
        values.effort = request.value;
      }
      return {
        configOptions: createConfigOptions(values),
      };
    }),
  };
}

describe('MimoSessionConfigCoordinator', () => {
  it('applies selected mode, model, and effort before a prompt in stable order', async () => {
    const harness = createHarness();
    const connection = createConnection();
    await harness.coordinator.syncFromSessionStart({
      configOptions: createConfigOptions(),
    });
    jest.clearAllMocks();

    await harness.coordinator.applyBeforePrompt({
      connection,
      sessionId: 'session-1',
    });

    expect(connection.setConfigOption).toHaveBeenCalledTimes(3);
    expect(connection.setConfigOption).toHaveBeenNthCalledWith(1, {
      configId: 'mode',
      sessionId: 'session-1',
      type: 'select',
      value: 'plan',
    });
    expect(connection.setConfigOption).toHaveBeenNthCalledWith(2, {
      configId: 'model',
      sessionId: 'session-1',
      type: 'select',
      value: 'mimo/new-model',
    });
    expect(connection.setConfigOption).toHaveBeenNthCalledWith(3, {
      configId: 'effort',
      sessionId: 'session-1',
      type: 'select',
      value: 'high',
    });
    expect(harness.onPermissionModeSync).toHaveBeenCalledWith('plan');
  });

  it('skips unchanged config until session state is reset', async () => {
    const harness = createHarness({
      permissionMode: 'build',
      savedProviderPermissionMode: { mimo: 'build' },
    });
    const connection = createConnection({
      effort: 'high',
      model: 'mimo/new-model',
      mode: 'build',
    });
    await harness.coordinator.syncFromSessionStart({
      configOptions: createConfigOptions({
        effort: 'high',
        model: 'mimo/new-model',
        mode: 'build',
      }),
    });
    jest.clearAllMocks();

    await harness.coordinator.applyBeforePrompt({
      connection,
      sessionId: 'session-1',
    });

    expect(connection.setConfigOption).not.toHaveBeenCalled();

    harness.coordinator.resetSessionState();
    await harness.coordinator.applyBeforePrompt({
      connection,
      sessionId: 'session-1',
    });

    expect(connection.setConfigOption).toHaveBeenCalledTimes(2);
  });

  it('refreshes selectors without saving when only model discovery changes', async () => {
    const harness = createHarness({
      effortLevel: 'default',
      model: 'mimo',
      permissionMode: 'build',
      providerConfigs: {
        mimo: {
          enabled: true,
        },
      },
      savedProviderModel: {},
    });

    await harness.coordinator.syncFromConfigOptions({
      configOptions: [
        createModelConfig(''),
      ],
    });

    expect(getMimoProviderSettings(harness.settings).discoveredModels).toEqual([
      { label: 'Old Model', rawId: 'mimo/old-model' },
      { label: 'New Model', rawId: 'mimo/new-model' },
    ]);
    expect(harness.saveSettings).not.toHaveBeenCalled();
    expect(harness.refreshModelSelectors).toHaveBeenCalledTimes(1);
  });

  it('warms model metadata through the config connection and reports success', async () => {
    const harness = createHarness();
    await harness.coordinator.syncFromSessionStart({
      configOptions: createConfigOptions(),
    });
    jest.clearAllMocks();
    const connection = createConnection();

    await expect(harness.coordinator.warmModelMetadata({
      connection,
      model: 'mimo:mimo/new-model',
      sessionId: 'session-1',
    })).resolves.toBe(true);

    expect(connection.setConfigOption).toHaveBeenCalledWith({
      configId: 'model',
      sessionId: 'session-1',
      type: 'select',
      value: 'mimo/new-model',
    });
  });
});
