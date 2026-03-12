import { describe, expect, it, vi } from 'vitest';

import { MessageDedupStore } from '../src/stores/message-dedup-store.js';

describe('MessageDedupStore', () => {
  it('returns true for duplicated msgId within window', () => {
    const store = new MessageDedupStore(60);
    expect(store.isDuplicate('1001')).toBe(false);
    expect(store.isDuplicate('1001')).toBe(true);
  });

  it('expires entries after window', () => {
    vi.useFakeTimers();
    const store = new MessageDedupStore(1);

    expect(store.isDuplicate('1002')).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(store.isDuplicate('1002')).toBe(false);

    vi.useRealTimers();
  });

  it('runs gc at intervals instead of every message', () => {
    vi.useFakeTimers();
    const store = new MessageDedupStore(60);
    const gcSpy = vi.spyOn(store as any, 'gc');

    expect(store.isDuplicate('a1')).toBe(false);
    expect(store.isDuplicate('a2')).toBe(false);
    expect(store.isDuplicate('a3')).toBe(false);
    expect(gcSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(31_000);
    expect(store.isDuplicate('a4')).toBe(false);
    expect(gcSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
