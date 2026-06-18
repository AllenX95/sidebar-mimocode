import { DEFAULT_SIDEBAR_MIMOCODE_SETTINGS } from '@/app/settings/defaultSettings';
import { MIMO_PROVIDER_CAPABILITIES } from '@/providers/mimo/capabilities';
import { getMimoProviderSettings } from '@/providers/mimo/settings';

describe('MiMo defaults and capabilities', () => {
  it('starts on the synthetic MiMo model', () => {
    expect(DEFAULT_SIDEBAR_MIMOCODE_SETTINGS.model).toBe('mimo');
  });

  it('enables the only built-in provider for a new installation', () => {
    expect(getMimoProviderSettings(DEFAULT_SIDEBAR_MIMOCODE_SETTINGS).enabled).toBe(true);
  });

  it('does not advertise fork or MCP support', () => {
    expect(MIMO_PROVIDER_CAPABILITIES.supportsFork).toBe(false);
    expect(MIMO_PROVIDER_CAPABILITIES.supportsMcpTools).toBe(false);
  });
});
