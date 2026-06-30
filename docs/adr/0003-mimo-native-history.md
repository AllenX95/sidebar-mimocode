# Place MiMo native history behind a deep module

Status: accepted

Sidebar MiMo-Code will introduce `MimoNativeHistory` under `src/providers/mimo/history/` to own MiMo native history hydration. Its interface hydrates a `Conversation` and builds MiMo-owned persisted provider state, while its implementation owns database path resolution, missing/in-memory database handling, SQLite row loading, `agent_id = 'main'` filtering through the row reader, row-to-message mapping, diagnostic messages, and successful-hydration caching.

This seam keeps `MimoConversationHistoryService` as the adapter for the provider-level history interface. Callers should not inspect SQLite row shape, SQL constants, diagnostic message identifiers, or database cache keys; those details stay inside the native history implementation and its row-reader adapter tests.

`MimoSqliteReader` remains a lower-level adapter for reading `mimocode.db` rows. It can still be tested directly for SQL compatibility with MiMo-Code schema details, but primary history hydration behavior should be tested through `MimoNativeHistory`.
