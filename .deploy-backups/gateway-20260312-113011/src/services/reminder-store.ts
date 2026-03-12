import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type ReminderChannel = 'wecom' | 'feishu';
export type ReminderStatus = 'pending' | 'sent';

export interface ReminderRecord {
  id: string;
  channel: ReminderChannel;
  userId: string;
  message: string;
  createdAt: number;
  dueAt: number;
  status: ReminderStatus;
  sentAt?: number;
  sourceAgentId?: string;
}

export interface CreateReminderInput {
  channel: ReminderChannel;
  userId: string;
  message: string;
  dueAt: number;
  sourceAgentId?: string;
}

export class ReminderStore {
  private readonly db: DatabaseSync;

  constructor(private readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(this.filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS reminder_task (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        sent_at INTEGER,
        source_agent_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_reminder_task_status_due_at
        ON reminder_task(status, due_at);
    `);
  }

  createReminder(input: CreateReminderInput): ReminderRecord {
    const now = Date.now();
    const id = randomUUID();
    const record: ReminderRecord = {
      id,
      channel: input.channel,
      userId: input.userId,
      message: input.message.trim(),
      createdAt: now,
      dueAt: Math.max(now, Math.floor(input.dueAt)),
      status: 'pending',
      sourceAgentId: input.sourceAgentId?.trim() || undefined,
    };

    this.db.prepare(`
      INSERT INTO reminder_task(id, channel, user_id, message, created_at, due_at, status, sent_at, source_agent_id)
      VALUES(?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      record.id,
      record.channel,
      record.userId,
      record.message,
      record.createdAt,
      record.dueAt,
      record.status,
      record.sourceAgentId ?? null,
    );

    return record;
  }

  listDuePending(now: number): ReminderRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        channel,
        user_id AS userId,
        message,
        created_at AS createdAt,
        due_at AS dueAt,
        status,
        sent_at AS sentAt,
        source_agent_id AS sourceAgentId
      FROM reminder_task
      WHERE status = 'pending' AND due_at <= ?
      ORDER BY due_at ASC, created_at ASC
    `).all(Math.floor(now)) as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapRow(row));
  }

  markSent(id: string, sentAt = Date.now()): boolean {
    const result = this.db.prepare(`
      UPDATE reminder_task
      SET status = 'sent', sent_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(Math.floor(sentAt), id) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  listPending(): ReminderRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        channel,
        user_id AS userId,
        message,
        created_at AS createdAt,
        due_at AS dueAt,
        status,
        sent_at AS sentAt,
        source_agent_id AS sourceAgentId
      FROM reminder_task
      WHERE status = 'pending'
      ORDER BY due_at ASC, created_at ASC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: Record<string, unknown>): ReminderRecord {
    return {
      id: String(row.id ?? ''),
      channel: row.channel === 'feishu' ? 'feishu' : 'wecom',
      userId: String(row.userId ?? ''),
      message: String(row.message ?? ''),
      createdAt: Number(row.createdAt ?? 0),
      dueAt: Number(row.dueAt ?? 0),
      status: row.status === 'sent' ? 'sent' : 'pending',
      sentAt: typeof row.sentAt === 'number' ? row.sentAt : undefined,
      sourceAgentId: typeof row.sourceAgentId === 'string' && row.sourceAgentId
        ? row.sourceAgentId
        : undefined,
    };
  }
}
