/**
 * 企业微信消息重试去重。
 * msgId 在窗口期内只处理一次。
 */
export class MessageDedupStore {
  private readonly windowMs: number;
  private readonly seen = new Map<string, number>();

  constructor(windowSeconds: number) {
    this.windowMs = Math.max(1, windowSeconds) * 1000;
  }

  isDuplicate(msgId?: string): boolean {
    const id = (msgId ?? '').trim();
    if (!id) {
      return false;
    }

    const now = Date.now();
    this.gc(now);

    if (this.seen.has(id)) {
      return true;
    }
    this.seen.set(id, now);
    return false;
  }

  private gc(now: number): void {
    for (const [id, ts] of this.seen.entries()) {
      if (now - ts > this.windowMs) {
        this.seen.delete(id);
      }
    }
  }
}
