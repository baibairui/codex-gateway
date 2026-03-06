import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const serverRefs: Array<{ close: () => void }> = [];

afterAll(() => {
  for (const server of serverRefs) {
    server.close();
  }
});

async function startTestServer(feishuVerificationToken?: string) {
  const app = createApp({
    wecomCrypto: {
      verifySignature: () => true,
      decrypt: (input: string) => input,
    } as never,
    allowFrom: '*',
    feishuVerificationToken,
    isDuplicateMessage: () => false,
    handleText: async () => undefined,
  });

  const server = app.listen(0);
  serverRefs.push(server);
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to acquire test server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('createApp feishu callback', () => {
  it('rejects url_verification when token mismatch', async () => {
    const baseUrl = await startTestServer('expected-token');

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'url_verification',
        token: 'wrong-token',
        challenge: 'ping',
      }),
    });
    const payload = await response.json() as { code?: number; msg?: string };

    expect(response.status).toBe(403);
    expect(payload.code).toBe(403);
    expect(payload.msg).toBe('token mismatch');
  });

  it('accepts url_verification when token matches', async () => {
    const baseUrl = await startTestServer('expected-token');

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'url_verification',
        token: 'expected-token',
        challenge: 'ping',
      }),
    });
    const payload = await response.json() as { challenge?: string };

    expect(response.status).toBe(200);
    expect(payload.challenge).toBe('ping');
  });
});
