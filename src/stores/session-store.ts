import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SessionStore');
const DEFAULT_AGENT_ID = 'default';
const HIDDEN_AGENT_ID_PREFIXES = ['memory-onboarding'];
const HIDDEN_AGENT_NAMES = new Set(['记忆初始化引导']);

export interface SessionListItem {
  threadId: string;
  name?: string;
  lastPrompt?: string;
  updatedAt: number;
}

export interface SessionState {
  threadId?: string;
  boundIdentityVersion?: string;
}

export interface AgentRecord {
  agentId: string;
  name: string;
  workspaceDir: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgentListItem extends AgentRecord {
  current: boolean;
  isDefault: boolean;
}

interface SessionStoreOptions {
  defaultWorkspaceDir: string;
}

export class SessionStore {
  private readonly filePath: string;
  private readonly db: DatabaseSync;
  private readonly defaultWorkspaceDir: string;
  private lastTs = 0;

  constructor(filePath: string, options: SessionStoreOptions) {
    this.filePath = filePath;
    this.defaultWorkspaceDir = path.resolve(options.defaultWorkspaceDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    this.db = new DatabaseSync(this.filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);

    this.ensureSchema();

    const row = this.db.prepare('SELECT COUNT(*) AS count FROM user_session').get() as { count: number };
    log.info('SessionStore 已加载(SQLite)', {
      filePath: this.filePath,
      sessionCount: row.count,
    });
  }

  getCurrentAgent(userId: string): AgentRecord {
    const selected = this.db
      .prepare('SELECT agent_id AS agentId FROM user_current_agent WHERE user_id = ?')
      .get(userId) as { agentId?: string } | undefined;
    const agentId = selected?.agentId ?? DEFAULT_AGENT_ID;
    const custom = this.getCustomAgent(userId, agentId);
    return custom ?? this.getDefaultAgent();
  }

  listAgents(userId: string, options: { includeHidden?: boolean } = {}): AgentListItem[] {
    const includeHidden = options.includeHidden ?? false;
    const currentAgentId = this.getCurrentAgent(userId).agentId;
    const rows = this.db
      .prepare(`
        SELECT
          agent_id AS agentId,
          name,
          workspace_dir AS workspaceDir,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM user_agent
        WHERE user_id = ?
        ORDER BY updated_at DESC, created_at DESC
      `)
      .all(userId) as Array<Record<string, unknown>>;

    const customAgents = rows
      .map((row) => ({
      agentId: String(row.agentId ?? ''),
      name: String(row.name ?? ''),
      workspaceDir: String(row.workspaceDir ?? ''),
      createdAt: numberRow(row.createdAt),
      updatedAt: numberRow(row.updatedAt),
      current: currentAgentId === row.agentId,
      isDefault: false,
      }))
      .filter((agent) => includeHidden || !isHiddenAgent(agent));

    return [
      {
        ...this.getDefaultAgent(),
        current: currentAgentId === DEFAULT_AGENT_ID,
        isDefault: true,
      },
      ...customAgents,
    ];
  }

  listKnownUsers(): string[] {
    const rows = this.db
      .prepare(`
        SELECT DISTINCT user_id AS userId FROM (
          SELECT user_id FROM user_session
          UNION
          SELECT user_id FROM user_history
          UNION
          SELECT user_id FROM user_current_agent
          UNION
          SELECT user_id FROM user_agent
          UNION
          SELECT user_id FROM user_agent_settings
          UNION
          SELECT user_id FROM user_agent_session
          UNION
          SELECT user_id FROM user_agent_history
        )
        ORDER BY user_id ASC
      `)
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => String(row.userId ?? '')).filter(Boolean);
  }

  createAgent(userId: string, input: { agentId: string; name: string; workspaceDir: string }): AgentRecord {
    const now = this.nextTimestamp();
    this.db
      .prepare(`
        INSERT INTO user_agent(user_id, agent_id, name, workspace_dir, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?)
      `)
      .run(userId, input.agentId, input.name.trim(), path.resolve(input.workspaceDir), now, now);

    return {
      agentId: input.agentId,
      name: input.name.trim(),
      workspaceDir: path.resolve(input.workspaceDir),
      createdAt: now,
      updatedAt: now,
    };
  }

