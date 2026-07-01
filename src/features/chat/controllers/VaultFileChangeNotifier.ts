import { type App,TFile } from 'obsidian';

import { getVaultPath, normalizePathForVault } from '../../../utils/path';

export interface VaultFileChangeNotifierDeps {
  app: App;
  setTimeout?: (callback: () => void, delay: number) => unknown;
}

export class VaultFileChangeNotifier {
  constructor(private readonly deps: VaultFileChangeNotifierDeps) {}

  /**
   * Nudges Obsidian's vault after file edits so the file tree refreshes.
   * Direct filesystem writes bypass the Vault API, and some FSWatchers miss it.
   */
  notifyInput(input: Record<string, unknown>): void {
    const rawPathValue = input.file_path ?? input.notebook_path;
    const rawPath = typeof rawPathValue === 'string' ? rawPathValue : undefined;
    const vaultPath = getVaultPath(this.deps.app);
    const relativePath = normalizePathForVault(rawPath, vaultPath);
    if (!relativePath || relativePath.startsWith('/')) return;

    this.schedule(() => {
      const { vault } = this.deps.app;
      const file = vault.getAbstractFileByPath(relativePath);
      if (file instanceof TFile) {
        vault.trigger('modify', file);
        return;
      }

      const parentDir = relativePath.includes('/')
        ? relativePath.substring(0, relativePath.lastIndexOf('/'))
        : '';
      vault.adapter.list(parentDir).catch(() => { /* ignore */ });
    }, 200);
  }

  notifyApplyPatchInput(input: Record<string, unknown>): void {
    const notified = new Set<string>();

    const changes = input.changes;
    if (Array.isArray(changes)) {
      for (const change of changes) {
        if (change && typeof change === 'object' && !Array.isArray(change)) {
          const changeRecord = change as Record<string, unknown>;
          if (typeof changeRecord.path === 'string') {
            notified.add(changeRecord.path);
            this.notifyInput({ file_path: changeRecord.path });
          }
        }
      }
    }

    const patchText = typeof input.patch === 'string' ? input.patch : '';
    if (!patchText) return;

    for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      const filePath = match[1]?.trim();
      if (filePath && !notified.has(filePath)) {
        this.notifyInput({ file_path: filePath });
      }
    }
  }

  private schedule(callback: () => void, delay: number): void {
    const schedule = this.deps.setTimeout ?? window.setTimeout.bind(window);
    schedule(callback, delay);
  }
}
