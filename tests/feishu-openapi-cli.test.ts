import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendImageToDocx,
  buildHelpText,
  buildFeishuDocxUrl,
  buildDocxImageBlock,
  extractDocxDocumentId,
  extractWikiNodeToken,
  parseArgs,
  normalizeFeishuApiError,
  parseJsonFlag,
  parseOptionalBooleanFlag,
  parseRequiredStringFlag,
  runCommand,
  resolveDocxWriteInput,
} from '../.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('feishu-openapi doc target helpers', () => {
  it('prints help text that includes the expanded command groups', () => {
    const help = buildHelpText();
    expect(help).toContain('im get-message --message-id <id>');
    expect(help).toContain('doc get-content --doc-token <token>');
    expect(help).toContain('bitable list-records --app-token <token> --table-id <id>');
    expect(help).toContain('calendar freebusy --time-min <time> --time-max <time>');
    expect(help).toContain('task create-subtask --task-guid <guid> --summary <text>');
  });

  it('parses argv pairs into a stable object', () => {
    expect(parseArgs(['--task-id', 'task_1', '--page-size', '50', '--all'])).toEqual({
      'task-id': 'task_1',
      'page-size': '50',
      all: 'true',
    });
  });

  it('parses JSON flag payloads with stable error messages', () => {
    expect(parseJsonFlag('{"conjunction":"and"}', '--filter-json')).toEqual({
      conjunction: 'and',
    });
    expect(() => parseJsonFlag('{oops}', '--filter-json')).toThrow('invalid --filter-json: expected valid JSON');
  });

  it('parses required string flags and optional booleans', () => {
    expect(parseRequiredStringFlag(' doc_123 ', '--doc-token')).toBe('doc_123');
    expect(parseOptionalBooleanFlag('true', '--only-busy')).toBe(true);
    expect(parseOptionalBooleanFlag('false', '--only-busy')).toBe(false);
    expect(() => parseRequiredStringFlag('   ', '--doc-token')).toThrow('missing --doc-token');
    expect(() => parseOptionalBooleanFlag('yes', '--only-busy')).toThrow(
      'invalid --only-busy: expected true or false',
    );
  });

  it('builds a default feishu docx url from document_id', () => {
    expect(buildFeishuDocxUrl('EChBdybp4oCAf2x6VqqcXQhmnvh')).toBe(
      'https://feishu.cn/docx/EChBdybp4oCAf2x6VqqcXQhmnvh',
    );
  });

  it('honors a custom docx url prefix override', () => {
    expect(buildFeishuDocxUrl('doccnxxxxxxxx', 'https://tenant.feishu.cn/docx/')).toBe(
      'https://tenant.feishu.cn/docx/doccnxxxxxxxx',
    );
  });

  it('extracts document ids from raw ids and docx urls', () => {
    expect(extractDocxDocumentId('doccnxxxxxxxx')).toBe('doccnxxxxxxxx');
    expect(extractDocxDocumentId('https://feishu.cn/docx/doccnxxxxxxxx')).toBe('doccnxxxxxxxx');
    expect(extractDocxDocumentId('https://tenant.feishu.cn/docs/doxcnyyyyyyyy?from=share')).toBe('doxcnyyyyyyyy');
  });

  it('extracts wiki node tokens from wiki urls', () => {
    expect(extractWikiNodeToken('https://tenant.feishu.cn/wiki/wikicnabcdefghijk')).toBe(
      'wikicnabcdefghijk',
    );
  });
});

