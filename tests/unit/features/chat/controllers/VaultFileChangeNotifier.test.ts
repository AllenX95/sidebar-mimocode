import { TFile } from 'obsidian';

import { VaultFileChangeNotifier } from '@/features/chat/controllers/VaultFileChangeNotifier';

function createApp(options: { files?: Record<string, TFile> } = {}) {
  const files = options.files ?? {};
  return {
    vault: {
      adapter: {
        basePath: '/vault',
        list: jest.fn(async () => ({ files: [], folders: [] })),
      },
      getAbstractFileByPath: jest.fn((path: string) => files[path] ?? null),
      trigger: jest.fn(),
    },
  };
}

function createNotifier(app: ReturnType<typeof createApp>) {
  const scheduled: Array<() => void> = [];
  const notifier = new VaultFileChangeNotifier({
    app: app as never,
    setTimeout: (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
  });

  return { notifier, runScheduled: () => scheduled.splice(0).forEach(callback => callback()) };
}

describe('VaultFileChangeNotifier', () => {
  it('triggers modify for an existing vault file', () => {
    const file = new (TFile as any)('notes/a.md') as TFile;
    const app = createApp({ files: { 'notes/a.md': file } });
    const { notifier, runScheduled } = createNotifier(app);

    notifier.notifyInput({ file_path: 'notes/a.md' });
    runScheduled();

    expect(app.vault.trigger).toHaveBeenCalledWith('modify', file);
    expect(app.vault.adapter.list).not.toHaveBeenCalled();
  });

  it('scans the parent directory when the file is not yet in the vault cache', () => {
    const app = createApp();
    const { notifier, runScheduled } = createNotifier(app);

    notifier.notifyInput({ file_path: 'notes/new.md' });
    runScheduled();

    expect(app.vault.trigger).not.toHaveBeenCalled();
    expect(app.vault.adapter.list).toHaveBeenCalledWith('notes');
  });

  it('uses notebook_path when file_path is absent', () => {
    const app = createApp();
    const { notifier, runScheduled } = createNotifier(app);

    notifier.notifyInput({ notebook_path: 'notebooks/run.ipynb' });
    runScheduled();

    expect(app.vault.adapter.list).toHaveBeenCalledWith('notebooks');
  });

  it('notifies changed paths from apply_patch changes and patch text without duplicates', () => {
    const app = createApp();
    const { notifier, runScheduled } = createNotifier(app);

    notifier.notifyApplyPatchInput({
      changes: [{ path: 'src/a.ts' }],
      patch: [
        '*** Begin Patch',
        '*** Update File: src/a.ts',
        '*** Add File: src/b.ts',
        '*** Delete File: src/c.ts',
        '*** End Patch',
      ].join('\n'),
    });
    runScheduled();

    expect(app.vault.adapter.list).toHaveBeenCalledTimes(3);
    expect(app.vault.adapter.list).toHaveBeenNthCalledWith(1, 'src');
    expect(app.vault.adapter.list).toHaveBeenNthCalledWith(2, 'src');
    expect(app.vault.adapter.list).toHaveBeenNthCalledWith(3, 'src');
  });

  it('ignores paths outside the vault', () => {
    const app = createApp();
    const { notifier, runScheduled } = createNotifier(app);

    notifier.notifyInput({ file_path: '/outside/file.md' });
    runScheduled();

    expect(app.vault.trigger).not.toHaveBeenCalled();
    expect(app.vault.adapter.list).not.toHaveBeenCalled();
  });
});
