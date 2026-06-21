import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { t } from '../../i18n/i18n';

interface DestructiveButtonCompat {
  setDestructive?: () => unknown;
  setWarning?: () => unknown;
}

function setDestructiveButtonStyle(button: DestructiveButtonCompat): void {
  // setDestructive arrived in 1.13.0; retain the legacy path while supporting 1.7.2.
  if (button.setDestructive) {
    button.setDestructive();
    return;
  }

  button.setWarning?.();
}

export function confirmDelete(app: App, message: string): Promise<boolean> {
  return new Promise(resolve => {
    new ConfirmModal(app, message, resolve).open();
  });
}

export function confirm(app: App, message: string, confirmText: string): Promise<boolean> {
  return new Promise(resolve => {
    new ConfirmModal(app, message, resolve, confirmText).open();
  });
}

class ConfirmModal extends Modal {
  private message: string;
  private resolve: (confirmed: boolean) => void;
  private resolved = false;
  private confirmText: string;

  constructor(app: App, message: string, resolve: (confirmed: boolean) => void, confirmText?: string) {
    super(app);
    this.message = message;
    this.resolve = resolve;
    this.confirmText = confirmText ?? t('common.delete');
  }

  onOpen() {
    this.setTitle(t('common.confirm'));
    this.modalEl.addClass('sidebar-mimocode-confirm-modal');

    this.contentEl.createEl('p', { text: this.message });

    new Setting(this.contentEl)
      .addButton(btn =>
        btn
          .setButtonText(t('common.cancel'))
          .onClick(() => this.close())
      )
      .addButton(btn => {
        btn.setButtonText(this.confirmText);
        setDestructiveButtonStyle(btn);
        btn.onClick(() => {
          this.resolved = true;
          this.resolve(true);
          this.close();
        });
      });
  }

  onClose() {
    if (!this.resolved) {
      this.resolve(false);
    }
    this.contentEl.empty();
  }
}
