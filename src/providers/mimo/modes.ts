export interface MimoMode {
  description?: string;
  id: string;
  name: string;
}

export const MIMO_BUILD_MODE_ID = 'build';
export const MIMO_YOLO_MODE_ID = 'claudian-yolo';
export const MIMO_SAFE_MODE_ID = 'claudian-safe';
export const MIMO_PLAN_MODE_ID = 'plan';

export const MIMO_FALLBACK_MODES: ReadonlyArray<MimoMode> = Object.freeze([
  {
    description: 'The default agent. Executes tools based on configured permissions.',
    id: MIMO_YOLO_MODE_ID,
    name: 'yolo',
  },
  {
    description: 'Safe mode. Asks before shell commands and file edits.',
    id: MIMO_SAFE_MODE_ID,
    name: 'safe',
  },
  {
    description: 'Plan mode. Disallows all edit tools.',
    id: MIMO_PLAN_MODE_ID,
    name: MIMO_PLAN_MODE_ID,
  },
]);

const MIMO_MANAGED_MODE_IDS = new Set([
  MIMO_BUILD_MODE_ID,
  ...MIMO_FALLBACK_MODES.map((mode) => mode.id),
]);

export function normalizeMimoAvailableModes(value: unknown): MimoMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: MimoMode[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : id;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      ...(description ? { description } : {}),
      id,
      name: name || id,
    });
  }

  return normalized;
}

export function getEffectiveMimoModes(modes: MimoMode[]): MimoMode[] {
  return modes.length > 0 ? modes : [...MIMO_FALLBACK_MODES];
}

export function isManagedMimoModeId(value: string): boolean {
  return MIMO_MANAGED_MODE_IDS.has(value);
}

export function getManagedMimoModes(modes: MimoMode[]): MimoMode[] {
  const effectiveModes = getEffectiveMimoModes(modes);
  return MIMO_FALLBACK_MODES.map((fallbackMode) => (
    effectiveModes.find((mode) => mode.id === fallbackMode.id) ?? fallbackMode
  ));
}

export function normalizeMimoSelectedMode(
  value: unknown,
): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed;
}

export function normalizeManagedMimoSelectedMode(
  value: unknown,
  modes: MimoMode[] = [],
): string {
  const normalized = normalizeMimoSelectedMode(value);
  if (!normalized) {
    return '';
  }

  const canonicalModeId = normalized === MIMO_BUILD_MODE_ID
    ? MIMO_YOLO_MODE_ID
    : normalized;
  const managedModes = getManagedMimoModes(modes);
  return managedModes.some((mode) => mode.id === canonicalModeId)
    ? canonicalModeId
    : (managedModes[0]?.id ?? '');
}

export function resolveMimoModeForPermissionMode(
  permissionMode: unknown,
  modes: MimoMode[] = [],
): string {
  const managedModes = getManagedMimoModes(modes);
  const managedModeIds = new Set(managedModes.map((mode) => mode.id));

  if (permissionMode === 'plan' && managedModeIds.has(MIMO_PLAN_MODE_ID)) {
    return MIMO_PLAN_MODE_ID;
  }
  if (permissionMode === 'normal' && managedModeIds.has(MIMO_SAFE_MODE_ID)) {
    return MIMO_SAFE_MODE_ID;
  }
  if (managedModeIds.has(MIMO_YOLO_MODE_ID)) {
    return MIMO_YOLO_MODE_ID;
  }

  return managedModes[0]?.id ?? '';
}

export function resolvePermissionModeForManagedMimoMode(
  modeId: unknown,
): 'normal' | 'plan' | 'yolo' | null {
  if (modeId === MIMO_BUILD_MODE_ID || modeId === MIMO_YOLO_MODE_ID) {
    return 'yolo';
  }
  if (modeId === MIMO_SAFE_MODE_ID) {
    return 'normal';
  }
  if (modeId === MIMO_PLAN_MODE_ID) {
    return 'plan';
  }
  return null;
}
