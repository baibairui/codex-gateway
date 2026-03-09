#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Client as LarkClient, Domain as LarkDomain, LoggerLevel as LarkLoggerLevel } from '@larksuiteoapi/node-sdk';
import { buildDocxChildrenFromConvertPayload, buildDocxCreateNodes } from './docx-markdown.mjs';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const DEFAULT_FEISHU_DOC_BASE_URL = 'https://feishu.cn/docx';
const LATEST_DOC_STATE_PATH = path.resolve(process.cwd(), '.data', 'feishu-docx-latest.json');

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const [resource, action, ...rest] = argv;
  const args = parseArgs(rest);
  const result = await runCommand({ resource, action, args });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(`${buildHelpText()}\n`);
}

export function buildHelpText() {
  const lines = [
    'Feishu OpenAPI CLI',
    '',
    'Environment:',
    '  FEISHU_APP_ID',
    '  FEISHU_APP_SECRET',
    '  FEISHU_DOC_BASE_URL (optional override; defaults to https://feishu.cn/docx)',
    '',
    'Commands:',
    '  im get-message --message-id <id>',
    '  im list-messages --container-id-type <type> --container-id <id> [--page-size <n>] [--page-token <token>]',
    '  im search-messages --query <text> [--page-size <n>] [--page-token <token>]',
    '  doc get-content --doc-token <token> [--lang <zh|en|ja>]',
    '  doc get-raw-content --document <url|token|document_id>',
    '  bitable list-tables --app-token <token> [--page-size <n>] [--page-token <token>]',
    '  bitable list-records --app-token <token> --table-id <id> [--page-size <n>] [--page-token <token>]',
    '  bitable search-records --app-token <token> --table-id <id> [--filter-json <json>] [--sort-json <json>]',
    '  calendar list-calendars [--page-size <n>] [--page-token <token>]',
    '  calendar list-events --calendar-id <id> --time-min <time> --time-max <time> [--page-size <n>] [--page-token <token>]',
    '  calendar freebusy --time-min <time> --time-max <time> [--user-id <id>] [--room-id <id>] [--only-busy <true|false>]',
    '  task create --summary <text>',
    '  task list [--page-size <n>] [--page-token <token>]',
    '  task get --task-id <id>',
    '  task update --task-id <id> --task-json <json> --update-fields-json <json>',
    '  task create-subtask --task-guid <guid> --summary <text>',
    '  docx create --title <title> [--folder-token <token>] [--markdown <text>] [--markdown-file <path>] [--image-file <path>]',
    '  docx append --document <url|token|document_id> [--markdown <text>] [--markdown-file <path>] [--image-file <path>]',
    '  wiki list-spaces [--page-size <n>] [--page-token <token>]',
    '  wiki get-node --token <token> [--obj-type <wiki|docx|doc|sheet|bitable|mindnote|file|slides>]',
    '  wiki create-node --space-id <id> --obj-type <docx|doc|sheet|bitable|mindnote|file|slides> [--title <title>] [--parent-node-token <token>] [--node-type <origin|shortcut>] [--origin-node-token <token>]',
    '',
    'Optional image write args:',
    '  --image-file <path> [--image-width <px>] [--image-height <px>] [--image-align <1|2|3>] [--image-caption <text>]',
    '',
    'Optional auth overrides:',
    '  --app-id <id> --app-secret <secret>',
  ];
  return lines.join('\n');
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

export function parseJsonFlag(value, flagName) {
  const raw = firstNonEmptyString(value);
  if (!raw) {
    throw new Error(`missing ${flagName}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`invalid ${flagName}: expected valid JSON`);
  }
}

export function parseRequiredStringFlag(value, flagName) {
  const normalized = firstNonEmptyString(value);
  if (!normalized) {
    throw new Error(`missing ${flagName}`);
  }
  return normalized;
}

export function parseOptionalBooleanFlag(value, flagName) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  throw new Error(`invalid ${flagName}: expected true or false`);
}

export async function getTenantAccessToken(input) {
  if (!input.appId || !input.appSecret) {
    throw new Error('missing FEISHU_APP_ID or FEISHU_APP_SECRET');
  }
  const response = await fetch(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      app_id: input.appId,
      app_secret: input.appSecret,
    }),
  });
  const body = await response.json();
  if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`failed to get tenant access token: ${body.code ?? response.status} ${body.msg ?? 'unknown error'}`);
  }
  return body.tenant_access_token;
}

function createFeishuSdkClient(input) {
  return new LarkClient({
    appId: input.appId,
    appSecret: input.appSecret,
    domain: LarkDomain.Feishu,
    loggerLevel: LarkLoggerLevel.error,
  });
}

function resolveAppCredentials(args) {
  const appId = firstNonEmptyString(args?.appId, args?.['app-id'], process.env.FEISHU_APP_ID);
  const appSecret = firstNonEmptyString(args?.appSecret, args?.['app-secret'], process.env.FEISHU_APP_SECRET);
  if (!appId || !appSecret) {
    throw new Error('missing FEISHU_APP_ID or FEISHU_APP_SECRET');
  }
  return { appId, appSecret };
}

async function resolveTenantToken(args, providedToken) {
  if (providedToken) {
    return providedToken;
  }
  const { appId, appSecret } = resolveAppCredentials(args);
  return getTenantAccessToken({ appId, appSecret });
}

function resolveSdkClient(args, providedClient) {
  if (providedClient) {
    return providedClient;
  }
  const { appId, appSecret } = resolveAppCredentials(args);
  return createFeishuSdkClient({ appId, appSecret });
}

export async function runCommand(input) {
  const { resource, action, args = {}, token, sdkClient } = input ?? {};
  if (resource === 'im') {
    return handleImCommand(action, args, resolveSdkClient(args, sdkClient));
  }
  if (resource === 'doc') {
    return handleDocCommand(action, args, resolveSdkClient(args, sdkClient), token);
  }
  if (resource === 'bitable') {
    return handleBitableCommand(action, args, resolveSdkClient(args, sdkClient));
  }
  if (resource === 'calendar') {
    return handleCalendarCommand(action, args, resolveSdkClient(args, sdkClient));
  }
  if (resource === 'task') {
    return handleTaskCommand(action, args, resolveSdkClient(args, sdkClient));
  }
  if (resource === 'docx' && action === 'create') {
    return createDocx(await resolveTenantToken(args, token), args);
  }
  if (resource === 'docx' && action === 'append') {
    return appendDocx(await resolveTenantToken(args, token), args);
  }
  if (resource === 'wiki' && action === 'list-spaces') {
    return listWikiSpaces(await resolveTenantToken(args, token), args);
  }
  if (resource === 'wiki' && action === 'get-node') {
    return getWikiNode(await resolveTenantToken(args, token), args);
  }
  if (resource === 'wiki' && action === 'create-node') {
    return createWikiNode(await resolveTenantToken(args, token), args);
  }
  throw new Error(`unsupported command: ${resource ?? ''} ${action ?? ''}`.trim());
}

async function handleImCommand(action, args, sdkClient) {
  if (action === 'get-message') {
    const messageId = parseRequiredStringFlag(args['message-id'], '--message-id');
    const response = await sdkClient.im.message.get({
      path: { message_id: messageId },
    });
    const message = Array.isArray(response?.data?.items) ? (response.data.items[0] ?? null) : null;
    return {
      ok: true,
      operation: 'im.get-message',
      message_id: messageId,
      message,
    };
  }
  if (action === 'list-messages') {
    const containerIdType = parseRequiredStringFlag(args['container-id-type'], '--container-id-type');
    const containerId = parseRequiredStringFlag(args['container-id'], '--container-id');
    const response = await sdkClient.im.message.list({
      params: {
        container_id_type: containerIdType,
        container_id: containerId,
        ...(parseOptionalPositiveInteger(args['page-size'], '--page-size')
          ? { page_size: parseOptionalPositiveInteger(args['page-size'], '--page-size') }
          : {}),
        ...(firstNonEmptyString(args['page-token']) ? { page_token: firstNonEmptyString(args['page-token']) } : {}),
      },
    });
    return {
      ok: true,
      operation: 'im.list-messages',
      container_id_type: containerIdType,
      container_id: containerId,
      items: response?.data?.items ?? [],
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }
  if (action === 'search-messages') {
    const query = parseRequiredStringFlag(args.query, '--query');
    const response = await sdkClient.search.message.create({
      data: { query },
      params: {
        ...(parseOptionalPositiveInteger(args['page-size'], '--page-size')
          ? { page_size: parseOptionalPositiveInteger(args['page-size'], '--page-size') }
          : {}),
        ...(firstNonEmptyString(args['page-token']) ? { page_token: firstNonEmptyString(args['page-token']) } : {}),
      },
    });
    return {
      ok: true,
      operation: 'im.search-messages',
      query,
      items: response?.data?.items ?? [],
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }
  throw new Error(`unsupported command: im ${action ?? ''}`.trim());
}

async function handleDocCommand(action, args, sdkClient, token) {
  if (action === 'get-content') {
    const docToken = parseRequiredStringFlag(args['doc-token'], '--doc-token');
    const lang = firstNonEmptyString(args.lang) ?? 'zh';
    const response = await sdkClient.docs.v1.content.get({
      params: {
        doc_token: docToken,
        doc_type: 'docx',
        content_type: 'markdown',
        lang,
      },
    });
    return {
      ok: true,
      operation: 'doc.get-content',
      doc_token: docToken,
      content_type: 'markdown',
      content: response?.data?.content ?? '',
    };
  }
  if (action === 'get-raw-content') {
    const locator = firstNonEmptyString(
      args.document,
      args['document-id'],
      args['doc-id'],
      args.document_id,
      args.url,
      args.target,
    );
    const directDocId = extractDocxDocumentId(locator);
    let target;
    if (directDocId) {
      target = {
        documentId: directDocId,
        kind: directDocId === locator ? 'document_id' : 'document_url',
      };
    } else {
      const tenantToken = await resolveTenantToken(args, token);
      target = await resolveDocxTarget(tenantToken, locator);
    }
    const response = await sdkClient.docx.v1.document.rawContent({
      path: {
        document_id: target.documentId,
      },
    });
    return {
      ok: true,
      operation: 'doc.get-raw-content',
      document_id: target.documentId,
      resolved_from: target.kind,
      content: response?.data?.content ?? '',
    };
  }
  throw new Error(`unsupported command: doc ${action ?? ''}`.trim());
}

async function handleBitableCommand(action, args, sdkClient) {
  const appToken = parseRequiredStringFlag(args['app-token'], '--app-token');
  if (action === 'list-tables') {
    const response = await sdkClient.bitable.appTable.list({
      path: { app_token: appToken },
      params: buildPagingParams(args),
    });
    return {
      ok: true,
      operation: 'bitable.list-tables',
      app_token: appToken,
      items: response?.data?.items ?? [],
      total: response?.data?.total ?? 0,
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }

  const tableId = parseRequiredStringFlag(args['table-id'], '--table-id');
  if (action === 'list-records') {
    const response = await sdkClient.bitable.appTableRecord.list({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      params: buildPagingParams(args),
    });
    return {
      ok: true,
      operation: 'bitable.list-records',
      app_token: appToken,
      table_id: tableId,
      items: response?.data?.items ?? [],
      total: response?.data?.total ?? 0,
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }
  if (action === 'search-records') {
    const response = await sdkClient.bitable.appTableRecord.search({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      data: {
        ...(args['filter-json'] ? { filter: parseJsonFlag(args['filter-json'], '--filter-json') } : {}),
        ...(args['sort-json'] ? { sort: parseJsonFlag(args['sort-json'], '--sort-json') } : {}),
      },
      params: buildPagingParams(args),
    });
    return {
      ok: true,
      operation: 'bitable.search-records',
      app_token: appToken,
      table_id: tableId,
      items: response?.data?.items ?? [],
      total: response?.data?.total ?? 0,
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }
  throw new Error(`unsupported command: bitable ${action ?? ''}`.trim());
}

async function handleCalendarCommand(action, args, sdkClient) {
  if (action === 'list-calendars') {
    const response = await sdkClient.calendar.calendar.list({
      params: buildPagingParams(args),
    });
    return {
      ok: true,
      operation: 'calendar.list-calendars',
      items: response?.data?.calendar_list ?? [],
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
      sync_token: response?.data?.sync_token ?? null,
    };
  }
  if (action === 'list-events') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const response = await sdkClient.calendar.calendarEvent.instanceView({
      path: { calendar_id: calendarId },
      params: {
        start_time: parseRequiredStringFlag(args['time-min'], '--time-min'),
        end_time: parseRequiredStringFlag(args['time-max'], '--time-max'),
      },
    });
    return {
      ok: true,
      operation: 'calendar.list-events',
      calendar_id: calendarId,
      items: response?.data?.items ?? [],
    };
  }
  if (action === 'freebusy') {
    const response = await sdkClient.calendar.freebusy.list({
      data: {
        time_min: parseRequiredStringFlag(args['time-min'], '--time-min'),
        time_max: parseRequiredStringFlag(args['time-max'], '--time-max'),
        ...(args['user-id'] ? { user_id: parseRequiredStringFlag(args['user-id'], '--user-id') } : {}),
        ...(args['room-id'] ? { room_id: parseRequiredStringFlag(args['room-id'], '--room-id') } : {}),
        ...(args['only-busy'] !== undefined ? { only_busy: parseOptionalBooleanFlag(args['only-busy'], '--only-busy') } : {}),
      },
    });
    return {
      ok: true,
      operation: 'calendar.freebusy',
      freebusy_list: response?.data?.freebusy_list ?? [],
    };
  }
  throw new Error(`unsupported command: calendar ${action ?? ''}`.trim());
}

async function handleTaskCommand(action, args, sdkClient) {
  if (action === 'create') {
    const summary = parseRequiredStringFlag(args.summary, '--summary');
    const originPlatformName = firstNonEmptyString(args['origin-platform-name']) ?? 'codex-gateway';
    const response = await sdkClient.task.task.create({
      data: {
        summary,
        ...(firstNonEmptyString(args.description) ? { description: firstNonEmptyString(args.description) } : {}),
        origin: {
          platform_i18n_name: originPlatformName,
        },
      },
    });
    return {
      ok: true,
      operation: 'task.create',
      task: response?.data?.task ?? null,
    };
  }
  if (action === 'list') {
    const response = await sdkClient.task.task.list({
      params: buildPagingParams(args),
    });
    return {
      ok: true,
      operation: 'task.list',
      items: response?.data?.items ?? [],
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }
  if (action === 'get') {
    const taskId = parseRequiredStringFlag(args['task-id'], '--task-id');
    const response = await sdkClient.task.task.get({
      path: { task_id: taskId },
    });
    return {
      ok: true,
      operation: 'task.get',
      task_id: taskId,
      task: response?.data?.task ?? null,
    };
  }
  if (action === 'update') {
    const taskId = parseRequiredStringFlag(args['task-id'], '--task-id');
    const task = parseJsonFlag(args['task-json'], '--task-json');
    const updateFields = parseJsonFlag(args['update-fields-json'], '--update-fields-json');
    if (!Array.isArray(updateFields)) {
      throw new Error('invalid --update-fields-json: expected a JSON array');
    }
    const response = await sdkClient.task.task.patch({
      path: { task_id: taskId },
      data: {
        task,
        update_fields: updateFields,
      },
    });
    return {
      ok: true,
      operation: 'task.update',
      task_id: taskId,
      task: response?.data?.task ?? null,
    };
  }
  if (action === 'create-subtask') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const summary = parseRequiredStringFlag(args.summary, '--summary');
    const response = await sdkClient.task.taskSubtask.create({
      path: { task_guid: taskGuid },
      data: {
        summary,
      },
    });
    return {
      ok: true,
      operation: 'task.create-subtask',
      task_guid: taskGuid,
      task: response?.data?.task ?? null,
    };
  }
  throw new Error(`unsupported command: task ${action ?? ''}`.trim());
}

export async function createDocx(token, args) {
  const title = args.title?.trim() || '未命名文档';
  const writeInput = resolveDocxWriteInput(args);
  const docBaseUrl = firstNonEmptyString(args['doc-base-url'], process.env.FEISHU_DOC_BASE_URL);
  const body = {
    title,
    ...(args['folder-token'] ? { folder_token: args['folder-token'] } : {}),
  };
  const payload = await apiRequest(token, 'POST', '/docx/v1/documents', body);
  const document = payload?.data?.document ?? {};
  const documentId = document.document_id ?? null;
  let writeResult = undefined;
  if (documentId && writeInput) {
    try {
      writeResult = await writeDocxContent(token, documentId, writeInput);
    } catch (error) {
      writeResult = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const documentUrl = buildFeishuDocxUrl(documentId, docBaseUrl);
  const result = {
    ok: true,
    operation: 'docx.create',
    title: document.title ?? title,
    document_id: documentId,
    document_url: documentUrl,
    revision_id: document.revision_id ?? null,
    content_write: writeResult ?? null,
    raw: payload.data ?? null,
  };
  persistLatestDocxState({
    documentId,
    documentUrl,
    title: document.title ?? title,
  });
  return result;
}

export async function appendDocx(token, args) {
  const locator = firstNonEmptyString(args.document, args['document-id'], args['doc-id'], args.document_id, args.url, args.target);
  const target = await resolveDocxTarget(token, locator);
  const writeInput = resolveDocxWriteInput(args);
  if (!writeInput) {
    throw new Error('missing --markdown, --markdown-file, or --image-file');
  }
  const docBaseUrl = firstNonEmptyString(args['doc-base-url'], process.env.FEISHU_DOC_BASE_URL);
  const writeResult = await writeDocxContent(token, target.documentId, writeInput);
  const documentUrl = buildFeishuDocxUrl(target.documentId, docBaseUrl);
  const result = {
    ok: true,
    operation: 'docx.append',
    document_id: target.documentId,
    document_url: documentUrl,
    input_locator: locator ?? null,
    resolved_from: target.kind,
    content_write: writeResult,
  };
  persistLatestDocxState({
    documentId: target.documentId,
    documentUrl,
  });
  return result;
}

export async function listWikiSpaces(token, args) {
  const query = new URLSearchParams();
  if (args['page-size']) {
    query.set('page_size', String(args['page-size']));
  }
  if (args['page-token']) {
    query.set('page_token', String(args['page-token']));
  }
  const payload = await apiRequest(token, 'GET', `/wiki/v2/spaces${query.toString() ? `?${query}` : ''}`);
  return {
    ok: true,
    operation: 'wiki.list-spaces',
    items: payload?.data?.items ?? [],
    has_more: payload?.data?.has_more ?? false,
    page_token: payload?.data?.page_token ?? null,
  };
}

export async function getWikiNode(token, args) {
  const nodeToken = args.token?.trim() || args['node-token']?.trim() || extractFeishuNodeToken(args.url);
  if (!nodeToken) {
    throw new Error('missing --token');
  }
  const query = new URLSearchParams({ token: nodeToken });
  if (args['obj-type']) {
    query.set('obj_type', String(args['obj-type']));
  }
  const payload = await apiRequest(token, 'GET', `/wiki/v2/spaces/get_node?${query.toString()}`);
  return {
    ok: true,
    operation: 'wiki.get-node',
    node: payload?.data?.node ?? null,
  };
}

export async function createWikiNode(token, args) {
  const spaceId = args['space-id']?.trim();
  if (!spaceId) {
    throw new Error('missing --space-id');
  }
  const objType = args['obj-type']?.trim();
  if (!objType) {
    throw new Error('missing --obj-type');
  }
  const nodeType = args['node-type']?.trim() || 'origin';
  const body = {
    obj_type: objType,
    node_type: nodeType,
    ...(args.title?.trim() ? { title: args.title.trim() } : {}),
    ...(args['parent-node-token']?.trim() ? { parent_node_token: args['parent-node-token'].trim() } : {}),
    ...(args['origin-node-token']?.trim() ? { origin_node_token: args['origin-node-token'].trim() } : {}),
  };
  if (nodeType === 'shortcut' && !body.origin_node_token) {
    throw new Error('missing --origin-node-token for shortcut node');
  }
  const payload = await apiRequest(token, 'POST', `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, body);
  return {
    ok: true,
    operation: 'wiki.create-node',
    node: payload?.data?.node ?? null,
  };
}

async function apiRequest(token, method, path, body) {
  const response = await fetch(`${FEISHU_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { code: response.status, msg: await response.text() };
  if (!response.ok || payload.code !== 0) {
    throw new Error(`feishu api failed: ${payload.code ?? response.status} ${payload.msg ?? 'unknown error'}`);
  }
  return payload;
}

function resolveMarkdownInput(args) {
  if (typeof args.markdown === 'string' && args.markdown.trim()) {
    return args.markdown;
  }
  const filePath = typeof args['markdown-file'] === 'string' ? args['markdown-file'].trim() : '';
  if (!filePath) {
    return undefined;
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`markdown file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function resolveDocxWriteInput(args) {
  const markdown = resolveMarkdownInput(args);
  const imageFile = firstNonEmptyString(args['image-file']);
  if (markdown?.trim() && imageFile) {
    throw new Error('cannot combine markdown input with --image-file in a single docx write');
  }
  if (imageFile) {
    return {
      mode: 'image',
      image: {
        filePath: imageFile,
        width: parseOptionalPositiveInteger(args['image-width'], '--image-width'),
        height: parseOptionalPositiveInteger(args['image-height'], '--image-height'),
        align: parseOptionalEnumInteger(args['image-align'], '--image-align', [1, 2, 3]),
        caption: firstNonEmptyString(args['image-caption']),
      },
    };
  }
  if (markdown?.trim()) {
    return {
      mode: 'markdown',
      markdown,
    };
  }
  return undefined;
}

async function writeDocxContent(token, documentId, input) {
  if (!input) {
    return { ok: true, blocks_appended: 0, mode: 'empty' };
  }
  if (input.mode === 'image') {
    return appendImageToDocx(token, documentId, input.image);
  }
  return appendMarkdownToDocx(token, documentId, input.markdown);
}

async function appendMarkdownToDocx(token, documentId, markdown) {
  const source = String(markdown ?? '').replace(/\r\n/g, '\n').trim();
  if (!source) {
    return { ok: true, blocks_appended: 0, mode: 'converted' };
  }

  let payload;
  try {
    payload = await convertMarkdownToDocxBlocksWithRetry(token, source);
  } catch (error) {
    const fallbackChildren = buildPlainTextDocxChildren(source);
    let appended = 0;
    for (const chunk of chunkArray(fallbackChildren, 20)) {
      await appendDocxChildrenWithRetry(token, documentId, documentId, chunk);
      appended += chunk.length;
    }
    return {
      ok: true,
      blocks_appended: appended,
      mode: 'plain_text_fallback',
      convert_error: error instanceof Error ? error.message : String(error),
    };
  }

  const nodes = buildDocxCreateNodes(buildDocxChildrenFromConvertPayload(payload?.data));
  if (nodes.length === 0) {
    return { ok: true, blocks_appended: 0, mode: 'converted' };
  }

  const appended = await appendDocxNodesRecursively(token, documentId, documentId, nodes);
  return {
    ok: true,
    blocks_appended: appended,
    mode: 'converted',
  };
}

async function convertMarkdownToDocxBlocksWithRetry(token, markdown, attempt = 1) {
  try {
    return await apiRequest(token, 'POST', '/docx/v1/documents/blocks/convert', {
      content_type: 'markdown',
      content: markdown,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('feishu api failed: 429') || attempt >= 6) {
      throw error;
    }
    await sleep(attempt * 1500);
    return convertMarkdownToDocxBlocksWithRetry(token, markdown, attempt + 1);
  }
}

async function appendDocxNodesRecursively(token, documentId, parentBlockId, nodes) {
  let appended = 0;
  for (const chunk of chunkArray(nodes, 10)) {
    const createdChildren = await appendDocxChildrenWithRetry(
      token,
      documentId,
      parentBlockId,
      chunk.map((node) => node.block),
    );
    appended += chunk.length;
    for (let i = 0; i < chunk.length; i += 1) {
      const createdBlockId = createdChildren?.[i]?.block_id;
      if (!createdBlockId || chunk[i].children.length === 0) {
        continue;
      }
      appended += await appendDocxNodesRecursively(token, documentId, createdBlockId, chunk[i].children);
    }
  }
  return appended;
}

async function appendDocxChildrenWithRetry(token, documentId, blockId, chunk, attempt = 1) {
  try {
    const payload = await apiRequest(
      token,
      'POST',
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}/children`,
      {
        index: -1,
        children: chunk,
      },
    );
    return Array.isArray(payload?.data?.children) ? payload.data.children : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('feishu api failed: 429') || attempt >= 6) {
      throw error;
    }
    await sleep(attempt * 1500);
    return appendDocxChildrenWithRetry(token, documentId, blockId, chunk, attempt + 1);
  }
}

export async function appendImageToDocx(token, documentId, imageInput) {
  const imageToken = await uploadDocxImageAsset(token, documentId, imageInput);
  const block = buildDocxImageBlock({
    token: imageToken,
    width: imageInput?.width,
    height: imageInput?.height,
    align: imageInput?.align,
    caption: imageInput?.caption,
  });
  const createdChildren = await appendDocxChildrenWithRetry(token, documentId, documentId, [block]);
  return {
    ok: true,
    blocks_appended: 1,
    mode: 'image',
    image_token: imageToken,
    block_id: firstNonEmptyString(createdChildren?.[0]?.block_id) ?? null,
  };
}

async function uploadDocxImageAsset(token, documentId, imageInput) {
  const filePath = validateLocalFilePath(imageInput?.filePath, '--image-file');
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`docx image upload failed: not a file: ${filePath}`);
  }

  const fileName = path.basename(filePath);
  const form = new FormData();
  form.set('file_name', fileName);
  form.set('parent_type', 'docx_image');
  form.set('parent_node', documentId);
  form.set('size', String(stat.size));
  form.set('file', new Blob([fs.readFileSync(filePath)]), fileName);

  const response = await fetch(`${FEISHU_API_BASE}/drive/v1/medias/upload_all`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { code: response.status, msg: await response.text() };
  if (!response.ok || payload.code !== 0) {
    throw new Error(`feishu api failed: ${payload.code ?? response.status} ${payload.msg ?? 'unknown error'}`);
  }
  const fileToken = firstNonEmptyString(payload?.data?.file_token, payload?.file_token);
  if (!fileToken) {
    throw new Error(`docx image upload failed: missing file_token for ${filePath}`);
  }
  return fileToken;
}

export function buildDocxImageBlock(input) {
  const token = firstNonEmptyString(input?.token);
  if (!token) {
    throw new Error('docx image block requires token');
  }
  return {
    block_type: 27,
    image: {
      token,
      ...(Number.isInteger(input?.width) ? { width: input.width } : {}),
      ...(Number.isInteger(input?.height) ? { height: input.height } : {}),
      ...(Number.isInteger(input?.align) ? { align: input.align } : {}),
      ...(firstNonEmptyString(input?.caption) ? {
        caption: {
          content: firstNonEmptyString(input?.caption),
        },
      } : {}),
      ...(Number.isFinite(input?.scale) ? { scale: input.scale } : {}),
    },
  };
}

function buildPlainTextDocxChildren(markdown) {
  const lines = String(markdown)
    .split('\n')
    .map((line) => line.trimEnd());
  const normalizedLines = lines.filter((line, index, arr) => line !== '' || (index > 0 && arr[index - 1] !== ''));
  return normalizedLines.map((line) => ({
    block_type: 2,
    text: {
      elements: [
        {
          text_run: {
            content: line || ' ',
          },
        },
      ],
    },
  }));
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function buildPagingParams(args) {
  const pageSize = parseOptionalPositiveInteger(args['page-size'], '--page-size');
  return {
    ...(pageSize ? { page_size: pageSize } : {}),
    ...(firstNonEmptyString(args['page-token']) ? { page_token: firstNonEmptyString(args['page-token']) } : {}),
  };
}

export function normalizeFeishuApiError(error) {
  const message = error instanceof Error ? error.message : String(error);

  const authMatch = message.match(/tenant access token:\s*(\d+)\s+(.+)$/i);
  if (authMatch) {
    return {
      type: 'auth_error',
      code: Number.parseInt(authMatch[1], 10),
      message: authMatch[2],
    };
  }

  const apiMatch = message.match(/feishu api failed:\s*(\d+)\s+(.+)$/i);
  if (apiMatch) {
    const code = Number.parseInt(apiMatch[1], 10);
    return {
      type: code === 99991663 ? 'permission_denied' : code === 404 ? 'not_found' : code === 429 ? 'rate_limited' : 'api_error',
      code,
      message: apiMatch[2],
    };
  }

  return {
    type: 'api_error',
    code: null,
    message,
  };
}

function parseOptionalPositiveInteger(value, flagName) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${flagName}: expected a positive integer`);
  }
  return parsed;
}

function parseOptionalEnumInteger(value, flagName, allowed) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || !allowed.includes(parsed)) {
    throw new Error(`invalid ${flagName}: expected one of ${allowed.join(', ')}`);
  }
  return parsed;
}

function validateLocalFilePath(value, flagName) {
  const filePath = firstNonEmptyString(value);
  if (!filePath) {
    throw new Error(`missing ${flagName}`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`file not found for ${flagName}: ${filePath}`);
  }
  return filePath;
}

async function resolveDocxTarget(token, locator) {
  const value = firstNonEmptyString(locator) ?? loadLatestDocxReference();
  if (!value) {
    throw new Error('missing --document and no recent DocX reference available');
  }
  const directDocId = extractDocxDocumentId(value);
  if (directDocId) {
    return {
      documentId: directDocId,
      kind: directDocId === value ? 'document_id' : 'document_url',
    };
  }
  const wikiToken = extractWikiNodeToken(value);
  if (!wikiToken) {
    throw new Error(`unsupported document locator: ${value}`);
  }
  const node = await getWikiNodeByToken(token, wikiToken);
  const documentId = firstNonEmptyString(node?.obj_token, node?.origin_node_token);
  if (!documentId) {
    throw new Error(`wiki node did not resolve to a DocX object: ${wikiToken}`);
  }
  return {
    documentId,
    kind: 'wiki_url',
  };
}

export function extractDocxDocumentId(value) {
  const raw = firstNonEmptyString(value);
  if (!raw) {
    return undefined;
  }
  const fromUrl = extractDocxPathToken(raw);
  if (fromUrl) {
    return fromUrl;
  }
  const normalized = raw.replace(/^\/+|\/+$/g, '');
  if (/^(?:dox|doc|docx)[A-Za-z0-9]+$/.test(normalized) || /^[A-Za-z0-9_-]{10,}$/.test(normalized)) {
    return normalized;
  }
  return undefined;
}

export function extractFeishuNodeToken(value) {
  return extractDocxPathToken(value) ?? extractWikiNodeToken(value);
}

function extractDocxPathToken(value) {
  const urlValue = parseUrlSafely(value);
  const pathname = urlValue?.pathname ?? value;
  return extractTokenFromPath(pathname, ['docx', 'docs', 'doc']);
}

export function extractWikiNodeToken(value) {
  const urlValue = parseUrlSafely(value);
  const pathname = urlValue?.pathname ?? value;
  return extractTokenFromPath(pathname, ['wiki']);
}

function extractTokenFromPath(pathname, prefixes) {
  const cleaned = String(pathname ?? '').replace(/^\/+|\/+$/g, '');
  if (!cleaned) {
    return undefined;
  }
  const segments = cleaned.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    if (prefixes.includes(segments[i]) && segments[i + 1]) {
      return decodeURIComponent(segments[i + 1]).replace(/[?#].*$/, '');
    }
  }
  return undefined;
}

function parseUrlSafely(value) {
  const raw = firstNonEmptyString(value);
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function loadLatestDocxReference() {
  try {
    if (!fs.existsSync(LATEST_DOC_STATE_PATH)) {
      return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(LATEST_DOC_STATE_PATH, 'utf8'));
    return firstNonEmptyString(parsed?.documentId, parsed?.documentUrl);
  } catch {
    return undefined;
  }
}

function persistLatestDocxState(input) {
  const documentId = firstNonEmptyString(input?.documentId);
  if (!documentId) {
    return;
  }
  fs.mkdirSync(path.dirname(LATEST_DOC_STATE_PATH), { recursive: true });
  fs.writeFileSync(LATEST_DOC_STATE_PATH, JSON.stringify({
    documentId,
    documentUrl: firstNonEmptyString(input?.documentUrl) ?? buildFeishuDocxUrl(documentId),
    title: firstNonEmptyString(input?.title) ?? null,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

async function getWikiNodeByToken(token, nodeToken) {
  const query = new URLSearchParams({ token: nodeToken });
  const payload = await apiRequest(token, 'GET', `/wiki/v2/spaces/get_node?${query.toString()}`);
  return payload?.data?.node ?? null;
}

export function buildFeishuDocxUrl(documentId, docBaseUrl) {
  const id = firstNonEmptyString(documentId);
  const base = firstNonEmptyString(docBaseUrl, DEFAULT_FEISHU_DOC_BASE_URL)?.replace(/\/+$/, '');
  if (!id || !base) {
    return null;
  }
  return `${base}/${encodeURIComponent(id)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function markdownToDocxChildren(markdown) {
  const source = String(markdown ?? '').replace(/\r\n/g, '\n').trim();
  return buildPlainTextDocxChildren(source);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: normalizeFeishuApiError(error),
    })}\n`);
    process.exitCode = 1;
  });
}
