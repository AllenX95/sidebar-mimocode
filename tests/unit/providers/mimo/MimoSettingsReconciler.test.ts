import { mimoSettingsReconciler } from '@/providers/mimo/env/MimoSettingsReconciler';
import { getMimoProviderSettings } from '@/providers/mimo/settings';

describe('mimoSettingsReconciler', () => {
  it('migrates legacy environment and Claude default model settings once', () => {
    const settings: Record<string, unknown> = {
      model: 'haiku',
      providerConfigs: {
        mimo: {
          environmentVariables: [
            'MIMO_DB=legacy.db',
            'MIMO_ENABLE_EXA=0',
            'MIMO_API_KEY=keep',
          ].join('\n'),
        },
      },
      savedProviderModel: { mimo: 'haiku' },
      titleGenerationModel: 'haiku',
    };

    expect(mimoSettingsReconciler.normalizeModelVariantSettings(settings)).toBe(true);

    const mimoSettings = getMimoProviderSettings(settings);
    expect(settings.model).toBe('mimo');
    expect(settings.titleGenerationModel).toBe('mimo');
    expect(settings.savedProviderModel).toEqual({ mimo: 'mimo' });
    expect(mimoSettings.environmentVariables).toBe([
      'MIMOCODE_DB=legacy.db',
      'MIMOCODE_ENABLE_EXA=0',
      'MIMO_API_KEY=keep',
    ].join('\n'));
  });

  it('migrates legacy permission modes to native MiMo modes', () => {
    const settings: Record<string, unknown> = {
      model: 'mimo',
      permissionMode: 'yolo',
      providerConfigs: {
        mimo: {
          selectedMode: 'sidebar-mimocode-safe',
        },
      },
      savedProviderPermissionMode: {
        mimo: 'normal',
      },
    };

    expect(mimoSettingsReconciler.normalizeModelVariantSettings(settings)).toBe(true);
    expect(settings.permissionMode).toBe('build');
    expect(settings.savedProviderPermissionMode).toEqual({ mimo: 'build' });
    expect(getMimoProviderSettings(settings).selectedMode).toBe('build');
    expect(settings.providerConfigs).toEqual(expect.objectContaining({
      mimo: expect.objectContaining({ selectedMode: 'build' }),
    }));
  });
});
