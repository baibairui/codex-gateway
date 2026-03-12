import { describe, expect, it } from 'vitest';

import { splitTextByUtf8Bytes } from '../src/services/wecom-api.js';

describe('splitTextByUtf8Bytes', () => {
  it('splits long ascii text into chunks', () => {
    const input = 'a'.repeat(4000);
    const chunks = splitTextByUtf8Bytes(input, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(input);
    expect(chunks.every((c) => Buffer.byteLength(c, 'utf8') <= 1000)).toBe(true);
  });

  it('splits chinese text by utf8 byte length', () => {
    const input = '你好世界'.repeat(800);
    const chunks = splitTextByUtf8Bytes(input, 900);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(input);
    expect(chunks.every((c) => Buffer.byteLength(c, 'utf8') <= 900)).toBe(true);
  });
});
