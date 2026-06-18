import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { prepareMimoLaunchArtifacts } from '@/providers/mimo/runtime/MimoLaunchArtifacts';

describe('MimoLaunchArtifacts', () => {
  it('loads the official config key and materializes managed modes without a disk DB', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mimocode-launch-'));
    const baseConfigPath = path.join(workspaceRoot, 'base.json');
    await fs.writeFile(baseConfigPath, JSON.stringify({
      agent: {
        custom: { mode: 'subagent' },
      },
    }));

    try {
      const artifacts = await prepareMimoLaunchArtifacts({
        runtimeEnv: {
          MIMOCODE_CONFIG: baseConfigPath,
          MIMOCODE_DB: ':memory:',
        },
        systemPromptText: 'System prompt',
        workspaceRoot,
      });
      const config = JSON.parse(artifacts.configContent) as {
        agent: Record<string, unknown>;
      };

      expect(config.agent).toEqual(expect.objectContaining({
        build: expect.any(Object),
        'sidebar-mimocode-safe': expect.any(Object),
        'sidebar-mimocode-yolo': expect.any(Object),
        custom: { mode: 'subagent' },
        plan: expect.any(Object),
      }));
      expect(artifacts.databasePath).toBe(':memory:');
    } finally {
      await fs.rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
