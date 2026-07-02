/** @jest-environment jsdom */

import {
  createProviderIconSvg,
  MIMO_PROVIDER_ICON,
  OPENAI_PROVIDER_ICON,
  OPENCODE_PROVIDER_ICON,
  PI_PROVIDER_ICON,
} from '@/shared/icons';

describe('createProviderIconSvg', () => {
  it('renders path-based provider icons with currentColor fill', () => {
    const svg = createProviderIconSvg(OPENAI_PROVIDER_ICON, {
      className: 'test-icon',
      height: 12,
      ownerDocument: document,
      width: 12,
    });

    expect(svg.getAttribute('viewBox')).toBe(OPENAI_PROVIDER_ICON.viewBox);
    expect(svg.getAttribute('width')).toBe('12');
    expect(svg.getAttribute('height')).toBe('12');
    expect(svg.classList.contains('sidebar-mimocode-provider-icon')).toBe(true);
    expect(svg.classList.contains('test-icon')).toBe(true);

    const path = svg.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('fill')).toBe('currentColor');
  });

  it('renders composite provider icons with theme variants', () => {
    const svg = createProviderIconSvg(OPENCODE_PROVIDER_ICON, {
      dataProvider: 'opencode',
      height: 18,
      ownerDocument: document,
      width: 18,
    });

    expect(svg.getAttribute('data-provider')).toBe('opencode');
    expect(svg.getAttribute('viewBox')).toBe(OPENCODE_PROVIDER_ICON.viewBox);
    expect(svg.querySelector('.sidebar-mimocode-provider-icon-variant--light')).not.toBeNull();
    expect(svg.querySelector('.sidebar-mimocode-provider-icon-variant--dark')).not.toBeNull();
  });

  it('renders the MiMo provider icon as a Xiaomi-orange pixel robot', () => {
    const svg = createProviderIconSvg(MIMO_PROVIDER_ICON, {
      dataProvider: 'mimo',
      ownerDocument: document,
    });

    expect(svg.getAttribute('data-provider')).toBe('mimo');
    expect(svg.getAttribute('viewBox')).toBe('0 0 300 300');
    expect(svg.querySelector('.sidebar-mimocode-provider-icon-variant--light')?.getAttribute('shape-rendering'))
      .toBe('crispEdges');
    expect(svg.querySelector('.sidebar-mimocode-provider-icon-variant--dark')?.getAttribute('shape-rendering'))
      .toBe('crispEdges');
    expect(svg.querySelectorAll('path[fill="#FF6900"]')).toHaveLength(2);
    expect(svg.querySelector('path[d*="M135 30H165V60H135V30"]')).not.toBeNull();
    expect(svg.querySelector('path[d*="M105 125H135V155H105V125"]')).not.toBeNull();
  });

  it('renders the Pi provider icon as currentColor composite paths', () => {
    const svg = createProviderIconSvg(PI_PROVIDER_ICON, {
      dataProvider: 'pi',
      ownerDocument: document,
    });

    expect(svg.getAttribute('viewBox')).toBe('0 0 800 800');
    const paths = Array.from(svg.querySelectorAll('path'));
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('fill-rule')).toBe('evenodd');
    expect(paths.every(path => path.getAttribute('fill') === 'currentColor')).toBe(true);
  });
});
