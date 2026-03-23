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

  it('sends plain text as interactive cards and preserves chunking', async () => {
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
    expect(createCalls.every((call) => call.msg_type === 'interactive')).toBe(true);
    expect(createCalls.every((call) => {
      const payload = JSON.parse(call.content) as {
        schema?: string;
        body?: { elements?: Array<{ tag?: string; content?: string }> };
      };
      return payload.schema === '2.0'
        && payload.body?.elements?.[0]?.tag === 'markdown'
        && typeof payload.body.elements[0]?.content === 'string'
        && payload.body.elements[0].content.length > 0;
    })).toBe(true);
  });

  it('renders a light interactive card body without agent identity for chat targets', async () => {
    const createCalls: Array<{ receive_id_type: string; receive_id: string; msg_type?: string; content?: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: {
            params: { receive_id_type: string };
            data: { receive_id: string; msg_type?: string; content?: string };
          }) => {
            createCalls.push({
              receive_id_type: payload.params.receive_id_type,
              receive_id: payload.data.receive_id,
              msg_type: payload.data.msg_type,
              content: payload.data.content,
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
    }, '默认助手 ·\nhello group');

    expect(createCalls).toEqual([
      {
        receive_id_type: 'chat_id',
        receive_id: 'oc_group_1',
        msg_type: 'interactive',
        content: JSON.stringify({
          schema: '2.0',
          config: {
            wide_screen_mode: true,
          },
          body: {
            elements: [
              {
                tag: 'markdown',
                content: 'hello group',
              },
            ],
          },
        }),
      },
    ]);
  });

  it('splits long agent-visible replies into multiple interactive cards', async () => {
    const createCalls: Array<{ msg_type?: string; content?: string }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(async (payload: {
            data: { msg_type?: string; content?: string };
          }) => {
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

    await api.sendText('ou_a', `默认助手 ·\n${'你好hello'.repeat(300)}`);

    expect(createCalls.length).toBeGreaterThan(1);
    expect(createCalls.every((call) => call.msg_type === 'interactive')).toBe(true);
    expect(createCalls.every((call) => {
      const payload = JSON.parse(call.content ?? '{}') as {
        schema?: string;
        body?: { elements?: Array<{ tag?: string; content?: string }> };
      };
      return payload.schema === '2.0'
        && payload.body?.elements?.[0]?.tag === 'markdown'
        && typeof payload.body.elements[0]?.content === 'string'
        && payload.body.elements[0].content.length > 0;
    })).toBe(true);
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
    expect(replyCalls[0]?.reply_in_thread).toBe(true);
    expect(JSON.parse(replyCalls[0]?.content ?? '{}')).toEqual({
      schema: '2.0',
      config: {
        wide_screen_mode: true,
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: 'thread reply',
          },
        ],
      },
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

  it('normalizes legacy skill interactive cards into schema 2.0 payloads', async () => {
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
        config: {
          wide_screen_mode: true,
          enable_forward: true,
        },
        header: {
          template: 'blue',
          title: {
            tag: 'plain_text',
            content: '登录授权',
          },
        },
        elements: [
          {
            tag: 'markdown',
            content: '**选择登录方式**\n请选择一种方式继续。',
          },
        ],
      },
    });

    expect(JSON.parse(createCalls[0]?.content ?? '{}')).toEqual({
      schema: '2.0',
      config: {
        wide_screen_mode: true,
        enable_forward: true,
      },
      header: {
        template: 'blue',
        title: {
          tag: 'plain_text',
          content: '登录授权',
        },
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '**选择登录方式**\n请选择一种方式继续。',
          },
        ],
      },
    });
  });

  it('migrates legacy action rows in interactive cards into column_set buttons', async () => {
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
        schema: '2.0',
        body: {
          elements: [
            {
              tag: 'markdown',
              content: '**执行成功**',
            },
            {
              tag: 'action',
              actions: [
                {
                  tag: 'button',
                  type: 'primary',
                  text: {
                    tag: 'plain_text',
                    content: '查看帮助',
                  },
                  value: {
                    gateway_cmd: '/help',
                  },
                },
                {
                  tag: 'button',
                  text: {
                    tag: 'plain_text',
                    content: '打开链接',
                  },
                  multi_url: {
                    url: 'https://example.com',
                  },
                },
              ],
            },
          ],
        },
      },
    });

    expect(JSON.parse(createCalls[0]?.content ?? '{}')).toEqual({
      schema: '2.0',
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '**执行成功**',
          },
          {
            tag: 'column_set',
            flex_mode: 'flow',
            columns: [
              {
                tag: 'column',
                width: 'weighted',
                weight: 1,
                vertical_align: 'top',
                elements: [
                  {
                    tag: 'button',
                    type: 'primary',
                    text: {
                      tag: 'plain_text',
                      content: '查看帮助',
                    },
                    value: {
                      gateway_cmd: '/help',
                    },
                  },
                ],
              },
              {
                tag: 'column',
                width: 'weighted',
                weight: 1,
                vertical_align: 'top',
                elements: [
                  {
                    tag: 'button',
                    text: {
                      tag: 'plain_text',
                      content: '打开链接',
                    },
                    multi_url: {
                      url: 'https://example.com',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  it('migrates legacy note blocks in interactive cards into markdown elements', async () => {
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
        schema: '2.0',
        body: {
          elements: [
            {
              tag: 'note',
              elements: [
                {
                  tag: 'plain_text',
                  content: '查看可用 agent 列表，并在不同工作区之间切换。',
                },
              ],
            },
          ],
        },
      },
    });

    expect(JSON.parse(createCalls[0]?.content ?? '{}')).toEqual({
      schema: '2.0',
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '查看可用 agent 列表，并在不同工作区之间切换。',
          },
        ],
      },
    });
  });

  it('patches interactive messages using template shorthand without msg_type', async () => {
    const fetchCalls: Array<{
      url: string;
      method?: string;
      headers?: HeadersInit;
      body?: string;
    }> = [];
    const sdkClient = {
      im: {
        message: {
          create: vi.fn(),
          reply: vi.fn(),
          update: vi.fn(),
        },
        image: { create: vi.fn() },
        file: { create: vi.fn() },
        messageResource: { get: vi.fn() },
      },
    };
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        method: init?.method,
        headers: init?.headers,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (String(input).includes('/tenant_access_token/internal')) {
        return new Response(
          JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 't_xxx', expire: 7200 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ code: 0, msg: 'ok', data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient,
    });

    await (api as unknown as {
      patchCardMessage: (input: {
        messageId: string;
        content: Record<string, unknown> | string;
      }) => Promise<void>;
    }).patchCardMessage({
      messageId: 'om_update_1',
      content: {
        template_id: 'AAqC5c9997YMX',
        template_variable: { name: '白瑞' },
      },
    });

    expect(fetchCalls.slice(1)).toEqual([
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_update_1',
        method: 'PATCH',
        headers: expect.any(Headers),
        body: JSON.stringify({
          content: JSON.stringify({
            type: 'template',
            data: {
              template_id: 'AAqC5c9997YMX',
              template_variable: { name: '白瑞' },
            },
          }),
        }),
      },
    ]);
  });

  it('normalizes post text shorthand into an interactive markdown card before sending', async () => {
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

    expect(createCalls[0]?.msg_type).toBe('interactive');
    expect(JSON.parse(createCalls[0]?.content ?? '{}')).toEqual({
      schema: '2.0',
      config: {
        wide_screen_mode: true,
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '今天完成了网关改造',
          },
        ],
      },
    });
  });

  it('normalizes markdown messages into interactive markdown cards before sending', async () => {
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
      msgType: 'markdown',
      content: '# 标题\n- 列表',
    });

    expect(createCalls[0]?.msg_type).toBe('interactive');
    expect(JSON.parse(createCalls[0]?.content ?? '{}')).toEqual({
      schema: '2.0',
      config: {
        wide_screen_mode: true,
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: '# 标题\n- 列表',
          },
        ],
      },
    });
  });

  it('flattens structured post payloads into interactive markdown cards', async () => {
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
      content: {
        zh_cn: {
          title: '日报',
          content: [
            [
              { tag: 'text', text: '今天完成 A' },
              { tag: 'md', text: '\n- 修复卡片\n- 补测试' },
            ],
          ],
        },
      },
    });

    expect(createCalls[0]?.msg_type).toBe('interactive');
    const payload = JSON.parse(createCalls[0]?.content ?? '{}') as {
      schema?: string;
      body?: { elements?: Array<{ tag?: string; content?: string }> };
    };
    expect(payload.schema).toBe('2.0');
    expect(payload.body?.elements?.[0]?.tag).toBe('markdown');
    expect(payload.body?.elements?.[0]?.content).toContain('日报');
    expect(payload.body?.elements?.[0]?.content).toContain('今天完成 A');
    expect(payload.body?.elements?.[0]?.content).toContain('- 修复卡片');
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
    expect(createCalls[0]?.msg_type).toBe('interactive');
    expect(JSON.parse(createCalls[0]?.content ?? '{}')).toEqual({
      schema: '2.0',
      config: {
        wide_screen_mode: true,
      },
      body: {
        elements: [
          {
            tag: 'markdown',
            content: 'hello',
          },
        ],
      },
    });
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

  it('recalls a sent message through the feishu openapi endpoint', async () => {
    const fetchCalls: Array<{ url: string; method: string; authorization?: string }> = [];
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
      fetchCalls.push({
        url,
        method: init?.method ?? 'GET',
        authorization: init?.headers instanceof Headers
          ? init.headers.get('authorization') ?? undefined
          : (init?.headers as Record<string, string> | undefined)?.authorization,
      });
      return new Response(JSON.stringify({ code: 0, msg: 'ok' }), { status: 200 });
    });

    const api = new FeishuApi({
      appId: 'cli_xxx',
      appSecret: 'yyy',
      timeoutMs: 2000,
      sdkClient: {
        im: {
          message: {
            create: vi.fn(),
            reply: vi.fn(),
            update: vi.fn(),
          },
          image: { create: vi.fn() },
          file: { create: vi.fn() },
          messageResource: { get: vi.fn() },
        },
      },
    });

    await (api as unknown as {
      recallMessage: (messageId: string) => Promise<void>;
    }).recallMessage('om_recall_1');

    expect(fetchCalls).toEqual([
      {
        url: 'https://open.feishu.cn/open-apis/im/v1/messages/om_recall_1',
        method: 'DELETE',
        authorization: 'Bearer tenant-token',
      },
    ]);
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
