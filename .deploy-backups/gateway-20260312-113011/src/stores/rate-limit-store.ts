/**
 * 简单滑动窗口限流：每个 key 在 windowSeconds 内最多 maxMessages 次。
 */
export class RateLimitStore {
  private readonly maxMessages: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();
  private readonly gcEvery = 64;
  private checks = 0;

  constructor(maxMessages: number, windowSeconds: number) {
    this.maxMessages = Math.max(1, maxMessages);
    this.windowMs = Math.max(1, windowSeconds) * 1000;
  }

  allow(key: string): boolean {
    const now = Date.now();
    const start = now - this.windowMs;
    const bucket = this.buckets.get(key) ?? [];
    this.pruneBucket(bucket, start);

    if (bucket.length >= this.maxMessages) {
      this.buckets.set(key, bucket);
      this.maybeGc(now);
      return false;
    }

    bucket.push(now);
    this.buckets.set(key, bucket);
    this.maybeGc(now);
    return true;
  }

  private pruneBucket(bucket: number[], start: number): void {
    let removeCount = 0;
    while (removeCount < bucket.length && bucket[removeCount] < start) {
      removeCount += 1;
    }
    if (removeCount > 0) {
      bucket.splice(0, removeCount);
    }
  }

  private maybeGc(now: number): void {
    this.checks += 1;
    if (this.checks % this.gcEvery !== 0) {
      return;
    }
    const start = now - this.windowMs;
    for (const [bucketKey, bucket] of this.buckets.entries()) {
      this.pruneBucket(bucket, start);
      if (bucket.length === 0) {
        this.buckets.delete(bucketKey);
      }
    }
  }
}
