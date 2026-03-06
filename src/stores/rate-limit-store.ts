/**
 * 简单滑动窗口限流：每个 key 在 windowSeconds 内最多 maxMessages 次。
 */
export class RateLimitStore {
  private readonly maxMessages: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(maxMessages: number, windowSeconds: number) {
    this.maxMessages = Math.max(1, maxMessages);
    this.windowMs = Math.max(1, windowSeconds) * 1000;
  }

  allow(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? [];
    const start = now - this.windowMs;
    const fresh = bucket.filter((ts) => ts >= start);

    if (fresh.length >= this.maxMessages) {
      this.buckets.set(key, fresh);
      return false;
    }

    fresh.push(now);
    this.buckets.set(key, fresh);
    return true;
  }
}
