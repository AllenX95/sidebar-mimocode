import { createMockEl } from '@test/helpers/mockElement';

import { updateContextRowHasContent } from '@/features/chat/controllers/contextRowVisibility';

function createContextRow(browserIndicator: HTMLElement | null): HTMLElement {
  const editorIndicator = createMockEl();
  editorIndicator.addClass('sidebar-mimocode-selection-indicator sidebar-mimocode-hidden');
  const canvasIndicator = createMockEl();
  canvasIndicator.addClass('sidebar-mimocode-canvas-indicator sidebar-mimocode-hidden');
  const fileIndicator = createMockEl();
  fileIndicator.addClass('sidebar-mimocode-file-indicator sidebar-mimocode-hidden');
  const imagePreview = createMockEl();
  imagePreview.addClass('sidebar-mimocode-image-preview sidebar-mimocode-hidden');
  const lookup = new Map<string, unknown>([
    ['.sidebar-mimocode-selection-indicator', editorIndicator],
    ['.sidebar-mimocode-browser-selection-indicator', browserIndicator],
    ['.sidebar-mimocode-canvas-indicator', canvasIndicator],
    ['.sidebar-mimocode-file-indicator', fileIndicator],
    ['.sidebar-mimocode-image-preview', imagePreview],
  ]);

  const contextRow = createMockEl();
  const toggle = contextRow.classList.toggle;
  contextRow.classList.toggle = jest.fn((cls: string, force?: boolean) => toggle(cls, force));
  contextRow.querySelector = jest.fn((selector: string) => lookup.get(selector) ?? null);
  return contextRow as unknown as HTMLElement;
}

describe('updateContextRowHasContent', () => {
  it('does not treat missing browser indicator as visible content', () => {
    const contextRowEl = createContextRow(null);

    expect(() => updateContextRowHasContent(contextRowEl)).not.toThrow();
    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', false);
  });

  it('treats browser indicator as visible only when it is not hidden', () => {
    const browserIndicator = createMockEl();
    browserIndicator.addClass('sidebar-mimocode-browser-selection-indicator');
    const contextRowEl = createContextRow(browserIndicator);

    updateContextRowHasContent(contextRowEl);

    expect((contextRowEl.classList.toggle as jest.Mock)).toHaveBeenCalledWith('has-content', true);
  });
});
