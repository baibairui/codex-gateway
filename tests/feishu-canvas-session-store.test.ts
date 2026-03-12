import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FeishuCanvasSessionStore } from '../src/stores/feishu-canvas-session-store.js';

describe('FeishuCanvasSessionStore', () => {
  it('creates, reads latest chat session, and clears sessions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-canvas-session-'));
    const filePath = path.join(dir, 'canvas-sessions.db');
    const store = new FeishuCanvasSessionStore(filePath);

    expect(store.getLatestByChat('chat_1')).toBeUndefined();

    const first = store.createSession({
      channel: 'feishu',
      chatId: 'chat_1',
      userId: 'ou_1',
      documentId: 'doc_1',
      documentUrl: 'https://feishu.cn/docx/doc_1',
      title: 'First Canvas',
      sourceMessageId: 'om_source_1',
      cardMessageId: 'om_card_1',
      lastAction: 'create',
    });

    expect(store.getLatestByChat('chat_1')).toEqual(expect.objectContaining({
      sessionId: first.sessionId,
      channel: 'feishu',
      chatId: 'chat_1',
      userId: 'ou_1',
      documentId: 'doc_1',
      documentUrl: 'https://feishu.cn/docx/doc_1',
      title: 'First Canvas',
      sourceMessageId: 'om_source_1',
      cardMessageId: 'om_card_1',
      lastAction: 'create',
    }));

    const second = store.createSession({
      channel: 'feishu',
      chatId: 'chat_1',
      userId: 'ou_1',
      documentId: 'doc_2',
      documentUrl: 'https://feishu.cn/docx/doc_2',
      title: 'Second Canvas',
      lastAction: 'create',
    });

    expect(store.getLatestByChat('chat_1')).toEqual(expect.objectContaining({
      sessionId: second.sessionId,
      documentId: 'doc_2',
      documentUrl: 'https://feishu.cn/docx/doc_2',
      title: 'Second Canvas',
    }));

    expect(store.clearSession(second.sessionId)).toBe(true);
    expect(store.getLatestByChat('chat_1')).toEqual(expect.objectContaining({
      sessionId: first.sessionId,
      documentId: 'doc_1',
    }));

    expect(store.clearSession(first.sessionId)).toBe(true);
    expect(store.getLatestByChat('chat_1')).toBeUndefined();
    expect(store.clearSession(first.sessionId)).toBe(false);
  });
});
