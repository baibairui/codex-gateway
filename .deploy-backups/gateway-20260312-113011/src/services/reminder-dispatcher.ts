import { createLogger } from '../utils/logger.js';
import { ReminderStore, type ReminderChannel, type ReminderRecord } from './reminder-store.js';

const log = createLogger('ReminderDispatcher');

interface ReminderDispatcherOptions {
  store: ReminderStore;
  sendText: (channel: ReminderChannel, userId: string, content: string) => Promise<void>;
  onTriggerAgent?: (reminder: ReminderRecord) => Promise<void>;
  pollIntervalMs?: number;
}

export class ReminderDispatcher {
  private readonly store: ReminderStore;
  private readonly sendText: (channel: ReminderChannel, userId: string, content: string) => Promise<void>;
  private readonly onTriggerAgent?: (reminder: ReminderRecord) => Promise<void>;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(options: ReminderDispatcherOptions) {
    this.store = options.store;
    this.sendText = options.sendText;
    this.onTriggerAgent = options.onTriggerAgent;
    this.pollIntervalMs = Math.max(250, Math.floor(options.pollIntervalMs ?? 1000));
  }

  start(): void {
    if (this.timer) {
      return;
    }
    void this.flushDueReminders();
    this.timer = setInterval(() => {
      void this.flushDueReminders();
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async flushDueReminders(now = Date.now()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const dueReminders = this.store.listDuePending(now);
      for (const reminder of dueReminders) {
        try {
          if (this.onTriggerAgent) {
            await this.onTriggerAgent(reminder);
          } else {
            await this.sendText(reminder.channel, reminder.userId, `⏰ 定时提醒：${reminder.message}`);
          }
          this.store.markSent(reminder.id, now);
        } catch (error) {
          log.error('ReminderDispatcher 发送提醒失败', {
            reminderId: reminder.id,
            channel: reminder.channel,
            userId: reminder.userId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
