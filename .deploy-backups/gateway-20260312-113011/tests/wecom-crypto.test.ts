import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { WeComCrypto } from '../src/utils/wecom-crypto.js';

function createEncodingAesKey(): string {
  return Buffer.alloc(32, 1).toString('base64').slice(0, 43);
}

describe('WeComCrypto.verifySignature', () => {
  it('returns false for signature length mismatch instead of throwing', () => {
    const instance = new WeComCrypto({
      token: 'token',
      encodingAesKey: createEncodingAesKey(),
      corpId: 'corp-id',
    });

    expect(instance.verifySignature('short', '123', '456', 'abc')).toBe(false);
  });

  it('returns true for a valid signature', () => {
    const token = 'token';
    const timestamp = '1710000000';
    const nonce = 'nonce';
    const encrypt = 'encrypt-body';

    const signature = crypto
      .createHash('sha1')
      .update([token, timestamp, nonce, encrypt].sort().join(''))
      .digest('hex');

    const instance = new WeComCrypto({
      token,
      encodingAesKey: createEncodingAesKey(),
      corpId: 'corp-id',
    });

    expect(instance.verifySignature(signature, timestamp, nonce, encrypt)).toBe(true);
  });
});
