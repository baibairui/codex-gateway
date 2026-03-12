import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface FeishuUserBindingRecord {
  gatewayUserId: string;
  feishuOpenId?: string;
  feishuUserId?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopeSnapshot?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertFeishuUserBindingInput {
  gatewayUserId: string;
  feishuOpenId?: string;
  feishuUserId?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopeSnapshot?: string;
}

export class FeishuUserBindingStore {
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS feishu_user_binding (
        gateway_user_id TEXT PRIMARY KEY,
        feishu_open_id TEXT,
        feishu_user_id TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        scope_snapshot TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  getByGatewayUserId(gatewayUserId: string): FeishuUserBindingRecord | undefined {
    const row = this.db.prepare(`
      SELECT
        gateway_user_id AS gatewayUserId,
        feishu_open_id AS feishuOpenId,
        feishu_user_id AS feishuUserId,
        access_token AS accessToken,
        refresh_token AS refreshToken,
        expires_at AS expiresAt,
        scope_snapshot AS scopeSnapshot,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM feishu_user_binding
      WHERE gateway_user_id = ?
    `).get(gatewayUserId) as Record<string, unknown> | undefined;
    return row ? mapBindingRow(row) : undefined;
  }

  listBindings(): FeishuUserBindingRecord[] {
    const rows = this.db.prepare(`
      SELECT
        gateway_user_id AS gatewayUserId,
        feishu_open_id AS feishuOpenId,
        feishu_user_id AS feishuUserId,
        access_token AS accessToken,
        refresh_token AS refreshToken,
        expires_at AS expiresAt,
        scope_snapshot AS scopeSnapshot,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM feishu_user_binding
      ORDER BY updated_at DESC, created_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(mapBindingRow);
  }

  upsertBinding(input: UpsertFeishuUserBindingInput): FeishuUserBindingRecord {
    const now = Date.now();
    const existing = this.getByGatewayUserId(input.gatewayUserId);
    this.db.prepare(`
      INSERT INTO feishu_user_binding(
        gateway_user_id,
        feishu_open_id,
        feishu_user_id,
        access_token,
        refresh_token,
        expires_at,
        scope_snapshot,
        created_at,
        updated_at
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gateway_user_id) DO UPDATE SET
        feishu_open_id = excluded.feishu_open_id,
        feishu_user_id = excluded.feishu_user_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        scope_snapshot = excluded.scope_snapshot,
        updated_at = excluded.updated_at
    `).run(
      input.gatewayUserId,
      normalizeOptional(input.feishuOpenId),
      normalizeOptional(input.feishuUserId),
      input.accessToken.trim(),
      input.refreshToken.trim(),
      Math.floor(input.expiresAt),
      normalizeOptional(input.scopeSnapshot),
      existing?.createdAt ?? now,
      now,
    );

    return this.getByGatewayUserId(input.gatewayUserId)!;
  }

  clearBinding(gatewayUserId: string): boolean {
    const result = this.db.prepare('DELETE FROM feishu_user_binding WHERE gateway_user_id = ?')
      .run(gatewayUserId) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }
}

function normalizeOptional(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function mapBindingRow(row: Record<string, unknown>): FeishuUserBindingRecord {
  return {
    gatewayUserId: String(row.gatewayUserId ?? ''),
    feishuOpenId: typeof row.feishuOpenId === 'string' && row.feishuOpenId ? row.feishuOpenId : undefined,
    feishuUserId: typeof row.feishuUserId === 'string' && row.feishuUserId ? row.feishuUserId : undefined,
    accessToken: String(row.accessToken ?? ''),
    refreshToken: String(row.refreshToken ?? ''),
    expiresAt: Number(row.expiresAt ?? 0),
    scopeSnapshot: typeof row.scopeSnapshot === 'string' && row.scopeSnapshot ? row.scopeSnapshot : undefined,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  };
}
