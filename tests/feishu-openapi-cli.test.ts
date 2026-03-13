import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

function seedFeishuUserBinding(filePath: string, input: {
  gatewayUserId: string;
  feishuOpenId?: string;
  feishuUserId?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopeSnapshot?: string;
}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS feishu_user_binding (
        gateway_user_id TEXT PRIMARY KEY,
        feishu_open_id TEXT,
        feishu_user_id TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        scope_snapshot TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    const now = Date.now();
    db.prepare(`
      INSERT INTO feishu_user_binding(
        gateway_user_id,
        feishu_open_id,
        feishu_user_id,
        access_token,
        refresh_token,
        expires_at,
        scope_snapshot,
        created_at,
        updated_at
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(gateway_user_id) DO UPDATE SET
        feishu_open_id = excluded.feishu_open_id,
        feishu_user_id = excluded.feishu_user_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        scope_snapshot = excluded.scope_snapshot,
        updated_at = excluded.updated_at
    `).run(
      input.gatewayUserId,
      input.feishuOpenId ?? null,
      input.feishuUserId ?? null,
      input.accessToken,
      input.refreshToken,
      Math.floor(input.expiresAt),
      input.scopeSnapshot ?? null,
      now,
      now,
    );
  } finally {
    db.close();
  }
}

function readFeishuUserBinding(filePath: string, gatewayUserId: string) {
  const db = new DatabaseSync(filePath);
  try {
    const row = db.prepare(`
      SELECT
        gateway_user_id AS gatewayUserId,
        access_token AS accessToken,
        refresh_token AS refreshToken,
        expires_at AS expiresAt,
        scope_snapshot AS scopeSnapshot
      FROM feishu_user_binding
      WHERE gateway_user_id = ?
    `).get(gatewayUserId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      gatewayUserId: String(row.gatewayUserId ?? ''),
      accessToken: String(row.accessToken ?? ''),
      refreshToken: String(row.refreshToken ?? ''),
      expiresAt: Number(row.expiresAt ?? 0),
      scopeSnapshot: typeof row.scopeSnapshot === 'string' ? row.scopeSnapshot : null,
    };
  } finally {
    db.close();
  }
}

