import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

  it('downloads image by image_key and stores to local file', async () => {
    const imageCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-image-'));
    global.fetch = vi.fn(async (input: string | URL | Request) => {
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
      if (url.includes('/im/v1/images/')) {
        return new Response(Buffer.from('fake-image-bytes'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      imageCacheDir,
    });

    const filePath = await api.downloadImage('img_v3_foo');
    expect(filePath.startsWith(imageCacheDir)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath).toString('utf8')).toBe('fake-image-bytes');
  });

  it('downloads file by file_key and stores to local file', async () => {
    const imageCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-file-'));
    global.fetch = vi.fn(async (input: string | URL | Request) => {
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
      if (url.includes('/im/v1/files/')) {
        return new Response(Buffer.from('fake-file-bytes'), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      imageCacheDir,
    });

    const filePath = await api.downloadFile('file_v3_foo');
    expect(filePath.startsWith(imageCacheDir)).toBe(true);
    expect(filePath.endsWith('.pdf')).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath).toString('utf8')).toBe('fake-file-bytes');
  });

  it('downloads user message resource with message_id + file_key + type', async () => {
    const imageCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-resource-'));
    let seenUrl = '';
    global.fetch = vi.fn(async (input: string | URL | Request) => {
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
      if (url.includes('/open-apis/im/v1/messages/')) {
        seenUrl = url;
        return new Response(Buffer.from('fake-resource-bytes'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      imageCacheDir,
    });

    const filePath = await api.downloadMessageResource({
      messageId: 'om_123',
      fileKey: 'img_123',
      type: 'image',
    });
    expect(seenUrl).toContain('/open-apis/im/v1/messages/om_123/resources/img_123');
    expect(seenUrl).toContain('type=image');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath).toString('utf8')).toBe('fake-resource-bytes');
  });
});
