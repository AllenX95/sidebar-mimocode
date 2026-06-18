export interface MimoProviderState {
  databasePath?: string;
}

export function getMimoState(
  providerState?: Record<string, unknown>,
): MimoProviderState {
  return (providerState ?? {});
}
