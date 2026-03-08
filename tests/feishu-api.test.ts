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

describe('FeishuApi', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends text via sdk create and preserves chunking', async () => {
    const createCalls: Array<{
      receive_id_type: string;
      receive_id: string;
      msg_type: string;
      content: string;
    }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: {
            params: { receive_id_type: string };
            data: { receive_id: string; msg_type: string; content: string };
          }) => {
            createCalls.push({
              receive_id_type: payload.params.receive_id_type,
              ...payload.data,
            });
            return { code: 0, msg: 'ok' };
          }),
          reply: vi.fn(),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await api.sendText('ou_a', '你好hello'.repeat(300));

    expect(createCalls.length).toBeGreaterThan(1);
    expect(createCalls.every((call) => call.receive_id_type === 'open_id')).toBe(true);
    expect(createCalls.every((call) => call.receive_id === 'ou_a')).toBe(true);
    expect(createCalls.every((call) => call.msg_type === 'text')).toBe(true);
  });

  it('supports chat_id as receive target', async () => {
    const createCalls: Array<{ receive_id_type: string; receive_id: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: {
            params: { receive_id_type: string };
            data: { receive_id: string };
          }) => {
            createCalls.push({
              receive_id_type: payload.params.receive_id_type,
              receive_id: payload.data.receive_id,
            });
            return { code: 0, msg: 'ok' };
          }),
          reply: vi.fn(),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await api.sendText({
      receiveId: 'oc_group_1',
      receiveIdType: 'chat_id',
    }, 'hello group');

    expect(createCalls).toEqual([
      {
        receive_id_type: 'chat_id',
        receive_id: 'oc_group_1',
      },
    ]);
  });

  it('replies to source feishu message via sdk reply', async () => {
    const replyCalls: Array<{
      message_id: string;
      msg_type: string;
      content: string;
      reply_in_thread?: boolean;
    }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(),
          reply: vi.fn(async (payload: {
            path: { message_id: string };
            data: { msg_type: string; content: string; reply_in_thread?: boolean };
          }) => {
            replyCalls.push({
              message_id: payload.path.message_id,
              msg_type: payload.data.msg_type,
              content: payload.data.content,
              reply_in_thread: payload.data.reply_in_thread,
            });
            return { code: 0, msg: 'ok' };
          }),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await api.sendMessage('ou_a', {
      msgType: 'interactive',
      content: {
        type: 'template',
        data: { template_id: 'AAqC5c9997YMX' },
      },
      replyToMessageId: 'om_source_1',
    });

    expect(replyCalls).toEqual([
      {
        message_id: 'om_source_1',
        msg_type: 'interactive',
        content: JSON.stringify({
          type: 'template',
          data: { template_id: 'AAqC5c9997YMX' },
        }),
        reply_in_thread: false,
      },
    ]);
  });

  it('supports reply_in_thread when replying to source message', async () => {
    const replyCalls: Array<{ reply_in_thread?: boolean; content: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(),
          reply: vi.fn(async (payload: {
            data: { reply_in_thread?: boolean; content: string };
          }) => {
            replyCalls.push(payload.data);
            return { code: 0, msg: 'ok' };
          }),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await api.sendMessage('ou_a', {
      msgType: 'text',
      content: { text: 'thread reply' },
      replyToMessageId: 'om_source_2',
      replyInThread: true,
    });

    expect(replyCalls).toHaveLength(1);
    expect(replyCalls[0]).toMatchObject({
      content: JSON.stringify({ text: 'thread reply' }),
      reply_in_thread: true,
    });
  });

  it('normalizes interactive template shorthand before sending', async () => {
    const createCalls: Array<{ msg_type: string; content: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: { data: { msg_type: string; content: string } }) => {
            createCalls.push(payload.data);
            return { code: 0, msg: 'ok' };
          }),
          reply: vi.fn(),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await api.sendMessage('ou_a', {
      msgType: 'interactive',
      content: {
        template_id: 'AAqC5c9997YMX',
        template_variable: { name: '白瑞' },
      },
    });

    expect(JSON.parse(createCalls[0]?.content ?? '{}')).toEqual({
      type: 'template',
      data: {
        template_id: 'AAqC5c9997YMX',
        template_variable: { name: '白瑞' },
      },
    });
  });

  it('normalizes post text shorthand before sending', async () => {
    const createCalls: Array<{ msg_type: string; content: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: { data: { msg_type: string; content: string } }) => {
            createCalls.push(payload.data);
            return { code: 0, msg: 'ok' };
          }),
          reply: vi.fn(),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await api.sendMessage('ou_a', {
      msgType: 'post',
      content: '今天完成了网关改造',
    });

    expect(JSON.parse(createCalls[0]?.content ?? '{}')).toEqual({
      zh_cn: {
        title: '',
        content: [[{ tag: 'text', text: '今天完成了网关改造' }]],
      },
    });
  });

  it('normalizes uppercase msgType before sending', async () => {
    const createCalls: Array<{ msg_type: string; content: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: { data: { msg_type: string; content: string } }) => {
            createCalls.push(payload.data);
            return { code: 0, msg: 'ok' };
          }),
          reply: vi.fn(),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await api.sendMessage('ou_a', {
      msgType: 'TEXT',
      content: 'hello',
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]?.msg_type).toBe('text');
    expect(createCalls[0]?.content).toBe(JSON.stringify({ text: 'hello' }));
  });

  it('rejects empty text content before calling sdk', async () => {
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(),
          reply: vi.fn(),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await expect(api.sendMessage('ou_a', {
      msgType: 'text',
      content: '   ',
    })).rejects.toThrow('feishu send failed: text content is required');
    expect(sdkClient.im.message.create).not.toHaveBeenCalled();
  });

  it('uploads local image path before sending image message', async () => {
    const imageCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-upload-image-'));
    const localImagePath = path.join(imageCacheDir, 'sample.png');
    fs.writeFileSync(localImagePath, Buffer.from('fake-image'));
    const imageCreates: Array<{ image_type: string; imageKind: string }> = [];
    const messageCreates: Array<{ msg_type: string; content: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: { data: { msg_type: string; content: string } }) => {
            messageCreates.push(payload.data);
            return { code: 0, msg: 'ok' };
          }),
          reply: vi.fn(),
        },
        image: {
          create: vi.fn(async (payload: { data: { image_type: string; image: unknown } }) => {
            imageCreates.push({
              image_type: payload.data.image_type,
              imageKind: typeof payload.data.image,
            });
            return { image_key: 'img_uploaded_1' };
          }),
        },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      imageCacheDir,
      sdkClient,
    });

    await api.sendMessage('ou_a', {
      msgType: 'image',
      content: {
        local_image_path: localImagePath,
      },
    });

    expect(imageCreates).toEqual([
      { image_type: 'message', imageKind: 'object' },
    ]);
    expect(messageCreates).toHaveLength(1);
    expect(messageCreates[0]?.msg_type).toBe('image');
    expect(messageCreates[0]?.receive_id).toBe('ou_a');
    expect(messageCreates[0]?.content).toBe(JSON.stringify({ image_key: 'img_uploaded_1' }));
  });

  it('uploads local audio path before sending audio message', async () => {
    const imageCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-upload-audio-'));
    const localAudioPath = path.join(imageCacheDir, 'sample.ogg');
    fs.writeFileSync(localAudioPath, Buffer.from('fake-audio'));
    const fileCreates: Array<{ file_type: string; file_name: string; duration?: number }> = [];
    const messageCreates: Array<{ msg_type: string; content: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: { data: { msg_type: string; content: string } }) => {
            messageCreates.push(payload.data);
            return { code: 0, msg: 'ok' };
          }),
          reply: vi.fn(),
        },
        image: { create: vi.fn() },
        file: {
          create: vi.fn(async (payload: { data: { file_type: string; file_name: string; duration?: number } }) => {
            fileCreates.push(payload.data);
            return { file_key: 'file_uploaded_1' };
          }),
        },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      imageCacheDir,
      sdkClient,
    });

    await api.sendMessage('ou_a', {
      msgType: 'audio',
      content: {
        local_audio_path: localAudioPath,
        duration: 2,
      },
    });

    expect(fileCreates).toHaveLength(1);
    expect(fileCreates[0]?.file_type).toBe('opus');
    expect(fileCreates[0]?.file_name).toBe('sample.ogg');
    expect(fileCreates[0]?.duration).toBe(2);
    expect(messageCreates).toHaveLength(1);
    expect(messageCreates[0]?.msg_type).toBe('audio');
    expect(JSON.parse(messageCreates[0]?.content ?? '{}')).toEqual({
      file_key: 'file_uploaded_1',
      duration: 2,
    });
  });

  it('uploads local sticker path before sending sticker message', async () => {
    const imageCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-upload-sticker-'));
    const localStickerPath = path.join(imageCacheDir, 'smile.webp');
    fs.writeFileSync(localStickerPath, Buffer.from('fake-sticker'));
    const fileCreates: Array<{ file_type: string; file_name: string; duration?: number }> = [];
    const messageCreates: Array<{ msg_type: string; content: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: { data: { msg_type: string; content: string } }) => {
            messageCreates.push(payload.data);
            return { code: 0, msg: 'ok' };
          }),
          reply: vi.fn(),
        },
        image: { create: vi.fn() },
        file: {
          create: vi.fn(async (payload: { data: { file_type: string; file_name: string; duration?: number } }) => {
            fileCreates.push(payload.data);
            return { file_key: 'file_uploaded_sticker_1' };
          }),
        },
        messageResource: { get: vi.fn() },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      imageCacheDir,
      sdkClient,
    });

    await api.sendMessage('ou_a', {
      msgType: 'sticker',
      content: {
        local_sticker_path: localStickerPath,
      },
    });

    expect(fileCreates).toHaveLength(1);
    expect(fileCreates[0]?.file_name).toBe('smile.webp');
    expect(messageCreates).toHaveLength(1);
    expect(messageCreates[0]?.msg_type).toBe('sticker');
    expect(JSON.parse(messageCreates[0]?.content ?? '{}')).toEqual({
      file_key: 'file_uploaded_sticker_1',
    });
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
    const calls: Array<{ message_id: string; file_key: string; type: string }> = [];
    const sdkClient = {
      im: {
        messageResource: {
          get: vi.fn(async (payload: { params: { type: string }; path: { message_id: string; file_key: string } }) => {
            calls.push({
              message_id: payload.path.message_id,
              file_key: payload.path.file_key,
              type: payload.params.type,
            });
            return {
              headers: { 'content-type': 'image/png' },
              writeFile: async (filePath: string) => {
                fs.writeFileSync(filePath, Buffer.from('fake-resource-bytes'));
              },
            };
          }),
        },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      imageCacheDir,
      sdkClient,
    });

    const filePath = await api.downloadMessageResource({
      messageId: 'om_123',
      fileKey: 'img_123',
      type: 'image',
    });
    expect(calls).toEqual([
      { message_id: 'om_123', file_key: 'img_123', type: 'image' },
    ]);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath).toString('utf8')).toBe('fake-resource-bytes');
  });

  it('falls back to next resource type on 234001 invalid param', async () => {
    const imageCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-resource-fallback-'));
    const seenTypes: string[] = [];
    const sdkClient = {
      im: {
        messageResource: {
          get: vi.fn(async (payload: { params: { type: string } }) => {
            seenTypes.push(payload.params.type);
            if (payload.params.type === 'image') {
              throw {
                response: {
                  status: 400,
                  data: { code: 234001, msg: 'Invalid request param.' },
                },
              };
            }
            return {
              headers: { 'content-type': 'audio/mpeg' },
              writeFile: async (filePath: string) => {
                fs.writeFileSync(filePath, Buffer.from('fake-fallback-bytes'));
              },
            };
          }),
        },
      },
    };

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      imageCacheDir,
      sdkClient,
    });

    const filePath = await api.downloadMessageResource({
      messageId: 'om_999',
      fileKey: 'file_999',
      type: ['image', 'file'],
    });
    expect(seenTypes).toEqual(['image', 'file']);
    expect(filePath.endsWith('.mp3')).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath).toString('utf8')).toBe('fake-fallback-bytes');
  });
});
