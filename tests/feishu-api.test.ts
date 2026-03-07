import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeishuApi, splitFeishuTextByUtf8Bytes } from '../src/services/feishu-api.js';

describe('splitFeishuTextByUtf8Bytes', () => {
  it('splits long text and preserves content', () => {
    const input = '你好hello'.repeat(500);
    const chunks = splitFeishuTextByUtf8Bytes(input, 800);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(input);
    expect(chunks.every((c) => Buffer.byteLength(c, 'utf8') <= 800)).toBe(true);
  });
});

describe('FeishuApi token cache', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses a single in-flight token request for concurrent sends', async () => {
    let tokenCalls = 0;
    let messageCalls = 0;

    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v3/tenant_access_token/internal')) {
        tokenCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 'tenant-token',
            expire: 7200,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/im/v1/messages')) {
        messageCalls += 1;
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
    });

    await Promise.all([
      api.sendText('ou_a', 'hello'),
      api.sendText('ou_b', 'world'),
    ]);

    expect(tokenCalls).toBe(1);
    expect(messageCalls).toBe(2);
  });

  it('does not retry on timeout by default to avoid duplicate messages', async () => {
    let messageCalls = 0;

    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v3/tenant_access_token/internal')) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 'tenant-token',
            expire: 7200,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/im/v1/messages')) {
        messageCalls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 10,
    });

    await expect(api.sendText('ou_a', 'hello')).rejects.toBeInstanceOf(Error);
    expect(messageCalls).toBe(1);
  });

  it('retries on timeout when retryOnTimeout=true', async () => {
    let messageCalls = 0;

    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v3/tenant_access_token/internal')) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 'tenant-token',
            expire: 7200,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/im/v1/messages')) {
        messageCalls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 10,
      retryOnTimeout: true,
    });

    await expect(api.sendText('ou_a', 'hello')).rejects.toBeInstanceOf(Error);
    expect(messageCalls).toBe(3);
  });

  it('sends interactive message using structured payload', async () => {
    let capturedBody = '';

    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v3/tenant_access_token/internal')) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            tenant_access_token: 'tenant-token',
            expire: 7200,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/im/v1/messages')) {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
    });

    await api.sendMessage('ou_a', {
      msgType: 'interactive',
      content: {
        type: 'template',
        data: { template_id: 'AAqC5c9997YMX' },
      },
    });

    const payload = JSON.parse(capturedBody) as { msg_type?: string; content?: string };
    expect(payload.msg_type).toBe('interactive');
    expect(payload.content).toContain('template_id');
  });
});
