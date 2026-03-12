import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WeComApi } from '../src/services/wecom-api.js';

describe('WeComApi upload-backed sends', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uploads local image before sending image message', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wecom-upload-image-'));
    const localImagePath = path.join(tempDir, 'sample.png');
    fs.writeFileSync(localImagePath, Buffer.from('fake-image'));

    const seenUrls: string[] = [];

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      seenUrls.push(url);

      if (url.includes('/cgi-bin/gettoken')) {
        return new Response(
          JSON.stringify({
            errcode: 0,
            access_token: 'token-1',
            expires_in: 7200,
          }),
          { status: 200 },
        );
      }

      if (url.includes('/cgi-bin/media/upload')) {
        return new Response(
          JSON.stringify({
            errcode: 0,
            errmsg: 'ok',
            media_id: 'media_uploaded_1',
          }),
          { status: 200 },
        );
      }

      if (url.includes('/cgi-bin/message/send')) {
        return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
      }

      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new WeComApi({
      corpId: 'corp-id',
      secret: 'secret',
      agentId: 1000002,
      timeoutMs: 2000,
    });

    await api.sendMessage('alice', {
      msgType: 'image',
      content: {
        local_image_path: localImagePath,
      },
    });

    expect(seenUrls.some((url) => url.includes('/cgi-bin/media/upload') && url.includes('type=image'))).toBe(true);
    expect(seenUrls.some((url) => url.includes('/cgi-bin/message/send'))).toBe(true);
  });

  it('uploads local file before sending file message', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wecom-upload-file-'));
    const localFilePath = path.join(tempDir, 'sample.pdf');
    fs.writeFileSync(localFilePath, Buffer.from('fake-file'));

    const sendBodies: string[] = [];

    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes('/cgi-bin/gettoken')) {
        return new Response(
          JSON.stringify({
            errcode: 0,
            access_token: 'token-1',
            expires_in: 7200,
          }),
          { status: 200 },
        );
      }

      if (url.includes('/cgi-bin/media/upload')) {
        return new Response(
          JSON.stringify({
            errcode: 0,
            errmsg: 'ok',
            media_id: 'file_uploaded_1',
          }),
          { status: 200 },
        );
      }

      if (url.includes('/cgi-bin/message/send')) {
        sendBodies.push(String(init?.body ?? ''));
        return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
      }

      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new WeComApi({
      corpId: 'corp-id',
      secret: 'secret',
      agentId: 1000002,
      timeoutMs: 2000,
    });

    await api.sendMessage('alice', {
      msgType: 'file',
      content: {
        local_file_path: localFilePath,
      },
    });

    expect(sendBodies).toHaveLength(1);
    expect(JSON.parse(sendBodies[0] ?? '{}')).toMatchObject({
      touser: 'alice',
      msgtype: 'file',
      file: {
        media_id: 'file_uploaded_1',
      },
    });
  });
});
