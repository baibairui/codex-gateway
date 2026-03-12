import { describe, expect, it } from 'vitest';

import { allowList } from '../src/utils/allow-list.js';

describe('allowList', () => {
  it('allows all when rule is * or empty', () => {
    expect(allowList('*', 'u1')).toBe(true);
    expect(allowList('', 'u1')).toBe(true);
    expect(allowList('   ', 'u1')).toBe(true);
  });

  it('matches exact user in comma-separated list', () => {
    expect(allowList('alice,bob,carol', 'bob')).toBe(true);
    expect(allowList('alice, bob , carol', 'bob')).toBe(true);
    expect(allowList('alice,bob,carol', 'dave')).toBe(false);
  });
});
