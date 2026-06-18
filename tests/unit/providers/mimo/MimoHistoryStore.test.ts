import { mapMimoMessages } from '@/providers/mimo/history/MimoHistoryStore';

describe('MimoHistoryStore', () => {
  it('hydrates ordered user and assistant content from stored rows', () => {
    const messages = mapMimoMessages([
      {
        info: { id: 'user-1', role: 'user', time: { created: 1_000 } },
        parts: [{ id: 'part-user', text: 'Hello', type: 'text' }],
      },
      {
        info: { id: 'assistant-1', role: 'assistant', time: { completed: 2_500, created: 1_500 } },
        parts: [
          { id: 'part-reasoning', text: 'Consider options', type: 'reasoning' },
          { id: 'part-text', text: 'Answer', type: 'text' },
        ],
      },
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        content: 'Hello',
        id: 'user-1',
        role: 'user',
        timestamp: 1_000,
      }),
      expect.objectContaining({
        content: 'Answer',
        durationSeconds: 1,
        id: 'assistant-1',
        role: 'assistant',
        timestamp: 1_500,
      }),
    ]);
    expect(messages[1]?.contentBlocks).toEqual([
      expect.objectContaining({ content: 'Consider options', type: 'thinking' }),
      { content: 'Answer', type: 'text' },
    ]);
  });
});