  setCurrentAgent(userId: string, agentId: string): boolean {
    if (agentId !== DEFAULT_AGENT_ID && !this.getCustomAgent(userId, agentId)) {
      return false;
    }
    this.db
      .prepare(`
        INSERT INTO user_current_agent(user_id, agent_id, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          agent_id = excluded.agent_id,
          updated_at = excluded.updated_at
      `)
      .run(userId, agentId, this.nextTimestamp());
    return true;
  }

  resolveAgentTarget(userId: string, target: string): string | undefined {
    const raw = target.trim();
    if (!raw) {
      return undefined;
    }
    if (/^\d+$/.test(raw)) {
      const index = Number(raw);
      if (index <= 0) {
        return undefined;
      }
      return this.listAgents(userId)[index - 1]?.agentId;
    }
    if (raw === DEFAULT_AGENT_ID) {
      return DEFAULT_AGENT_ID;
    }
    if (isHiddenAgentId(raw)) {
      return undefined;
    }
    const custom = this.getCustomAgent(userId, raw);
    if (!custom) {
      return undefined;
    }
    if (isHiddenAgent(custom)) {
      return undefined;
    }
    return custom.agentId;
  }

  getSession(userId: string, agentId: string): string | undefined {
    return this.getSessionState(userId, agentId).threadId;
  }

  getSessionState(userId: string, agentId: string): SessionState {
    const row = this.db
      .prepare(`
        SELECT current_thread_id AS threadId, bound_identity_version AS boundIdentityVersion
        FROM user_agent_session
        WHERE user_id = ? AND agent_id = ?
      `)
      .get(userId, agentId) as { threadId?: string; boundIdentityVersion?: string } | undefined;
    if (row?.threadId) {
      return {
        threadId: row.threadId,
        boundIdentityVersion: typeof row.boundIdentityVersion === 'string' && row.boundIdentityVersion
          ? row.boundIdentityVersion
          : undefined,
      };
    }
    if (agentId === DEFAULT_AGENT_ID) {
      return this.getLegacySessionState(userId);
    }
    return {};
  }

  getModelOverride(userId: string, agentId: string): string | undefined {
    const row = this.db
      .prepare(`
        SELECT model_override AS modelOverride
        FROM user_agent_settings
        WHERE user_id = ? AND agent_id = ?
      `)
      .get(userId, agentId) as { modelOverride?: string | null } | undefined;
    return typeof row?.modelOverride === 'string' && row.modelOverride ? row.modelOverride : undefined;
  }

  setModelOverride(userId: string, agentId: string, model: string): void {
    this.db
      .prepare(`
        INSERT INTO user_agent_settings(user_id, agent_id, model_override, updated_at)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(user_id, agent_id) DO UPDATE SET
          model_override = excluded.model_override,
          updated_at = excluded.updated_at
      `)
      .run(userId, agentId, model.trim(), this.nextTimestamp());
  }

