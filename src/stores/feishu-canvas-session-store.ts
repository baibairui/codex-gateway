import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface FeishuCanvasSessionRecord {
  sessionId: string;
  channel: 'feishu' | 'wecom';
  chatId: string;
  userId: string;
  documentId: string;
  documentUrl: string;
  title?: string;
  sourceMessageId?: string;
  cardMessageId?: string;
  lastAction?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateFeishuCanvasSessionInput {
  channel: 'feishu' | 'wecom';
  chatId: string;
  userId: string;
  documentId: string;
  documentUrl: string;
  title?: string;
  sourceMessageId?: string;
  cardMessageId?: string;
  lastAction?: string;
}

interface StoreShape {
  sessions: FeishuCanvasSessionRecord[];
}

export class FeishuCanvasSessionStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  createSession(input: CreateFeishuCanvasSessionInput): FeishuCanvasSessionRecord {
    const data = this.readStore();
    const now = Date.now();
    const record: FeishuCanvasSessionRecord = {
      sessionId: randomUUID(),
      channel: input.channel,
      chatId: input.chatId.trim(),
      userId: input.userId.trim(),
      documentId: input.documentId.trim(),
      documentUrl: input.documentUrl.trim(),
      title: normalizeOptional(input.title),
      sourceMessageId: normalizeOptional(input.sourceMessageId),
      cardMessageId: normalizeOptional(input.cardMessageId),
      lastAction: normalizeOptional(input.lastAction),
      createdAt: now,
      updatedAt: now,
    };
    data.sessions.push(record);
    this.writeStore(data);
    return record;
  }

  getBySessionId(sessionId: string): FeishuCanvasSessionRecord | undefined {
    return this.readStore().sessions.find((item) => item.sessionId === sessionId);
  }

  getLatestByChat(chatId: string): FeishuCanvasSessionRecord | undefined {
    return this.readStore().sessions
      .filter((item) => item.chatId === chatId)
      .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)[0];
  }

  clearSession(sessionId: string): boolean {
    const data = this.readStore();
    const nextSessions = data.sessions.filter((item) => item.sessionId !== sessionId);
    if (nextSessions.length === data.sessions.length) {
      return false;
    }
    this.writeStore({ sessions: nextSessions });
    return true;
  }

  private readStore(): StoreShape {
    if (!fs.existsSync(this.filePath)) {
      return { sessions: [] };
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoreShape;
      if (!parsed || !Array.isArray(parsed.sessions)) {
        return { sessions: [] };
      }
      return {
        sessions: parsed.sessions
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            ...item,
            channel: item.channel === 'wecom' ? 'wecom' : 'feishu',
          })),
      };
    } catch {
      return { sessions: [] };
    }
  }

  private writeStore(data: StoreShape): void {
    fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
