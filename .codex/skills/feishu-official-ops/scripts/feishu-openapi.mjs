#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Client as LarkClient, Domain as LarkDomain, LoggerLevel as LarkLoggerLevel } from '@larksuiteoapi/node-sdk';
import { buildDocxChildrenFromConvertPayload, buildDocxCreateNodes } from './docx-markdown.mjs';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';
const FEISHU_AUTH_BASE = 'https://open.feishu.cn/open-apis';
const FEISHU_API_CATALOG_URL = 'https://open.feishu.cn/api_explorer/v1/api_catalog';
const DEFAULT_FEISHU_DOC_BASE_URL = 'https://feishu.cn/docx';
const LATEST_DOC_STATE_PATH = path.resolve(process.cwd(), '.data', 'feishu-docx-latest.json');
const API_CATALOG_CACHE_PATH = path.resolve(process.cwd(), '.data', 'feishu-api-catalog.json');
const FEISHU_USER_BINDING_DB_FILENAME = 'feishu-user-binding.db';
const FEISHU_USER_BINDING_REFRESH_WINDOW_MS = 10_000;
const FEISHU_DEVICE_AUTH_URL = 'https://accounts.feishu.cn/oauth/v1/device_authorization';
const FEISHU_DEVICE_TOKEN_URL = `${FEISHU_API_BASE}/authen/v2/oauth/token`;
const FEISHU_USER_INFO_URL = `${FEISHU_API_BASE}/authen/v1/user_info`;
const FEISHU_OPERATION_REQUIRED_SCOPES = {
  'calendar.create-personal-event': ['calendar:calendar', 'calendar:calendar.event:create'],
  'task.create-personal-task': ['task:task:write', 'task:task:writeonly'],
  'task.list-personal-tasks': ['task:task:read', 'task:task:write'],
  'task.get-personal-task': ['task:task:read', 'task:task:write'],
  'task.update-personal-task': ['task:task:write', 'task:task:writeonly'],
  'task.delete-personal-task': ['task:task:write', 'task:task:writeonly'],
};

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
    '  bitable create-record --app-token <token> --table-id <id> --fields-json <json>',
    '  bitable get-record --app-token <token> --table-id <id> --record-id <id>',
    '  bitable update-record --app-token <token> --table-id <id> --record-id <id> --fields-json <json>',
    '  bitable delete-record --app-token <token> --table-id <id> --record-id <id>',
    '  bitable batch-create-records --app-token <token> --table-id <id> --records-json <json>',
    '  bitable batch-update-records --app-token <token> --table-id <id> --records-json <json>',
    '  bitable batch-delete-records --app-token <token> --table-id <id> --record-ids-json <json>',
    '  auth start-device-auth --gateway-user-id <id> [--required-scopes-json <json>]',
    '  auth poll-device-auth --gateway-user-id <id> --device-code <code>',
    '  auth diagnose-permission --gateway-user-id <id> [--required-scopes-json <json>] [--error-message <text>] [--token-type <user|tenant>]',
    '  calendar list-calendars [--page-size <n>] [--page-token <token>]',
    '  calendar list-events --calendar-id <id> --time-min <time> --time-max <time> [--page-size <n>] [--page-token <token>]',
    '  calendar create-calendar --body-json <json>',
    '  calendar get-calendar --calendar-id <id>',
    '  calendar update-calendar --calendar-id <id> --body-json <json>',
    '  calendar delete-calendar --calendar-id <id>',
    '  calendar create-event --calendar-id <id> --body-json <json> [--idempotency-key <key>] [--user-id-type <open_id|union_id|user_id>]  # shared calendar only',
    '  calendar list-events-v4 --calendar-id <id> [--page-size <n>] [--page-token <token>] [--time-min <time>] [--time-max <time>] [--anchor-time <time>] [--sync-token <token>] [--user-id-type <open_id|union_id|user_id>]',
    '  calendar get-event --calendar-id <id> --event-id <id> [--need-attendee <true|false>] [--need-meeting-settings <true|false>] [--max-attendee-num <n>] [--user-id-type <open_id|union_id|user_id>]',
    '  calendar update-event --calendar-id <id> --event-id <id> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  calendar delete-event --calendar-id <id> --event-id <id> [--need-notification <true|false>]',
    '  calendar create-personal-event --summary <text> --start-time <iso> --end-time <iso> [--timezone <tz>] [--description <text>] [--user-access-token <token>] [--gateway-user-id <id>]  # default for the current user',
    '  calendar freebusy --time-min <time> --time-max <time> [--user-id <id>] [--room-id <id>] [--only-busy <true|false>]',
    '  task create --summary <text>',
    '  task list [--page-size <n>] [--page-token <token>]',
    '  task get --task-id <id>',
    '  task update --task-id <id> --task-json <json> --update-fields-json <json>',
    '  task create-subtask --task-guid <guid> --summary <text>',
    '  task delete --task-guid <guid>',
    '  task add-members --task-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  task remove-members --task-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  task add-reminders --task-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  task remove-reminders --task-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  task add-dependencies --task-guid <guid> --body-json <json>',
    '  task remove-dependencies --task-guid <guid> --body-json <json>',
    '  task list-subtasks --task-guid <guid> [--page-size <n>] [--page-token <token>]',
    '  task list-tasklists --task-guid <guid>',
    '  task add-tasklist --task-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  task remove-tasklist --task-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  task create-personal-task --summary <text> [--description <text>] [--user-access-token <token>] [--gateway-user-id <id>]',
    '  task list-personal-tasks [--page-size <n>] [--page-token <token>] [--user-access-token <token>] [--gateway-user-id <id>]',
    '  task get-personal-task --task-guid <guid> [--user-access-token <token>] [--gateway-user-id <id>]',
    '  task update-personal-task --task-guid <guid> --task-json <json> --update-fields-json <json> [--user-access-token <token>] [--gateway-user-id <id>]',
    '  task delete-personal-task --task-guid <guid> [--user-access-token <token>] [--gateway-user-id <id>]',
    '  tasklist create --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  tasklist list [--page-size <n>] [--page-token <token>] [--user-id-type <open_id|union_id|user_id>]',
    '  tasklist get --tasklist-guid <guid> [--user-id-type <open_id|union_id|user_id>]',
    '  tasklist update --tasklist-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  tasklist delete --tasklist-guid <guid>',
    '  tasklist tasks --tasklist-guid <guid> [--completed <true|false>] [--page-size <n>] [--page-token <token>] [--user-id-type <open_id|union_id|user_id>]',
    '  tasklist add-members --tasklist-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  tasklist remove-members --tasklist-guid <guid> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  catalog list [--category <name>] [--project <name>] [--limit <n>] [--refresh]',
    '  catalog search --query <text> [--category <name>] [--project <name>] [--limit <n>] [--refresh]',
    '  catalog show --project <name> --version <ver> --resource <name> --api-name <name> [--refresh]',
    '  api call --method <verb> --path <open_api_path> [--query-json <json>] [--body-json <json>]',
    '  drive list-files --folder-token <token> [--page-size <n>] [--page-token <token>]',
    '  drive create-folder --name <text> --folder-token <token>',
    '  drive get-meta --doc-token <token> --doc-type <type> [--with-url <true|false>]',
    '  drive copy-file --file-token <token> --name <text> --folder-token <token> [--type <type>]',
    '  drive move-file --file-token <token> --folder-token <token> [--type <type>]',
    '  drive delete-file --file-token <token> --type <type>',
    '  drive task-check --task-id <id>',
    '  drive create-shortcut --parent-token <token> --refer-token <token> --refer-type <type>',
    '  drive get-public-permission --token <token> --type <type>',
    '  drive patch-public-permission --token <token> --type <type> --body-json <json>',
    '  drive list-permission-members --token <token> --type <type> [--fields <csv>] [--perm-type <container|single_page>]',
    '  drive create-permission-member --token <token> --type <type> --body-json <json> [--need-notification <true|false>]',
    '  drive update-permission-member --token <token> --member-id <id> --type <type> --body-json <json> [--need-notification <true|false>]',
    '  drive delete-permission-member --token <token> --member-id <id> --type <type> --member-type <type> [--body-json <json>]',
    '  drive check-member-auth --token <token> --type <type> --action <action>',
    '  drive transfer-owner --token <token> --type <type> --body-json <json> [--need-notification <true|false>] [--remove-old-owner <true|false>] [--stay-put <true|false>] [--old-owner-perm <perm>]',
    '  drive batch-query-comments --file-token <token> --file-type <type> --body-json <json>',
    '  drive list-comments --file-token <token> --file-type <type> [--page-size <n>] [--page-token <token>]',
    '  drive get-comment --file-token <token> --comment-id <id> --file-type <type>',
    '  drive create-comment --file-token <token> --file-type <type> --body-json <json>',
    '  drive patch-comment --file-token <token> --comment-id <id> --file-type <type> --body-json <json>',
    '  drive list-comment-replies --file-token <token> --comment-id <id> --file-type <type> [--page-size <n>] [--page-token <token>]',
    '  drive update-comment-reply --file-token <token> --comment-id <id> --reply-id <id> --file-type <type> --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  drive delete-comment-reply --file-token <token> --comment-id <id> --reply-id <id> --file-type <type> [--user-id-type <open_id|union_id|user_id>]',
    '  chat list [--page-size <n>] [--page-token <token>]',
    '  chat create --body-json <json>',
    '  chat get --chat-id <id>',
    '  chat search --query <text> [--page-size <n>] [--page-token <token>]',
    '  chat get-members --chat-id <id> [--page-size <n>] [--page-token <token>]',
    '  chat add-members --chat-id <id> --body-json <json> [--member-id-type <user_id|union_id|open_id|app_id>] [--succeed-type <n>]',
    '  chat remove-members --chat-id <id> --body-json <json> [--member-id-type <user_id|union_id|open_id|app_id>]',
    '  chat is-in-chat --chat-id <id>',
    '  chat get-announcement --chat-id <id> [--user-id-type <user_id|union_id|open_id>]',
    '  chat update-announcement --chat-id <id> --body-json <json>',
    '  chat add-managers --chat-id <id> --body-json <json> [--member-id-type <user_id|union_id|open_id|app_id>]',
    '  chat delete-managers --chat-id <id> --body-json <json> [--member-id-type <user_id|union_id|open_id|app_id>]',
    '  chat update --chat-id <id> --body-json <json>',
    '  card create --body-json <json>',
    '  card update --card-id <id> --body-json <json>',
    '  approval create-instance --body-json <json>',
    '  approval get-definition --approval-code <code>',
    '  approval get-instance --instance-id <id>',
    '  approval cancel-instance --body-json <json>',
    '  approval list-instances [--page-size <n>] [--page-token <token>]',
    '  approval search-tasks --body-json <json> [--page-size <n>] [--page-token <token>]',
    '  approval approve-task --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  approval reject-task --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  approval transfer-task --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  approval resubmit-task --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  approval query-tasks --user-id <id> --topic <topic> [--page-size <n>] [--page-token <token>] [--user-id-type <open_id|union_id|user_id>]',
    '  approval cc-instance --body-json <json> [--user-id-type <open_id|union_id|user_id>]',
    '  approval search-cc --body-json <json> [--page-size <n>] [--page-token <token>] [--user-id-type <open_id|union_id|user_id>]',
    '  approval list-comments --instance-id <id> --user-id <id> [--page-size <n>] [--page-token <token>]',
    '  approval create-comment --instance-id <id> --user-id <id> --body-json <json>',
    '  approval delete-comment --instance-id <id> --comment-id <id> --user-id <id> [--user-id-type <open_id|union_id|user_id>]',
    '  contact get-user --user-id <id> [--user-id-type <open_id|union_id|user_id>]',
    '  contact get-department --department-id <id> [--department-id-type <department_id|open_department_id>]',
    '  contact list-users [--department-id <id>] [--page-size <n>] [--page-token <token>]',
    '  contact list-users-by-department --department-id <id> [--page-size <n>] [--page-token <token>]',
    '  contact list-departments [--parent-department-id <id>] [--fetch-child <true|false>] [--page-size <n>] [--page-token <token>]',
    '  contact batch-get-user-id --body-json <json>',
    '  contact search-departments --body-json <json>',
    '  search doc-wiki --query <text> [--page-size <n>]',
    '  sheets create --title <text> [--folder-token <token>] [--without-mount <true|false>]',
    '  sheets get --spreadsheet-token <token>',
    '  sheets query-sheets --spreadsheet-token <token>',
    '  sheets get-sheet --spreadsheet-token <token> --sheet-id <id>',
    '  sheets find --spreadsheet-token <token> --sheet-id <id> --body-json <json>',
    '  sheets replace --spreadsheet-token <token> --sheet-id <id> --body-json <json>',
    '  docx create --title <title> [--folder-token <token>] [--markdown <text>] [--markdown-file <path>] [--image-file <path>]',
    '  docx append --document <url|token|document_id> [--markdown <text>] [--markdown-file <path>] [--image-file <path>]',
    '  wiki list-spaces [--page-size <n>] [--page-token <token>]',
    '  wiki list-nodes --space-id <id> [--parent-node-token <token>] [--page-size <n>] [--page-token <token>]',
    '  wiki get-node --token <token> [--obj-type <wiki|docx|doc|sheet|bitable|mindnote|file|slides>]',
    '  wiki get-task --task-id <id> [--task-type <move>]',
    '  wiki create-node --space-id <id> --obj-type <docx|doc|sheet|bitable|mindnote|file|slides> [--title <title>] [--parent-node-token <token>] [--node-type <origin|shortcut>] [--origin-node-token <token>]',
    '  wiki move-node --space-id <id> --node-token <token> [--target-parent-token <token>] [--target-space-id <id>]',
    '  wiki move-docs-to-wiki --space-id <id> --obj-type <type> --obj-token <token> [--parent-wiki-token <token>] [--apply <true|false>]',
    '  wiki update-title --space-id <id> --node-token <token> --title <text>',
    '  wiki copy-node --space-id <id> --node-token <token> [--target-parent-token <token>] [--target-space-id <id>] [--title <text>]',
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
  const {
    resource,
    action,
    args = {},
    token,
    sdkClient,
    catalogItems,
  } = input ?? {};
  if (resource === 'im') {
    return handleImCommand(action, args, resolveSdkClient(args, sdkClient));
  }
  if (resource === 'doc') {
    return handleDocCommand(action, args, resolveSdkClient(args, sdkClient), token);
  }
  if (resource === 'bitable') {
    return handleBitableCommand(action, args, resolveSdkClient(args, sdkClient));
  }
  if (resource === 'auth') {
    return handleAuthCommand(action, args);
  }
  if (resource === 'calendar') {
    return handleCalendarCommand(action, args, sdkClient);
  }
  if (resource === 'task') {
    return handleTaskCommand(action, args, sdkClient);
  }
  if (resource === 'tasklist') {
    return handleTasklistCommand(action, args, resolveSdkClient(args, sdkClient));
  }
  if (resource === 'catalog') {
    return handleCatalogCommand(action, args, catalogItems);
  }
  if (resource === 'api' && action === 'call') {
    return handleApiCommand(args, await resolveTenantToken(args, token));
  }
  if (resource === 'drive') {
    return handleDriveCommand(action, args, await resolveTenantToken(args, token));
  }
  if (resource === 'chat') {
    return handleChatCommand(action, args, await resolveTenantToken(args, token));
  }
  if (resource === 'card') {
    return handleCardCommand(action, args, await resolveTenantToken(args, token));
  }
  if (resource === 'approval') {
    return handleApprovalCommand(action, args, await resolveTenantToken(args, token));
  }
  if (resource === 'contact') {
    return handleContactCommand(action, args, await resolveTenantToken(args, token));
  }
  if (resource === 'search') {
    return handleSearchCommand(action, args, await resolveTenantToken(args, token));
  }
  if (resource === 'sheets') {
    return handleSheetsCommand(action, args, await resolveTenantToken(args, token));
  }
  if (resource === 'wiki') {
    return handleWikiCommand(action, args, await resolveTenantToken(args, token));
  }
  if (resource === 'docx' && action === 'create') {
    return createDocx(await resolveTenantToken(args, token), args);
  }
  if (resource === 'docx' && action === 'append') {
    return appendDocx(await resolveTenantToken(args, token), args);
  }
  throw new Error(`unsupported command: ${resource ?? ''} ${action ?? ''}`.trim());
}

