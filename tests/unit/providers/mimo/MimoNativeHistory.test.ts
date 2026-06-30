import type { Conversation } from '@/core/types';
import {
  MimoNativeHistory,
  type MimoNativeHistoryRowReader,
} from '@/providers/mimo/history/MimoNativeHistory';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    createdAt: 1,
    id: 'conversation-1',
    messages: [],
    providerId: 'mimo',
    sessionId: 'session-1',
    title: 'Conversation',
    updatedAt: 1,
    ...overrides,
  };
}

function createReader(
  rows: Awaited<ReturnType<MimoNativeHistoryRowReader['loadSessionRows']>>,
): MimoNativeHistoryRowReader {
  return {
    loadSessionRows: jest.fn(async () => rows),
  };
}

describe('MimoNativeHistory', () => {
  it('hydrates a conversation through the native history interface and caches successful loads', async () => {
    const rowReader = createReader({
      messageRows: [
        {
          data: JSON.stringify({ role: 'user', time: { created: 1_000 } }),
          id: 'user-1',
          time_created: 1_000,
        },
        {
          data: JSON.stringify({ role: 'assistant', time: { completed: 2_500, created: 1_500 } }),
          id: 'assistant-1',
          time_created: 1_500,
        },
      ],
      partRows: [
        {
          data: JSON.stringify({ text: 'Hello', type: 'text' }),
          id: 'part-user',
          message_id: 'user-1',
        },
        {
          data: JSON.stringify({ text: 'Answer', type: 'text' }),
          id: 'part-assistant',
          message_id: 'assistant-1',
        },
      ],
    });
    const history = new MimoNativeHistory({
      fileExists: () => true,
      resolveDatabasePath: () => 'C:\\Users\\Ada\\AppData\\Roaming\\mimocode\\mimocode.db',
      rowReader,
    });
    const conversation = createConversation({
      providerState: {
        databasePath: 'C:\\Users\\Ada\\AppData\\Roaming\\mimocode\\mimocode.db',
      },
    });

    await history.hydrateConversationHistory(conversation);
    await history.hydrateConversationHistory(conversation);

    expect(rowReader.loadSessionRows).toHaveBeenCalledTimes(1);
    expect(conversation.messages).toEqual([
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
  });

  it('does not cache diagnostic hydration failures', async () => {
    const rowReader = createReader(null);
    const history = new MimoNativeHistory({
      fileExists: () => true,
      now: () => 9_999,
      resolveDatabasePath: () => 'C:\\Users\\Ada\\AppData\\Roaming\\mimocode\\mimocode.db',
      rowReader,
    });
    const conversation = createConversation({
      providerState: {
        databasePath: 'C:\\Users\\Ada\\AppData\\Roaming\\mimocode\\mimocode.db',
      },
    });

    await history.hydrateConversationHistory(conversation);
    await history.hydrateConversationHistory(conversation);

    expect(rowReader.loadSessionRows).toHaveBeenCalledTimes(2);
    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0]).toEqual(expect.objectContaining({
      content: expect.stringContaining('Could not read MiMo-Code session rows from SQLite.'),
      id: 'mimo-hydration-error-session-session-1',
      role: 'assistant',
      timestamp: 9_999,
    }));
  });

  it('persists only MiMo native history state owned by the provider', () => {
    const history = new MimoNativeHistory();
    const conversation = createConversation({
      providerState: {
        databasePath: 'C:\\mimocode\\mimocode.db',
        unrelated: 'ignore',
      },
    });

    expect(history.buildPersistedProviderState(conversation)).toEqual({
      databasePath: 'C:\\mimocode\\mimocode.db',
    });
  });
});
