import {
  normalizeMimoPermissionRules,
  parseMimoPermissionRulesText,
} from '@/providers/mimo/permissions';
import { getMimoProviderSettings, updateMimoProviderSettings } from '@/providers/mimo/settings';

describe('MiMo permission rules', () => {
  it('accepts native actions and pattern-specific rules in insertion order', () => {
    const parsed = parseMimoPermissionRulesText(JSON.stringify({
      '*': 'ask',
      read: 'allow',
      bash: {
        '*': 'ask',
        'git status*': 'allow',
      },
      edit: 'deny',
    }));

    expect(parsed).toEqual({
      ok: true,
      value: {
        '*': 'ask',
        read: 'allow',
        bash: {
          '*': 'ask',
          'git status*': 'allow',
        },
        edit: 'deny',
      },
    });
    expect(Object.keys(parsed.ok ? parsed.value : {})).toEqual(['*', 'read', 'bash', 'edit']);
  });

  it('rejects invalid actions and nested rule shapes', () => {
    expect(parseMimoPermissionRulesText('{"bash":"prompt"}')).toEqual({
      error: 'Permission "bash" must use ask, allow, or deny.',
      ok: false,
    });
    expect(parseMimoPermissionRulesText('{"bash":{"git status*":{"action":"allow"}}}')).toEqual({
      error: 'Permission "bash" pattern "git status*" must use ask, allow, or deny.',
      ok: false,
    });
  });

  it('normalizes invalid persisted values to an empty ruleset', () => {
    expect(normalizeMimoPermissionRules({ bash: 'prompt' })).toEqual({});
    expect(parseMimoPermissionRulesText('')).toEqual({ ok: true, value: {} });
  });

  it('persists normalized rules in the MiMo provider config', () => {
    const settings: Record<string, unknown> = {};
    updateMimoProviderSettings(settings, {
      permissionRules: {
        bash: 'ask',
        edit: 'deny',
      },
    });

    expect(getMimoProviderSettings(settings).permissionRules).toEqual({
      bash: 'ask',
      edit: 'deny',
    });
    expect(settings.providerConfigs).toEqual(expect.objectContaining({
      mimo: expect.objectContaining({
        permissionRules: { bash: 'ask', edit: 'deny' },
      }),
    }));
  });
});