describe('feishu-openapi docx image support', () => {
  it('prefers explicit image write input with optional image metadata', () => {
    expect(resolveDocxWriteInput({
      'image-file': '/tmp/sample.png',
      'image-width': '640',
      'image-height': '480',
      'image-align': '3',
      'image-caption': '系统拓扑图',
    })).toEqual({
      mode: 'image',
      image: {
        filePath: '/tmp/sample.png',
        width: 640,
        height: 480,
        align: 3,
        caption: '系统拓扑图',
      },
    });
  });

  it('builds an image block with the official docx image block shape', () => {
    expect(buildDocxImageBlock({
      token: 'file_tok_123',
      width: 640,
      height: 480,
      align: 2,
      caption: '架构图',
    })).toEqual({
      block_type: 27,
      image: {
        token: 'file_tok_123',
        width: 640,
        height: 480,
        align: 2,
        caption: {
          content: '架构图',
        },
      },
    });
  });

  it('uploads a local image to docx media and appends an image block', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-docx-image-'));
    const imagePath = path.join(tempDir, 'topology.png');
    fs.writeFileSync(imagePath, Buffer.from('fake-image'));

    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/drive/v1/medias/upload_all')) {
        const formData = init?.body as FormData;
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual({
          Authorization: 'Bearer tenant_token',
        });
        expect(formData.get('file_name')).toBe('topology.png');
        expect(formData.get('parent_type')).toBe('docx_image');
        expect(formData.get('parent_node')).toBe('doc_123');
        expect(formData.get('size')).toBe(String(Buffer.byteLength('fake-image')));
        return new Response(JSON.stringify({
          code: 0,
          data: {
            file_token: 'file_tok_uploaded',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }

      if (input.endsWith('/docx/v1/documents/doc_123/blocks/doc_123/children')) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual({
          Authorization: 'Bearer tenant_token',
          'content-type': 'application/json; charset=utf-8',
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          index: -1,
          children: [
            {
              block_type: 27,
              image: {
                token: 'file_tok_uploaded',
                width: 640,
                height: 480,
                align: 2,
                caption: {
                  content: '拓扑图',
                },
              },
            },
          ],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            children: [{ block_id: 'blk_image_1' }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }

      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(appendImageToDocx('tenant_token', 'doc_123', {
      filePath: imagePath,
      width: 640,
      height: 480,
      align: 2,
      caption: '拓扑图',
    })).resolves.toEqual({
      ok: true,
      blocks_appended: 1,
      mode: 'image',
      image_token: 'file_tok_uploaded',
      block_id: 'blk_image_1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('feishu-openapi SDK-backed command groups', () => {
  it('gets a single IM message and normalizes the payload', async () => {
    const sdkClient = {
      im: {
        message: {
          get: vi.fn(async () => ({
            code: 0,
            data: {
              items: [
                {
                  message_id: 'om_1',
                  chat_id: 'oc_1',
                  msg_type: 'text',
                  body: { content: '{"text":"hello"}' },
                },
              ],
            },
          })),
          list: vi.fn(),
        },
      },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
    };

    await expect(runCommand({
      resource: 'im',
      action: 'get-message',
      args: { 'message-id': 'om_1' },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'im.get-message',
      message_id: 'om_1',
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        msg_type: 'text',
        body: { content: '{"text":"hello"}' },
      },
    });
  });

  it('lists IM history with paging fields preserved', async () => {
    const sdkClient = {
      im: {
        message: {
          get: vi.fn(),
          list: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ message_id: 'om_2' }],
              has_more: true,
              page_token: 'page_2',
            },
          })),
        },
      },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
    };

    await expect(runCommand({
      resource: 'im',
      action: 'list-messages',
      args: {
        'container-id-type': 'chat',
        'container-id': 'oc_1',
        'page-size': '50',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'im.list-messages',
      container_id_type: 'chat',
      container_id: 'oc_1',
      items: [{ message_id: 'om_2' }],
      has_more: true,
      page_token: 'page_2',
    });
  });

  it('searches IM messages and returns matched ids', async () => {
    const sdkClient = {
      im: {
        message: {
          get: vi.fn(),
          list: vi.fn(),
        },
      },
      search: {
        message: {
          create: vi.fn(async () => ({
            code: 0,
            data: {
              items: ['om_3', 'om_4'],
              has_more: false,
              page_token: 'done',
            },
          })),
        },
      },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
    };

    await expect(runCommand({
      resource: 'im',
      action: 'search-messages',
      args: { query: 'hello' },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'im.search-messages',
      query: 'hello',
      items: ['om_3', 'om_4'],
      has_more: false,
      page_token: 'done',
    });
  });

  it('reads markdown doc content via docs.v1.content.get', async () => {
    const sdkClient = {
      im: {
        message: {
          get: vi.fn(),
          list: vi.fn(),
        },
      },
      docs: {
        v1: {
          content: {
            get: vi.fn(async () => ({
              code: 0,
              data: { content: '# weekly report' },
            })),
          },
        },
      },
      docx: { v1: { document: { rawContent: vi.fn() } } },
    };

    await expect(runCommand({
      resource: 'doc',
      action: 'get-content',
      args: { 'doc-token': 'doccn_1', lang: 'zh' },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'doc.get-content',
      doc_token: 'doccn_1',
      content_type: 'markdown',
      content: '# weekly report',
    });
  });

  it('reads docx raw content using a document locator', async () => {
    const sdkClient = {
      im: {
        message: {
          get: vi.fn(),
          list: vi.fn(),
        },
      },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: {
        v1: {
          document: {
            rawContent: vi.fn(async () => ({
              code: 0,
              data: { content: 'plain text body' },
            })),
          },
        },
      },
    };

    await expect(runCommand({
      resource: 'doc',
      action: 'get-raw-content',
      args: { document: 'https://feishu.cn/docx/doccn_raw_1' },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'doc.get-raw-content',
      document_id: 'doccn_raw_1',
      resolved_from: 'document_url',
      content: 'plain text body',
    });
  });

  it('lists bitable tables with stable paging metadata', async () => {
    const sdkClient = {
      im: { message: { get: vi.fn(), list: vi.fn() } },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
      bitable: {
        appTable: {
          list: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ table_id: 'tbl_1', name: '需求池' }],
              total: 1,
              has_more: false,
              page_token: 'done',
            },
          })),
        },
        appTableRecord: {
          list: vi.fn(),
          search: vi.fn(),
        },
      },
    };

    await expect(runCommand({
      resource: 'bitable',
      action: 'list-tables',
      args: { 'app-token': 'app_1' },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.list-tables',
      app_token: 'app_1',
      items: [{ table_id: 'tbl_1', name: '需求池' }],
      total: 1,
      has_more: false,
      page_token: 'done',
    });
  });

  it('lists and searches bitable records', async () => {
    const sdkClient = {
      im: { message: { get: vi.fn(), list: vi.fn() } },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
      bitable: {
        appTable: { list: vi.fn() },
        appTableRecord: {
          list: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ record_id: 'rec_1', fields: { 标题: 'A' } }],
              total: 1,
              has_more: false,
              page_token: 'records_done',
            },
          })),
          search: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ record_id: 'rec_2', fields: { 标题: 'B' } }],
              total: 1,
              has_more: false,
              page_token: 'search_done',
            },
          })),
        },
      },
    };

    await expect(runCommand({
      resource: 'bitable',
      action: 'list-records',
      args: { 'app-token': 'app_1', 'table-id': 'tbl_1' },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.list-records',
      app_token: 'app_1',
      table_id: 'tbl_1',
      items: [{ record_id: 'rec_1', fields: { 标题: 'A' } }],
      total: 1,
      has_more: false,
      page_token: 'records_done',
    });

    await expect(runCommand({
      resource: 'bitable',
      action: 'search-records',
      args: {
        'app-token': 'app_1',
        'table-id': 'tbl_1',
        'filter-json': '{"conjunction":"and","conditions":[]}',
        'sort-json': '[{"field_name":"标题","desc":true}]',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.search-records',
      app_token: 'app_1',
      table_id: 'tbl_1',
      items: [{ record_id: 'rec_2', fields: { 标题: 'B' } }],
      total: 1,
      has_more: false,
      page_token: 'search_done',
    });
  });

  it('lists calendars, calendar events, and freebusy slots', async () => {
    const sdkClient = {
      im: { message: { get: vi.fn(), list: vi.fn() } },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
      calendar: {
        calendar: {
          list: vi.fn(async () => ({
            code: 0,
            data: {
              calendar_list: [{ calendar_id: 'cal_1', summary: '主日历' }],
              has_more: false,
              page_token: 'calendar_done',
              sync_token: 'sync_1',
            },
          })),
        },
        calendarEvent: {
          instanceView: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ event_id: 'evt_1', summary: '评审会' }],
            },
          })),
        },
        freebusy: {
          list: vi.fn(async () => ({
            code: 0,
            data: {
              freebusy_list: [{ start_time: '1', end_time: '2' }],
            },
          })),
        },
      },
    };

    await expect(runCommand({
      resource: 'calendar',
      action: 'list-calendars',
      args: {},
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.list-calendars',
      items: [{ calendar_id: 'cal_1', summary: '主日历' }],
      has_more: false,
      page_token: 'calendar_done',
      sync_token: 'sync_1',
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'list-events',
      args: {
        'calendar-id': 'cal_1',
        'time-min': '2026-03-09T00:00:00Z',
        'time-max': '2026-03-10T00:00:00Z',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.list-events',
      calendar_id: 'cal_1',
      items: [{ event_id: 'evt_1', summary: '评审会' }],
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'freebusy',
      args: {
        'time-min': '2026-03-09T00:00:00Z',
        'time-max': '2026-03-10T00:00:00Z',
        'user-id': 'ou_1',
        'only-busy': 'true',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.freebusy',
      freebusy_list: [{ start_time: '1', end_time: '2' }],
    });
  });

  it('creates, lists, gets, updates, and creates subtasks for tasks', async () => {
    const sdkClient = {
      im: { message: { get: vi.fn(), list: vi.fn() } },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
      task: {
        task: {
          create: vi.fn(async () => ({
            code: 0,
            data: {
              task: { id: 'task_1', summary: '整理周报' },
            },
          })),
          list: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ id: 'task_1', summary: '整理周报' }],
              has_more: false,
              page_token: 'task_done',
            },
          })),
          get: vi.fn(async () => ({
            code: 0,
            data: {
              task: { id: 'task_1', summary: '整理周报' },
            },
          })),
          patch: vi.fn(async () => ({
            code: 0,
            data: {
              task: { id: 'task_1', summary: '整理下周周报' },
            },
          })),
        },
        taskSubtask: {
          create: vi.fn(async () => ({
            code: 0,
            data: {
              task: { guid: 'sub_1', summary: '补齐风险项' },
            },
          })),
        },
      },
    };

    await expect(runCommand({
      resource: 'task',
      action: 'create',
      args: {
        summary: '整理周报',
        'origin-platform-name': 'codex-gateway',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.create',
      task: { id: 'task_1', summary: '整理周报' },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'list',
      args: {},
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.list',
      items: [{ id: 'task_1', summary: '整理周报' }],
      has_more: false,
      page_token: 'task_done',
    });

    await expect(runCommand({
      resource: 'task',
      action: 'get',
      args: { 'task-id': 'task_1' },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.get',
      task_id: 'task_1',
      task: { id: 'task_1', summary: '整理周报' },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'update',
      args: {
        'task-id': 'task_1',
        'task-json': '{"summary":"整理下周周报"}',
        'update-fields-json': '["summary"]',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.update',
      task_id: 'task_1',
      task: { id: 'task_1', summary: '整理下周周报' },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'create-subtask',
      args: {
        'task-guid': 'task_guid_1',
        summary: '补齐风险项',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.create-subtask',
      task_guid: 'task_guid_1',
      task: { guid: 'sub_1', summary: '补齐风险项' },
    });
  });

  it('classifies common Feishu API errors into stable types', () => {
    expect(normalizeFeishuApiError(new Error('feishu api failed: 99991663 permission denied'))).toEqual({
      type: 'permission_denied',
      code: 99991663,
      message: 'permission denied',
    });
    expect(normalizeFeishuApiError(new Error('failed to get tenant access token: 401 unauthorized'))).toEqual({
      type: 'auth_error',
      code: 401,
      message: 'unauthorized',
    });
    expect(normalizeFeishuApiError(new Error('plain boom'))).toEqual({
      type: 'api_error',
      code: null,
      message: 'plain boom',
    });
  });
});