  clearModelOverride(userId: string, agentId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM user_agent_settings WHERE user_id = ? AND agent_id = ?')
      .run(userId, agentId) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  setSession(
    userId: string,
    agentId: string,
    threadId: string,
    lastPrompt?: string,
    options: { boundIdentityVersion?: string } = {},
  ): void {
    const now = this.nextTimestamp();
    this.withTransaction(() => {
      this.db
        .prepare(`
          INSERT INTO user_agent_session(user_id, agent_id, current_thread_id, bound_identity_version, updated_at)
          VALUES(?, ?, ?, ?, ?)
          ON CONFLICT(user_id, agent_id) DO UPDATE SET
            current_thread_id = excluded.current_thread_id,
            bound_identity_version = excluded.bound_identity_version,
            updated_at = excluded.updated_at
        `)
        .run(userId, agentId, threadId, options.boundIdentityVersion ?? null, now);

      this.db
        .prepare(`
          INSERT INTO user_agent_history(user_id, agent_id, thread_id, updated_at)
          VALUES(?, ?, ?, ?)
          ON CONFLICT(user_id, agent_id, thread_id) DO UPDATE SET
            updated_at = excluded.updated_at
        `)
        .run(userId, agentId, threadId, now);

      this.upsertSessionMeta(threadId, lastPrompt, now);

      this.db
        .prepare(`
          DELETE FROM user_agent_history
          WHERE user_id = ?
            AND agent_id = ?
            AND thread_id IN (
              SELECT thread_id
              FROM user_agent_history
              WHERE user_id = ?
                AND agent_id = ?
              ORDER BY updated_at DESC
              LIMIT -1 OFFSET 20
            )
        `)
        .run(userId, agentId, userId, agentId);

      if (agentId === DEFAULT_AGENT_ID) {
        this.persistLegacySession(userId, threadId, lastPrompt, now, options.boundIdentityVersion);
      }

      if (agentId !== DEFAULT_AGENT_ID) {
        this.db
          .prepare('UPDATE user_agent SET updated_at = ? WHERE user_id = ? AND agent_id = ?')
          .run(now, userId, agentId);
      }
    });
  }

  clearSession(userId: string, agentId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM user_agent_session WHERE user_id = ? AND agent_id = ?')
      .run(userId, agentId) as { changes?: number };
    if (agentId === DEFAULT_AGENT_ID) {
      this.db.prepare('DELETE FROM user_session WHERE user_id = ?').run(userId);
    }
    return (result.changes ?? 0) > 0;
  }

  listDetailed(userId: string, agentId: string): SessionListItem[] {
    const rows = this.db
      .prepare(`
        SELECT
          h.thread_id AS threadId,
          m.name AS name,
          m.last_prompt AS lastPrompt,
          COALESCE(m.updated_at, h.updated_at) AS updatedAt
        FROM user_agent_history h
        LEFT JOIN session_meta m ON m.thread_id = h.thread_id
        WHERE h.user_id = ?
          AND h.agent_id = ?
        ORDER BY h.updated_at DESC
        LIMIT 20
      `)
      .all(userId, agentId) as Array<Record<string, unknown>>;
    if (rows.length > 0 || agentId !== DEFAULT_AGENT_ID) {
      return rows.map(mapSessionListItem);
    }
    return this.listLegacyDetailed(userId);
  }

  resolveSwitchTarget(userId: string, agentId: string, target: string): string | undefined {
    const raw = target.trim();
    if (!raw) {
      return undefined;
    }
    if (/^\d+$/.test(raw)) {
      const index = Number(raw);
      if (index <= 0) {
        return undefined;
      }
      const list = this.listDetailed(userId, agentId);
      return list[index - 1]?.threadId;
    }
    return raw;
  }

  renameSession(targetThreadId: string, name: string): boolean {
    const normalized = name.trim();
    if (!normalized) {
      return false;
    }
    this.db
      .prepare(`
        INSERT INTO session_meta(thread_id, name, last_prompt, updated_at)
        VALUES(?, ?, NULL, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          name = excluded.name,
          updated_at = excluded.updated_at
      `)
      .run(targetThreadId, normalized, this.nextTimestamp());
    return true;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_session (
        user_id TEXT PRIMARY KEY,
        current_thread_id TEXT NOT NULL,
        bound_identity_version TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_history (
        user_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, thread_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_history_user_updated
        ON user_history(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS session_meta (
        thread_id TEXT PRIMARY KEY,
        name TEXT,
        last_prompt TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_current_agent (
        user_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_agent (
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        workspace_dir TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, agent_id)
      );

      CREATE TABLE IF NOT EXISTS user_agent_session (
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        current_thread_id TEXT NOT NULL,
        bound_identity_version TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, agent_id)
      );

      CREATE TABLE IF NOT EXISTS user_agent_history (
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, agent_id, thread_id)
      );

      CREATE INDEX IF NOT EXISTS idx_user_agent_history_lookup
        ON user_agent_history(user_id, agent_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS user_agent_settings (
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        model_override TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, agent_id)
      );
    `);

    this.ensureColumn('user_session', 'bound_identity_version', 'TEXT');
    this.ensureColumn('user_agent_session', 'bound_identity_version', 'TEXT');
  }

  private getCustomAgent(userId: string, agentId: string): AgentRecord | undefined {
    if (agentId === DEFAULT_AGENT_ID) {
      return undefined;
    }
    const row = this.db
      .prepare(`
        SELECT
          agent_id AS agentId,
          name,
          workspace_dir AS workspaceDir,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM user_agent
        WHERE user_id = ? AND agent_id = ?
      `)
      .get(userId, agentId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      agentId: String(row.agentId ?? ''),
      name: String(row.name ?? ''),
      workspaceDir: String(row.workspaceDir ?? ''),
      createdAt: numberRow(row.createdAt),
      updatedAt: numberRow(row.updatedAt),
    };
  }

  private getDefaultAgent(): AgentRecord {
    return {
      agentId: DEFAULT_AGENT_ID,
      name: '默认Agent',
      workspaceDir: this.defaultWorkspaceDir,
      createdAt: 0,
      updatedAt: 0,
    };
  }

  private getLegacySessionState(userId: string): SessionState {
    const row = this.db
      .prepare(`
        SELECT current_thread_id AS threadId, bound_identity_version AS boundIdentityVersion
        FROM user_session
        WHERE user_id = ?
      `)
      .get(userId) as { threadId?: string; boundIdentityVersion?: string } | undefined;
    return {
      threadId: row?.threadId,
      boundIdentityVersion: typeof row?.boundIdentityVersion === 'string' && row.boundIdentityVersion
        ? row.boundIdentityVersion
        : undefined,
    };
  }

  private listLegacyDetailed(userId: string): SessionListItem[] {
    const rows = this.db
      .prepare(`
        SELECT
          h.thread_id AS threadId,
          m.name AS name,
          m.last_prompt AS lastPrompt,
          COALESCE(m.updated_at, h.updated_at) AS updatedAt
        FROM user_history h
        LEFT JOIN session_meta m ON m.thread_id = h.thread_id
        WHERE h.user_id = ?
        ORDER BY h.updated_at DESC
        LIMIT 20
      `)
      .all(userId) as Array<Record<string, unknown>>;
    return rows.map(mapSessionListItem);
  }

  private persistLegacySession(
    userId: string,
    threadId: string,
    lastPrompt: string | undefined,
    now: number,
    boundIdentityVersion?: string,
  ): void {
    this.db
      .prepare(`
        INSERT INTO user_session(user_id, current_thread_id, bound_identity_version, updated_at)
        VALUES(?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          current_thread_id = excluded.current_thread_id,
          bound_identity_version = excluded.bound_identity_version,
          updated_at = excluded.updated_at
      `)
      .run(userId, threadId, boundIdentityVersion ?? null, now);

    this.db
      .prepare(`
        INSERT INTO user_history(user_id, thread_id, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(user_id, thread_id) DO UPDATE SET
          updated_at = excluded.updated_at
      `)
      .run(userId, threadId, now);

    this.db
      .prepare(`
        DELETE FROM user_history
        WHERE user_id = ?
          AND thread_id IN (
            SELECT thread_id
            FROM user_history
            WHERE user_id = ?
            ORDER BY updated_at DESC
            LIMIT -1 OFFSET 20
          )
      `)
      .run(userId, userId);

    this.upsertSessionMeta(threadId, lastPrompt, now);
  }

  private upsertSessionMeta(threadId: string, lastPrompt: string | undefined, now: number): void {
    const normalizedPrompt = normalizePreview(lastPrompt);
    if (normalizedPrompt) {
      this.db
        .prepare(`
          INSERT INTO session_meta(thread_id, name, last_prompt, updated_at)
          VALUES(?, NULL, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            last_prompt = excluded.last_prompt,
            updated_at = excluded.updated_at
        `)
        .run(threadId, normalizedPrompt, now);
      return;
    }

    this.db
      .prepare(`
        INSERT INTO session_meta(thread_id, name, last_prompt, updated_at)
        VALUES(?, NULL, NULL, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          updated_at = excluded.updated_at
      `)
      .run(threadId, now);
  }

  private withTransaction(fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
    const hasColumn = rows.some((row) => row.name === column);
    if (hasColumn) {
      return;
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private nextTimestamp(): number {
    const now = Date.now() * 1000;
    this.lastTs = Math.max(now, this.lastTs + 1);
    return this.lastTs;
  }
}

function normalizePreview(input?: string): string | undefined {
  const text = (input ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return undefined;
  }
  return text.length <= 80 ? text : `${text.slice(0, 80)}...`;
}

function mapSessionListItem(row: Record<string, unknown>): SessionListItem {
  return {
    threadId: String(row.threadId ?? ''),
    name: typeof row.name === 'string' ? row.name : undefined,
    lastPrompt: typeof row.lastPrompt === 'string' ? row.lastPrompt : undefined,
    updatedAt: numberRow(row.updatedAt),
  };
}

function numberRow(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function isHiddenAgentId(agentId: string): boolean {
  return HIDDEN_AGENT_ID_PREFIXES.some((prefix) => agentId === prefix || agentId.startsWith(`${prefix}-`));
}

function isHiddenAgent(agent: { agentId: string; name: string }): boolean {
  return isHiddenAgentId(agent.agentId) || HIDDEN_AGENT_NAMES.has(agent.name.trim());
}
