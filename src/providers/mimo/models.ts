export interface MimoDiscoveredModel {
  description?: string;
  label: string;
  rawId: string;
}

export interface MimoModelVariant {
  description?: string;
  label: string;
  value: string;
}

export type MimoThinkingOptionsByModel = Record<string, MimoModelVariant[]>;

export interface MimoBaseModel {
  description?: string;
  label: string;
  rawId: string;
  variants: MimoModelVariant[];
}

export interface MimoDiscoveredModelGroup {
  models: MimoDiscoveredModel[];
  providerKey: string;
  providerLabel: string;
}

export const MIMO_SYNTHETIC_MODEL_ID = 'mimo';
export const MIMO_DEFAULT_THINKING_LEVEL = 'default';

const MIMO_MODEL_PREFIX = 'mimo:';
const MIMO_VARIANT_ASCENDING_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'max',
  'xhigh',
] as const;
const MIMO_VARIANT_ASCENDING_RANK = new Map<string, number>(
  MIMO_VARIANT_ASCENDING_ORDER.map((value, index) => [value, index] as const),
);

export function isMimoModelSelectionId(model: string): boolean {
  return model === MIMO_SYNTHETIC_MODEL_ID || model.startsWith(MIMO_MODEL_PREFIX);
}

export function encodeMimoModelId(rawModelId: string): string {
  const normalized = rawModelId.trim();
  return normalized ? `${MIMO_MODEL_PREFIX}${normalized}` : MIMO_SYNTHETIC_MODEL_ID;
}

export function decodeMimoModelId(model: string): string | null {
  if (!model.startsWith(MIMO_MODEL_PREFIX)) {
    return null;
  }

  const rawModelId = model.slice(MIMO_MODEL_PREFIX.length).trim();
  return rawModelId || null;
}

export function normalizeMimoDiscoveredModels(value: unknown): MimoDiscoveredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: MimoDiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const rawId = typeof record.rawId === 'string' ? record.rawId.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : rawId;
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    if (!rawId || seen.has(rawId)) {
      continue;
    }

    seen.add(rawId);
    normalized.push({
      ...(description ? { description } : {}),
      label: label || rawId,
      rawId,
    });
  }

  return normalized;
}

export function normalizeMimoModelVariants(value: unknown): MimoModelVariant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const variants: MimoModelVariant[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const rawValue = typeof record.value === 'string' ? record.value.trim() : '';
    if (!rawValue) {
      continue;
    }

    let rawLabel = '';
    if (typeof record.label === 'string') {
      rawLabel = record.label.trim();
    } else if (typeof record.name === 'string') {
      rawLabel = record.name.trim();
    }
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';

    variants.push({
      ...(description ? { description } : {}),
      label: rawLabel || formatMimoThinkingLevelLabel(rawValue),
      value: rawValue,
    });
  }

  return dedupeMimoVariants(variants);
}

export function normalizeMimoThinkingOptionsByModel(
  value: unknown,
  discoveredModels: MimoDiscoveredModel[] = [],
): MimoThinkingOptionsByModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: MimoThinkingOptionsByModel = {};
  for (const [rawId, variants] of Object.entries(value as Record<string, unknown>)) {
    const normalizedRawId = resolveMimoBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedVariants = normalizeMimoModelVariants(variants);
    if (!normalizedRawId || normalizedVariants.length === 0) {
      continue;
    }

    normalized[normalizedRawId] = normalizedVariants;
  }

  return normalized;
}

export function resolveMimoBaseModelRawId(
  rawId: string,
  discoveredModels: MimoDiscoveredModel[] | Set<string>,
): string {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return '';
  }

  const discoveredRawIds = discoveredModels instanceof Set
    ? discoveredModels
    : new Set(discoveredModels.map((model) => model.rawId));
  const slashIndex = normalizedRawId.lastIndexOf('/');
  if (slashIndex <= 0) {
    return normalizedRawId;
  }

  const candidate = normalizedRawId.slice(0, slashIndex);
  if (discoveredRawIds.has(candidate)) {
    return candidate;
  }

  const variant = normalizedRawId.slice(slashIndex + 1).trim().toLowerCase();
  return MIMO_VARIANT_ASCENDING_RANK.has(variant)
    ? candidate
    : normalizedRawId;
}

export function extractMimoModelVariantValue(
  rawId: string,
  discoveredModels: MimoDiscoveredModel[] | Set<string>,
): string | null {
  const normalizedRawId = rawId.trim();
  if (!normalizedRawId) {
    return null;
  }

  const baseRawId = resolveMimoBaseModelRawId(normalizedRawId, discoveredModels);
  if (baseRawId === normalizedRawId || baseRawId.length >= normalizedRawId.length) {
    return null;
  }

  const variant = normalizedRawId.slice(baseRawId.length + 1).trim();
  return variant || null;
}

