import type { PreparedChatTurn } from '@/core/runtime/types';
import type SidebarMimocodePlugin from '@/main';
import { MimoChatRuntime } from '@/providers/mimo/runtime/MimoChatRuntime';

describe('MimoChatRuntime', () => {
  it('explains how to enable MiMo-Code instead of reporting a CLI failure', async () => {
    const plugin = {
      settings: {
        providerConfigs: {
          mimo: { enabled: false },
        },
      },
    } as unknown as SidebarMimocodePlugin;
    const runtime = new MimoChatRuntime(plugin);
    const turn: PreparedChatTurn = {
      isCompact: false,
      mcpMentions: new Set(),
      persistedContent: '',
      prompt: 'Hello',
      request: { text: 'Hello' },
    };

    const chunks = [];
    for await (const chunk of runtime.query(turn)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        type: 'error',
        content: 'MiMo-Code is disabled. Enable it in Settings → Sidebar MiMo-Code → Enable MiMo-Code.',
      },
      { type: 'done' },
    ]);
  });
});
