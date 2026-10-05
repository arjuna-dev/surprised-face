import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type RoomEvent = { eventSeq: number; type: string; [key: string]: unknown };

export type LocalMessage = {
  id: string;
  roomId: string;
  messageSeq: number;
  participantId: string;
  participantName: string;
  role: 'user' | 'assistant';
  text: string;
  state: string;
  agentId: string | null;
  agentName: string | null;
  ownerId: string | null;
  harness: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

export class LocalStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.database = new DatabaseSync(filePath);
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS catalog_items (
        kind TEXT NOT NULL,
        item_id TEXT NOT NULL,
        harness TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(kind, item_id, harness)
      );
      CREATE TABLE IF NOT EXISTS native_sessions (
        harness TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        format TEXT NOT NULL DEFAULT '',
        complete INTEGER NOT NULL DEFAULT 0,
        next_cursor TEXT NOT NULL DEFAULT '',
        summary TEXT,
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(harness, session_id)
      );
      CREATE TABLE IF NOT EXISTS native_records (
        harness TEXT NOT NULL,
        session_id TEXT NOT NULL,
        record_index INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT '',
        at TEXT,
        raw TEXT NOT NULL,
        PRIMARY KEY(harness, session_id, record_index)
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS room_events (
        room_id TEXT NOT NULL,
        event_seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY(room_id, event_seq)
      );
      CREATE TABLE IF NOT EXISTS room_messages (
        room_id TEXT NOT NULL,
        message_seq INTEGER NOT NULL,
        id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        participant_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        state TEXT NOT NULL,
        agent_id TEXT,
        agent_name TEXT,
        owner_id TEXT,
        harness TEXT,
        model TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(room_id, id),
        UNIQUE(room_id, message_seq)
      );
      CREATE TABLE IF NOT EXISTS room_cursors (
        room_id TEXT PRIMARY KEY,
        event_seq INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS outbox (
        client_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        text TEXT NOT NULL,
        agent_ids TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_sessions (
        room_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        harness TEXT NOT NULL,
        native_session_id TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        context_through_seq INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(room_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS native_room_links (
        harness TEXT NOT NULL,
        session_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        PRIMARY KEY(harness, session_id)
      );
    `);
    const messageColumns = this.database.prepare('PRAGMA table_info(room_messages)').all() as { name: string }[];
    if (!messageColumns.some((column) => column.name === 'participant_name')) {
      this.database.exec("ALTER TABLE room_messages ADD COLUMN participant_name TEXT NOT NULL DEFAULT ''");
    }
  }

  cache(kind: string, itemId: string, harness: string, data: unknown): void {
    this.database.prepare(
      'INSERT INTO catalog_items (kind,item_id,harness,data,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(kind,item_id,harness) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
    ).run(kind, itemId, harness, JSON.stringify(data), new Date().toISOString());
  }

  catalog(kind: string): Record<string, unknown>[] {
    const rows = this.database.prepare('SELECT data FROM catalog_items WHERE kind=? ORDER BY updated_at DESC').all(kind) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data) as Record<string, unknown>);
  }

  saveNativePage(page: {
    harness: string;
    sessionId: string;
    format: string;
    cursor?: string;
    complete: boolean;
    nextCursor?: string;
    summary?: unknown;
    note?: string;
    records: { index: number; kind?: string; at?: string; raw: unknown }[];
  }, title = ''): void {
    const upsertSession = this.database.prepare(`
      INSERT INTO native_sessions (harness,session_id,title,format,complete,next_cursor,summary,note,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(harness,session_id) DO UPDATE SET title=CASE WHEN excluded.title='' THEN title ELSE excluded.title END,
        format=excluded.format,complete=excluded.complete,next_cursor=excluded.next_cursor,
        summary=COALESCE(excluded.summary,summary),note=excluded.note,updated_at=excluded.updated_at
    `);
    const upsertRecord = this.database.prepare(`
      INSERT INTO native_records (harness,session_id,record_index,kind,at,raw) VALUES (?,?,?,?,?,?)
      ON CONFLICT(harness,session_id,record_index) DO UPDATE SET kind=excluded.kind,at=excluded.at,raw=excluded.raw
    `);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (!page.cursor || page.cursor === '0') {
        this.database.prepare('DELETE FROM native_records WHERE harness=? AND session_id=?').run(page.harness, page.sessionId);
      }
      upsertSession.run(page.harness, page.sessionId, title, page.format, Number(page.complete), page.nextCursor || '', page.summary ? JSON.stringify(page.summary) : null, page.note || '', new Date().toISOString());
      for (const record of page.records) upsertRecord.run(page.harness, page.sessionId, record.index, record.kind || '', record.at || null, JSON.stringify(record.raw));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  nativeRecords(harness: string, sessionId: string): unknown[] {
    const rows = this.database.prepare('SELECT record_index,kind,at,raw FROM native_records WHERE harness=? AND session_id=? ORDER BY record_index').all(harness, sessionId) as
      { record_index: number; kind: string; at: string | null; raw: string }[];
    return rows.map((row) => ({ index: row.record_index, kind: row.kind, at: row.at, raw: JSON.parse(row.raw) }));
  }

  storeRooms(rooms: { id: string; name: string; createdAt?: string }[]): void {
    const upsert = this.database.prepare('INSERT INTO rooms (id,name,created_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const room of rooms) upsert.run(room.id, room.name, room.createdAt || '');
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  applyEvent(roomId: string, event: RoomEvent): boolean {
    const createdAt = typeof event.sourceAt === 'string' ? event.sourceAt : typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const inserted = this.database.prepare('INSERT OR IGNORE INTO room_events (room_id,event_seq,type,data) VALUES (?,?,?,?)')
        .run(roomId, event.eventSeq, event.type, JSON.stringify(event));
      if (Number(inserted.changes) === 0) {
        this.database.exec('COMMIT');
        return false;
      }
      const messageId = stringValue(event.messageId);
      const messageSeq = numberValue(event.messageSeq);
      if (event.type === 'message.created' && messageId && messageSeq !== null) {
        this.database.prepare(`
          INSERT INTO room_messages (room_id,message_seq,id,participant_id,participant_name,role,text,state,agent_id,agent_name,owner_id,harness,model,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(room_id,id) DO UPDATE SET text=excluded.text, participant_name=excluded.participant_name, updated_at=excluded.updated_at
        `).run(roomId, messageSeq, messageId, stringValue(event.participantId) || '', stringValue(event.participantName) || '', event.role === 'assistant' ? 'assistant' : 'user', stringValue(event.text) || '', 'complete', stringValue(event.agentId), stringValue(event.agentName), stringValue(event.ownerId), stringValue(event.harness), stringValue(event.model), createdAt, createdAt);
      } else if (event.type === 'turn.started' && messageId && messageSeq !== null) {
        this.database.prepare(`
          INSERT INTO room_messages (room_id,message_seq,id,participant_id,participant_name,role,text,state,agent_id,agent_name,owner_id,harness,model,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(room_id,id) DO NOTHING
        `).run(roomId, messageSeq, messageId, stringValue(event.agentId) || '', stringValue(event.agentName) || '', 'assistant', '', 'streaming', stringValue(event.agentId), stringValue(event.agentName), stringValue(event.ownerId), stringValue(event.harness), stringValue(event.model), createdAt, createdAt);
      } else if (event.type === 'message.delta' && messageId) {
        this.database.prepare('UPDATE room_messages SET text=text || ?, updated_at=? WHERE room_id=? AND id=?')
          .run(stringValue(event.text) || '', createdAt, roomId, messageId);
      } else if (event.type === 'turn.finished' && messageId) {
        this.database.prepare('UPDATE room_messages SET state=?, updated_at=? WHERE room_id=? AND id=?')
          .run(stringValue(event.state) || 'complete', createdAt, roomId, messageId);
      }
      this.database.prepare(`
        INSERT INTO room_cursors (room_id,event_seq) VALUES (?,?)
        ON CONFLICT(room_id) DO UPDATE SET event_seq=MAX(event_seq,excluded.event_seq)
      `).run(roomId, event.eventSeq);
      this.database.exec('COMMIT');
      return true;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  cursor(roomId: string): number {
    const row = this.database.prepare('SELECT event_seq FROM room_cursors WHERE room_id=?').get(roomId) as { event_seq?: number } | undefined;
    return Number(row?.event_seq || 0);
  }

  messages(roomId: string): LocalMessage[] {
    const rows = this.database.prepare('SELECT * FROM room_messages WHERE room_id=? ORDER BY message_seq ASC').all(roomId) as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      id: stringValue(row.id) || '', roomId: stringValue(row.room_id) || '', messageSeq: Number(row.message_seq || 0),
      participantId: stringValue(row.participant_id) || '', participantName: stringValue(row.participant_name) || '',
      role: row.role === 'assistant' ? 'assistant' : 'user',
      text: stringValue(row.text) || '', state: stringValue(row.state) || 'complete',
      agentId: typeof row.agent_id === 'string' ? row.agent_id : null,
      agentName: typeof row.agent_name === 'string' ? row.agent_name : null,
      ownerId: typeof row.owner_id === 'string' ? row.owner_id : null,
      harness: typeof row.harness === 'string' ? row.harness : null,
      model: typeof row.model === 'string' ? row.model : null,
      createdAt: stringValue(row.created_at) || '', updatedAt: stringValue(row.updated_at) || '',
    }));
  }

  queueMessage(input: { clientId: string; roomId: string; text: string; agentIds?: string[] }): void {
    this.database.prepare('INSERT OR IGNORE INTO outbox (client_id,room_id,text,agent_ids,state,created_at) VALUES (?,?,?,?,?,?)')
      .run(input.clientId, input.roomId, input.text, JSON.stringify(input.agentIds || []), 'pending', new Date().toISOString());
  }

  pendingMessages(roomId?: string): { client_id: string; room_id: string; text: string; agent_ids: string }[] {
    const query = roomId
      ? this.database.prepare("SELECT client_id,room_id,text,agent_ids FROM outbox WHERE state='pending' AND room_id=? ORDER BY created_at,rowid")
      : this.database.prepare("SELECT client_id,room_id,text,agent_ids FROM outbox WHERE state='pending' ORDER BY created_at,rowid");
    return (roomId ? query.all(roomId) : query.all()) as unknown as { client_id: string; room_id: string; text: string; agent_ids: string }[];
  }

  pendingOutbox(roomId: string): { client_id: string; room_id: string; text: string; agent_ids: string; error: string | null; created_at: string }[] {
    return this.database.prepare(
      "SELECT client_id,room_id,text,agent_ids,error,created_at FROM outbox WHERE state='pending' AND room_id=? ORDER BY created_at,rowid",
    ).all(roomId) as unknown as { client_id: string; room_id: string; text: string; agent_ids: string; error: string | null; created_at: string }[];
  }

  updateOutbox(clientId: string, state: 'sent' | 'failed' | 'pending', error?: string): void {
    this.database.prepare('UPDATE outbox SET state=?, error=? WHERE client_id=?').run(state, error || null, clientId);
  }

  agentSession(roomId: string, agentId: string): { harness: string; native_session_id: string; working_directory: string; model: string; context_through_seq: number } | undefined {
    return this.database.prepare('SELECT harness,native_session_id,working_directory,model,context_through_seq FROM agent_sessions WHERE room_id=? AND agent_id=?').get(roomId, agentId) as
      | { harness: string; native_session_id: string; working_directory: string; model: string; context_through_seq: number }
      | undefined;
  }

  nativeRoomLink(harness: string, sessionId: string): { roomId: string; agentId: string } | null {
    const row = this.database.prepare('SELECT room_id, agent_id FROM native_room_links WHERE harness=? AND session_id=?').get(harness, sessionId) as { room_id: string; agent_id: string } | undefined;
    return row ? { roomId: row.room_id, agentId: row.agent_id } : null;
  }

  saveNativeRoomLink(harness: string, sessionId: string, roomId: string, agentId: string): void {
    this.database.prepare('INSERT INTO native_room_links (harness,session_id,room_id,agent_id) VALUES (?,?,?,?) ON CONFLICT(harness,session_id) DO UPDATE SET room_id=excluded.room_id, agent_id=excluded.agent_id')
      .run(harness, sessionId, roomId, agentId);
  }

  saveAgentSession(input: { roomId: string; agentId: string; harness: string; sessionId: string; cwd: string; model?: string; contextThroughSeq?: number }): void {
    this.database.prepare(`
      INSERT INTO agent_sessions (room_id,agent_id,harness,native_session_id,working_directory,model,context_through_seq,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(room_id,agent_id) DO UPDATE SET harness=excluded.harness,native_session_id=excluded.native_session_id,
        working_directory=excluded.working_directory,model=excluded.model,context_through_seq=excluded.context_through_seq,updated_at=excluded.updated_at
    `).run(input.roomId, input.agentId, input.harness, input.sessionId, input.cwd, input.model || '', input.contextThroughSeq || 0, new Date().toISOString());
  }

  close(): void {
    this.database.close();
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