export function combineMimoRawModelSelection(
  baseRawId: string | null | undefined,
  thinkingLevel: string | null | undefined,
  discoveredModels: MimoDiscoveredModel[],
): string | null {
  const normalizedBaseRawId = baseRawId?.trim();
  if (!normalizedBaseRawId) {
    return null;
  }

  const variant = thinkingLevel?.trim();
  if (!variant || variant === MIMO_DEFAULT_THINKING_LEVEL) {
    return normalizedBaseRawId;
  }

  const supportedVariants = new Set(
    getMimoModelVariants(normalizedBaseRawId, discoveredModels).map((entry) => entry.value),
  );
  return supportedVariants.has(variant)
    ? `${normalizedBaseRawId}/${variant}`
    : normalizedBaseRawId;
}

export function splitMimoModelLabel(label: string): {
  modelLabel: string;
  providerLabel: string;
} {
  const trimmed = label.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return {
      modelLabel: trimmed,
      providerLabel: 'Other',
    };
  }

  return {
    modelLabel: trimmed.slice(slashIndex + 1).trim(),
    providerLabel: trimmed.slice(0, slashIndex).trim(),
  };
}

export function buildMimoBaseModels(
  models: MimoDiscoveredModel[],
): MimoBaseModel[] {
  const discoveredRawIds = new Set(models.map((model) => model.rawId));
  const discoveredByRawId = new Map(models.map((model) => [model.rawId, model] as const));
  const grouped = new Map<string, MimoDiscoveredModel[]>();

  for (const model of models) {
    const baseRawId = resolveMimoBaseModelRawId(model.rawId, discoveredRawIds);
    const existing = grouped.get(baseRawId);
    if (existing) {
      existing.push(model);
    } else {
      grouped.set(baseRawId, [model]);
    }
  }

  return Array.from(grouped.entries())
    .map(([baseRawId, entries]) => {
      const baseModel = discoveredByRawId.get(baseRawId) ?? entries[0];
      const variants = entries.flatMap((entry) => {
        if (entry.rawId === baseRawId) {
          return [];
        }

        const variant = extractMimoModelVariantValue(entry.rawId, discoveredRawIds);
        if (!variant) {
          return [];
        }

        return [{
          ...(entry.description ? { description: entry.description } : {}),
          label: formatMimoThinkingLevelLabel(variant),
          value: variant,
        }];
      });

      return {
        ...(baseModel?.description ? { description: baseModel.description } : {}),
        label: baseModel?.label ?? baseRawId,
        rawId: baseRawId,
        variants: dedupeMimoVariants(variants),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getMimoModelVariants(
  rawId: string,
  models: MimoDiscoveredModel[],
): MimoModelVariant[] {
  const baseRawId = resolveMimoBaseModelRawId(rawId, models);
  return buildMimoBaseModels(models)
    .find((model) => model.rawId === baseRawId)?.variants ?? [];
}

function formatMimoThinkingLevelLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.toLowerCase() === 'xhigh') {
    return 'XHigh';
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function groupMimoDiscoveredModels(
  models: MimoDiscoveredModel[],
): MimoDiscoveredModelGroup[] {
  const groups = new Map<string, MimoDiscoveredModelGroup>();
  for (const model of buildMimoBaseModels(models)) {
    const { providerLabel } = splitMimoModelLabel(model.label || model.rawId);
    const providerKey = providerLabel.toLowerCase();
    const existing = groups.get(providerKey);
    if (existing) {
      existing.models.push({
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        rawId: model.rawId,
      });
      continue;
    }

    groups.set(providerKey, {
      models: [{
        ...(model.description ? { description: model.description } : {}),
        label: model.label,
        rawId: model.rawId,
      }],
      providerKey,
      providerLabel,
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      models: [...group.models].sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => left.providerLabel.localeCompare(right.providerLabel));
}

function dedupeMimoVariants(variants: MimoModelVariant[]): MimoModelVariant[] {
  const unique = new Map<string, MimoModelVariant>();
  for (const variant of variants) {
    if (!unique.has(variant.value)) {
      unique.set(variant.value, variant);
    }
  }

  return Array.from(unique.values())
    .sort((left, right) => compareMimoVariantValues(left.value, right.value));
}

function compareMimoVariantValues(left: string, right: string): number {
  const leftRank = MIMO_VARIANT_ASCENDING_RANK.get(left.toLowerCase());
  const rightRank = MIMO_VARIANT_ASCENDING_RANK.get(right.toLowerCase());

  if (leftRank !== undefined && rightRank !== undefined) {
    return leftRank - rightRank;
  }

  if (leftRank !== undefined) {
    return -1;
  }

  if (rightRank !== undefined) {
    return 1;
  }

  return left.localeCompare(right);
}
