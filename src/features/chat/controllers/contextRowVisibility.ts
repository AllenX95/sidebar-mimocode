export function updateContextRowHasContent(contextRowEl: HTMLElement): void {
  const editorIndicator = contextRowEl.querySelector('.sidebar-mimocode-selection-indicator');
  const browserIndicator = contextRowEl.querySelector('.sidebar-mimocode-browser-selection-indicator');
  const canvasIndicator = contextRowEl.querySelector('.sidebar-mimocode-canvas-indicator');
  const fileIndicator = contextRowEl.querySelector('.sidebar-mimocode-file-indicator');
  const imagePreview = contextRowEl.querySelector('.sidebar-mimocode-image-preview');

  const hasEditorSelection = !!editorIndicator && !editorIndicator.hasClass('sidebar-mimocode-hidden');
  const hasBrowserSelection = !!browserIndicator && !browserIndicator.hasClass('sidebar-mimocode-hidden');
  const hasCanvasSelection = !!canvasIndicator && !canvasIndicator.hasClass('sidebar-mimocode-hidden');
  const hasFileChips = !!fileIndicator && fileIndicator.hasClass('sidebar-mimocode-visible-flex');
  const hasImageChips = !!imagePreview && imagePreview.hasClass('sidebar-mimocode-visible-flex');

  contextRowEl.classList.toggle(
    'has-content',
    hasEditorSelection || hasBrowserSelection || hasCanvasSelection || hasFileChips || hasImageChips
  );
}
