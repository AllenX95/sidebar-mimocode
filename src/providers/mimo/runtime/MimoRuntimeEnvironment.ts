import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { normalizeMimoEnvironment } from './MimoEnvironment';

export function buildMimoRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
  databasePathOverride?: string | null,
): NodeJS.ProcessEnv {
  const envText = getRuntimeEnvironmentText(settings, 'mimo');
  const envVars = parseEnvironmentVariables(envText);
  const runtimeEnv = normalizeMimoEnvironment({
    ...process.env,
    ...envVars,
  });
  return {
    ...runtimeEnv,
    MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT: 'true',
    ...(databasePathOverride ? { MIMOCODE_DB: databasePathOverride } : {}),
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}
