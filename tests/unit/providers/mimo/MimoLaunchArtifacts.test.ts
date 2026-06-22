import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { prepareMimoLaunchArtifacts } from '@/providers/mimo/runtime/MimoLaunchArtifacts';

describe('MimoLaunchArtifacts', () => {
  it('loads the official config key and materializes native managed modes without a disk DB', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mimocode-launch-'));
    const baseConfigPath = path.join(workspaceRoot, 'base.json');
    await fs.writeFile(baseConfigPath, JSON.stringify({
      agent: {
        custom: { mode: 'subagent' },
      },
      permission: {
        edit: 'allow',
        read: 'deny',
      },
    }));

    try {
      const artifacts = await prepareMimoLaunchArtifacts({
        permissionRules: {
          bash: { '*': 'ask', 'git status*': 'allow' },
          edit: 'ask',
        },
        runtimeEnv: {
          MIMOCODE_CONFIG: baseConfigPath,
          MIMOCODE_DB: ':memory:',
        },
        systemPromptText: 'System prompt',
        workspaceRoot,
      });
      const config = JSON.parse(artifacts.configContent) as {
        agent: Record<string, unknown>;
        permission: Record<string, unknown>;
      };

      expect(config.agent).toEqual(expect.objectContaining({
        build: expect.any(Object),
        custom: { mode: 'subagent' },
        plan: expect.any(Object),
      }));
      expect(config.agent).not.toHaveProperty('sidebar-mimocode-safe');
      expect(config.agent).not.toHaveProperty('sidebar-mimocode-yolo');
      expect(config.permission).toEqual({
        read: 'deny',
        edit: 'ask',
        bash: { '*': 'ask', 'git status*': 'allow' },
      });
      expect(artifacts.databasePath).toBe(':memory:');
    } finally {
      await fs.rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
