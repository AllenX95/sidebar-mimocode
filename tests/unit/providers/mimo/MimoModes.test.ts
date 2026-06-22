import {
  getManagedMimoModes,
  normalizeManagedMimoSelectedMode,
  resolveMimoModeForPermissionMode,
  resolvePermissionModeForManagedMimoMode,
} from '@/providers/mimo/modes';
import { mimoChatUIConfig } from '@/providers/mimo/ui/MimoChatUIConfig';

describe('MiMo modes', () => {
  it('only exposes native build and plan modes', () => {
    expect(getManagedMimoModes([
      { id: 'build', name: 'build' },
      { id: 'compose', name: 'compose' },
      { id: 'plan', name: 'plan' },
      { id: 'sidebar-mimocode-safe', name: 'safe' },
    ])).toEqual([
      { id: 'build', name: 'build' },
      { id: 'plan', name: 'plan' },
    ]);
  });

  it.each([
    ['sidebar-mimocode-yolo', 'build'],
    ['sidebar-mimocode-safe', 'build'],
    ['yolo', 'build'],
    ['normal', 'build'],
    ['build', 'build'],
    ['plan', 'plan'],
  ])('normalizes legacy mode %s to %s', (input, expected) => {
    expect(normalizeManagedMimoSelectedMode(input)).toBe(expected);
    expect(resolveMimoModeForPermissionMode(input)).toBe(expected);
  });

  it('maps native modes back to the shared setting', () => {
    expect(resolvePermissionModeForManagedMimoMode('build')).toBe('build');
    expect(resolvePermissionModeForManagedMimoMode('plan')).toBe('plan');
    expect(resolvePermissionModeForManagedMimoMode('compose')).toBeNull();
  });

  it('uses the native build/plan mode selector instead of a permission toggle', () => {
    const settings: Record<string, unknown> = {
      permissionMode: 'build',
      providerConfigs: { mimo: { selectedMode: 'build' } },
    };

    expect(mimoChatUIConfig.getPermissionModeToggle?.()).toBeNull();
    expect(mimoChatUIConfig.getModeSelector?.(settings)).toEqual(expect.objectContaining({
      activeValue: 'plan',
      options: [
        expect.objectContaining({ label: 'Build', value: 'build' }),
        expect.objectContaining({ label: 'Plan', value: 'plan' }),
      ],
      value: 'build',
    }));

    mimoChatUIConfig.applyModeSelection?.('plan', settings);
    expect(settings.permissionMode).toBe('plan');
    expect(settings.providerConfigs).toEqual(expect.objectContaining({
      mimo: expect.objectContaining({ selectedMode: 'plan' }),
    }));
  });
});
