import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SessionStore');

interface SessionFileData {
  sessions?: Record<string, string>;
}

export class SessionStore {
  private readonly filePath: string;
  private sessions: Record<string, string>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.sessions = this.load();
    log.info('SessionStore 已加载', {
      filePath: this.filePath,
      sessionCount: Object.keys(this.sessions).length,
      userIds: Object.keys(this.sessions),
    });
  }

  get(userId: string): string | undefined {
    const threadId = this.sessions[userId];
    log.debug('SessionStore.get', {
      userId,
      threadId: threadId ?? '(未找到)',
    });
    return threadId;
  }

  set(userId: string, threadId: string): void {
    this.sessions[userId] = threadId;
    log.debug('SessionStore.set', { userId, threadId });
    this.persist();
  }

  private load(): Record<string, string> {
    if (!fs.existsSync(this.filePath)) {
      log.debug('Session 文件不存在，返回空', { filePath: this.filePath });
      return {};
    }

    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) {
      log.debug('Session 文件为空');
      return {};
    }

    try {
      const parsed = JSON.parse(content) as SessionFileData;
      log.debug('Session 文件加载成功', {
        sessionCount: Object.keys(parsed.sessions ?? {}).length,
      });
      return parsed.sessions ?? {};
    } catch (err) {
      log.warn('Session 文件解析失败，返回空', err);
      return {};
    }
  }

  private persist(): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });

    const body = JSON.stringify({ sessions: this.sessions }, null, 2);
    fs.writeFileSync(this.filePath, body, 'utf8');
    log.debug('Session 文件已持久化', {
      filePath: this.filePath,
      sessionCount: Object.keys(this.sessions).length,
    });
  }
}
