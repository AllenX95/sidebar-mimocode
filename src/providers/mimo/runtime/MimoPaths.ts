import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const MIMO_APP_NAME = 'mimocode';
const DEFAULT_DATABASE_NAME = 'mimocode.db';
const DATABASE_NAME_PATTERN = /^mimocode(?:-[a-z0-9._-]+)?\.db$/i;

export function resolveMimoDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) {
    return path.join(xdgDataHome, MIMO_APP_NAME);
  }

  const home = env.HOME || os.homedir();
  if (platform === 'win32') {
    const appData = env.APPDATA || env.LOCALAPPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, MIMO_APP_NAME);
  }

  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', MIMO_APP_NAME);
  }

  return path.join(home, '.local', 'share', MIMO_APP_NAME);
}

export function resolveMimoDatabasePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const override = env.MIMOCODE_DB?.trim();
  if (override) {
    if (override === ':memory:' || path.isAbsolute(override)) {
      return override;
    }
    return path.join(resolveMimoDataDir(env, platform), override);
  }

  const candidates = getMimoDatabasePathCandidates(env, platform);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? null;
}

export function resolveExistingMimoDatabasePath(
  preferredPath?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const preferred = preferredPath?.trim();
  if (preferred) {
    if (preferred === ':memory:') {
      return preferred;
    }
    if (fs.existsSync(preferred)) {
      return preferred;
    }
  }

  const resolved = resolveMimoDatabasePath(env, platform);
  if (resolved && (resolved === ':memory:' || fs.existsSync(resolved))) {
    return resolved;
  }

  return preferred ?? resolved;
}

function getMimoDatabasePathCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const dataDirs = [resolveMimoDataDir(env, platform)];

  for (const dataDir of dataDirs) {
    pushCandidate(candidates, seen, path.join(dataDir, DEFAULT_DATABASE_NAME));
    try {
      const matches = fs.readdirSync(dataDir)
        .filter((entry) => DATABASE_NAME_PATTERN.test(entry))
        .sort((left, right) => {
          if (left === DEFAULT_DATABASE_NAME) return -1;
          if (right === DEFAULT_DATABASE_NAME) return 1;
          return left.localeCompare(right);
        });

      for (const entry of matches) {
        pushCandidate(candidates, seen, path.join(dataDir, entry));
      }
    } catch {
      // Ignore missing dirs and unreadable locations.
    }
  }

  return candidates;
}

function pushCandidate(
  candidates: string[],
  seen: Set<string>,
  candidate: string,
): void {
  if (seen.has(candidate)) {
    return;
  }

  seen.add(candidate);
  candidates.push(candidate);
}
