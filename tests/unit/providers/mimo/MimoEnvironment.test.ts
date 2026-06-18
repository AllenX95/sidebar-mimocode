import {
  buildMimoProcessEnvironment,
  migrateMimoEnvironmentVariables,
} from '@/providers/mimo/runtime/MimoEnvironment';

describe('migrateMimoEnvironmentVariables', () => {
  it('migrates known keys, removes shadowed legacy keys, and preserves business keys', () => {
    const result = migrateMimoEnvironmentVariables([
      '# keep comment',
      'MIMO_CONFIG=legacy.json',
      'export MIMO_DB=legacy.db',
      'MIMOCODE_DB=official.db',
      'MIMO_API_KEY=secret',
    ].join('\n'));

    expect(result.changed).toBe(true);
    expect(result.value).toBe([
      '# keep comment',
      'MIMOCODE_CONFIG=legacy.json',
      'MIMOCODE_DB=official.db',
      'MIMO_API_KEY=secret',
    ].join('\n'));
  });

  it('uses the same official launch keys for chat and auxiliary processes', () => {
    const chatEnv = buildMimoProcessEnvironment({
      command: 'mimo',
      configPath: 'chat.json',
      runtimeEnv: { MIMO_CONFIG: 'legacy.json' },
    });
    const auxiliaryEnv = buildMimoProcessEnvironment({
      command: 'mimo',
      configContent: '{"agent":{}}',
      configPath: 'aux.json',
      runtimeEnv: {},
    });

    expect(chatEnv.MIMOCODE_CONFIG).toBe('chat.json');
    expect(chatEnv.MIMO_CONFIG).toBeUndefined();
    expect(auxiliaryEnv.MIMOCODE_CONFIG).toBe('aux.json');
    expect(auxiliaryEnv.MIMOCODE_CONFIG_CONTENT).toBe('{"agent":{}}');
  });
});