async function handleCatalogCommand(action, args, injectedItems) {
  const items = Array.isArray(injectedItems) ? injectedItems : await loadApiCatalog({
    refresh: parseCatalogRefreshFlag(args.refresh),
  });
  if (action === 'search') {
    const query = parseRequiredStringFlag(args.query, '--query').toLowerCase();
    const filtered = filterCatalogItems(items, args).filter((item) => {
      const haystack = [
        item.name,
        item.project,
        item.version,
        item.resource,
        item.apiName,
        item.method,
        item.path,
        ...(Array.isArray(item.chain) ? item.chain : []),
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      return haystack.includes(query);
    });
    return {
      ok: true,
      operation: 'catalog.search',
      query,
      items: applyCatalogLimit(filtered, args),
      total: filtered.length,
    };
  }
  if (action === 'show') {
    const project = parseRequiredStringFlag(args.project, '--project');
    const version = parseRequiredStringFlag(args.version, '--version');
    const resource = parseRequiredStringFlag(args.resource, '--resource');
    const apiName = parseRequiredStringFlag(args['api-name'], '--api-name');
    const item = items.find((entry) => (
      entry.project === project
      && entry.version === version
      && entry.resource === resource
      && entry.apiName === apiName
    ));
    if (!item) {
      throw new Error(`catalog entry not found: ${project}/${version}/${resource}/${apiName}`);
    }
    return {
      ok: true,
      operation: 'catalog.show',
      item,
    };
  }
  if (action === 'list') {
    const filtered = filterCatalogItems(items, args);
    if (!firstNonEmptyString(args.category, args.project)) {
      const categories = [...new Set(
        filtered
          .map((item) => Array.isArray(item.chain) ? item.chain[0] : '')
          .filter(Boolean),
      )].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      return {
        ok: true,
        operation: 'catalog.list',
        categories,
        total: categories.length,
      };
    }
    return {
      ok: true,
      operation: 'catalog.list',
      items: applyCatalogLimit(filtered, args),
      total: filtered.length,
    };
  }
  throw new Error(`unsupported command: catalog ${action ?? ''}`.trim());
}

async function handleApiCommand(args, token) {
  const method = parseRequiredStringFlag(args.method, '--method').toUpperCase();
  const pathInfo = normalizeOpenApiPath(parseRequiredStringFlag(args.path, '--path'));
  const query = parseOptionalJsonObjectFlag(args['query-json'], '--query-json');
  const body = parseOptionalJsonFlag(args['body-json'], '--body-json');
  const payload = await apiRequest(
    token,
    method,
    appendQueryToPath(pathInfo.requestPath, query),
    body,
  );
  return {
    ok: true,
    operation: 'api.call',
    method,
    path: pathInfo.openApiPath,
    query: query ?? {},
    data: payload?.data ?? null,
  };
}

async function handleDriveCommand(action, args, token) {
  if (action === 'list-files') {
    const folderToken = parseRequiredStringFlag(args['folder-token'], '--folder-token');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath('/drive/v1/files', {
        folder_token: folderToken,
        ...buildPagingParams(args),
      }),
    );
    return buildGenericSuccess('drive.list-files', payload?.data ?? null);
  }
  if (action === 'create-folder') {
    const name = parseRequiredStringFlag(args.name, '--name');
    const folderToken = parseRequiredStringFlag(args['folder-token'], '--folder-token');
    const payload = await apiRequest(token, 'POST', '/drive/v1/files/create_folder', {
      name,
      folder_token: folderToken,
    });
    return buildGenericSuccess('drive.create-folder', payload?.data ?? null);
  }
  if (action === 'get-meta') {
    const docToken = parseRequiredStringFlag(args['doc-token'], '--doc-token');
    const docType = parseRequiredStringFlag(args['doc-type'], '--doc-type');
    const withUrl = parseOptionalBooleanFlag(args['with-url'], '--with-url');
    const payload = await apiRequest(token, 'POST', '/drive/v1/metas/batch_query', {
      request_docs: [{ doc_token: docToken, doc_type: docType }],
      ...(withUrl !== undefined ? { with_url: withUrl } : {}),
    });
    return buildGenericSuccess('drive.get-meta', payload?.data ?? null);
  }
  if (action === 'copy-file') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const name = parseRequiredStringFlag(args.name, '--name');
    const folderToken = parseRequiredStringFlag(args['folder-token'], '--folder-token');
    const type = firstNonEmptyString(args.type);
    const payload = await apiRequest(
      token,
      'POST',
      `/drive/v1/files/${encodeURIComponent(fileToken)}/copy`,
      {
        name,
        folder_token: folderToken,
        ...(type ? { type } : {}),
      },
    );
    return buildGenericSuccess('drive.copy-file', payload?.data ?? null);
  }
  if (action === 'move-file') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const folderToken = parseRequiredStringFlag(args['folder-token'], '--folder-token');
    const type = firstNonEmptyString(args.type);
    const payload = await apiRequest(
      token,
      'POST',
      `/drive/v1/files/${encodeURIComponent(fileToken)}/move`,
      {
        folder_token: folderToken,
        ...(type ? { type } : {}),
      },
    );
    return buildGenericSuccess('drive.move-file', payload?.data ?? null);
  }
  if (action === 'delete-file') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const type = parseRequiredStringFlag(args.type, '--type');
    const payload = await apiRequest(
      token,
      'DELETE',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}`, { type }),
    );
    return buildGenericSuccess('drive.delete-file', payload?.data ?? null);
  }
  if (action === 'task-check') {
    const taskId = parseRequiredStringFlag(args['task-id'], '--task-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath('/drive/v1/files/task_check', { task_id: taskId }),
    );
    return buildGenericSuccess('drive.task-check', payload?.data ?? null);
  }
  if (action === 'create-shortcut') {
    const parentToken = parseRequiredStringFlag(args['parent-token'], '--parent-token');
    const referToken = parseRequiredStringFlag(args['refer-token'], '--refer-token');
    const referType = parseRequiredStringFlag(args['refer-type'], '--refer-type');
    const payload = await apiRequest(token, 'POST', '/drive/v1/files/create_shortcut', {
      parent_token: parentToken,
      refer_entity: {
        refer_token: referToken,
        refer_type: referType,
      },
    });
    return buildGenericSuccess('drive.create-shortcut', payload?.data ?? null);
  }
  if (action === 'get-public-permission') {
    const tokenValue = parseRequiredStringFlag(args.token, '--token');
    const type = parseRequiredStringFlag(args.type, '--type');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/drive/v1/permissions/${encodeURIComponent(tokenValue)}/public`, { type }),
    );
    return buildGenericSuccess('drive.get-public-permission', payload?.data ?? null);
  }
  if (action === 'patch-public-permission') {
    const tokenValue = parseRequiredStringFlag(args.token, '--token');
    const type = parseRequiredStringFlag(args.type, '--type');
    const payload = await apiRequest(
      token,
      'PATCH',
      appendQueryToPath(`/drive/v1/permissions/${encodeURIComponent(tokenValue)}/public`, { type }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('drive.patch-public-permission', payload?.data ?? null);
  }
  if (action === 'list-permission-members') {
    const tokenValue = parseRequiredStringFlag(args.token, '--token');
    const type = parseRequiredStringFlag(args.type, '--type');
    const fields = firstNonEmptyString(args.fields);
    const permType = firstNonEmptyString(args['perm-type']);
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/drive/v1/permissions/${encodeURIComponent(tokenValue)}/members`, {
        type,
        ...(fields ? { fields } : {}),
        ...(permType ? { perm_type: permType } : {}),
      }),
    );
    return buildGenericSuccess('drive.list-permission-members', payload?.data ?? null);
  }
  if (action === 'create-permission-member') {
    const tokenValue = parseRequiredStringFlag(args.token, '--token');
    const type = parseRequiredStringFlag(args.type, '--type');
    const needNotification = parseOptionalBooleanFlag(args['need-notification'], '--need-notification');
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath(`/drive/v1/permissions/${encodeURIComponent(tokenValue)}/members`, {
        type,
        ...(needNotification !== undefined ? { need_notification: needNotification } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('drive.create-permission-member', payload?.data ?? null);
  }
  if (action === 'update-permission-member') {
    const tokenValue = parseRequiredStringFlag(args.token, '--token');
    const memberId = parseRequiredStringFlag(args['member-id'], '--member-id');
    const type = parseRequiredStringFlag(args.type, '--type');
    const needNotification = parseOptionalBooleanFlag(args['need-notification'], '--need-notification');
    const payload = await apiRequest(
      token,
      'PUT',
      appendQueryToPath(`/drive/v1/permissions/${encodeURIComponent(tokenValue)}/members/${encodeURIComponent(memberId)}`, {
        type,
        ...(needNotification !== undefined ? { need_notification: needNotification } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('drive.update-permission-member', payload?.data ?? null, { member_id: memberId });
  }
  if (action === 'delete-permission-member') {
    const tokenValue = parseRequiredStringFlag(args.token, '--token');
    const memberId = parseRequiredStringFlag(args['member-id'], '--member-id');
    const type = parseRequiredStringFlag(args.type, '--type');
    const memberType = parseRequiredStringFlag(args['member-type'], '--member-type');
    const bodyJson = firstNonEmptyString(args['body-json']);
    const payload = await apiRequest(
      token,
      'DELETE',
      appendQueryToPath(`/drive/v1/permissions/${encodeURIComponent(tokenValue)}/members/${encodeURIComponent(memberId)}`, {
        type,
        member_type: memberType,
      }),
      bodyJson ? parseJsonFlag(bodyJson, '--body-json') : undefined,
    );
    return buildGenericSuccess('drive.delete-permission-member', payload?.data ?? null, { member_id: memberId });
  }
  if (action === 'check-member-auth') {
    const tokenValue = parseRequiredStringFlag(args.token, '--token');
    const type = parseRequiredStringFlag(args.type, '--type');
    const authAction = parseRequiredStringFlag(args.action, '--action');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/drive/v1/permissions/${encodeURIComponent(tokenValue)}/members/auth`, {
        type,
        action: authAction,
      }),
    );
    return buildGenericSuccess('drive.check-member-auth', payload?.data ?? null);
  }
  if (action === 'transfer-owner') {
    const tokenValue = parseRequiredStringFlag(args.token, '--token');
    const type = parseRequiredStringFlag(args.type, '--type');
    const needNotification = parseOptionalBooleanFlag(args['need-notification'], '--need-notification');
    const removeOldOwner = parseOptionalBooleanFlag(args['remove-old-owner'], '--remove-old-owner');
    const stayPut = parseOptionalBooleanFlag(args['stay-put'], '--stay-put');
    const oldOwnerPerm = firstNonEmptyString(args['old-owner-perm']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath(`/drive/v1/permissions/${encodeURIComponent(tokenValue)}/members/transfer_owner`, {
        type,
        ...(needNotification !== undefined ? { need_notification: needNotification } : {}),
        ...(removeOldOwner !== undefined ? { remove_old_owner: removeOldOwner } : {}),
        ...(stayPut !== undefined ? { stay_put: stayPut } : {}),
        ...(oldOwnerPerm ? { old_owner_perm: oldOwnerPerm } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('drive.transfer-owner', payload?.data ?? null);
  }
  if (action === 'batch-query-comments') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const fileType = parseRequiredStringFlag(args['file-type'], '--file-type');
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}/comments/batch_query`, {
        file_type: fileType,
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('drive.batch-query-comments', payload?.data ?? null);
  }
  if (action === 'list-comments') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const fileType = parseRequiredStringFlag(args['file-type'], '--file-type');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}/comments`, {
        file_type: fileType,
        ...buildPagingParams(args),
      }),
    );
    return buildGenericSuccess('drive.list-comments', payload?.data ?? null);
  }
  if (action === 'get-comment') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const commentId = parseRequiredStringFlag(args['comment-id'], '--comment-id');
    const fileType = parseRequiredStringFlag(args['file-type'], '--file-type');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}/comments/${encodeURIComponent(commentId)}`, {
        file_type: fileType,
      }),
    );
    return buildGenericSuccess('drive.get-comment', payload?.data ?? null);
  }
  if (action === 'create-comment') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const fileType = parseRequiredStringFlag(args['file-type'], '--file-type');
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}/comments`, {
        file_type: fileType,
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('drive.create-comment', payload?.data ?? null);
  }
  if (action === 'patch-comment') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const commentId = parseRequiredStringFlag(args['comment-id'], '--comment-id');
    const fileType = parseRequiredStringFlag(args['file-type'], '--file-type');
    const payload = await apiRequest(
      token,
      'PATCH',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}/comments/${encodeURIComponent(commentId)}`, {
        file_type: fileType,
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('drive.patch-comment', payload?.data ?? null, { comment_id: commentId });
  }
  if (action === 'list-comment-replies') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const commentId = parseRequiredStringFlag(args['comment-id'], '--comment-id');
    const fileType = parseRequiredStringFlag(args['file-type'], '--file-type');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}/comments/${encodeURIComponent(commentId)}/replies`, {
        file_type: fileType,
        ...buildPagingParams(args),
      }),
    );
    return buildGenericSuccess('drive.list-comment-replies', payload?.data ?? null);
  }
  if (action === 'update-comment-reply') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const commentId = parseRequiredStringFlag(args['comment-id'], '--comment-id');
    const replyId = parseRequiredStringFlag(args['reply-id'], '--reply-id');
    const fileType = parseRequiredStringFlag(args['file-type'], '--file-type');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'PUT',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}/comments/${encodeURIComponent(commentId)}/replies/${encodeURIComponent(replyId)}`, {
        file_type: fileType,
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('drive.update-comment-reply', payload?.data ?? null, { reply_id: replyId });
  }
  if (action === 'delete-comment-reply') {
    const fileToken = parseRequiredStringFlag(args['file-token'], '--file-token');
    const commentId = parseRequiredStringFlag(args['comment-id'], '--comment-id');
    const replyId = parseRequiredStringFlag(args['reply-id'], '--reply-id');
    const fileType = parseRequiredStringFlag(args['file-type'], '--file-type');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'DELETE',
      appendQueryToPath(`/drive/v1/files/${encodeURIComponent(fileToken)}/comments/${encodeURIComponent(commentId)}/replies/${encodeURIComponent(replyId)}`, {
        file_type: fileType,
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
    );
    return buildGenericSuccess('drive.delete-comment-reply', payload?.data ?? null, { reply_id: replyId });
  }
  throw new Error(`unsupported command: drive ${action ?? ''}`.trim());
}

async function handleChatCommand(action, args, token) {
  if (action === 'create') {
    const payload = await apiRequest(
      token,
      'POST',
      '/im/v1/chats',
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('chat.create', payload?.data ?? null);
  }
  if (action === 'get') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/im/v1/chats/${encodeURIComponent(chatId)}`, {
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      }),
    );
    return buildGenericSuccess('chat.get', payload?.data ?? null);
  }
  if (action === 'list') {
    const payload = await apiRequest(token, 'GET', appendQueryToPath('/im/v1/chats', buildPagingParams(args)));
    return buildGenericSuccess('chat.list', payload?.data ?? null);
  }
  if (action === 'search') {
    const query = parseRequiredStringFlag(args.query, '--query');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath('/im/v1/chats/search', {
        query,
        ...buildPagingParams(args),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      }),
    );
    return buildGenericSuccess('chat.search', payload?.data ?? null);
  }
  if (action === 'get-members') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/im/v1/chats/${encodeURIComponent(chatId)}/members`, buildPagingParams(args)),
    );
    return buildGenericSuccess('chat.get-members', payload?.data ?? null);
  }
  if (action === 'add-members') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const memberIdType = firstNonEmptyString(args['member-id-type']);
    const succeedType = parseOptionalPositiveInteger(args['succeed-type'], '--succeed-type');
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath(`/im/v1/chats/${encodeURIComponent(chatId)}/members`, {
        ...(memberIdType ? { member_id_type: memberIdType } : {}),
        ...(succeedType ? { succeed_type: succeedType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('chat.add-members', payload?.data ?? null, { chat_id: chatId });
  }
  if (action === 'remove-members') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const memberIdType = firstNonEmptyString(args['member-id-type']);
    const payload = await apiRequest(
      token,
      'DELETE',
      appendQueryToPath(`/im/v1/chats/${encodeURIComponent(chatId)}/members`, {
        ...(memberIdType ? { member_id_type: memberIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('chat.remove-members', payload?.data ?? null, { chat_id: chatId });
  }
  if (action === 'is-in-chat') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const payload = await apiRequest(
      token,
      'GET',
      `/im/v1/chats/${encodeURIComponent(chatId)}/members/is_in_chat`,
    );
    return buildGenericSuccess('chat.is-in-chat', payload?.data ?? null, { chat_id: chatId });
  }
  if (action === 'get-announcement') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/im/v1/chats/${encodeURIComponent(chatId)}/announcement`, {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
    );
    return buildGenericSuccess('chat.get-announcement', payload?.data ?? null, { chat_id: chatId });
  }
  if (action === 'update-announcement') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const payload = await apiRequest(
      token,
      'PATCH',
      `/im/v1/chats/${encodeURIComponent(chatId)}/announcement`,
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('chat.update-announcement', payload?.data ?? null, { chat_id: chatId });
  }
  if (action === 'add-managers') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const memberIdType = firstNonEmptyString(args['member-id-type']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath(`/im/v1/chats/${encodeURIComponent(chatId)}/managers/add_managers`, {
        ...(memberIdType ? { member_id_type: memberIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('chat.add-managers', payload?.data ?? null, { chat_id: chatId });
  }
  if (action === 'delete-managers') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const memberIdType = firstNonEmptyString(args['member-id-type']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath(`/im/v1/chats/${encodeURIComponent(chatId)}/managers/delete_managers`, {
        ...(memberIdType ? { member_id_type: memberIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('chat.delete-managers', payload?.data ?? null, { chat_id: chatId });
  }
  if (action === 'update') {
    const chatId = parseRequiredStringFlag(args['chat-id'], '--chat-id');
    const payload = await apiRequest(
      token,
      'PUT',
      `/im/v1/chats/${encodeURIComponent(chatId)}`,
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('chat.update', payload?.data ?? null, { chat_id: chatId });
  }
  throw new Error(`unsupported command: chat ${action ?? ''}`.trim());
}

async function handleCardCommand(action, args, token) {
  if (action === 'create') {
    const payload = await apiRequest(
      token,
      'POST',
      '/cardkit/v1/cards',
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('card.create', payload?.data ?? null);
  }
  if (action === 'update') {
    const cardId = parseRequiredStringFlag(args['card-id'], '--card-id');
    const payload = await apiRequest(
      token,
      'PUT',
      `/cardkit/v1/cards/${encodeURIComponent(cardId)}`,
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('card.update', payload?.data ?? null, { card_id: cardId });
  }
  throw new Error(`unsupported command: card ${action ?? ''}`.trim());
}

async function handleApprovalCommand(action, args, token) {
  if (action === 'get-definition') {
    const approvalCode = parseRequiredStringFlag(args['approval-code'], '--approval-code');
    const payload = await apiRequest(
      token,
      'GET',
      `/approval/v4/approvals/${encodeURIComponent(approvalCode)}`,
    );
    return buildGenericSuccess('approval.get-definition', payload?.data ?? null);
  }
  if (action === 'create-instance') {
    const payload = await apiRequest(
      token,
      'POST',
      '/approval/v4/instances',
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.create-instance', payload?.data ?? null);
  }
  if (action === 'get-instance') {
    const instanceId = parseRequiredStringFlag(args['instance-id'], '--instance-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/approval/v4/instances/${encodeURIComponent(instanceId)}`, {
        ...(firstNonEmptyString(args['user-id']) ? { user_id: firstNonEmptyString(args['user-id']) } : {}),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
        ...(firstNonEmptyString(args.locale) ? { locale: firstNonEmptyString(args.locale) } : {}),
      }),
    );
    return buildGenericSuccess('approval.get-instance', payload?.data ?? null);
  }
  if (action === 'cancel-instance') {
    const payload = await apiRequest(
      token,
      'POST',
      '/approval/v4/instances/cancel',
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.cancel-instance', payload?.data ?? null);
  }
  if (action === 'search-tasks') {
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath('/approval/v4/tasks/search', buildPagingParams(args)),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.search-tasks', payload?.data ?? null);
  }
  if (action === 'approve-task') {
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath('/approval/v4/tasks/approve', {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.approve-task', payload?.data ?? null);
  }
  if (action === 'reject-task') {
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath('/approval/v4/tasks/reject', {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.reject-task', payload?.data ?? null);
  }
  if (action === 'transfer-task') {
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath('/approval/v4/tasks/transfer', {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.transfer-task', payload?.data ?? null);
  }
  if (action === 'resubmit-task') {
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath('/approval/v4/tasks/resubmit', {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.resubmit-task', payload?.data ?? null);
  }
  if (action === 'query-tasks') {
    const userId = parseRequiredStringFlag(args['user-id'], '--user-id');
    const topic = parseRequiredStringFlag(args.topic, '--topic');
    const pageSize = parseOptionalPositiveInteger(args['page-size'], '--page-size');
    const pageToken = firstNonEmptyString(args['page-token']);
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath('/approval/v4/tasks/query', {
        user_id: userId,
        topic,
        ...(pageSize ? { page_size: pageSize } : {}),
        ...(pageToken ? { page_token: pageToken } : {}),
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
    );
    return buildGenericSuccess('approval.query-tasks', payload?.data ?? null);
  }
  if (action === 'cc-instance') {
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath('/approval/v4/instances/cc', {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.cc-instance', payload?.data ?? null);
  }
  if (action === 'search-cc') {
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath('/approval/v4/instances/search_cc', {
        ...buildPagingParams(args),
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.search-cc', payload?.data ?? null);
  }
  if (action === 'list-comments') {
    const instanceId = parseRequiredStringFlag(args['instance-id'], '--instance-id');
    const userId = parseRequiredStringFlag(args['user-id'], '--user-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/approval/v4/instances/${encodeURIComponent(instanceId)}/comments`, {
        user_id: userId,
        ...buildPagingParams(args),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      }),
    );
    return buildGenericSuccess('approval.list-comments', payload?.data ?? null);
  }
  if (action === 'create-comment') {
    const instanceId = parseRequiredStringFlag(args['instance-id'], '--instance-id');
    const userId = parseRequiredStringFlag(args['user-id'], '--user-id');
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath(`/approval/v4/instances/${encodeURIComponent(instanceId)}/comments`, {
        user_id: userId,
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('approval.create-comment', payload?.data ?? null);
  }
  if (action === 'delete-comment') {
    const instanceId = parseRequiredStringFlag(args['instance-id'], '--instance-id');
    const commentId = parseRequiredStringFlag(args['comment-id'], '--comment-id');
    const userId = parseRequiredStringFlag(args['user-id'], '--user-id');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const payload = await apiRequest(
      token,
      'DELETE',
      appendQueryToPath(`/approval/v4/instances/${encodeURIComponent(instanceId)}/comments/${encodeURIComponent(commentId)}`, {
        user_id: userId,
        ...(userIdType ? { user_id_type: userIdType } : {}),
      }),
    );
    return buildGenericSuccess('approval.delete-comment', payload?.data ?? null, { comment_id: commentId });
  }
  if (action === 'list-instances') {
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath('/approval/v4/instances', buildPagingParams(args)),
    );
    return buildGenericSuccess('approval.list-instances', payload?.data ?? null);
  }
  throw new Error(`unsupported command: approval ${action ?? ''}`.trim());
}

async function handleContactCommand(action, args, token) {
  if (action === 'get-department') {
    const departmentId = parseRequiredStringFlag(args['department-id'], '--department-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/contact/v3/departments/${encodeURIComponent(departmentId)}`, {
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
        ...(firstNonEmptyString(args['department-id-type']) ? { department_id_type: firstNonEmptyString(args['department-id-type']) } : {}),
      }),
    );
    return buildGenericSuccess('contact.get-department', payload?.data ?? null);
  }
  if (action === 'list-users') {
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath('/contact/v3/users', {
        ...buildPagingParams(args),
        ...(firstNonEmptyString(args['department-id']) ? { department_id: firstNonEmptyString(args['department-id']) } : {}),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
        ...(firstNonEmptyString(args['department-id-type']) ? { department_id_type: firstNonEmptyString(args['department-id-type']) } : {}),
      }),
    );
    return buildGenericSuccess('contact.list-users', payload?.data ?? null);
  }
  if (action === 'get-user') {
    const userId = parseRequiredStringFlag(args['user-id'], '--user-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/contact/v3/users/${encodeURIComponent(userId)}`, {
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      }),
    );
    return buildGenericSuccess('contact.get-user', payload?.data ?? null);
  }
  if (action === 'list-departments') {
    const fetchChild = parseOptionalBooleanFlag(args['fetch-child'], '--fetch-child');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath('/contact/v3/departments', {
        ...buildPagingParams(args),
        ...(firstNonEmptyString(args['parent-department-id']) ? { parent_department_id: firstNonEmptyString(args['parent-department-id']) } : {}),
        ...(fetchChild !== undefined ? { fetch_child: fetchChild } : {}),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
        ...(firstNonEmptyString(args['department-id-type']) ? { department_id_type: firstNonEmptyString(args['department-id-type']) } : {}),
      }),
    );
    return buildGenericSuccess('contact.list-departments', payload?.data ?? null);
  }
  if (action === 'list-users-by-department') {
    const departmentId = parseRequiredStringFlag(args['department-id'], '--department-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath('/contact/v3/users/find_by_department', {
        department_id: departmentId,
        ...buildPagingParams(args),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
        ...(firstNonEmptyString(args['department-id-type']) ? { department_id_type: firstNonEmptyString(args['department-id-type']) } : {}),
      }),
    );
    return buildGenericSuccess('contact.list-users-by-department', payload?.data ?? null);
  }
  if (action === 'batch-get-user-id') {
    const payload = await apiRequest(
      token,
      'POST',
      appendQueryToPath('/contact/v3/users/batch_get_id', {
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      }),
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('contact.batch-get-user-id', payload?.data ?? null);
  }
  if (action === 'search-departments') {
    const payload = await apiRequest(
      token,
      'POST',
      '/contact/v3/departments/search',
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('contact.search-departments', payload?.data ?? null);
  }
  throw new Error(`unsupported command: contact ${action ?? ''}`.trim());
}

async function handleSearchCommand(action, args, token) {
  if (action === 'doc-wiki') {
    const query = parseRequiredStringFlag(args.query, '--query');
    const body = {
      query,
      ...(parseOptionalPositiveInteger(args['page-size'], '--page-size')
        ? { page_size: parseOptionalPositiveInteger(args['page-size'], '--page-size') }
        : {}),
    };
    const payload = await apiRequest(token, 'POST', '/search/v2/doc_wiki/search', body);
    return buildGenericSuccess('search.doc-wiki', payload?.data ?? null);
  }
  throw new Error(`unsupported command: search ${action ?? ''}`.trim());
}

async function handleSheetsCommand(action, args, token) {
  if (action === 'create') {
    const title = firstNonEmptyString(args.title);
    const folderToken = firstNonEmptyString(args['folder-token']);
    const withoutMount = parseOptionalBooleanFlag(args['without-mount'], '--without-mount');
    const payload = await apiRequest(token, 'POST', '/sheets/v3/spreadsheets', {
      ...(title ? { title } : {}),
      ...(folderToken ? { folder_token: folderToken } : {}),
      ...(withoutMount !== undefined ? { without_mount: withoutMount } : {}),
    });
    return buildGenericSuccess('sheets.create', payload?.data ?? null);
  }
  if (action === 'get') {
    const spreadsheetToken = parseRequiredStringFlag(args['spreadsheet-token'], '--spreadsheet-token');
    const payload = await apiRequest(
      token,
      'GET',
      `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}`,
    );
    return buildGenericSuccess('sheets.get', payload?.data ?? null);
  }
  if (action === 'query-sheets') {
    const spreadsheetToken = parseRequiredStringFlag(args['spreadsheet-token'], '--spreadsheet-token');
    const payload = await apiRequest(
      token,
      'GET',
      `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/query`,
    );
    return buildGenericSuccess('sheets.query-sheets', payload?.data ?? null);
  }
  if (action === 'get-sheet') {
    const spreadsheetToken = parseRequiredStringFlag(args['spreadsheet-token'], '--spreadsheet-token');
    const sheetId = parseRequiredStringFlag(args['sheet-id'], '--sheet-id');
    const payload = await apiRequest(
      token,
      'GET',
      `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/${encodeURIComponent(sheetId)}`,
    );
    return buildGenericSuccess('sheets.get-sheet', payload?.data ?? null);
  }
  if (action === 'find') {
    const spreadsheetToken = parseRequiredStringFlag(args['spreadsheet-token'], '--spreadsheet-token');
    const sheetId = parseRequiredStringFlag(args['sheet-id'], '--sheet-id');
    const payload = await apiRequest(
      token,
      'POST',
      `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/${encodeURIComponent(sheetId)}/find`,
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('sheets.find', payload?.data ?? null);
  }
  if (action === 'replace') {
    const spreadsheetToken = parseRequiredStringFlag(args['spreadsheet-token'], '--spreadsheet-token');
    const sheetId = parseRequiredStringFlag(args['sheet-id'], '--sheet-id');
    const payload = await apiRequest(
      token,
      'POST',
      `/sheets/v3/spreadsheets/${encodeURIComponent(spreadsheetToken)}/sheets/${encodeURIComponent(sheetId)}/replace`,
      parseJsonFlag(args['body-json'], '--body-json'),
    );
    return buildGenericSuccess('sheets.replace', payload?.data ?? null);
  }
  throw new Error(`unsupported command: sheets ${action ?? ''}`.trim());
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
  if (action === 'create-record') {
    const fields = parseRequiredJsonObjectFlag(args['fields-json'], '--fields-json');
    const response = await sdkClient.bitable.appTableRecord.create({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      data: { fields },
    });
    return {
      ok: true,
      operation: 'bitable.create-record',
      app_token: appToken,
      table_id: tableId,
      record: response?.data?.record ?? null,
    };
  }
  if (action === 'get-record') {
    const recordId = parseRequiredStringFlag(args['record-id'], '--record-id');
    const response = await sdkClient.bitable.appTableRecord.get({
      path: {
        app_token: appToken,
        table_id: tableId,
        record_id: recordId,
      },
    });
    return {
      ok: true,
      operation: 'bitable.get-record',
      app_token: appToken,
      table_id: tableId,
      record_id: recordId,
      record: response?.data?.record ?? null,
    };
  }
  if (action === 'update-record') {
    const recordId = parseRequiredStringFlag(args['record-id'], '--record-id');
    const fields = parseRequiredJsonObjectFlag(args['fields-json'], '--fields-json');
    const response = await sdkClient.bitable.appTableRecord.update({
      path: {
        app_token: appToken,
        table_id: tableId,
        record_id: recordId,
      },
      data: { fields },
    });
    return {
      ok: true,
      operation: 'bitable.update-record',
      app_token: appToken,
      table_id: tableId,
      record_id: recordId,
      record: response?.data?.record ?? null,
    };
  }
  if (action === 'delete-record') {
    const recordId = parseRequiredStringFlag(args['record-id'], '--record-id');
    const response = await sdkClient.bitable.appTableRecord.delete({
      path: {
        app_token: appToken,
        table_id: tableId,
        record_id: recordId,
      },
    });
    return {
      ok: true,
      operation: 'bitable.delete-record',
      app_token: appToken,
      table_id: tableId,
      record_id: recordId,
      deleted: response?.data?.deleted ?? false,
    };
  }
  if (action === 'batch-create-records') {
    const records = parseRequiredJsonArrayFlag(args['records-json'], '--records-json');
    const response = await sdkClient.bitable.appTableRecord.batchCreate({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      data: { records },
    });
    return {
      ok: true,
      operation: 'bitable.batch-create-records',
      app_token: appToken,
      table_id: tableId,
      records: response?.data?.records ?? [],
    };
  }
  if (action === 'batch-update-records') {
    const records = parseRequiredJsonArrayFlag(args['records-json'], '--records-json');
    const response = await sdkClient.bitable.appTableRecord.batchUpdate({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      data: { records },
    });
    return {
      ok: true,
      operation: 'bitable.batch-update-records',
      app_token: appToken,
      table_id: tableId,
      records: response?.data?.records ?? [],
    };
  }
  if (action === 'batch-delete-records') {
    const records = parseRequiredJsonArrayFlag(args['record-ids-json'], '--record-ids-json');
    const response = await sdkClient.bitable.appTableRecord.batchDelete({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      data: { records },
    });
    return {
      ok: true,
      operation: 'bitable.batch-delete-records',
      app_token: appToken,
      table_id: tableId,
      records: response?.data?.records ?? [],
    };
  }
  throw new Error(`unsupported command: bitable ${action ?? ''}`.trim());
}

async function handleAuthCommand(action, args) {
  if (action === 'start-device-auth') {
    const gatewayUserId = parseRequiredStringFlag(
      firstNonEmptyString(args['gateway-user-id'], process.env.GATEWAY_USER_ID),
      '--gateway-user-id',
    );
    const startedAt = Date.now();
    const deviceAuth = await startFeishuDeviceAuth(args);
    return {
      ok: true,
      operation: 'auth.start-device-auth',
      gateway_user_id: gatewayUserId,
      device_code: deviceAuth.deviceCode,
      user_code: deviceAuth.userCode,
      interval: deviceAuth.interval,
      verification_uri: deviceAuth.verificationUri,
      verification_uri_complete: deviceAuth.verificationUriComplete,
      expires_at: startedAt + deviceAuth.expiresIn * 1000,
      requested_scopes: deviceAuth.requestedScopes,
    };
  }
  if (action === 'poll-device-auth') {
    const gatewayUserId = parseRequiredStringFlag(
      firstNonEmptyString(args['gateway-user-id'], process.env.GATEWAY_USER_ID),
      '--gateway-user-id',
    );
    const deviceCode = parseRequiredStringFlag(args['device-code'], '--device-code');
    const polled = await pollFeishuDeviceAuth(deviceCode, args);
    if (!polled.ok) {
      return {
        ok: false,
        operation: 'auth.poll-device-auth',
        gateway_user_id: gatewayUserId,
        device_code: deviceCode,
        status: polled.status,
        authorized: false,
        message: polled.message,
      };
    }
    const userInfo = await requestFeishuJson(
      FEISHU_USER_INFO_URL,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${polled.accessToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
      },
      'feishu user info failed',
    );
    const binding = upsertFeishuUserBinding(resolveFeishuUserBindingDbPath(args), {
      gatewayUserId,
      feishuOpenId: firstNonEmptyString(userInfo?.data?.open_id),
      feishuUserId: firstNonEmptyString(userInfo?.data?.user_id),
      accessToken: polled.accessToken,
      refreshToken: polled.refreshToken,
      expiresAt: Date.now() + polled.expiresIn * 1000,
      scopeSnapshot: polled.scopeSnapshot,
    });
    return {
      ok: true,
      operation: 'auth.poll-device-auth',
      gateway_user_id: gatewayUserId,
      device_code: deviceCode,
      authorized: true,
      binding: binding
        ? {
            gateway_user_id: binding.gatewayUserId,
            feishu_open_id: binding.feishuOpenId ?? null,
            feishu_user_id: binding.feishuUserId ?? null,
            expires_at: binding.expiresAt,
            scope_snapshot: binding.scopeSnapshot ?? null,
          }
        : null,
    };
  }
  if (action === 'diagnose-permission') {
    const gatewayUserId = parseRequiredStringFlag(
      firstNonEmptyString(args['gateway-user-id'], process.env.GATEWAY_USER_ID),
      '--gateway-user-id',
    );
    const requiredScopes = resolveRequiredScopesForDiagnosis(args);
    const tokenType = firstNonEmptyString(args['token-type']) === 'tenant' ? 'tenant' : 'user';
    const binding = getFeishuUserBinding(resolveFeishuUserBindingDbPath(args), gatewayUserId);
    const userGrantedScopes = binding?.scopeSnapshot
      ? binding.scopeSnapshot.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
      : [];
    const userGrantedScopeSet = new Set(userGrantedScopes);
    const userMissingScopes = requiredScopes.filter((scope) => !userGrantedScopeSet.has(scope));

    let appGrantedScopes = [];
    let appScopeQuery = { ok: true };
    try {
      appGrantedScopes = await listFeishuAppGrantedScopes(args, tokenType);
    } catch (error) {
      appScopeQuery = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const appGrantedScopeSet = new Set(appGrantedScopes);
    const appMissingScopes = appScopeQuery.ok
      ? requiredScopes.filter((scope) => !appGrantedScopeSet.has(scope))
      : [];

    let diagnosis = 'scope_diagnostics_inconclusive';
    let message = 'Unable to fully classify the Feishu permission blocker from the currently available scope data.';
    if (!binding) {
      diagnosis = 'authorization_required';
      message = 'No Feishu user binding exists for the current gateway user. Run device auth first, then retry the original command.';
    } else if (appScopeQuery.ok && appMissingScopes.length > 0) {
      diagnosis = 'app_scope_missing';
      message = 'The Feishu app is missing required scopes. An app admin must enable them first, then the user should authorize again before retrying the original command.';
    } else if (userMissingScopes.length > 0) {
      diagnosis = 'user_scope_missing';
      message = appScopeQuery.ok
        ? 'The current Feishu user binding is missing required scopes, while the app already has them. Re-run device auth for this user, then retry the original command.'
        : 'The current Feishu user binding is missing required scopes. Re-run device auth for this user, then retry the original command.';
    } else if (appScopeQuery.ok) {
      diagnosis = 'grants_look_ok';
      message = 'The app scopes and stored user scopes already cover the required permissions. Retry the original command; if it still fails, re-run device auth to refresh the user token.';
    }

    return {
      ok: true,
      operation: 'auth.diagnose-permission',
      gateway_user_id: gatewayUserId,
      token_type: tokenType,
      required_scopes: requiredScopes,
      app_scope_query: appScopeQuery,
      app_missing_scopes: appMissingScopes,
      user_granted_scopes: userGrantedScopes,
      user_missing_scopes: userMissingScopes,
      diagnosis,
      message,
    };
  }
  throw new Error(`unsupported command: auth ${action ?? ''}`.trim());
}

async function handleCalendarCommand(action, args, sdkClient) {
  if (action === 'create-personal-event') {
    const accessToken = await resolveFeishuUserAccessTokenForOperation(args, 'calendar.create-personal-event');
    if (typeof accessToken !== 'string') {
      return accessToken;
    }
    const timezone = firstNonEmptyString(args.timezone) ?? 'Asia/Shanghai';
    const payload = await requestFeishuJson(
      `${FEISHU_API_BASE}/calendar/v4/calendars/primary/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          summary: parseRequiredStringFlag(args.summary, '--summary'),
          ...(firstNonEmptyString(args.description) ? { description: firstNonEmptyString(args.description) } : {}),
          start_time: {
            date_time: parseRequiredStringFlag(args['start-time'], '--start-time'),
            timezone,
          },
          end_time: {
            date_time: parseRequiredStringFlag(args['end-time'], '--end-time'),
            timezone,
          },
        }),
      },
      'feishu user api failed',
    );
    return {
      ok: true,
      operation: 'calendar.create-personal-event',
      event: payload?.data?.event ?? null,
    };
  }
  const client = sdkClient ?? resolveSdkClient(args);
  if (action === 'create-calendar') {
    const response = await client.calendar.calendar.create({
      data: parseRequiredJsonObjectFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'calendar.create-calendar',
      calendar: response?.data?.calendar ?? null,
    };
  }
  if (action === 'get-calendar') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const response = await client.calendar.calendar.get({
      path: { calendar_id: calendarId },
    });
    return {
      ok: true,
      operation: 'calendar.get-calendar',
      calendar_id: calendarId,
      calendar: response?.data ?? null,
    };
  }
  if (action === 'update-calendar') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const response = await client.calendar.calendar.patch({
      path: { calendar_id: calendarId },
      data: parseRequiredJsonObjectFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'calendar.update-calendar',
      calendar_id: calendarId,
      calendar: response?.data?.calendar ?? null,
    };
  }
  if (action === 'delete-calendar') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    await client.calendar.calendar.delete({
      path: { calendar_id: calendarId },
    });
    return {
      ok: true,
      operation: 'calendar.delete-calendar',
      calendar_id: calendarId,
      deleted: true,
    };
  }
  if (action === 'create-event') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const response = await client.calendar.calendarEvent.create({
      path: { calendar_id: calendarId },
      params: {
        ...(firstNonEmptyString(args['idempotency-key']) ? { idempotency_key: firstNonEmptyString(args['idempotency-key']) } : {}),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      },
      data: parseRequiredJsonObjectFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'calendar.create-event',
      calendar_id: calendarId,
      event: response?.data?.event ?? null,
    };
  }
  if (action === 'list-calendars') {
    const response = await client.calendar.calendar.list({
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
  if (action === 'list-events-v4') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const response = await client.calendar.calendarEvent.list({
      path: { calendar_id: calendarId },
      params: {
        ...buildPagingParams(args),
        ...(firstNonEmptyString(args['time-min']) ? { start_time: firstNonEmptyString(args['time-min']) } : {}),
        ...(firstNonEmptyString(args['time-max']) ? { end_time: firstNonEmptyString(args['time-max']) } : {}),
        ...(firstNonEmptyString(args['anchor-time']) ? { anchor_time: firstNonEmptyString(args['anchor-time']) } : {}),
        ...(firstNonEmptyString(args['sync-token']) ? { sync_token: firstNonEmptyString(args['sync-token']) } : {}),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      },
    });
    return {
      ok: true,
      operation: 'calendar.list-events-v4',
      calendar_id: calendarId,
      items: response?.data?.items ?? [],
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
      sync_token: response?.data?.sync_token ?? null,
    };
  }
  if (action === 'list-events') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const response = await client.calendar.calendarEvent.instanceView({
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
  if (action === 'get-event') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const eventId = parseRequiredStringFlag(args['event-id'], '--event-id');
    const response = await client.calendar.calendarEvent.get({
      path: {
        calendar_id: calendarId,
        event_id: eventId,
      },
      params: {
        ...(args['need-attendee'] !== undefined ? { need_attendee: parseOptionalBooleanFlag(args['need-attendee'], '--need-attendee') } : {}),
        ...(args['need-meeting-settings'] !== undefined ? { need_meeting_settings: parseOptionalBooleanFlag(args['need-meeting-settings'], '--need-meeting-settings') } : {}),
        ...(args['max-attendee-num'] !== undefined ? { max_attendee_num: parseOptionalPositiveInteger(args['max-attendee-num'], '--max-attendee-num') } : {}),
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      },
    });
    return {
      ok: true,
      operation: 'calendar.get-event',
      calendar_id: calendarId,
      event_id: eventId,
      event: response?.data?.event ?? null,
    };
  }
  if (action === 'update-event') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const eventId = parseRequiredStringFlag(args['event-id'], '--event-id');
    const response = await client.calendar.calendarEvent.patch({
      path: {
        calendar_id: calendarId,
        event_id: eventId,
      },
      params: {
        ...(firstNonEmptyString(args['user-id-type']) ? { user_id_type: firstNonEmptyString(args['user-id-type']) } : {}),
      },
      data: parseRequiredJsonObjectFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'calendar.update-event',
      calendar_id: calendarId,
      event_id: eventId,
      event: response?.data?.event ?? null,
    };
  }
  if (action === 'delete-event') {
    const calendarId = parseRequiredStringFlag(args['calendar-id'], '--calendar-id');
    const eventId = parseRequiredStringFlag(args['event-id'], '--event-id');
    const needNotification = parseOptionalBooleanFlag(args['need-notification'], '--need-notification');
    await client.calendar.calendarEvent.delete({
      path: {
        calendar_id: calendarId,
        event_id: eventId,
      },
      params: {
        ...(needNotification !== undefined ? { need_notification: String(needNotification) } : {}),
      },
    });
    return {
      ok: true,
      operation: 'calendar.delete-event',
      calendar_id: calendarId,
      event_id: eventId,
      deleted: true,
    };
  }
  if (action === 'freebusy') {
    const response = await client.calendar.freebusy.list({
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

async function resolveFeishuUserAccessToken(args) {
  const explicitAccessToken = firstNonEmptyString(args['user-access-token']);
  if (explicitAccessToken) {
    return explicitAccessToken;
  }

  const gatewayUserId = firstNonEmptyString(args['gateway-user-id'], process.env.GATEWAY_USER_ID);
  if (!gatewayUserId) {
    throw new Error('missing --user-access-token or --gateway-user-id (or GATEWAY_USER_ID)');
  }

  const bindingDbPath = resolveFeishuUserBindingDbPath(args);
  const binding = getFeishuUserBinding(bindingDbPath, gatewayUserId);
  if (!binding) {
    throw new Error(`feishu user binding not found: ${gatewayUserId}`);
  }
  if (binding.expiresAt > Date.now() + FEISHU_USER_BINDING_REFRESH_WINDOW_MS) {
    return binding.accessToken;
  }

  const refreshed = await refreshFeishuUserAccessToken(binding.refreshToken, args);
  const next = upsertFeishuUserBinding(bindingDbPath, {
    gatewayUserId: binding.gatewayUserId,
    feishuOpenId: binding.feishuOpenId,
    feishuUserId: binding.feishuUserId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: Date.now() + refreshed.expiresIn * 1000,
    scopeSnapshot: binding.scopeSnapshot,
  });
  return next.accessToken;
}

function resolveFeishuUserBindingDbPath(args) {
  const explicitPath = firstNonEmptyString(args['binding-db-path'], process.env.FEISHU_USER_BINDING_DB_PATH);
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  const gatewayRootDir = firstNonEmptyString(process.env.GATEWAY_ROOT_DIR, process.cwd());
  return path.resolve(gatewayRootDir, '.data', FEISHU_USER_BINDING_DB_FILENAME);
}

function getFeishuUserBinding(filePath, gatewayUserId) {
  const db = openFeishuUserBindingDb(filePath);
  try {
    return getFeishuUserBindingFromDb(db, gatewayUserId);
  } finally {
    db.close();
  }
}

function upsertFeishuUserBinding(filePath, input) {
  const db = openFeishuUserBindingDb(filePath);
  try {
    const existing = getFeishuUserBindingFromDb(db, input.gatewayUserId);
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
      normalizeOptionalSqlValue(input.feishuOpenId),
      normalizeOptionalSqlValue(input.feishuUserId),
      parseRequiredStringFlag(input.accessToken, 'binding access_token'),
      parseRequiredStringFlag(input.refreshToken, 'binding refresh_token'),
      Math.floor(Number(input.expiresAt)),
      normalizeOptionalSqlValue(input.scopeSnapshot),
      existing?.createdAt ?? now,
      now,
    );
    return getFeishuUserBindingFromDb(db, input.gatewayUserId);
  } finally {
    db.close();
  }
}

function openFeishuUserBindingDb(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
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
  return db;
}

function getFeishuUserBindingFromDb(db, gatewayUserId) {
  const row = db.prepare(`
    SELECT
      gateway_user_id AS gatewayUserId,
      feishu_open_id AS feishuOpenId,
      feishu_user_id AS feishuUserId,
      access_token AS accessToken,
      refresh_token AS refreshToken,
      expires_at AS expiresAt,
      scope_snapshot AS scopeSnapshot,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM feishu_user_binding
    WHERE gateway_user_id = ?
  `).get(gatewayUserId);
  if (!row || typeof row !== 'object') {
    return undefined;
  }
  return {
    gatewayUserId: String(row.gatewayUserId ?? ''),
    feishuOpenId: normalizeOptionalString(row.feishuOpenId),
    feishuUserId: normalizeOptionalString(row.feishuUserId),
    accessToken: String(row.accessToken ?? ''),
    refreshToken: String(row.refreshToken ?? ''),
    expiresAt: Number(row.expiresAt ?? 0),
    scopeSnapshot: normalizeOptionalString(row.scopeSnapshot),
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  };
}

async function refreshFeishuUserAccessToken(refreshToken, args) {
  const { appId, appSecret } = resolveAppCredentials(args);
  const payload = await requestFeishuJson(
    `${FEISHU_AUTH_BASE}/authen/v2/oauth/token`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'refresh_token',
        refresh_token: parseRequiredStringFlag(refreshToken, 'refresh_token'),
      }),
    },
    'feishu oauth failed',
  );
  return {
    accessToken: parseRequiredStringFlag(payload?.data?.access_token, 'refresh access_token'),
    refreshToken: parseRequiredStringFlag(payload?.data?.refresh_token, 'refresh refresh_token'),
    expiresIn: Number(payload?.data?.expires_in ?? 0),
    scopeSnapshot: firstNonEmptyString(payload?.data?.scope),
  };
}

async function resolveFeishuUserAccessTokenForOperation(args, operation) {
  const explicitAccessToken = firstNonEmptyString(args['user-access-token']);
  if (explicitAccessToken) {
    return explicitAccessToken;
  }
  const gatewayUserId = parseRequiredStringFlag(
    firstNonEmptyString(args?.['gateway-user-id'], process.env.GATEWAY_USER_ID),
    '--gateway-user-id',
  );
  const requiredScopes = getRequiredScopesForOperation(operation);
  const bindingDbPath = resolveFeishuUserBindingDbPath(args);
  const binding = getFeishuUserBinding(bindingDbPath, gatewayUserId);
  if (!binding) {
    return buildFeishuAuthorizationRequiredResult({
      operation,
      reason: 'feishu_user_binding_missing',
      gatewayUserId,
      requiredScopes,
      message: 'Feishu user authorization required. Run auth start-device-auth, finish auth poll-device-auth, then retry the original command.',
    });
  }
  if (binding.scopeSnapshot && requiredScopes.length > 0) {
    const grantedScopes = new Set(
      binding.scopeSnapshot.split(/\s+/).map((scope) => scope.trim()).filter(Boolean),
    );
    const missingScopes = requiredScopes.filter((scope) => !grantedScopes.has(scope));
    if (missingScopes.length > 0) {
      return buildFeishuAuthorizationRequiredResult({
        operation,
        reason: 'feishu_user_scope_missing',
        gatewayUserId,
        requiredScopes,
        missingScopes,
        message: 'Feishu user authorization is missing required scopes. Run auth start-device-auth with the required scopes, finish auth poll-device-auth, then retry the original command.',
      });
    }
  }
  return resolveFeishuUserAccessToken(args);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalSqlValue(value) {
  return normalizeOptionalString(value) ?? null;
}

async function startFeishuDeviceAuth(args) {
  const { appId, appSecret } = resolveAppCredentials(args);
  const requestedScopes = resolveDeviceAuthRequestedScopes(args);
  const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString('base64');
  const payload = await requestFeishuOauthJson(
    FEISHU_DEVICE_AUTH_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        client_id: appId,
        scope: requestedScopes.join(' '),
      }),
    },
    'feishu device auth failed',
  );
  const data = extractOauthPayloadData(payload);
  return {
    deviceCode: parseRequiredStringFlag(data.device_code, 'device_code'),
    userCode: parseRequiredStringFlag(data.user_code, 'user_code'),
    interval: Number(data.interval ?? 0),
    expiresIn: Number(data.expires_in ?? 0),
    verificationUri: parseRequiredStringFlag(data.verification_uri, 'verification_uri'),
    verificationUriComplete: parseRequiredStringFlag(data.verification_uri_complete, 'verification_uri_complete'),
    requestedScopes,
  };
}

async function pollFeishuDeviceAuth(deviceCode, args) {
  const { appId, appSecret } = resolveAppCredentials(args);
  const response = await fetch(FEISHU_DEVICE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: parseRequiredStringFlag(deviceCode, '--device-code'),
      client_id: appId,
      client_secret: appSecret,
    }),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const status = normalizeFeishuDeviceAuthStatus(firstNonEmptyString(payload?.error, payload?.data?.error));
    if (status) {
      return {
        ok: false,
        status,
        message: feishuDeviceAuthStatusMessage(status),
      };
    }
    throw new Error(buildOauthErrorMessage(payload, response.status, 'feishu device auth failed'));
  }
  const data = extractOauthPayloadData(payload);
  return {
    ok: true,
    accessToken: parseRequiredStringFlag(data.access_token, 'access_token'),
    refreshToken: parseRequiredStringFlag(data.refresh_token, 'refresh_token'),
    expiresIn: Number(data.expires_in ?? 0),
    scopeSnapshot: firstNonEmptyString(data.scope),
  };
}

function resolveRequiredScopesForDiagnosis(args) {
  const requiredScopesJson = firstNonEmptyString(args['required-scopes-json']);
  if (requiredScopesJson) {
    const scopes = normalizeScopeList(parseRequiredJsonArrayFlag(requiredScopesJson, '--required-scopes-json'));
    if (scopes.length > 0) {
      return scopes;
    }
  }
  const errorMessage = firstNonEmptyString(args['error-message']);
  if (errorMessage) {
    const scopes = extractFeishuScopesFromText(errorMessage);
    if (scopes.length > 0) {
      return scopes;
    }
  }
  throw new Error('missing --required-scopes-json or --error-message');
}

function resolveDeviceAuthRequestedScopes(args) {
  const scopeParts = [];
  const requiredScopesJson = firstNonEmptyString(args['required-scopes-json']);
  if (requiredScopesJson) {
    scopeParts.push(...normalizeScopeList(parseRequiredJsonArrayFlag(requiredScopesJson, '--required-scopes-json')));
  }
  const scopeText = firstNonEmptyString(args.scope);
  if (scopeText) {
    scopeParts.push(...scopeText.split(/\s+/).map((scope) => scope.trim()).filter(Boolean));
  }
  if (!scopeParts.includes('offline_access')) {
    scopeParts.push('offline_access');
  }
  return Array.from(new Set(scopeParts));
}

function normalizeScopeList(items) {
  return Array.from(new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean),
  ));
}

function getRequiredScopesForOperation(operation) {
  const scopes = FEISHU_OPERATION_REQUIRED_SCOPES[operation];
  return Array.isArray(scopes) ? [...scopes] : [];
}

function buildDeviceAuthNextActionArgs(gatewayUserId, requiredScopes) {
  return {
    'gateway-user-id': gatewayUserId,
    ...(requiredScopes.length > 0 ? { 'required-scopes-json': JSON.stringify(requiredScopes) } : {}),
  };
}

function buildFeishuAuthorizationRequiredResult(input) {
  return {
    ok: false,
    operation: input.operation,
    authorization_required: true,
    reason: input.reason,
    gateway_user_id: input.gatewayUserId,
    ...(input.requiredScopes?.length ? { required_scopes: input.requiredScopes } : {}),
    ...(input.missingScopes?.length ? { missing_scopes: input.missingScopes } : {}),
    next_action: {
      resource: 'auth',
      action: 'start-device-auth',
      args: buildDeviceAuthNextActionArgs(input.gatewayUserId, input.requiredScopes ?? []),
    },
    message: input.message,
  };
}

async function listFeishuAppGrantedScopes(args, tokenType) {
  const token = await resolveTenantToken(args);
  const payload = await apiRequest(
    token,
    'GET',
    appendQueryToPath('/application/v6/applications/me', { lang: 'zh_cn' }),
  );
  const app = payload?.data?.app ?? payload?.app ?? payload?.data ?? null;
  const rawScopes = Array.isArray(app?.scopes)
    ? app.scopes
    : Array.isArray(app?.online_version?.scopes)
    ? app.online_version.scopes
    : [];
  return rawScopes
    .filter((item) => item && typeof item.scope === 'string')
    .filter((item) => {
      if (!tokenType || !Array.isArray(item.token_types) || item.token_types.length === 0) {
        return true;
      }
      return item.token_types.includes(tokenType);
    })
    .map((item) => item.scope)
    .filter(Boolean);
}

async function requestFeishuOauthJson(url, init, errorPrefix = 'feishu oauth failed') {
  const response = await fetch(url, init);
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(buildOauthErrorMessage(payload, response.status, errorPrefix));
  }
  return payload;
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return {
    message: await response.text(),
  };
}

function extractOauthPayloadData(payload) {
  if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return payload.data;
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload;
  }
  return {};
}

function normalizeFeishuDeviceAuthStatus(value) {
  if (value === 'authorization_pending') {
    return 'authorization_pending';
  }
  if (value === 'slow_down') {
    return 'slow_down';
  }
  if (value === 'expired_token') {
    return 'expired_token';
  }
  return undefined;
}

function feishuDeviceAuthStatusMessage(status) {
  if (status === 'authorization_pending') {
    return 'Feishu device authorization is still pending.';
  }
  if (status === 'slow_down') {
    return 'Feishu device authorization polling should slow down.';
  }
  if (status === 'expired_token') {
    return 'Feishu device authorization expired before approval.';
  }
  return 'Feishu device authorization failed.';
}

function buildOauthErrorMessage(payload, fallbackStatus, errorPrefix) {
  const code = firstNonEmptyString(payload?.error, payload?.code) ?? String(fallbackStatus);
  const message = firstNonEmptyString(
    payload?.error_description,
    payload?.message,
    payload?.msg,
    payload?.data?.error_description,
  ) ?? 'unknown error';
  return `${errorPrefix}: ${code} ${message}`;
}

async function handleTaskCommand(action, args, sdkClient) {
  if (action === 'create-personal-task') {
    const accessToken = await resolveFeishuUserAccessTokenForOperation(args, 'task.create-personal-task');
    if (typeof accessToken !== 'string') {
      return accessToken;
    }
    const payload = await requestFeishuJson(
      `${FEISHU_API_BASE}/task/v2/tasks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          summary: parseRequiredStringFlag(args.summary, '--summary'),
          ...(firstNonEmptyString(args.description) ? { description: firstNonEmptyString(args.description) } : {}),
        }),
      },
      'feishu user api failed',
    );
    return {
      ok: true,
      operation: 'task.create-personal-task',
      task: payload?.data?.task ?? null,
    };
  }
  if (action === 'list-personal-tasks') {
    const accessToken = await resolveFeishuUserAccessTokenForOperation(args, 'task.list-personal-tasks');
    if (typeof accessToken !== 'string') {
      return accessToken;
    }
    const payload = await requestFeishuJson(
      `${FEISHU_API_BASE}${appendQueryToPath('/task/v2/tasks', buildPagingParams(args))}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
      },
      'feishu user api failed',
    );
    return {
      ok: true,
      operation: 'task.list-personal-tasks',
      items: payload?.data?.items ?? [],
      has_more: payload?.data?.has_more ?? false,
      page_token: firstNonEmptyString(payload?.data?.page_token) ?? null,
    };
  }
  if (action === 'get-personal-task') {
    const accessToken = await resolveFeishuUserAccessTokenForOperation(args, 'task.get-personal-task');
    if (typeof accessToken !== 'string') {
      return accessToken;
    }
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const payload = await requestFeishuJson(
      `${FEISHU_API_BASE}/task/v2/tasks/${encodeURIComponent(taskGuid)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
      },
      'feishu user api failed',
    );
    return {
      ok: true,
      operation: 'task.get-personal-task',
      task_guid: taskGuid,
      task: payload?.data?.task ?? null,
    };
  }
  if (action === 'update-personal-task') {
    const accessToken = await resolveFeishuUserAccessTokenForOperation(args, 'task.update-personal-task');
    if (typeof accessToken !== 'string') {
      return accessToken;
    }
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const task = parseJsonFlag(args['task-json'], '--task-json');
    const updateFields = parseJsonFlag(args['update-fields-json'], '--update-fields-json');
    if (!Array.isArray(updateFields)) {
      throw new Error('invalid --update-fields-json: expected a JSON array');
    }
    const payload = await requestFeishuJson(
      `${FEISHU_API_BASE}/task/v2/tasks/${encodeURIComponent(taskGuid)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          task,
          update_fields: updateFields,
        }),
      },
      'feishu user api failed',
    );
    return {
      ok: true,
      operation: 'task.update-personal-task',
      task_guid: taskGuid,
      task: payload?.data?.task ?? null,
    };
  }
  if (action === 'delete-personal-task') {
    const accessToken = await resolveFeishuUserAccessTokenForOperation(args, 'task.delete-personal-task');
    if (typeof accessToken !== 'string') {
      return accessToken;
    }
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    await requestFeishuJson(
      `${FEISHU_API_BASE}/task/v2/tasks/${encodeURIComponent(taskGuid)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
      },
      'feishu user api failed',
    );
    return {
      ok: true,
      operation: 'task.delete-personal-task',
      task_guid: taskGuid,
    };
  }
  const client = sdkClient ?? resolveSdkClient(args);
  if (action === 'create') {
    const summary = parseRequiredStringFlag(args.summary, '--summary');
    const originPlatformName = firstNonEmptyString(args['origin-platform-name']) ?? 'codex-gateway';
    const response = await client.task.task.create({
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
    const response = await client.task.task.list({
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
    const response = await client.task.task.get({
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
    const response = await client.task.task.patch({
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
    const response = await client.task.taskSubtask.create({
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
  if (action === 'delete') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    await client.task.task.delete({
      path: { task_guid: taskGuid },
    });
    return {
      ok: true,
      operation: 'task.delete',
      task_guid: taskGuid,
    };
  }
  if (action === 'add-members') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await client.task.task.addMembers({
      path: { task_guid: taskGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'task.add-members',
      task_guid: taskGuid,
      task: response?.data?.task ?? null,
    };
  }
  if (action === 'remove-members') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await client.task.task.removeMembers({
      path: { task_guid: taskGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'task.remove-members',
      task_guid: taskGuid,
      task: response?.data?.task ?? null,
    };
  }
  if (action === 'add-reminders') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await client.task.task.addReminders({
      path: { task_guid: taskGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'task.add-reminders',
      task_guid: taskGuid,
      task: response?.data?.task ?? null,
    };
  }
  if (action === 'remove-reminders') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await client.task.task.removeReminders({
      path: { task_guid: taskGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'task.remove-reminders',
      task_guid: taskGuid,
      task: response?.data?.task ?? null,
    };
  }
  if (action === 'add-dependencies') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const response = await client.task.task.addDependencies({
      path: { task_guid: taskGuid },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'task.add-dependencies',
      task_guid: taskGuid,
      dependencies: response?.data?.dependencies ?? [],
    };
  }
  if (action === 'remove-dependencies') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const response = await client.task.task.removeDependencies({
      path: { task_guid: taskGuid },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'task.remove-dependencies',
      task_guid: taskGuid,
      dependencies: response?.data?.dependencies ?? [],
    };
  }
  if (action === 'list-subtasks') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const response = await client.task.taskSubtask.list({
      path: { task_guid: taskGuid },
      params: buildPagingParams(args),
    });
    return {
      ok: true,
      operation: 'task.list-subtasks',
      task_guid: taskGuid,
      items: response?.data?.items ?? [],
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }
  if (action === 'list-tasklists') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const response = await client.task.task.tasklists({
      path: { task_guid: taskGuid },
    });
    return {
      ok: true,
      operation: 'task.list-tasklists',
      task_guid: taskGuid,
      tasklists: response?.data?.tasklists ?? [],
    };
  }
  if (action === 'add-tasklist') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await client.task.task.addTasklist({
      path: { task_guid: taskGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'task.add-tasklist',
      task_guid: taskGuid,
      task: response?.data?.task ?? null,
    };
  }
  if (action === 'remove-tasklist') {
    const taskGuid = parseRequiredStringFlag(args['task-guid'], '--task-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await client.task.task.removeTasklist({
      path: { task_guid: taskGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'task.remove-tasklist',
      task_guid: taskGuid,
      task: response?.data?.task ?? null,
    };
  }
  throw new Error(`unsupported command: task ${action ?? ''}`.trim());
}

async function handleTasklistCommand(action, args, sdkClient) {
  if (action === 'create') {
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await sdkClient.task.tasklist.create({
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'tasklist.create',
      tasklist: response?.data?.tasklist ?? null,
    };
  }
  if (action === 'list') {
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await sdkClient.task.tasklist.list({
      params: {
        ...buildPagingParams(args),
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
    });
    return {
      ok: true,
      operation: 'tasklist.list',
      items: response?.data?.items ?? [],
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }
  if (action === 'get') {
    const tasklistGuid = parseRequiredStringFlag(args['tasklist-guid'], '--tasklist-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await sdkClient.task.tasklist.get({
      path: { tasklist_guid: tasklistGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
    });
    return {
      ok: true,
      operation: 'tasklist.get',
      tasklist_guid: tasklistGuid,
      tasklist: response?.data?.tasklist ?? null,
    };
  }
  if (action === 'update') {
    const tasklistGuid = parseRequiredStringFlag(args['tasklist-guid'], '--tasklist-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await sdkClient.task.tasklist.patch({
      path: { tasklist_guid: tasklistGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'tasklist.update',
      tasklist_guid: tasklistGuid,
      tasklist: response?.data?.tasklist ?? null,
    };
  }
  if (action === 'delete') {
    const tasklistGuid = parseRequiredStringFlag(args['tasklist-guid'], '--tasklist-guid');
    await sdkClient.task.tasklist.delete({
      path: { tasklist_guid: tasklistGuid },
    });
    return {
      ok: true,
      operation: 'tasklist.delete',
      tasklist_guid: tasklistGuid,
    };
  }
  if (action === 'tasks') {
    const tasklistGuid = parseRequiredStringFlag(args['tasklist-guid'], '--tasklist-guid');
    const completed = parseOptionalBooleanFlag(args.completed, '--completed');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await sdkClient.task.tasklist.tasks({
      path: { tasklist_guid: tasklistGuid },
      params: {
        ...buildPagingParams(args),
        ...(completed !== undefined ? { completed } : {}),
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
    });
    return {
      ok: true,
      operation: 'tasklist.tasks',
      tasklist_guid: tasklistGuid,
      items: response?.data?.items ?? [],
      has_more: response?.data?.has_more ?? false,
      page_token: response?.data?.page_token ?? null,
    };
  }
  if (action === 'add-members') {
    const tasklistGuid = parseRequiredStringFlag(args['tasklist-guid'], '--tasklist-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await sdkClient.task.tasklist.addMembers({
      path: { tasklist_guid: tasklistGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'tasklist.add-members',
      tasklist_guid: tasklistGuid,
      tasklist: response?.data?.tasklist ?? null,
    };
  }
  if (action === 'remove-members') {
    const tasklistGuid = parseRequiredStringFlag(args['tasklist-guid'], '--tasklist-guid');
    const userIdType = firstNonEmptyString(args['user-id-type']);
    const response = await sdkClient.task.tasklist.removeMembers({
      path: { tasklist_guid: tasklistGuid },
      params: {
        ...(userIdType ? { user_id_type: userIdType } : {}),
      },
      data: parseJsonFlag(args['body-json'], '--body-json'),
    });
    return {
      ok: true,
      operation: 'tasklist.remove-members',
      tasklist_guid: tasklistGuid,
      tasklist: response?.data?.tasklist ?? null,
    };
  }
  throw new Error(`unsupported command: tasklist ${action ?? ''}`.trim());
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

async function handleWikiCommand(action, args, token) {
  if (action === 'list-spaces') {
    return listWikiSpaces(token, args);
  }
  if (action === 'get-node') {
    return getWikiNode(token, args);
  }
  if (action === 'get-task') {
    const taskId = parseRequiredStringFlag(args['task-id'], '--task-id');
    const taskType = firstNonEmptyString(args['task-type']) ?? 'move';
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/wiki/v2/tasks/${encodeURIComponent(taskId)}`, {
        task_type: taskType,
      }),
    );
    return buildGenericSuccess('wiki.get-task', payload?.data ?? null);
  }
  if (action === 'create-node') {
    return createWikiNode(token, args);
  }
  if (action === 'list-nodes') {
    const spaceId = parseRequiredStringFlag(args['space-id'], '--space-id');
    const payload = await apiRequest(
      token,
      'GET',
      appendQueryToPath(`/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes`, {
        ...buildPagingParams(args),
        ...(firstNonEmptyString(args['parent-node-token'])
          ? { parent_node_token: firstNonEmptyString(args['parent-node-token']) }
          : {}),
      }),
    );
    return {
      ok: true,
      operation: 'wiki.list-nodes',
      items: payload?.data?.items ?? [],
      has_more: payload?.data?.has_more ?? false,
      page_token: payload?.data?.page_token ?? null,
    };
  }
  if (action === 'move-node') {
    const spaceId = parseRequiredStringFlag(args['space-id'], '--space-id');
    const nodeToken = parseRequiredStringFlag(args['node-token'], '--node-token');
    const targetParentToken = firstNonEmptyString(args['target-parent-token']);
    const targetSpaceId = firstNonEmptyString(args['target-space-id']);
    if (!targetParentToken && !targetSpaceId) {
      throw new Error('missing --target-parent-token or --target-space-id');
    }
    const payload = await apiRequest(
      token,
      'POST',
      `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeToken)}/move`,
      {
        ...(targetParentToken ? { target_parent_token: targetParentToken } : {}),
        ...(targetSpaceId ? { target_space_id: targetSpaceId } : {}),
      },
    );
    return {
      ok: true,
      operation: 'wiki.move-node',
      node: payload?.data?.node ?? null,
    };
  }
  if (action === 'update-title') {
    const spaceId = parseRequiredStringFlag(args['space-id'], '--space-id');
    const nodeToken = parseRequiredStringFlag(args['node-token'], '--node-token');
    const title = parseRequiredStringFlag(args.title, '--title');
    await apiRequest(
      token,
      'POST',
      `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeToken)}/update_title`,
      { title },
    );
    return {
      ok: true,
      operation: 'wiki.update-title',
      space_id: spaceId,
      node_token: nodeToken,
      title,
    };
  }
  if (action === 'copy-node') {
    const spaceId = parseRequiredStringFlag(args['space-id'], '--space-id');
    const nodeToken = parseRequiredStringFlag(args['node-token'], '--node-token');
    const targetParentToken = firstNonEmptyString(args['target-parent-token']);
    const targetSpaceId = firstNonEmptyString(args['target-space-id']);
    const title = firstNonEmptyString(args.title);
    const payload = await apiRequest(
      token,
      'POST',
      `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeToken)}/copy`,
      {
        ...(targetParentToken ? { target_parent_token: targetParentToken } : {}),
        ...(targetSpaceId ? { target_space_id: targetSpaceId } : {}),
        ...(title ? { title } : {}),
      },
    );
    return {
      ok: true,
      operation: 'wiki.copy-node',
      node: payload?.data?.node ?? null,
    };
  }
  if (action === 'move-docs-to-wiki') {
    const spaceId = parseRequiredStringFlag(args['space-id'], '--space-id');
    const objType = parseRequiredStringFlag(args['obj-type'], '--obj-type');
    const objToken = parseRequiredStringFlag(args['obj-token'], '--obj-token');
    const parentWikiToken = firstNonEmptyString(args['parent-wiki-token']);
    const apply = parseOptionalBooleanFlag(args.apply, '--apply');
    const payload = await apiRequest(
      token,
      'POST',
      `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes/move_docs_to_wiki`,
      {
        ...(parentWikiToken ? { parent_wiki_token: parentWikiToken } : {}),
        obj_type: objType,
        obj_token: objToken,
        ...(apply !== undefined ? { apply } : {}),
      },
    );
    return buildGenericSuccess('wiki.move-docs-to-wiki', payload?.data ?? null);
  }
  throw new Error(`unsupported command: wiki ${action ?? ''}`.trim());
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
  return requestFeishuJson(`${FEISHU_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function requestFeishuJson(url, init, errorPrefix = 'feishu api failed') {
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { code: response.status, msg: await response.text() };
  if (!response.ok || payload.code !== 0) {
    throw new Error(`${errorPrefix}: ${payload.code ?? response.status} ${payload.msg ?? 'unknown error'}`);
  }
  return payload;
}

async function loadApiCatalog(input = {}) {
  const refresh = input.refresh === true;
  if (!refresh) {
    const cached = loadCachedApiCatalog();
    if (cached) {
      return cached;
    }
  }

  try {
    const payload = await fetchJson(FEISHU_API_CATALOG_URL);
    const normalized = normalizeApiCatalog(payload?.data?.items ?? []);
    persistApiCatalogCache(normalized);
    return normalized;
  } catch (error) {
    const cached = loadCachedApiCatalog();
    if (cached) {
      return cached;
    }
    throw error;
  }
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? payload?.msg ?? `request failed: ${response.status}`);
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

function normalizeApiCatalog(items) {
  const normalized = [];
  for (const item of Array.isArray(items) ? items : []) {
    walkCatalogNode(item, [], normalized);
  }
  return normalized;
}

function walkCatalogNode(node, chain, output) {
  const nextChain = node?.type === 2 && typeof node?.name === 'string'
    ? [...chain, node.name]
    : chain;
  const identity = node?.apiSummary?.apiIdentity;
  if (identity && typeof node?.name === 'string') {
    output.push({
      name: node.name,
      chain,
      project: identity.project ?? '',
      version: identity.version ?? '',
      resource: identity.resource ?? '',
      apiName: identity.apiName ?? '',
      method: node?.apiSummary?.httpMethod ?? '',
      path: node?.apiSummary?.apiPath ?? '',
    });
  }
  for (const child of Array.isArray(node?.children) ? node.children : []) {
    walkCatalogNode(child, nextChain, output);
  }
}

function loadCachedApiCatalog() {
  try {
    if (!fs.existsSync(API_CATALOG_CACHE_PATH)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(API_CATALOG_CACHE_PATH, 'utf8'));
    return Array.isArray(parsed?.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

function persistApiCatalogCache(items) {
  fs.mkdirSync(path.dirname(API_CATALOG_CACHE_PATH), { recursive: true });
  fs.writeFileSync(API_CATALOG_CACHE_PATH, JSON.stringify({
    updatedAt: new Date().toISOString(),
    items,
  }, null, 2));
}

function parseCatalogRefreshFlag(value) {
  return value === true || value === 'true';
}

function filterCatalogItems(items, args) {
  const category = firstNonEmptyString(args.category);
  const project = firstNonEmptyString(args.project);
  return items.filter((item) => {
    if (category && (!Array.isArray(item.chain) || item.chain[0] !== category)) {
      return false;
    }
    if (project && item.project !== project) {
      return false;
    }
    return true;
  });
}

function applyCatalogLimit(items, args) {
  const limit = parseOptionalPositiveInteger(args.limit, '--limit');
  return limit ? items.slice(0, limit) : items;
}

function parseOptionalJsonFlag(value, flagName) {
  const raw = firstNonEmptyString(value);
  if (!raw) {
    return undefined;
  }
  return parseJsonFlag(raw, flagName);
}

function parseOptionalJsonObjectFlag(value, flagName) {
  const parsed = parseOptionalJsonFlag(value, flagName);
  if (parsed === undefined) {
    return undefined;
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`invalid ${flagName}: expected a JSON object`);
  }
  return parsed;
}

function parseRequiredJsonObjectFlag(value, flagName) {
  const parsed = parseJsonFlag(value, flagName);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`invalid ${flagName}: expected a JSON object`);
  }
  return parsed;
}

function parseRequiredJsonArrayFlag(value, flagName) {
  const parsed = parseJsonFlag(value, flagName);
  if (!Array.isArray(parsed)) {
    throw new Error(`invalid ${flagName}: expected a JSON array`);
  }
  return parsed;
}

function normalizeOpenApiPath(value) {
  const raw = firstNonEmptyString(value);
  if (!raw) {
    throw new Error('missing --path');
  }
  if (raw.startsWith(FEISHU_API_BASE)) {
    const requestPath = raw.slice(FEISHU_API_BASE.length);
    return {
      openApiPath: `/open-apis${requestPath}`,
      requestPath,
    };
  }
  if (raw.startsWith('/open-apis/')) {
    return {
      openApiPath: raw,
      requestPath: raw.slice('/open-apis'.length),
    };
  }
  if (raw.startsWith('/')) {
    return {
      openApiPath: `/open-apis${raw}`,
      requestPath: raw,
    };
  }
  return {
    openApiPath: `/open-apis/${raw.replace(/^\/+/, '')}`,
    requestPath: `/${raw.replace(/^\/+/, '')}`,
  };
}

function appendQueryToPath(requestPath, query) {
  if (!query || typeof query !== 'object') {
    return requestPath;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, stringifyQueryValue(item));
      }
      continue;
    }
    params.set(key, stringifyQueryValue(value));
  }
  const text = params.toString();
  return text ? `${requestPath}?${text}` : requestPath;
}

function stringifyQueryValue(value) {
  return value && typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function buildGenericSuccess(operation, data, extra = {}) {
  return {
    ok: true,
    operation,
    ...extra,
    data,
  };
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

  const apiMatch = message.match(/feishu api failed:\s*(\d+)\s+([\s\S]+)$/i);
  if (apiMatch) {
    const code = Number.parseInt(apiMatch[1], 10);
    const scopes = extractFeishuScopesFromText(apiMatch[2]);
    return {
      type: code === 99991679
        ? 'user_scope_insufficient'
        : code === 99991672
        ? 'app_scope_missing'
        : code === 99991663
        ? 'permission_denied'
        : code === 404
        ? 'not_found'
        : code === 429
        ? 'rate_limited'
        : 'api_error',
      code,
      message: apiMatch[2],
      ...(scopes.length > 0 ? { scopes } : {}),
    };
  }

  return {
    type: 'api_error',
    code: null,
    message,
  };
}

function extractFeishuScopesFromText(value) {
  const matches = String(value ?? '').match(/\b[a-z]+:[a-z0-9._:-]+\b/g) ?? [];
  return Array.from(new Set(matches));
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
