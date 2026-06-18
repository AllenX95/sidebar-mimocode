import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

describe('getBuiltInProviderDefaultConfigs', () => {
  it('returns only a fresh MiMo provider config', () => {
    const first = getBuiltInProviderDefaultConfigs();
    const second = getBuiltInProviderDefaultConfigs();

    expect(Object.keys(first)).toEqual(['mimo']);
    expect(first).not.toBe(second);
    expect(first.mimo).not.toBe(second.mimo);
  });

  it('does not share nested mutable MiMo settings', () => {
    const first = getBuiltInProviderDefaultConfigs();
    const second = getBuiltInProviderDefaultConfigs();
    const firstMimo = first.mimo!;
    const secondMimo = second.mimo!;

    expect(firstMimo.cliPathsByHost).not.toBe(secondMimo.cliPathsByHost);
    expect(firstMimo.modelAliases).not.toBe(secondMimo.modelAliases);
    expect(firstMimo.visibleModels).not.toBe(secondMimo.visibleModels);
  });
});
