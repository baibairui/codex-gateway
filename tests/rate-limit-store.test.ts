import { describe, expect, it, vi } from 'vitest';

import { RateLimitStore } from '../src/stores/rate-limit-store.js';

describe('RateLimitStore', () => {
  it('allows up to max messages within window', () => {
    const store = new RateLimitStore(2, 60);
    expect(store.allow('u1')).toBe(true);
    expect(store.allow('u1')).toBe(true);
    expect(store.allow('u1')).toBe(false);
  });

  it('resets after window elapsed', () => {
    vi.useFakeTimers();
    const store = new RateLimitStore(1, 1);
    expect(store.allow('u2')).toBe(true);
    expect(store.allow('u2')).toBe(false);
    vi.advanceTimersByTime(1200);
    expect(store.allow('u2')).toBe(true);
    vi.useRealTimers();
  });
});
