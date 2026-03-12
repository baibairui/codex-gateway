/**
 * 企业微信消息重试去重。
 * msgId 在窗口期内只处理一次。
 */
export class MessageDedupStore {
  private readonly windowMs: number;
  private readonly gcIntervalMs: number;
  private readonly seen = new Map<string, number>();
  private lastGcAt = 0;

  constructor(windowSeconds: number) {
    this.windowMs = Math.max(1, windowSeconds) * 1000;
    this.gcIntervalMs = Math.min(this.windowMs, 30_000);
  }

  isDuplicate(msgId?: string): boolean {
    const id = (msgId ?? '').trim();
    if (!id) {
      return false;
    }

    const now = Date.now();
    this.maybeGc(now);

    const previousTs = this.seen.get(id);
    if (typeof previousTs === 'number' && now - previousTs <= this.windowMs) {
      return true;
    }
    this.seen.set(id, now);
    return false;
  }

  private maybeGc(now: number): void {
    if (this.lastGcAt !== 0 && now - this.lastGcAt < this.gcIntervalMs) {
      return;
    }
    this.gc(now);
    this.lastGcAt = now;
  }

  private gc(now: number): void {
    for (const [id, ts] of this.seen.entries()) {
      if (now - ts > this.windowMs) {
        this.seen.delete(id);
      }
    }
  }
}