describe('feishu-openapi doc target helpers', () => {
  it('prints help text that includes the expanded command groups', () => {
    const help = buildHelpText();
    expect(help).toContain('im get-message --message-id <id>');
    expect(help).toContain('doc get-content --doc-token <token>');
    expect(help).toContain('bitable list-records --app-token <token> --table-id <id>');
    expect(help).toContain('bitable create-record --app-token <token> --table-id <id> --fields-json <json>');
    expect(help).toContain('calendar freebusy --time-min <time> --time-max <time>');
    expect(help).toContain('calendar create-calendar --body-json <json>');
    expect(help).toContain('calendar create-event --calendar-id <id> --body-json <json>');
    expect(help).toContain('calendar get-calendar --calendar-id <id>');
    expect(help).toContain('calendar update-calendar --calendar-id <id> --body-json <json>');
    expect(help).toContain('calendar delete-calendar --calendar-id <id>');
    expect(help).toContain('calendar get-event --calendar-id <id> --event-id <id>');
    expect(help).toContain('calendar update-event --calendar-id <id> --event-id <id> --body-json <json>');
    expect(help).toContain('calendar delete-event --calendar-id <id> --event-id <id>');
    expect(help).toContain('calendar list-events-v4 --calendar-id <id>');
    expect(help).toContain('task create-subtask --task-guid <guid> --summary <text>');
    expect(help).toContain('task delete --task-guid <guid>');
    expect(help).toContain('task add-members --task-guid <guid> --body-json <json>');
    expect(help).toContain('task list-subtasks --task-guid <guid>');
    expect(help).toContain('task list-tasklists --task-guid <guid>');
    expect(help).toContain('tasklist create --body-json <json>');
    expect(help).toContain('tasklist tasks --tasklist-guid <guid>');
    expect(help).toContain('catalog search --query <text>');
    expect(help).toContain('api call --method <verb> --path <open_api_path>');
    expect(help).toContain('drive list-files --folder-token <token>');
    expect(help).toContain('drive copy-file --file-token <token> --name <text> --folder-token <token>');
    expect(help).toContain('drive get-public-permission --token <token> --type <type>');
    expect(help).toContain('drive patch-public-permission --token <token> --type <type> --body-json <json>');
    expect(help).toContain('drive list-permission-members --token <token> --type <type>');
    expect(help).toContain('drive create-permission-member --token <token> --type <type> --body-json <json>');
    expect(help).toContain('drive update-permission-member --token <token> --member-id <id> --type <type> --body-json <json>');
    expect(help).toContain('drive delete-permission-member --token <token> --member-id <id> --type <type> --member-type <type>');
    expect(help).toContain('drive check-member-auth --token <token> --type <type> --action <action>');
    expect(help).toContain('drive transfer-owner --token <token> --type <type> --body-json <json>');
    expect(help).toContain('drive batch-query-comments --file-token <token> --file-type <type> --body-json <json>');
    expect(help).toContain('drive list-comments --file-token <token> --file-type <type>');
    expect(help).toContain('drive patch-comment --file-token <token> --comment-id <id> --file-type <type> --body-json <json>');
    expect(help).toContain('drive update-comment-reply --file-token <token> --comment-id <id> --reply-id <id> --file-type <type> --body-json <json>');
    expect(help).toContain('drive delete-comment-reply --file-token <token> --comment-id <id> --reply-id <id> --file-type <type>');
    expect(help).toContain('chat list');
    expect(help).toContain('chat create --body-json <json>');
    expect(help).toContain('chat add-members --chat-id <id> --body-json <json>');
    expect(help).toContain('chat remove-members --chat-id <id> --body-json <json>');
    expect(help).toContain('chat is-in-chat --chat-id <id>');
    expect(help).toContain('chat get-announcement --chat-id <id>');
    expect(help).toContain('chat update-announcement --chat-id <id> --body-json <json>');
    expect(help).toContain('chat add-managers --chat-id <id> --body-json <json>');
    expect(help).toContain('chat delete-managers --chat-id <id> --body-json <json>');
    expect(help).toContain('card create --body-json <json>');
    expect(help).toContain('card update --card-id <id> --body-json <json>');
    expect(help).toContain('approval create-instance --body-json <json>');
    expect(help).toContain('approval get-instance --instance-id <id>');
    expect(help).toContain('approval search-tasks --body-json <json>');
    expect(help).toContain('approval approve-task --body-json <json>');
    expect(help).toContain('approval reject-task --body-json <json>');
    expect(help).toContain('approval transfer-task --body-json <json>');
    expect(help).toContain('approval resubmit-task --body-json <json>');
    expect(help).toContain('approval query-tasks --user-id <id> --topic <topic>');
    expect(help).toContain('approval cc-instance --body-json <json>');
    expect(help).toContain('approval search-cc --body-json <json>');
    expect(help).toContain('approval delete-comment --instance-id <id> --comment-id <id> --user-id <id>');
    expect(help).toContain('contact get-user --user-id <id>');
    expect(help).toContain('contact get-department --department-id <id>');
    expect(help).toContain('contact list-users [--department-id <id>]');
    expect(help).toContain('search doc-wiki --query <text>');
    expect(help).toContain('auth start-device-auth --gateway-user-id <id>');
    expect(help).toContain('auth poll-device-auth --gateway-user-id <id> --device-code <code>');
    expect(help).toContain('auth diagnose-permission --gateway-user-id <id> [--required-scopes-json <json>]');
    expect(help).toContain('calendar create-personal-event --summary <text> --start-time <iso> --end-time <iso>');
    expect(help).toContain('default for the current user');
    expect(help).toContain('shared calendar only');
    expect(help).toContain('sheets create --title <text>');
    expect(help).toContain('sheets find --spreadsheet-token <token> --sheet-id <id> --body-json <json>');
    expect(help).toContain('task create-personal-task --summary <text>');
    expect(help).toContain('task list-personal-tasks [--page-size <n>] [--page-token <token>]');
    expect(help).toContain('task get-personal-task --task-guid <guid>');
    expect(help).toContain('task update-personal-task --task-guid <guid> --task-json <json> --update-fields-json <json>');
    expect(help).toContain('task delete-personal-task --task-guid <guid>');
    expect(help).toContain('wiki list-nodes --space-id <id>');
    expect(help).toContain('wiki move-docs-to-wiki --space-id <id> --obj-type <type> --obj-token <token>');
    expect(help).toContain('wiki get-task --task-id <id> [--task-type <move>]');
    expect(help).toContain('wiki update-title --space-id <id> --node-token <token> --title <text>');
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

  it('creates, gets, updates, and deletes shared calendars without user auth', async () => {
    const sdkClient = {
      im: { message: { get: vi.fn(), list: vi.fn() } },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
      calendar: {
        calendar: {
          create: vi.fn(async (payload) => {
            expect(payload).toEqual({
              data: {
                summary: '项目协同',
                description: '跨团队共享日历',
                permissions: 'private',
                color: 5,
              },
            });
            return {
              code: 0,
              data: {
                calendar: {
                  calendar_id: 'cal_shared_2',
                  summary: '项目协同',
                },
              },
            };
          }),
          get: vi.fn(async (payload) => {
            expect(payload).toEqual({
              path: { calendar_id: 'cal_shared_2' },
            });
            return {
              code: 0,
              data: {
                calendar_id: 'cal_shared_2',
                summary: '项目协同',
              },
            };
          }),
          patch: vi.fn(async (payload) => {
            expect(payload).toEqual({
              path: { calendar_id: 'cal_shared_2' },
              data: {
                summary: '项目协同-更新',
                color: 7,
              },
            });
            return {
              code: 0,
              data: {
                calendar: {
                  calendar_id: 'cal_shared_2',
                  summary: '项目协同-更新',
                },
              },
            };
          }),
          delete: vi.fn(async (payload) => {
            expect(payload).toEqual({
              path: { calendar_id: 'cal_shared_2' },
            });
            return {
              code: 0,
              data: {},
            };
          }),
          list: vi.fn(),
        },
        calendarEvent: {
          instanceView: vi.fn(),
        },
        freebusy: {
          list: vi.fn(),
        },
      },
    };

    await expect(runCommand({
      resource: 'calendar',
      action: 'create-calendar',
      args: {
        'body-json': '{"summary":"项目协同","description":"跨团队共享日历","permissions":"private","color":5}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.create-calendar',
      calendar: {
        calendar_id: 'cal_shared_2',
        summary: '项目协同',
      },
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'get-calendar',
      args: {
        'calendar-id': 'cal_shared_2',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.get-calendar',
      calendar_id: 'cal_shared_2',
      calendar: {
        calendar_id: 'cal_shared_2',
        summary: '项目协同',
      },
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'update-calendar',
      args: {
        'calendar-id': 'cal_shared_2',
        'body-json': '{"summary":"项目协同-更新","color":7}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.update-calendar',
      calendar_id: 'cal_shared_2',
      calendar: {
        calendar_id: 'cal_shared_2',
        summary: '项目协同-更新',
      },
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'delete-calendar',
      args: {
        'calendar-id': 'cal_shared_2',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.delete-calendar',
      calendar_id: 'cal_shared_2',
      deleted: true,
    });
  });

  it('creates, lists, gets, updates, and deletes calendar events without user auth', async () => {
    const sdkClient = {
      im: { message: { get: vi.fn(), list: vi.fn() } },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
      calendar: {
        calendar: {
          list: vi.fn(),
        },
        calendarEvent: {
          instanceView: vi.fn(),
          create: vi.fn(async (payload) => {
            expect(payload).toEqual({
              path: { calendar_id: 'cal_shared_1' },
              params: {
                idempotency_key: 'idem_1',
                user_id_type: 'open_id',
              },
              data: {
                summary: '架构评审',
                description: '同步边界条件',
                start_time: {
                  timestamp: '1741850400',
                  timezone: 'Asia/Shanghai',
                },
                end_time: {
                  timestamp: '1741854000',
                  timezone: 'Asia/Shanghai',
                },
              },
            });
            return {
              code: 0,
              data: {
                event: {
                  event_id: 'evt_create_1',
                  summary: '架构评审',
                },
              },
            };
          }),
          list: vi.fn(async (payload) => {
            expect(payload).toEqual({
              path: { calendar_id: 'cal_shared_1' },
              params: {
                page_size: 20,
                page_token: 'page_1',
                start_time: '2026-03-13T00:00:00Z',
                end_time: '2026-03-14T00:00:00Z',
                anchor_time: '2026-03-13T00:00:00Z',
                sync_token: 'sync_1',
                user_id_type: 'open_id',
              },
            });
            return {
              code: 0,
              data: {
                items: [{ event_id: 'evt_1', summary: '架构评审' }],
                has_more: true,
                page_token: 'page_2',
                sync_token: 'sync_2',
              },
            };
          }),
          get: vi.fn(async (payload) => {
            expect(payload).toEqual({
              path: {
                calendar_id: 'cal_shared_1',
                event_id: 'evt_1',
              },
              params: {
                need_attendee: true,
                need_meeting_settings: false,
                max_attendee_num: 50,
                user_id_type: 'open_id',
              },
            });
            return {
              code: 0,
              data: {
                event: {
                  event_id: 'evt_1',
                  summary: '架构评审',
                },
              },
            };
          }),
          patch: vi.fn(async (payload) => {
            expect(payload).toEqual({
              path: {
                calendar_id: 'cal_shared_1',
                event_id: 'evt_1',
              },
              params: {
                user_id_type: 'open_id',
              },
              data: {
                summary: '架构评审-更新',
                need_notification: true,
              },
            });
            return {
              code: 0,
              data: {
                event: {
                  event_id: 'evt_1',
                  summary: '架构评审-更新',
                },
              },
            };
          }),
          delete: vi.fn(async (payload) => {
            expect(payload).toEqual({
              path: {
                calendar_id: 'cal_shared_1',
                event_id: 'evt_1',
              },
              params: {
                need_notification: 'true',
              },
            });
            return {
              code: 0,
              data: {},
            };
          }),
        },
        freebusy: {
          list: vi.fn(),
        },
      },
    };

    await expect(runCommand({
      resource: 'calendar',
      action: 'create-event',
      args: {
        'calendar-id': 'cal_shared_1',
        'body-json': '{"summary":"架构评审","description":"同步边界条件","start_time":{"timestamp":"1741850400","timezone":"Asia/Shanghai"},"end_time":{"timestamp":"1741854000","timezone":"Asia/Shanghai"}}',
        'idempotency-key': 'idem_1',
        'user-id-type': 'open_id',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.create-event',
      calendar_id: 'cal_shared_1',
      event: {
        event_id: 'evt_create_1',
        summary: '架构评审',
      },
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'list-events-v4',
      args: {
        'calendar-id': 'cal_shared_1',
        'page-size': '20',
        'page-token': 'page_1',
        'time-min': '2026-03-13T00:00:00Z',
        'time-max': '2026-03-14T00:00:00Z',
        'anchor-time': '2026-03-13T00:00:00Z',
        'sync-token': 'sync_1',
        'user-id-type': 'open_id',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.list-events-v4',
      calendar_id: 'cal_shared_1',
      items: [{ event_id: 'evt_1', summary: '架构评审' }],
      has_more: true,
      page_token: 'page_2',
      sync_token: 'sync_2',
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'get-event',
      args: {
        'calendar-id': 'cal_shared_1',
        'event-id': 'evt_1',
        'need-attendee': 'true',
        'need-meeting-settings': 'false',
        'max-attendee-num': '50',
        'user-id-type': 'open_id',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.get-event',
      calendar_id: 'cal_shared_1',
      event_id: 'evt_1',
      event: {
        event_id: 'evt_1',
        summary: '架构评审',
      },
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'update-event',
      args: {
        'calendar-id': 'cal_shared_1',
        'event-id': 'evt_1',
        'body-json': '{"summary":"架构评审-更新","need_notification":true}',
        'user-id-type': 'open_id',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.update-event',
      calendar_id: 'cal_shared_1',
      event_id: 'evt_1',
      event: {
        event_id: 'evt_1',
        summary: '架构评审-更新',
      },
    });

    await expect(runCommand({
      resource: 'calendar',
      action: 'delete-event',
      args: {
        'calendar-id': 'cal_shared_1',
        'event-id': 'evt_1',
        'need-notification': 'true',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.delete-event',
      calendar_id: 'cal_shared_1',
      event_id: 'evt_1',
      deleted: true,
    });
  });

  it('starts Feishu device auth and returns verification info', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://accounts.feishu.cn/oauth/v1/device_authorization');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(`Basic ${Buffer.from('cli_app:cli_secret').toString('base64')}`);
      expect(String(init?.body)).toContain('client_id=cli_app');
      expect(String(init?.body)).toContain('scope=calendar%3Acalendar+calendar%3Acalendar.event%3Acreate+offline_access');
      return new Response(JSON.stringify({
        device_code: 'dev_123',
        user_code: 'ABCD-EFGH',
        interval: 5,
        expires_in: 900,
        verification_uri: 'https://accounts.feishu.cn/device',
        verification_uri_complete: 'https://accounts.feishu.cn/device?user_code=ABCD-EFGH',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const startedAt = Date.now();
    const result = await runCommand({
      resource: 'auth',
      action: 'start-device-auth',
      args: {
        'gateway-user-id': 'ou_bind_1',
        'required-scopes-json': '["calendar:calendar","calendar:calendar.event:create"]',
        'app-id': 'cli_app',
        'app-secret': 'cli_secret',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      operation: 'auth.start-device-auth',
      gateway_user_id: 'ou_bind_1',
      device_code: 'dev_123',
      user_code: 'ABCD-EFGH',
      interval: 5,
      verification_uri: 'https://accounts.feishu.cn/device',
      verification_uri_complete: 'https://accounts.feishu.cn/device?user_code=ABCD-EFGH',
      requested_scopes: ['calendar:calendar', 'calendar:calendar.event:create', 'offline_access'],
    });
    expect(Number(result.expires_at)).toBeGreaterThanOrEqual(startedAt + 899_000);
  });

  it('polls Feishu device auth and returns pending status before approval', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe('https://open.feishu.cn/open-apis/authen/v2/oauth/token');
      return new Response(JSON.stringify({
        error: 'authorization_pending',
        error_description: 'user has not authorized yet',
      }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'auth',
      action: 'poll-device-auth',
      args: {
        'gateway-user-id': 'ou_bind_1',
        'device-code': 'dev_123',
        'app-id': 'cli_app',
        'app-secret': 'cli_secret',
      },
    })).resolves.toEqual({
      ok: false,
      operation: 'auth.poll-device-auth',
      gateway_user_id: 'ou_bind_1',
      device_code: 'dev_123',
      status: 'authorization_pending',
      authorized: false,
      message: 'Feishu device authorization is still pending.',
    });
  });

  it('polls Feishu device auth, stores binding, and returns binding metadata', async () => {
    const bindingDbPath = path.join(os.tmpdir(), `feishu-binding-${Date.now()}.db`);
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://open.feishu.cn/open-apis/authen/v2/oauth/token') {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            access_token: 'user_access_1',
            refresh_token: 'refresh_1',
            expires_in: 7200,
            scope: 'offline_access calendar:calendar',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (url === 'https://open.feishu.cn/open-apis/authen/v1/user_info') {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            open_id: 'ou_feishu_1',
            user_id: 'u_feishu_1',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const startedAt = Date.now();
    const result = await runCommand({
      resource: 'auth',
      action: 'poll-device-auth',
      args: {
        'gateway-user-id': 'ou_bind_1',
        'device-code': 'dev_123',
        'binding-db-path': bindingDbPath,
        'app-id': 'cli_app',
        'app-secret': 'cli_secret',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      operation: 'auth.poll-device-auth',
      gateway_user_id: 'ou_bind_1',
      authorized: true,
      binding: {
        gateway_user_id: 'ou_bind_1',
        feishu_open_id: 'ou_feishu_1',
        feishu_user_id: 'u_feishu_1',
      },
    });
    expect((result as { binding?: { expires_at?: number } }).binding?.expires_at).toBeGreaterThanOrEqual(startedAt + 7_199_000);
    const binding = readFeishuUserBinding(bindingDbPath, 'ou_bind_1');
    expect(binding).toMatchObject({
      gatewayUserId: 'ou_bind_1',
      accessToken: 'user_access_1',
      refreshToken: 'refresh_1',
      scopeSnapshot: 'offline_access calendar:calendar',
    });
  });

  it('diagnoses when app scopes are present but the user binding is missing required scopes', async () => {
    const bindingDbPath = path.join(os.tmpdir(), `feishu-binding-${Date.now()}-diag-user.db`);
    seedFeishuUserBinding(bindingDbPath, {
      gatewayUserId: 'ou_bind_1',
      accessToken: 'user_access_1',
      refreshToken: 'refresh_1',
      expiresAt: Date.now() + 7_200_000,
      scopeSnapshot: 'offline_access calendar:calendar',
    });

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal') {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: 'tenant_token_1',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (url === 'https://open.feishu.cn/open-apis/application/v6/applications/me?lang=zh_cn') {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer tenant_token_1');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            app: {
              scopes: [
                { scope: 'calendar:calendar', token_types: ['user'] },
                { scope: 'calendar:calendar.event:create', token_types: ['user'] },
              ],
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'auth',
      action: 'diagnose-permission',
      args: {
        'gateway-user-id': 'ou_bind_1',
        'binding-db-path': bindingDbPath,
        'required-scopes-json': '["calendar:calendar","calendar:calendar.event:create"]',
        'app-id': 'cli_app',
        'app-secret': 'cli_secret',
      },
    })).resolves.toEqual({
      ok: true,
      operation: 'auth.diagnose-permission',
      gateway_user_id: 'ou_bind_1',
      token_type: 'user',
      required_scopes: ['calendar:calendar', 'calendar:calendar.event:create'],
      app_scope_query: {
        ok: true,
      },
      app_missing_scopes: [],
      user_granted_scopes: ['offline_access', 'calendar:calendar'],
      user_missing_scopes: ['calendar:calendar.event:create'],
      diagnosis: 'user_scope_missing',
      message: 'The current Feishu user binding is missing required scopes, while the app already has them. Re-run device auth for this user, then retry the original command.',
    });
  });

  it('diagnoses when the app itself is missing required scopes', async () => {
    const bindingDbPath = path.join(os.tmpdir(), `feishu-binding-${Date.now()}-diag-app.db`);
    seedFeishuUserBinding(bindingDbPath, {
      gatewayUserId: 'ou_bind_1',
      accessToken: 'user_access_1',
      refreshToken: 'refresh_1',
      expiresAt: Date.now() + 7_200_000,
      scopeSnapshot: 'offline_access calendar:calendar',
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal') {
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: 'tenant_token_1',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (url === 'https://open.feishu.cn/open-apis/application/v6/applications/me?lang=zh_cn') {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            app: {
              scopes: [
                { scope: 'calendar:calendar', token_types: ['user'] },
              ],
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'auth',
      action: 'diagnose-permission',
      args: {
        'gateway-user-id': 'ou_bind_1',
        'binding-db-path': bindingDbPath,
        'required-scopes-json': '["calendar:calendar","calendar:calendar.event:create"]',
        'app-id': 'cli_app',
        'app-secret': 'cli_secret',
      },
    })).resolves.toEqual({
      ok: true,
      operation: 'auth.diagnose-permission',
      gateway_user_id: 'ou_bind_1',
      token_type: 'user',
      required_scopes: ['calendar:calendar', 'calendar:calendar.event:create'],
      app_scope_query: {
        ok: true,
      },
      app_missing_scopes: ['calendar:calendar.event:create'],
      user_granted_scopes: ['offline_access', 'calendar:calendar'],
      user_missing_scopes: ['calendar:calendar.event:create'],
      diagnosis: 'app_scope_missing',
      message: 'The Feishu app is missing required scopes. An app admin must enable them first, then the user should authorize again before retrying the original command.',
    });
  });

  it('returns an authorization_required result for personal commands when binding is missing', async () => {
    await expect(runCommand({
      resource: 'calendar',
      action: 'create-personal-event',
      args: {
        'gateway-user-id': 'ou_bind_1',
        summary: '评审会',
        'start-time': '2026-03-13T10:00:00+08:00',
        'end-time': '2026-03-13T11:00:00+08:00',
      },
    })).resolves.toEqual({
      ok: false,
      operation: 'calendar.create-personal-event',
      authorization_required: true,
      reason: 'feishu_user_binding_missing',
      gateway_user_id: 'ou_bind_1',
      required_scopes: ['calendar:calendar', 'calendar:calendar.event:create'],
      next_action: {
        resource: 'auth',
        action: 'start-device-auth',
        args: {
          'gateway-user-id': 'ou_bind_1',
          'required-scopes-json': '["calendar:calendar","calendar:calendar.event:create"]',
        },
      },
      message: 'Feishu user authorization required. Run auth start-device-auth, finish auth poll-device-auth, then retry the original command.',
    });
  });

  it('returns an authorization_required result when the stored binding is missing the required calendar scopes', async () => {
    const bindingDbPath = path.join(os.tmpdir(), `feishu-binding-${Date.now()}-missing-scope.db`);
    seedFeishuUserBinding(bindingDbPath, {
      gatewayUserId: 'ou_bind_1',
      accessToken: 'user_access_1',
      refreshToken: 'refresh_1',
      expiresAt: Date.now() + 7_200_000,
      scopeSnapshot: 'offline_access calendar:calendar',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'calendar',
      action: 'create-personal-event',
      args: {
        'gateway-user-id': 'ou_bind_1',
        'binding-db-path': bindingDbPath,
        summary: '评审会',
        'start-time': '2026-03-13T10:00:00+08:00',
        'end-time': '2026-03-13T11:00:00+08:00',
      },
    })).resolves.toEqual({
      ok: false,
      operation: 'calendar.create-personal-event',
      authorization_required: true,
      reason: 'feishu_user_scope_missing',
      gateway_user_id: 'ou_bind_1',
      required_scopes: ['calendar:calendar', 'calendar:calendar.event:create'],
      missing_scopes: ['calendar:calendar.event:create'],
      next_action: {
        resource: 'auth',
        action: 'start-device-auth',
        args: {
          'gateway-user-id': 'ou_bind_1',
          'required-scopes-json': '["calendar:calendar","calendar:calendar.event:create"]',
        },
      },
      message: 'Feishu user authorization is missing required scopes. Run auth start-device-auth with the required scopes, finish auth poll-device-auth, then retry the original command.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a personal calendar event with an explicit user access token', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://open.feishu.cn/open-apis/calendar/v4/calendars/primary/events');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer user_access_1');
      expect(JSON.parse(String(init?.body))).toEqual({
        summary: '评审会',
        description: '同步设计结论',
        start_time: {
          date_time: '2026-03-13T10:00:00+08:00',
          timezone: 'Asia/Shanghai',
        },
        end_time: {
          date_time: '2026-03-13T11:00:00+08:00',
          timezone: 'Asia/Shanghai',
        },
      });
      return new Response(JSON.stringify({
        code: 0,
        data: {
          event: {
            event_id: 'evt_personal_1',
            summary: '评审会',
          },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'calendar',
      action: 'create-personal-event',
      args: {
        summary: '评审会',
        description: '同步设计结论',
        'start-time': '2026-03-13T10:00:00+08:00',
        'end-time': '2026-03-13T11:00:00+08:00',
        timezone: 'Asia/Shanghai',
        'user-access-token': 'user_access_1',
      },
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.create-personal-event',
      event: {
        event_id: 'evt_personal_1',
        summary: '评审会',
      },
    });
  });

  it('creates and lists personal tasks with an explicit user access token', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://open.feishu.cn/open-apis/task/v2/tasks' && init?.method === 'POST') {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer user_access_1');
        expect(JSON.parse(String(init?.body))).toEqual({
          summary: '整理个人待办',
          description: '把今天的行动项补齐',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            task: {
              guid: 'task_guid_1',
              summary: '整理个人待办',
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (url === 'https://open.feishu.cn/open-apis/task/v2/tasks?page_size=20' && init?.method === 'GET') {
        expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer user_access_1');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ guid: 'task_guid_1', summary: '整理个人待办' }],
            has_more: false,
            page_token: '',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'task',
      action: 'create-personal-task',
      args: {
        'user-access-token': 'user_access_1',
        summary: '整理个人待办',
        description: '把今天的行动项补齐',
      },
    })).resolves.toEqual({
      ok: true,
      operation: 'task.create-personal-task',
      task: {
        guid: 'task_guid_1',
        summary: '整理个人待办',
      },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'list-personal-tasks',
      args: {
        'user-access-token': 'user_access_1',
        'page-size': '20',
      },
    })).resolves.toEqual({
      ok: true,
      operation: 'task.list-personal-tasks',
      items: [{ guid: 'task_guid_1', summary: '整理个人待办' }],
      has_more: false,
      page_token: null,
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


  it('supports advanced task collaboration commands', async () => {
    const sdkClient = {
      task: {
        task: {
          delete: vi.fn(async () => ({
            code: 0,
            data: {},
          })),
          addMembers: vi.fn(async () => ({
            code: 0,
            data: {
              task: {
                guid: 'task_guid_1',
                members: [{ id: 'ou_1', role: 'assignee' }],
              },
            },
          })),
          removeMembers: vi.fn(async () => ({
            code: 0,
            data: {
              task: {
                guid: 'task_guid_1',
                members: [],
              },
            },
          })),
          addReminders: vi.fn(async () => ({
            code: 0,
            data: {
              task: {
                guid: 'task_guid_1',
                reminders: [{ id: 'rem_1', relative_fire_minute: 30 }],
              },
            },
          })),
          removeReminders: vi.fn(async () => ({
            code: 0,
            data: {
              task: {
                guid: 'task_guid_1',
                reminders: [],
              },
            },
          })),
          addDependencies: vi.fn(async () => ({
            code: 0,
            data: {
              dependencies: [{ type: 'prev', task_guid: 'task_prev_1' }],
            },
          })),
          removeDependencies: vi.fn(async () => ({
            code: 0,
            data: {
              dependencies: [],
            },
          })),
          tasklists: vi.fn(async () => ({
            code: 0,
            data: {
              tasklists: [{ tasklist_guid: 'tl_1', section_guid: 'sec_1' }],
            },
          })),
          addTasklist: vi.fn(async () => ({
            code: 0,
            data: {
              task: {
                guid: 'task_guid_1',
                tasklists: [{ tasklist_guid: 'tl_1', section_guid: 'sec_1' }],
              },
            },
          })),
          removeTasklist: vi.fn(async () => ({
            code: 0,
            data: {
              task: {
                guid: 'task_guid_1',
                tasklists: [],
              },
            },
          })),
        },
        taskSubtask: {
          list: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ guid: 'sub_1', summary: '拆小任务' }],
              has_more: false,
              page_token: 'done',
            },
          })),
        },
      },
    };

    await expect(runCommand({
      resource: 'task',
      action: 'delete',
      args: {
        'task-guid': 'task_guid_1',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.delete',
      task_guid: 'task_guid_1',
    });

    await expect(runCommand({
      resource: 'task',
      action: 'add-members',
      args: {
        'task-guid': 'task_guid_1',
        'user-id-type': 'open_id',
        'body-json': '{"members":[{"id":"ou_1","role":"assignee"}],"client_token":"ct_1"}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.add-members',
      task_guid: 'task_guid_1',
      task: {
        guid: 'task_guid_1',
        members: [{ id: 'ou_1', role: 'assignee' }],
      },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'remove-members',
      args: {
        'task-guid': 'task_guid_1',
        'body-json': '{"members":[{"id":"ou_1","role":"assignee"}]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.remove-members',
      task_guid: 'task_guid_1',
      task: {
        guid: 'task_guid_1',
        members: [],
      },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'add-reminders',
      args: {
        'task-guid': 'task_guid_1',
        'body-json': '{"reminders":[{"relative_fire_minute":30}]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.add-reminders',
      task_guid: 'task_guid_1',
      task: {
        guid: 'task_guid_1',
        reminders: [{ id: 'rem_1', relative_fire_minute: 30 }],
      },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'remove-reminders',
      args: {
        'task-guid': 'task_guid_1',
        'body-json': '{"reminder_ids":["rem_1"]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.remove-reminders',
      task_guid: 'task_guid_1',
      task: {
        guid: 'task_guid_1',
        reminders: [],
      },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'add-dependencies',
      args: {
        'task-guid': 'task_guid_1',
        'body-json': '{"dependencies":[{"type":"prev","task_guid":"task_prev_1"}]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.add-dependencies',
      task_guid: 'task_guid_1',
      dependencies: [{ type: 'prev', task_guid: 'task_prev_1' }],
    });

    await expect(runCommand({
      resource: 'task',
      action: 'remove-dependencies',
      args: {
        'task-guid': 'task_guid_1',
        'body-json': '{"dependencies":[{"task_guid":"task_prev_1"}]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.remove-dependencies',
      task_guid: 'task_guid_1',
      dependencies: [],
    });

    await expect(runCommand({
      resource: 'task',
      action: 'list-subtasks',
      args: {
        'task-guid': 'task_guid_1',
        'page-size': '20',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.list-subtasks',
      task_guid: 'task_guid_1',
      items: [{ guid: 'sub_1', summary: '拆小任务' }],
      has_more: false,
      page_token: 'done',
    });

    await expect(runCommand({
      resource: 'task',
      action: 'list-tasklists',
      args: {
        'task-guid': 'task_guid_1',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.list-tasklists',
      task_guid: 'task_guid_1',
      tasklists: [{ tasklist_guid: 'tl_1', section_guid: 'sec_1' }],
    });

    await expect(runCommand({
      resource: 'task',
      action: 'add-tasklist',
      args: {
        'task-guid': 'task_guid_1',
        'body-json': '{"tasklist_guid":"tl_1","section_guid":"sec_1"}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.add-tasklist',
      task_guid: 'task_guid_1',
      task: {
        guid: 'task_guid_1',
        tasklists: [{ tasklist_guid: 'tl_1', section_guid: 'sec_1' }],
      },
    });

    await expect(runCommand({
      resource: 'task',
      action: 'remove-tasklist',
      args: {
        'task-guid': 'task_guid_1',
        'body-json': '{"tasklist_guid":"tl_1"}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'task.remove-tasklist',
      task_guid: 'task_guid_1',
      task: {
        guid: 'task_guid_1',
        tasklists: [],
      },
    });
  });

  it('supports tasklist management commands', async () => {
    const sdkClient = {
      task: {
        tasklist: {
          create: vi.fn(async () => ({
            code: 0,
            data: {
              tasklist: { guid: 'tl_1', name: '项目待办' },
            },
          })),
          list: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ guid: 'tl_1', name: '项目待办' }],
              has_more: false,
              page_token: 'done',
            },
          })),
          get: vi.fn(async () => ({
            code: 0,
            data: {
              tasklist: { guid: 'tl_1', name: '项目待办' },
            },
          })),
          patch: vi.fn(async () => ({
            code: 0,
            data: {
              tasklist: { guid: 'tl_1', name: '项目待办-升级' },
            },
          })),
          delete: vi.fn(async () => ({
            code: 0,
            data: {},
          })),
          tasks: vi.fn(async () => ({
            code: 0,
            data: {
              items: [{ guid: 'task_guid_1', summary: '整理周报' }],
              has_more: false,
              page_token: 'done',
            },
          })),
          addMembers: vi.fn(async () => ({
            code: 0,
            data: {
              tasklist: {
                guid: 'tl_1',
                name: '项目待办',
                members: [{ id: 'ou_1', role: 'editor' }],
              },
            },
          })),
          removeMembers: vi.fn(async () => ({
            code: 0,
            data: {
              tasklist: {
                guid: 'tl_1',
                name: '项目待办',
                members: [],
              },
            },
          })),
        },
      },
    };

    await expect(runCommand({
      resource: 'tasklist',
      action: 'create',
      args: {
        'user-id-type': 'open_id',
        'body-json': '{"name":"项目待办","members":[{"id":"ou_1","role":"editor"}]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'tasklist.create',
      tasklist: { guid: 'tl_1', name: '项目待办' },
    });

    await expect(runCommand({
      resource: 'tasklist',
      action: 'list',
      args: {
        'page-size': '20',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'tasklist.list',
      items: [{ guid: 'tl_1', name: '项目待办' }],
      has_more: false,
      page_token: 'done',
    });

    await expect(runCommand({
      resource: 'tasklist',
      action: 'get',
      args: {
        'tasklist-guid': 'tl_1',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'tasklist.get',
      tasklist_guid: 'tl_1',
      tasklist: { guid: 'tl_1', name: '项目待办' },
    });

    await expect(runCommand({
      resource: 'tasklist',
      action: 'update',
      args: {
        'tasklist-guid': 'tl_1',
        'body-json': '{"tasklist":{"name":"项目待办-升级"},"update_fields":["name"]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'tasklist.update',
      tasklist_guid: 'tl_1',
      tasklist: { guid: 'tl_1', name: '项目待办-升级' },
    });

    await expect(runCommand({
      resource: 'tasklist',
      action: 'delete',
      args: {
        'tasklist-guid': 'tl_1',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'tasklist.delete',
      tasklist_guid: 'tl_1',
    });

    await expect(runCommand({
      resource: 'tasklist',
      action: 'tasks',
      args: {
        'tasklist-guid': 'tl_1',
        completed: 'false',
        'page-size': '20',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'tasklist.tasks',
      tasklist_guid: 'tl_1',
      items: [{ guid: 'task_guid_1', summary: '整理周报' }],
      has_more: false,
      page_token: 'done',
    });

    await expect(runCommand({
      resource: 'tasklist',
      action: 'add-members',
      args: {
        'tasklist-guid': 'tl_1',
        'user-id-type': 'open_id',
        'body-json': '{"members":[{"id":"ou_1","role":"editor"}]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'tasklist.add-members',
      tasklist_guid: 'tl_1',
      tasklist: {
        guid: 'tl_1',
        name: '项目待办',
        members: [{ id: 'ou_1', role: 'editor' }],
      },
    });

    await expect(runCommand({
      resource: 'tasklist',
      action: 'remove-members',
      args: {
        'tasklist-guid': 'tl_1',
        'body-json': '{"members":[{"id":"ou_1","role":"editor"}]}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'tasklist.remove-members',
      tasklist_guid: 'tl_1',
      tasklist: {
        guid: 'tl_1',
        name: '项目待办',
        members: [],
      },
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
    expect(normalizeFeishuApiError(new Error(
      'feishu api failed: 99991679 Unauthorized\n缺少用户侧权限：\ncalendar:calendar\ncalendar:calendar.event:create',
    ))).toEqual({
      type: 'user_scope_insufficient',
      code: 99991679,
      message: 'Unauthorized\n缺少用户侧权限：\ncalendar:calendar\ncalendar:calendar.event:create',
      scopes: ['calendar:calendar', 'calendar:calendar.event:create'],
    });
  });

  it('searches and shows normalized official catalog entries', async () => {
    const catalogItems = [
      {
        name: '获取知识空间列表',
        chain: ['云文档', '知识库'],
        project: 'wiki',
        version: 'v2',
        resource: 'space',
        apiName: 'list',
        method: 'GET',
        path: '/open-apis/wiki/v2/spaces',
      },
      {
        name: '搜索文档',
        chain: ['搜索', '文档搜索'],
        project: 'search',
        version: 'v2',
        resource: 'doc_wiki',
        apiName: 'search',
        method: 'POST',
        path: '/open-apis/search/v2/doc_wiki/search',
      },
    ];

    await expect(runCommand({
      resource: 'catalog',
      action: 'search',
      args: { query: 'wiki' },
      catalogItems,
    })).resolves.toEqual({
      ok: true,
      operation: 'catalog.search',
      query: 'wiki',
      items: [catalogItems[0], catalogItems[1]],
      total: 2,
    });

    await expect(runCommand({
      resource: 'catalog',
      action: 'show',
      args: {
        project: 'wiki',
        version: 'v2',
        resource: 'space',
        'api-name': 'list',
      },
      catalogItems,
    })).resolves.toEqual({
      ok: true,
      operation: 'catalog.show',
      item: catalogItems[0],
    });
  });

  it('executes a generic authenticated OpenAPI call', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe('https://open.feishu.cn/open-apis/wiki/v2/spaces?page_size=50');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual({
        Authorization: 'Bearer tenant_token',
        'content-type': 'application/json; charset=utf-8',
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        space_name: '知识库',
      });
      return new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{ space_id: 'space_1' }],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'api',
      action: 'call',
      args: {
        method: 'POST',
        path: '/open-apis/wiki/v2/spaces',
        'query-json': '{"page_size":"50"}',
        'body-json': '{"space_name":"知识库"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'api.call',
      method: 'POST',
      path: '/open-apis/wiki/v2/spaces',
      query: { page_size: '50' },
      data: {
        items: [{ space_id: 'space_1' }],
      },
    });
  });

  it('supports curated drive file listing and folder creation through the skill surface', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files?folder_token=fld_1&page_size=20') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            files: [{ token: 'doc_1', name: '周报' }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/create_folder') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          name: '新目录',
          folder_token: 'fld_parent',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            token: 'fld_new',
            name: '新目录',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'drive',
      action: 'list-files',
      args: {
        'folder-token': 'fld_1',
        'page-size': '20',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.list-files',
      data: {
        files: [{ token: 'doc_1', name: '周报' }],
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'create-folder',
      args: {
        name: '新目录',
        'folder-token': 'fld_parent',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.create-folder',
      data: {
        token: 'fld_new',
        name: '新目录',
      },
    });
  });

  it('supports curated drive metadata and file mutation commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/metas/batch_query') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          request_docs: [{ doc_token: 'docx_1', doc_type: 'docx' }],
          with_url: true,
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            metas: [{ doc_token: 'docx_1', title: '项目周报' }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/file_1/copy') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          name: '项目周报-副本',
          folder_token: 'fld_target',
          type: 'docx',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            file: { token: 'file_copy_1', name: '项目周报-副本' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/file_1/move') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          folder_token: 'fld_archive',
          type: 'docx',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            task_id: 'drive_task_1',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/file_1?type=docx') {
        expect(init?.method).toBe('DELETE');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            task_id: 'drive_task_deleted',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/task_check?task_id=drive_task_1') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            status: 'success',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'drive',
      action: 'get-meta',
      args: {
        'doc-token': 'docx_1',
        'doc-type': 'docx',
        'with-url': 'true',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.get-meta',
      data: {
        metas: [{ doc_token: 'docx_1', title: '项目周报' }],
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'copy-file',
      args: {
        'file-token': 'file_1',
        name: '项目周报-副本',
        'folder-token': 'fld_target',
        type: 'docx',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.copy-file',
      data: {
        file: { token: 'file_copy_1', name: '项目周报-副本' },
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'move-file',
      args: {
        'file-token': 'file_1',
        'folder-token': 'fld_archive',
        type: 'docx',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.move-file',
      data: {
        task_id: 'drive_task_1',
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'delete-file',
      args: {
        'file-token': 'file_1',
        type: 'docx',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.delete-file',
      data: {
        task_id: 'drive_task_deleted',
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'task-check',
      args: {
        'task-id': 'drive_task_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.task-check',
      data: {
        status: 'success',
      },
    });
  });

  it('supports curated sheets and wiki workspace commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          title: '项目台账',
          folder_token: 'fld_sheet_root',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            spreadsheet: { spreadsheet_token: 'sht_1', title: '项目台账' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/sht_1') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            spreadsheet: { token: 'sht_1', title: '项目台账' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/sht_1/sheets/query') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            sheets: [{ sheet_id: 'sheet_1', title: '默认工作表' }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/sht_1/sheets/sheet_1') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            sheet: { sheet_id: 'sheet_1', title: '默认工作表' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/wiki/v2/spaces/space_1/nodes?page_size=50&parent_node_token=wikihome_1') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ node_token: 'wiki_child_1', title: '周报' }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/wiki/v2/spaces/space_1/nodes/wiki_child_1/move') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          target_parent_token: 'wiki_archive_1',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            node: { node_token: 'wiki_child_1', parent_node_token: 'wiki_archive_1' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/wiki/v2/spaces/space_1/nodes/wiki_child_1/update_title') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          title: '项目周报（归档）',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/wiki/v2/spaces/space_1/nodes/wiki_child_1/copy') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          target_space_id: 'space_2',
          target_parent_token: 'wiki_target_1',
          title: '项目周报-副本',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            node: { node_token: 'wiki_copy_1', title: '项目周报-副本' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'sheets',
      action: 'create',
      args: {
        title: '项目台账',
        'folder-token': 'fld_sheet_root',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'sheets.create',
      data: {
        spreadsheet: { spreadsheet_token: 'sht_1', title: '项目台账' },
      },
    });

    await expect(runCommand({
      resource: 'sheets',
      action: 'get',
      args: {
        'spreadsheet-token': 'sht_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'sheets.get',
      data: {
        spreadsheet: { token: 'sht_1', title: '项目台账' },
      },
    });

    await expect(runCommand({
      resource: 'sheets',
      action: 'query-sheets',
      args: {
        'spreadsheet-token': 'sht_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'sheets.query-sheets',
      data: {
        sheets: [{ sheet_id: 'sheet_1', title: '默认工作表' }],
      },
    });

    await expect(runCommand({
      resource: 'sheets',
      action: 'get-sheet',
      args: {
        'spreadsheet-token': 'sht_1',
        'sheet-id': 'sheet_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'sheets.get-sheet',
      data: {
        sheet: { sheet_id: 'sheet_1', title: '默认工作表' },
      },
    });

    await expect(runCommand({
      resource: 'wiki',
      action: 'list-nodes',
      args: {
        'space-id': 'space_1',
        'parent-node-token': 'wikihome_1',
        'page-size': '50',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'wiki.list-nodes',
      items: [{ node_token: 'wiki_child_1', title: '周报' }],
      has_more: false,
      page_token: 'done',
    });

    await expect(runCommand({
      resource: 'wiki',
      action: 'move-node',
      args: {
        'space-id': 'space_1',
        'node-token': 'wiki_child_1',
        'target-parent-token': 'wiki_archive_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'wiki.move-node',
      node: { node_token: 'wiki_child_1', parent_node_token: 'wiki_archive_1' },
    });

    await expect(runCommand({
      resource: 'wiki',
      action: 'update-title',
      args: {
        'space-id': 'space_1',
        'node-token': 'wiki_child_1',
        title: '项目周报（归档）',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'wiki.update-title',
      space_id: 'space_1',
      node_token: 'wiki_child_1',
      title: '项目周报（归档）',
    });

    await expect(runCommand({
      resource: 'wiki',
      action: 'copy-node',
      args: {
        'space-id': 'space_1',
        'node-token': 'wiki_child_1',
        'target-space-id': 'space_2',
        'target-parent-token': 'wiki_target_1',
        title: '项目周报-副本',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'wiki.copy-node',
      node: { node_token: 'wiki_copy_1', title: '项目周报-副本' },
    });
  });

  it('supports curated bitable record write commands', async () => {
    const sdkClient = {
      im: { message: { get: vi.fn(), list: vi.fn() } },
      docs: { v1: { content: { get: vi.fn() } } },
      docx: { v1: { document: { rawContent: vi.fn() } } },
      bitable: {
        appTable: { list: vi.fn() },
        appTableRecord: {
          list: vi.fn(),
          search: vi.fn(),
          create: vi.fn(async () => ({
            code: 0,
            data: {
              record: { record_id: 'rec_new', fields: { 标题: '新需求' } },
            },
          })),
          get: vi.fn(async () => ({
            code: 0,
            data: {
              record: { record_id: 'rec_new', fields: { 标题: '新需求' } },
            },
          })),
          update: vi.fn(async () => ({
            code: 0,
            data: {
              record: { record_id: 'rec_new', fields: { 标题: '已更新需求' } },
            },
          })),
          delete: vi.fn(async () => ({
            code: 0,
            data: {
              deleted: true,
              record_id: 'rec_new',
            },
          })),
          batchCreate: vi.fn(async () => ({
            code: 0,
            data: {
              records: [{ record_id: 'rec_batch_1' }, { record_id: 'rec_batch_2' }],
            },
          })),
          batchUpdate: vi.fn(async () => ({
            code: 0,
            data: {
              records: [{ record_id: 'rec_batch_1' }],
            },
          })),
          batchDelete: vi.fn(async () => ({
            code: 0,
            data: {
              records: [{ record_id: 'rec_batch_1', deleted: true }],
            },
          })),
        },
      },
    };

    await expect(runCommand({
      resource: 'bitable',
      action: 'create-record',
      args: {
        'app-token': 'app_1',
        'table-id': 'tbl_1',
        'fields-json': '{"标题":"新需求"}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.create-record',
      app_token: 'app_1',
      table_id: 'tbl_1',
      record: { record_id: 'rec_new', fields: { 标题: '新需求' } },
    });

    await expect(runCommand({
      resource: 'bitable',
      action: 'get-record',
      args: {
        'app-token': 'app_1',
        'table-id': 'tbl_1',
        'record-id': 'rec_new',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.get-record',
      app_token: 'app_1',
      table_id: 'tbl_1',
      record_id: 'rec_new',
      record: { record_id: 'rec_new', fields: { 标题: '新需求' } },
    });

    await expect(runCommand({
      resource: 'bitable',
      action: 'update-record',
      args: {
        'app-token': 'app_1',
        'table-id': 'tbl_1',
        'record-id': 'rec_new',
        'fields-json': '{"标题":"已更新需求"}',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.update-record',
      app_token: 'app_1',
      table_id: 'tbl_1',
      record_id: 'rec_new',
      record: { record_id: 'rec_new', fields: { 标题: '已更新需求' } },
    });

    await expect(runCommand({
      resource: 'bitable',
      action: 'delete-record',
      args: {
        'app-token': 'app_1',
        'table-id': 'tbl_1',
        'record-id': 'rec_new',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.delete-record',
      app_token: 'app_1',
      table_id: 'tbl_1',
      record_id: 'rec_new',
      deleted: true,
    });

    await expect(runCommand({
      resource: 'bitable',
      action: 'batch-create-records',
      args: {
        'app-token': 'app_1',
        'table-id': 'tbl_1',
        'records-json': '[{\"fields\":{\"标题\":\"A\"}},{\"fields\":{\"标题\":\"B\"}}]',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.batch-create-records',
      app_token: 'app_1',
      table_id: 'tbl_1',
      records: [{ record_id: 'rec_batch_1' }, { record_id: 'rec_batch_2' }],
    });

    await expect(runCommand({
      resource: 'bitable',
      action: 'batch-update-records',
      args: {
        'app-token': 'app_1',
        'table-id': 'tbl_1',
        'records-json': '[{\"record_id\":\"rec_batch_1\",\"fields\":{\"标题\":\"A-更新\"}}]',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.batch-update-records',
      app_token: 'app_1',
      table_id: 'tbl_1',
      records: [{ record_id: 'rec_batch_1' }],
    });

    await expect(runCommand({
      resource: 'bitable',
      action: 'batch-delete-records',
      args: {
        'app-token': 'app_1',
        'table-id': 'tbl_1',
        'record-ids-json': '[\"rec_batch_1\"]',
      },
      sdkClient,
    })).resolves.toEqual({
      ok: true,
      operation: 'bitable.batch-delete-records',
      app_token: 'app_1',
      table_id: 'tbl_1',
      records: [{ record_id: 'rec_batch_1', deleted: true }],
    });
  });

  it('supports additional drive, sheets, and wiki workspace mutation commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/create_shortcut') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          parent_token: 'fld_1',
          refer_entity: {
            refer_token: 'doc_1',
            refer_type: 'docx',
          },
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            succ_shortcut_node: { token: 'shortcut_1', name: '周报快捷方式' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/sht_1/sheets/sheet_1/find') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          find: '需求',
          find_condition: {
            range: 'A1:B20',
          },
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            find_result: { matched_cells: ['A2'], rows_count: 1 },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/sht_1/sheets/sheet_1/replace') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          find: '需求',
          replacement: '需求-已处理',
          find_condition: {
            range: 'A1:B20',
          },
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            replace_result: { matched_cells: ['A2'], rows_count: 1 },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/wiki/v2/spaces/space_1/nodes/move_docs_to_wiki') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          parent_wiki_token: 'wiki_parent_1',
          obj_type: 'docx',
          obj_token: 'doc_1',
          apply: true,
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            wiki_token: 'wiki_new_1',
            applied: true,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'drive',
      action: 'create-shortcut',
      args: {
        'parent-token': 'fld_1',
        'refer-token': 'doc_1',
        'refer-type': 'docx',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.create-shortcut',
      data: {
        succ_shortcut_node: { token: 'shortcut_1', name: '周报快捷方式' },
      },
    });

    await expect(runCommand({
      resource: 'sheets',
      action: 'find',
      args: {
        'spreadsheet-token': 'sht_1',
        'sheet-id': 'sheet_1',
        'body-json': '{"find":"需求","find_condition":{"range":"A1:B20"}}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'sheets.find',
      data: {
        find_result: { matched_cells: ['A2'], rows_count: 1 },
      },
    });

    await expect(runCommand({
      resource: 'sheets',
      action: 'replace',
      args: {
        'spreadsheet-token': 'sht_1',
        'sheet-id': 'sheet_1',
        'body-json': '{"find":"需求","replacement":"需求-已处理","find_condition":{"range":"A1:B20"}}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'sheets.replace',
      data: {
        replace_result: { matched_cells: ['A2'], rows_count: 1 },
      },
    });

    await expect(runCommand({
      resource: 'wiki',
      action: 'move-docs-to-wiki',
      args: {
        'space-id': 'space_1',
        'obj-type': 'docx',
        'obj-token': 'doc_1',
        'parent-wiki-token': 'wiki_parent_1',
        apply: 'true',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'wiki.move-docs-to-wiki',
      data: {
        wiki_token: 'wiki_new_1',
        applied: true,
      },
    });
  });

  it('supports drive collaboration and wiki task lookup commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/permissions/doc_1/public?type=docx') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            permission_public: {
              external_access: false,
              link_share_entity: 'tenant_readable',
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/doc_1/comments?file_type=docx&page_size=20') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ comment_id: 'cmt_1', is_whole: true }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/doc_1/comments/cmt_1?file_type=docx') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            comment_id: 'cmt_1',
            is_whole: true,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/doc_1/comments?file_type=docx') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          reply_list: {
            replies: [
              {
                content: {
                  elements: [
                    { type: 'text_run', text_run: { text: '已处理' } },
                  ],
                },
              },
            ],
          },
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            comment_id: 'cmt_new',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/doc_1/comments/cmt_1/replies?file_type=docx&page_size=20') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ reply_id: 'r_1', content: { elements: [] } }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/wiki/v2/tasks/task_1?task_type=move') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            task: {
              task_id: 'task_1',
              move_result: [{ status: 0, status_msg: 'ok' }],
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'drive',
      action: 'get-public-permission',
      args: {
        token: 'doc_1',
        type: 'docx',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.get-public-permission',
      data: {
        permission_public: {
          external_access: false,
          link_share_entity: 'tenant_readable',
        },
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'list-comments',
      args: {
        'file-token': 'doc_1',
        'file-type': 'docx',
        'page-size': '20',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.list-comments',
      data: {
        items: [{ comment_id: 'cmt_1', is_whole: true }],
        has_more: false,
        page_token: 'done',
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'get-comment',
      args: {
        'file-token': 'doc_1',
        'comment-id': 'cmt_1',
        'file-type': 'docx',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.get-comment',
      data: {
        comment_id: 'cmt_1',
        is_whole: true,
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'create-comment',
      args: {
        'file-token': 'doc_1',
        'file-type': 'docx',
        'body-json': '{"reply_list":{"replies":[{"content":{"elements":[{"type":"text_run","text_run":{"text":"已处理"}}]}}]}}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.create-comment',
      data: {
        comment_id: 'cmt_new',
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'list-comment-replies',
      args: {
        'file-token': 'doc_1',
        'comment-id': 'cmt_1',
        'file-type': 'docx',
        'page-size': '20',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.list-comment-replies',
      data: {
        items: [{ reply_id: 'r_1', content: { elements: [] } }],
        has_more: false,
        page_token: 'done',
      },
    });

    await expect(runCommand({
      resource: 'wiki',
      action: 'get-task',
      args: {
        'task-id': 'task_1',
        'task-type': 'move',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'wiki.get-task',
      data: {
        task: {
          task_id: 'task_1',
          move_result: [{ status: 0, status_msg: 'ok' }],
        },
      },
    });
  });

  it('supports drive permission and comment maintenance commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/permissions/doc_1/public?type=docx') {
        expect(init?.method).toBe('PATCH');
        expect(JSON.parse(String(init?.body))).toEqual({
          external_access: true,
          link_share_entity: 'tenant_editable',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            permission_public: {
              external_access: true,
              link_share_entity: 'tenant_editable',
            },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/permissions/doc_1/members?type=docx&fields=member_id%2Cname&perm_type=single_page') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ member_id: 'ou_1', name: '白瑞', perm: 'edit' }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/permissions/doc_1/members?type=docx&need_notification=true') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          member_type: 'userid',
          member_id: 'ou_1',
          perm: 'edit',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            member: { member_id: 'ou_1', perm: 'edit' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/permissions/doc_1/members/ou_1?type=docx&need_notification=false') {
        expect(init?.method).toBe('PUT');
        expect(JSON.parse(String(init?.body))).toEqual({
          member_type: 'userid',
          perm: 'full_access',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            member: { member_id: 'ou_1', perm: 'full_access' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/permissions/doc_1/members/ou_1?type=docx&member_type=userid') {
        expect(init?.method).toBe('DELETE');
        expect(JSON.parse(String(init?.body))).toEqual({
          perm_type: 'single_page',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/doc_1/comments/cmt_1?file_type=docx') {
        expect(init?.method).toBe('PATCH');
        expect(JSON.parse(String(init?.body))).toEqual({
          is_solved: true,
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/doc_1/comments/cmt_1/replies/r_1?file_type=docx&user_id_type=open_id') {
        if (init?.method === 'PUT') {
          expect(JSON.parse(String(init?.body))).toEqual({
            content: {
              elements: [{ type: 'text_run', text_run: { text: '已改成最终版本' } }],
            },
          });
          return new Response(JSON.stringify({
            code: 0,
            data: {},
          }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
        if (init?.method === 'DELETE') {
          return new Response(JSON.stringify({
            code: 0,
            data: {},
          }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'drive',
      action: 'patch-public-permission',
      args: {
        token: 'doc_1',
        type: 'docx',
        'body-json': '{"external_access":true,"link_share_entity":"tenant_editable"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.patch-public-permission',
      data: {
        permission_public: {
          external_access: true,
          link_share_entity: 'tenant_editable',
        },
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'list-permission-members',
      args: {
        token: 'doc_1',
        type: 'docx',
        fields: 'member_id,name',
        'perm-type': 'single_page',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.list-permission-members',
      data: {
        items: [{ member_id: 'ou_1', name: '白瑞', perm: 'edit' }],
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'create-permission-member',
      args: {
        token: 'doc_1',
        type: 'docx',
        'need-notification': 'true',
        'body-json': '{"member_type":"userid","member_id":"ou_1","perm":"edit"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.create-permission-member',
      data: {
        member: { member_id: 'ou_1', perm: 'edit' },
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'update-permission-member',
      args: {
        token: 'doc_1',
        'member-id': 'ou_1',
        type: 'docx',
        'need-notification': 'false',
        'body-json': '{"member_type":"userid","perm":"full_access"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.update-permission-member',
      member_id: 'ou_1',
      data: {
        member: { member_id: 'ou_1', perm: 'full_access' },
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'delete-permission-member',
      args: {
        token: 'doc_1',
        'member-id': 'ou_1',
        type: 'docx',
        'member-type': 'userid',
        'body-json': '{"perm_type":"single_page"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.delete-permission-member',
      member_id: 'ou_1',
      data: {},
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'patch-comment',
      args: {
        'file-token': 'doc_1',
        'comment-id': 'cmt_1',
        'file-type': 'docx',
        'body-json': '{"is_solved":true}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.patch-comment',
      comment_id: 'cmt_1',
      data: {},
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'update-comment-reply',
      args: {
        'file-token': 'doc_1',
        'comment-id': 'cmt_1',
        'reply-id': 'r_1',
        'file-type': 'docx',
        'user-id-type': 'open_id',
        'body-json': '{"content":{"elements":[{"type":"text_run","text_run":{"text":"已改成最终版本"}}]}}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.update-comment-reply',
      reply_id: 'r_1',
      data: {},
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'delete-comment-reply',
      args: {
        'file-token': 'doc_1',
        'comment-id': 'cmt_1',
        'reply-id': 'r_1',
        'file-type': 'docx',
        'user-id-type': 'open_id',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.delete-comment-reply',
      reply_id: 'r_1',
      data: {},
    });
  });

  it('supports drive permission auth, ownership transfer, and comment batch query commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/permissions/doc_1/members/auth?type=docx&action=edit') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            auth_result: true,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/permissions/doc_1/members/transfer_owner?type=docx&need_notification=true&remove_old_owner=false&stay_put=true&old_owner_perm=edit') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          member_type: 'userid',
          member_id: 'ou_new_owner',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/drive/v1/files/doc_1/comments/batch_query?file_type=docx') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          comment_ids: ['cmt_1', 'cmt_2'],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            comments: [
              { comment_id: 'cmt_1', is_whole: true },
              { comment_id: 'cmt_2', is_whole: false },
            ],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'drive',
      action: 'check-member-auth',
      args: {
        token: 'doc_1',
        type: 'docx',
        action: 'edit',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.check-member-auth',
      data: {
        auth_result: true,
      },
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'transfer-owner',
      args: {
        token: 'doc_1',
        type: 'docx',
        'need-notification': 'true',
        'remove-old-owner': 'false',
        'stay-put': 'true',
        'old-owner-perm': 'edit',
        'body-json': '{"member_type":"userid","member_id":"ou_new_owner"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.transfer-owner',
      data: {},
    });

    await expect(runCommand({
      resource: 'drive',
      action: 'batch-query-comments',
      args: {
        'file-token': 'doc_1',
        'file-type': 'docx',
        'body-json': '{"comment_ids":["cmt_1","cmt_2"]}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'drive.batch-query-comments',
      data: {
        comments: [
          { comment_id: 'cmt_1', is_whole: true },
          { comment_id: 'cmt_2', is_whole: false },
        ],
      },
    });
  });

  it('supports curated chat, card, approval, contact, and search commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ chat_id: 'oc_1', name: '项目群' }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/cardkit/v1/cards') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          schema: '2.0',
          header: { title: { tag: 'plain_text', content: '状态卡片' } },
        });
        return new Response(JSON.stringify({
          code: 0,
          data: { card_id: 'card_1' },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/instances') {
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify({
          code: 0,
          data: { instance_code: 'ins_1' },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/contact/v3/users/ou_1') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: { user: { user_id: 'ou_1', name: '白瑞' } },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/search/v2/doc_wiki/search') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          query: '网关设计',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: { items: [{ id: 'doc_1', title: '网关设计' }] },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'chat',
      action: 'list',
      args: {},
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.list',
      data: {
        items: [{ chat_id: 'oc_1', name: '项目群' }],
      },
    });

    await expect(runCommand({
      resource: 'card',
      action: 'create',
      args: {
        'body-json': '{"schema":"2.0","header":{"title":{"tag":"plain_text","content":"状态卡片"}}}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'card.create',
      data: { card_id: 'card_1' },
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'create-instance',
      args: {
        'body-json': '{"approval_code":"leave","user_id":"ou_1"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.create-instance',
      data: { instance_code: 'ins_1' },
    });

    await expect(runCommand({
      resource: 'contact',
      action: 'get-user',
      args: {
        'user-id': 'ou_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'contact.get-user',
      data: { user: { user_id: 'ou_1', name: '白瑞' } },
    });

    await expect(runCommand({
      resource: 'search',
      action: 'doc-wiki',
      args: {
        query: '网关设计',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'search.doc-wiki',
      data: { items: [{ id: 'doc_1', title: '网关设计' }] },
    });
  });

  it('supports additional chat, card, approval, and contact management commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          name: '项目群',
          user_id_list: ['ou_1'],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            chat_id: 'oc_new',
            name: '项目群',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/oc_new') {
        if (init?.method === 'GET') {
          return new Response(JSON.stringify({
            code: 0,
            data: {
              chat_id: 'oc_new',
              name: '项目群',
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
        if (init?.method === 'PUT') {
          expect(JSON.parse(String(init?.body))).toEqual({
            description: '项目主群',
          });
          return new Response(JSON.stringify({
            code: 0,
            data: {},
          }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
      }
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/search?query=%E9%A1%B9%E7%9B%AE&page_size=20') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ chat_id: 'oc_new', name: '项目群' }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/cardkit/v1/cards/card_1') {
        expect(init?.method).toBe('PUT');
        expect(JSON.parse(String(init?.body))).toEqual({
          card: {
            type: 'card_json',
            data: '{"schema":"2.0"}',
          },
          sequence: 2,
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/approvals/leave') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            approval_name: '请假',
            approval_code: 'leave',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/instances/ins_1') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            approval_name: '请假',
            instance_code: 'ins_1',
            status: 'PENDING',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/instances/cancel') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          approval_code: 'leave',
          instance_code: 'ins_1',
          user_id: 'ou_1',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/contact/v3/departments/dep_1') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            department: { department_id: 'dep_1', name: '平台研发' },
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/contact/v3/users/find_by_department?department_id=dep_1&page_size=50') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ user_id: 'ou_1', name: '白瑞' }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          emails: ['rui@example.com'],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            user_list: [{ user_id: 'ou_1', email: 'rui@example.com' }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'chat',
      action: 'create',
      args: {
        'body-json': '{"name":"项目群","user_id_list":["ou_1"]}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.create',
      data: {
        chat_id: 'oc_new',
        name: '项目群',
      },
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'get',
      args: {
        'chat-id': 'oc_new',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.get',
      data: {
        chat_id: 'oc_new',
        name: '项目群',
      },
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'search',
      args: {
        query: '项目',
        'page-size': '20',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.search',
      data: {
        items: [{ chat_id: 'oc_new', name: '项目群' }],
        has_more: false,
        page_token: 'done',
      },
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'update',
      args: {
        'chat-id': 'oc_new',
        'body-json': '{"description":"项目主群"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.update',
      chat_id: 'oc_new',
      data: {},
    });

    await expect(runCommand({
      resource: 'card',
      action: 'update',
      args: {
        'card-id': 'card_1',
        'body-json': '{"card":{"type":"card_json","data":"{\\"schema\\":\\"2.0\\"}"},"sequence":2}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'card.update',
      card_id: 'card_1',
      data: {},
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'get-definition',
      args: {
        'approval-code': 'leave',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.get-definition',
      data: {
        approval_name: '请假',
        approval_code: 'leave',
      },
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'get-instance',
      args: {
        'instance-id': 'ins_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.get-instance',
      data: {
        approval_name: '请假',
        instance_code: 'ins_1',
        status: 'PENDING',
      },
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'cancel-instance',
      args: {
        'body-json': '{"approval_code":"leave","instance_code":"ins_1","user_id":"ou_1"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.cancel-instance',
      data: {},
    });

    await expect(runCommand({
      resource: 'contact',
      action: 'get-department',
      args: {
        'department-id': 'dep_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'contact.get-department',
      data: {
        department: { department_id: 'dep_1', name: '平台研发' },
      },
    });

    await expect(runCommand({
      resource: 'contact',
      action: 'list-users-by-department',
      args: {
        'department-id': 'dep_1',
        'page-size': '50',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'contact.list-users-by-department',
      data: {
        items: [{ user_id: 'ou_1', name: '白瑞' }],
        has_more: false,
        page_token: 'done',
      },
    });

    await expect(runCommand({
      resource: 'contact',
      action: 'batch-get-user-id',
      args: {
        'body-json': '{"emails":["rui@example.com"]}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'contact.batch-get-user-id',
      data: {
        user_list: [{ user_id: 'ou_1', email: 'rui@example.com' }],
      },
    });
  });

  it('supports approval collaboration queries and broader contact listing commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/tasks/search?page_size=50') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          user_id: 'ou_1',
          task_status: 'PENDING',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ task_id: 'task_1', title: '请假审批' }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/instances/ins_1/comments?user_id=ou_1&page_size=20') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            comments: [{ id: 'ac_1', content: '请尽快处理' }],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/instances/ins_1/comments?user_id=ou_1') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          content: '补充说明',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            comment_id: 'ac_new',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/contact/v3/users?page_size=20&department_id=dep_1') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ user_id: 'ou_1', name: '白瑞' }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/contact/v3/departments?page_size=20&parent_department_id=dep_root&fetch_child=true') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            items: [{ department_id: 'dep_1', name: '平台研发' }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'approval',
      action: 'search-tasks',
      args: {
        'body-json': '{"user_id":"ou_1","task_status":"PENDING"}',
        'page-size': '50',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.search-tasks',
      data: {
        items: [{ task_id: 'task_1', title: '请假审批' }],
        has_more: false,
        page_token: 'done',
      },
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'list-comments',
      args: {
        'instance-id': 'ins_1',
        'user-id': 'ou_1',
        'page-size': '20',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.list-comments',
      data: {
        comments: [{ id: 'ac_1', content: '请尽快处理' }],
      },
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'create-comment',
      args: {
        'instance-id': 'ins_1',
        'user-id': 'ou_1',
        'body-json': '{"content":"补充说明"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.create-comment',
      data: {
        comment_id: 'ac_new',
      },
    });

    await expect(runCommand({
      resource: 'contact',
      action: 'list-users',
      args: {
        'department-id': 'dep_1',
        'page-size': '20',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'contact.list-users',
      data: {
        items: [{ user_id: 'ou_1', name: '白瑞' }],
        has_more: false,
        page_token: 'done',
      },
    });

    await expect(runCommand({
      resource: 'contact',
      action: 'list-departments',
      args: {
        'parent-department-id': 'dep_root',
        'page-size': '20',
        'fetch-child': 'true',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'contact.list-departments',
      data: {
        items: [{ department_id: 'dep_1', name: '平台研发' }],
        has_more: false,
        page_token: 'done',
      },
    });
  });

  it('supports approval task action commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/tasks/approve?user_id_type=open_id') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          approval_code: 'leave',
          instance_code: 'ins_1',
          user_id: 'ou_1',
          task_id: 'task_1',
          comment: '同意',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/tasks/reject') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          approval_code: 'leave',
          instance_code: 'ins_1',
          user_id: 'ou_1',
          task_id: 'task_1',
          comment: '资料不完整',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/tasks/transfer?user_id_type=user_id') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          approval_code: 'leave',
          instance_code: 'ins_1',
          user_id: 'u_admin',
          task_id: 'task_1',
          comment: '转交处理',
          transfer_user_id: 'u_delegate',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/tasks/resubmit') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          approval_code: 'leave',
          instance_code: 'ins_1',
          user_id: 'ou_1',
          task_id: 'task_1',
          comment: '已补充附件',
          form: '[{\"id\":\"field_1\",\"value\":\"done\"}]',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/tasks/query?user_id=ou_1&topic=1&page_size=20&user_id_type=open_id') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            task_list: [{ task_id: 'task_1', title: '请假审批' }],
            count: 1,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'approval',
      action: 'approve-task',
      args: {
        'user-id-type': 'open_id',
        'body-json': '{"approval_code":"leave","instance_code":"ins_1","user_id":"ou_1","task_id":"task_1","comment":"同意"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.approve-task',
      data: {},
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'reject-task',
      args: {
        'body-json': '{"approval_code":"leave","instance_code":"ins_1","user_id":"ou_1","task_id":"task_1","comment":"资料不完整"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.reject-task',
      data: {},
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'transfer-task',
      args: {
        'user-id-type': 'user_id',
        'body-json': '{"approval_code":"leave","instance_code":"ins_1","user_id":"u_admin","task_id":"task_1","comment":"转交处理","transfer_user_id":"u_delegate"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.transfer-task',
      data: {},
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'resubmit-task',
      args: {
        'body-json': '{"approval_code":"leave","instance_code":"ins_1","user_id":"ou_1","task_id":"task_1","comment":"已补充附件","form":"[{\\"id\\":\\"field_1\\",\\"value\\":\\"done\\"}]"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.resubmit-task',
      data: {},
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'query-tasks',
      args: {
        'user-id': 'ou_1',
        topic: '1',
        'page-size': '20',
        'user-id-type': 'open_id',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.query-tasks',
      data: {
        task_list: [{ task_id: 'task_1', title: '请假审批' }],
        count: 1,
      },
    });
  });

  it('supports approval cc search and comment delete commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/instances/cc?user_id_type=open_id') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          approval_code: 'leave',
          instance_code: 'ins_1',
          user_id: 'ou_1',
          cc_user_ids: ['ou_cc_1', 'ou_cc_2'],
          comment: '请同步关注',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/instances/search_cc?page_size=20&user_id_type=open_id') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          user_id: 'ou_1',
          read_status: 'UNREAD',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            count: 1,
            cc_list: [{
              approval: { code: 'leave', name: '请假' },
              instance: { code: 'ins_1', title: '年假申请' },
              cc: { user_id: 'ou_1', read_status: 'unread', title: '请假抄送' },
            }],
            has_more: false,
            page_token: 'done',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/approval/v4/instances/ins_1/comments/ac_1?user_id=ou_1&user_id_type=open_id') {
        expect(init?.method).toBe('DELETE');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            comment_id: 'ac_1',
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'approval',
      action: 'cc-instance',
      args: {
        'user-id-type': 'open_id',
        'body-json': '{"approval_code":"leave","instance_code":"ins_1","user_id":"ou_1","cc_user_ids":["ou_cc_1","ou_cc_2"],"comment":"请同步关注"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.cc-instance',
      data: {},
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'search-cc',
      args: {
        'page-size': '20',
        'user-id-type': 'open_id',
        'body-json': '{"user_id":"ou_1","read_status":"UNREAD"}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.search-cc',
      data: {
        count: 1,
        cc_list: [{
          approval: { code: 'leave', name: '请假' },
          instance: { code: 'ins_1', title: '年假申请' },
          cc: { user_id: 'ou_1', read_status: 'unread', title: '请假抄送' },
        }],
        has_more: false,
        page_token: 'done',
      },
    });

    await expect(runCommand({
      resource: 'approval',
      action: 'delete-comment',
      args: {
        'instance-id': 'ins_1',
        'comment-id': 'ac_1',
        'user-id': 'ou_1',
        'user-id-type': 'open_id',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'approval.delete-comment',
      comment_id: 'ac_1',
      data: {
        comment_id: 'ac_1',
      },
    });
  });

  it('supports chat collaboration management commands', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/oc_1/members?member_id_type=user_id&succeed_type=2') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          id_list: ['ou_1', 'ou_2'],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            invalid_id_list: [],
            not_existed_id_list: [],
            pending_approval_id_list: ['ou_2'],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/oc_1/members?member_id_type=user_id') {
        expect(init?.method).toBe('DELETE');
        expect(JSON.parse(String(init?.body))).toEqual({
          id_list: ['ou_2'],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            invalid_id_list: [],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/oc_1/members/is_in_chat') {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            is_in_chat: true,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/oc_1/announcement?user_id_type=open_id') {
        if (init?.method === 'GET') {
          return new Response(JSON.stringify({
            code: 0,
            data: {
              content: '[{\"insert\":\"项目群公告\"}]',
              revision: '7',
            },
          }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
      }
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/oc_1/announcement') {
        expect(init?.method).toBe('PATCH');
        expect(JSON.parse(String(init?.body))).toEqual({
          revision: '7',
          requests: ['{\"insert\":\"更新后的公告\"}'],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/oc_1/managers/add_managers?member_id_type=user_id') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          manager_ids: ['ou_mgr'],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            chat_managers: ['ou_mgr'],
            chat_bot_managers: [],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      if (input === 'https://open.feishu.cn/open-apis/im/v1/chats/oc_1/managers/delete_managers?member_id_type=user_id') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          manager_ids: ['ou_mgr'],
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            chat_managers: [],
            chat_bot_managers: [],
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(runCommand({
      resource: 'chat',
      action: 'add-members',
      args: {
        'chat-id': 'oc_1',
        'member-id-type': 'user_id',
        'succeed-type': '2',
        'body-json': '{"id_list":["ou_1","ou_2"]}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.add-members',
      chat_id: 'oc_1',
      data: {
        invalid_id_list: [],
        not_existed_id_list: [],
        pending_approval_id_list: ['ou_2'],
      },
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'remove-members',
      args: {
        'chat-id': 'oc_1',
        'member-id-type': 'user_id',
        'body-json': '{"id_list":["ou_2"]}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.remove-members',
      chat_id: 'oc_1',
      data: {
        invalid_id_list: [],
      },
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'is-in-chat',
      args: {
        'chat-id': 'oc_1',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.is-in-chat',
      chat_id: 'oc_1',
      data: {
        is_in_chat: true,
      },
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'get-announcement',
      args: {
        'chat-id': 'oc_1',
        'user-id-type': 'open_id',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.get-announcement',
      chat_id: 'oc_1',
      data: {
        content: '[{\"insert\":\"项目群公告\"}]',
        revision: '7',
      },
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'update-announcement',
      args: {
        'chat-id': 'oc_1',
        'body-json': '{"revision":"7","requests":["{\\"insert\\":\\"更新后的公告\\"}"]}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.update-announcement',
      chat_id: 'oc_1',
      data: {},
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'add-managers',
      args: {
        'chat-id': 'oc_1',
        'member-id-type': 'user_id',
        'body-json': '{"manager_ids":["ou_mgr"]}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.add-managers',
      chat_id: 'oc_1',
      data: {
        chat_managers: ['ou_mgr'],
        chat_bot_managers: [],
      },
    });

    await expect(runCommand({
      resource: 'chat',
      action: 'delete-managers',
      args: {
        'chat-id': 'oc_1',
        'member-id-type': 'user_id',
        'body-json': '{"manager_ids":["ou_mgr"]}',
      },
      token: 'tenant_token',
    })).resolves.toEqual({
      ok: true,
      operation: 'chat.delete-managers',
      chat_id: 'oc_1',
      data: {
        chat_managers: [],
        chat_bot_managers: [],
      },
    });
  });
});
