import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

let ReminderDispatcher: any;
let ReminderStore: any;
try {
  await import('node:sqlite');
  ({ ReminderDispatcher } = await import('../src/services/reminder-dispatcher.js'));
  ({ ReminderStore } = await import('../src/services/reminder-store.js'));
} catch {
  ReminderDispatcher = undefined;
  ReminderStore = undefined;
}

const describeIfSqlite = ReminderDispatcher && ReminderStore ? describe : describe.skip;

describeIfSqlite('ReminderDispatcher', () => {
  it('triggers agent callback for due reminders and marks them as sent', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-dispatcher-'));
    const store = new ReminderStore(path.join(dir, 'reminders.db'));
    const sendText = vi.fn(async () => undefined);
    const onTriggerAgent = vi.fn(async () => undefined);
    const dispatcher = new ReminderDispatcher({
      store,
      sendText,
      onTriggerAgent,
      pollIntervalMs: 1000,
    });

    const reminder = store.createReminder({
      channel: 'wecom',
      userId: 'u1',
      message: '喝水',
      dueAt: Date.now() - 1,
      sourceAgentId: 'assistant',
    });

    await dispatcher.flushDueReminders();

    expect(onTriggerAgent).toHaveBeenCalledWith(expect.objectContaining({
      id: reminder.id,
      channel: 'wecom',
      userId: 'u1',
      message: '喝水',
    }));
    expect(sendText).not.toHaveBeenCalled();
    expect(store.listPending().some((item) => item.id === reminder.id)).toBe(false);
  });

  it('keeps reminder pending when agent trigger fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-dispatcher-'));
    const store = new ReminderStore(path.join(dir, 'reminders.db'));
    const sendText = vi.fn(async () => undefined);
    const onTriggerAgent = vi.fn(async () => {
      throw new Error('trigger failed');
    });
    const dispatcher = new ReminderDispatcher({
      store,
      sendText,
      onTriggerAgent,
      pollIntervalMs: 1000,
    });

    const reminder = store.createReminder({
      channel: 'wecom',
      userId: 'u1',
      message: '开会',
      dueAt: Date.now() - 1,
    });

    await dispatcher.flushDueReminders();

    expect(store.listPending().map((item) => item.id)).toContain(reminder.id);
  });

  it('falls back to direct send when agent trigger callback is not configured', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-dispatcher-'));
    const store = new ReminderStore(path.join(dir, 'reminders.db'));
    const sendText = vi.fn(async () => undefined);
    const dispatcher = new ReminderDispatcher({
      store,
      sendText,
      pollIntervalMs: 1000,
    });

    store.createReminder({
      channel: 'wecom',
      userId: 'u1',
      message: '站起来活动',
      dueAt: Date.now() - 1,
    });

    await dispatcher.flushDueReminders();

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '⏰ 定时提醒：站起来活动');
  });
});
