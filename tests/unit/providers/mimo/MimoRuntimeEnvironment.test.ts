import { buildMimoRuntimeEnv } from '@/providers/mimo/runtime/MimoRuntimeEnvironment';
import { MIMO_DEFAULT_ENVIRONMENT_VARIABLES } from '@/providers/mimo/settings';

describe('MiMo runtime environment', () => {
  it('migrates only known legacy runtime keys and prefers official keys', () => {
    const env = buildMimoRuntimeEnv({
      providerConfigs: {
        mimo: {
          environmentVariables: [
            'MIMO_CONFIG=legacy.json',
            'MIMOCODE_CONFIG=official.json',
            'MIMO_DB=legacy.db',
            'MIMO_API_KEY=keep-me',
          ].join('\n'),
        },
      },
      sharedEnvironmentVariables: '',
    }, 'mimo', ':memory:');

    expect(env.MIMOCODE_CONFIG).toBe('official.json');
    expect(env.MIMOCODE_DB).toBe(':memory:');
    expect(env.MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe('true');
    expect(env.MIMO_CONFIG).toBeUndefined();
    expect(env.MIMO_DB).toBeUndefined();
    expect(env.MIMO_API_KEY).toBe('keep-me');
  });

  it('uses the official Exa key in defaults', () => {
    expect(MIMO_DEFAULT_ENVIRONMENT_VARIABLES).toBe('MIMOCODE_ENABLE_EXA=1');
  });
});
