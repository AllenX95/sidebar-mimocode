import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  loadMimoSessionRows,
  MIMO_MESSAGE_ROW_SQL,
  MIMO_PART_ROW_SQL,
} from '@/providers/mimo/history/MimoSqliteReader';

describe('MimoSqliteReader', () => {
  it('filters messages and parts to the main agent on both query paths', async () => {
    const databasePath = path.join(os.tmpdir(), `mimocode-history-${process.pid}-${Date.now()}.db`);
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`
        create table message (
          id text primary key,
          session_id text not null,
          agent_id text not null default 'main',
          time_created integer not null,
          data text not null
        );
        create table part (
          id text primary key,
          message_id text not null,
          session_id text not null,
          data text not null
        );
        insert into message values ('main-1', 'session-1', 'main', 1, '{"role":"user"}');
        insert into message values ('sub-1', 'session-1', 'reviewer', 2, '{"role":"assistant"}');
        insert into message values ('main-2', 'session-1', 'main', 3, '{"role":"assistant"}');
        insert into part values ('part-main-1', 'main-1', 'session-1', '{}');
        insert into part values ('part-sub-1', 'sub-1', 'session-1', '{}');
        insert into part values ('part-main-2', 'main-2', 'session-1', '{}');
      `);
    } finally {
      db.close();
    }

    try {
      const rows = await loadMimoSessionRows(databasePath, 'session-1', {
        requireSqliteModule: () => ({ DatabaseSync }),
      });

      expect(MIMO_MESSAGE_ROW_SQL).toContain("agent_id = 'main'");
      expect(MIMO_PART_ROW_SQL).toContain("message.agent_id = 'main'");
      expect(rows?.messageRows.map(row => row.id)).toEqual(['main-1', 'main-2']);
      expect(rows?.partRows.map(row => row.id)).toEqual(['part-main-1', 'part-main-2']);
    } finally {
      fs.rmSync(databasePath, { force: true });
    }
  });
});
