import * as path from 'node:path';

import {
  resolveMimoDatabasePath,
  resolveMimoDataDir,
} from '@/providers/mimo/runtime/MimoPaths';

describe('MiMo paths', () => {
  const home = path.resolve('test-home');

  it('uses the MiMo-Code Linux data directory and database name', () => {
    const env = { HOME: home };

    expect(resolveMimoDataDir(env, 'linux')).toBe(
      path.join(home, '.local', 'share', 'mimocode'),
    );
    expect(resolveMimoDatabasePath(env, 'linux')).toBe(
      path.join(home, '.local', 'share', 'mimocode', 'mimocode.db'),
    );
  });

  it('honors XDG, macOS, Windows, relative overrides, and memory databases', () => {
    expect(resolveMimoDataDir({ HOME: home, XDG_DATA_HOME: path.resolve('xdg') }, 'linux'))
      .toBe(path.join(path.resolve('xdg'), 'mimocode'));
    expect(resolveMimoDataDir({ HOME: home }, 'darwin'))
      .toBe(path.join(home, 'Library', 'Application Support', 'mimocode'));
    expect(resolveMimoDataDir({ HOME: home, APPDATA: path.resolve('appdata') }, 'win32'))
      .toBe(path.join(path.resolve('appdata'), 'mimocode'));
    expect(resolveMimoDatabasePath({ HOME: home, MIMOCODE_DB: 'custom.db' }, 'linux'))
      .toBe(path.join(home, '.local', 'share', 'mimocode', 'custom.db'));
    expect(resolveMimoDatabasePath({ MIMOCODE_DB: ':memory:' }, 'linux')).toBe(':memory:');
  });
});
