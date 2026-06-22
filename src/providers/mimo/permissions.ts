export type MimoPermissionAction = 'allow' | 'ask' | 'deny';
export type MimoPermissionRule = MimoPermissionAction | Record<string, MimoPermissionAction>;
export type MimoPermissionRules = Record<string, MimoPermissionRule>;

export type ParseMimoPermissionRulesResult =
  | { ok: true; value: MimoPermissionRules }
  | { error: string; ok: false };

const ACTIONS = new Set<MimoPermissionAction>(['allow', 'ask', 'deny']);

export function parseMimoPermissionRulesText(text: string): ParseMimoPermissionRulesResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { error: 'Permission rules must be valid JSON.', ok: false };
  }

  return parseMimoPermissionRules(parsed);
}

export function normalizeMimoPermissionRules(value: unknown): MimoPermissionRules {
  const parsed = parseMimoPermissionRules(value);
  return parsed.ok ? parsed.value : {};
}

function parseMimoPermissionRules(value: unknown): ParseMimoPermissionRulesResult {
  if (!isRecord(value)) {
    return { error: 'Permission rules must be a JSON object.', ok: false };
  }

  const rules: MimoPermissionRules = {};
  for (const [permission, rule] of Object.entries(value)) {
    if (!permission.trim()) {
      return { error: 'Permission names cannot be empty.', ok: false };
    }

    if (isAction(rule)) {
      rules[permission] = rule;
      continue;
    }

    if (!isRecord(rule)) {
      return {
        error: `Permission "${permission}" must use ask, allow, or deny.`,
        ok: false,
      };
    }

    const patterns: Record<string, MimoPermissionAction> = {};
    for (const [pattern, action] of Object.entries(rule)) {
      if (!pattern.trim()) {
        return { error: `Permission "${permission}" contains an empty pattern.`, ok: false };
      }
      if (!isAction(action)) {
        return {
          error: `Permission "${permission}" pattern "${pattern}" must use ask, allow, or deny.`,
          ok: false,
        };
      }
      patterns[pattern] = action;
    }
    rules[permission] = patterns;
  }

  return { ok: true, value: rules };
}

function isAction(value: unknown): value is MimoPermissionAction {
  return typeof value === 'string' && ACTIONS.has(value as MimoPermissionAction);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
