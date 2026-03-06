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
});
