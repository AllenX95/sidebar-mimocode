import * as path from 'node:path';

import { getEnhancedPath } from '../../../utils/env';

const LEGACY_MIMO_ENVIRONMENT_KEYS = Object.freeze({
  MIMO_CONFIG: 'MIMOCODE_CONFIG',
  MIMO_CONFIG_CONTENT: 'MIMOCODE_CONFIG_CONTENT',
  MIMO_DB: 'MIMOCODE_DB',
  MIMO_DISABLE_CLAUDE_CODE_PROMPT: 'MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT',
  MIMO_DISABLE_PROJECT_CONFIG: 'MIMOCODE_DISABLE_PROJECT_CONFIG',
  MIMO_ENABLE_EXA: 'MIMOCODE_ENABLE_EXA',
} as const);

const ENVIRONMENT_ASSIGNMENT_PATTERN = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=.*)$/;

export interface MimoEnvironmentMigrationResult {
  changed: boolean;
  value: string;
}

export function migrateMimoEnvironmentVariables(
  envText: string,
): MimoEnvironmentMigrationResult {
  const lines = envText.split(/\r?\n/);
  const officialKeys = new Set<string>();

  for (const line of lines) {
    const match = line.match(ENVIRONMENT_ASSIGNMENT_PATTERN);
    if (!match) continue;
    const normalizedKey = match[2].toUpperCase();
    if (Object.values(LEGACY_MIMO_ENVIRONMENT_KEYS).includes(
      normalizedKey as (typeof LEGACY_MIMO_ENVIRONMENT_KEYS)[keyof typeof LEGACY_MIMO_ENVIRONMENT_KEYS],
    )) {
      officialKeys.add(normalizedKey);
    }
  }

  let changed = false;
  const migratedLines: string[] = [];
  for (const line of lines) {
    const match = line.match(ENVIRONMENT_ASSIGNMENT_PATTERN);
    if (!match) {
      migratedLines.push(line);
      continue;
    }

    const legacyKey = match[2].toUpperCase() as keyof typeof LEGACY_MIMO_ENVIRONMENT_KEYS;
    const officialKey = LEGACY_MIMO_ENVIRONMENT_KEYS[legacyKey];
    if (!officialKey) {
      migratedLines.push(line);
      continue;
    }

    changed = true;
    if (officialKeys.has(officialKey)) {
      continue;
    }

    officialKeys.add(officialKey);
    migratedLines.push(`${match[1]}${officialKey}${match[3]}`);
  }

  return {
    changed,
    value: migratedLines.join('\n'),
  };
}

export function normalizeMimoEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const normalized: NodeJS.ProcessEnv = { ...environment };

  for (const [legacyKey, officialKey] of Object.entries(LEGACY_MIMO_ENVIRONMENT_KEYS)) {
    if (normalized[officialKey] === undefined && normalized[legacyKey] !== undefined) {
      normalized[officialKey] = normalized[legacyKey];
    }
    delete normalized[legacyKey];
  }

  return normalized;
}

export function buildMimoProcessEnvironment(params: {
  command: string;
  configContent?: string;
  configPath: string;
  runtimeEnv: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const environment = normalizeMimoEnvironment({
    ...process.env,
    ...params.runtimeEnv,
  });

  return {
    ...environment,
    MIMOCODE_CONFIG: params.configPath,
    ...(params.configContent === undefined
      ? {}
      : { MIMOCODE_CONFIG_CONTENT: params.configContent }),
    PATH: getEnhancedPath(
      environment.PATH,
      path.isAbsolute(params.command) ? params.command : undefined,
    ),
  };
}
