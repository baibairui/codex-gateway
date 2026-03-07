import { afterAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';

const serverRefs: Array<{ close: () => void }> = [];

afterAll(() => {
  for (const server of serverRefs) {
    server.close();
  }
});

async function startTestServer(options?: {
  feishuVerificationToken?: string;
  handleText?: (input: { channel: 'wecom' | 'feishu'; userId: string; content: string }) => Promise<void>;
}) {
  const app = createApp({
    wecomEnabled: true,
    wecomCrypto: {
      verifySignature: () => true,
      decrypt: (input: string) => input,
    } as never,
    allowFrom: '*',
    feishuVerificationToken: options?.feishuVerificationToken,
    isDuplicateMessage: () => false,
    handleText: options?.handleText ?? (async () => undefined),
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

async function startWecomDisabledServer() {
  const app = createApp({
    wecomEnabled: false,
    allowFrom: '*',
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

describe('createApp wecom toggle', () => {
  it('does not expose wecom callback when disabled', async () => {
    const baseUrl = await startWecomDisabledServer();

    const response = await fetch(`${baseUrl}/wecom/callback`);

    expect(response.status).toBe(404);
  });
});

describe('createApp feishu callback', () => {
  it('rejects url_verification when token mismatch', async () => {
    const baseUrl = await startTestServer({ feishuVerificationToken: 'expected-token' });

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
    const baseUrl = await startTestServer({ feishuVerificationToken: 'expected-token' });

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

  it('accepts image message and forwards normalized content', async () => {
    const handleText = vi.fn(async () => undefined);
    const baseUrl = await startTestServer({
      feishuVerificationToken: 'expected-token',
      handleText,
    });

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: '2.0',
        header: {
          token: 'expected-token',
          event_type: 'im.message.receive_v1',
        },
        event: {
          sender: { sender_id: { open_id: 'ou_1' } },
          message: {
            message_id: 'om_1',
            message_type: 'image',
            content: JSON.stringify({ image_key: 'img_1' }),
          },
        },
      }),
    });
    const payload = await response.json() as { code?: number; msg?: string };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.msg).toBe('success');
    expect(handleText).toHaveBeenCalledWith({
      channel: 'feishu',
      userId: 'ou_1',
      content: '[飞书图片] image_key=img_1',
    });
  });
});
