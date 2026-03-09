#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
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
  const token = await getTenantAccessToken({
    appId: args.appId ?? process.env.FEISHU_APP_ID,
    appSecret: args.appSecret ?? process.env.FEISHU_APP_SECRET,
  });

  let result;
  if (resource === 'docx' && action === 'create') {
    result = await createDocx(token, args);
  } else if (resource === 'docx' && action === 'append') {
    result = await appendDocx(token, args);
  } else if (resource === 'wiki' && action === 'list-spaces') {
    result = await listWikiSpaces(token, args);
  } else if (resource === 'wiki' && action === 'get-node') {
    result = await getWikiNode(token, args);
  } else if (resource === 'wiki' && action === 'create-node') {
    result = await createWikiNode(token, args);
  } else {
    throw new Error(`unsupported command: ${resource ?? ''} ${action ?? ''}`.trim());
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printHelp() {
  const lines = [
    'Feishu OpenAPI CLI',
    '',
    'Environment:',
    '  FEISHU_APP_ID',
    '  FEISHU_APP_SECRET',
    '  FEISHU_DOC_BASE_URL (optional override; defaults to https://feishu.cn/docx)',
    '',
    'Commands:',
    '  docx create --title <title> [--folder-token <token>] [--markdown <text>] [--markdown-file <path>]',
    '  docx append --document <url|token|document_id> [--markdown <text>] [--markdown-file <path>]',
    '  wiki list-spaces [--page-size <n>] [--page-token <token>]',
    '  wiki get-node --token <token> [--obj-type <wiki|docx|doc|sheet|bitable|mindnote|file|slides>]',
    '  wiki create-node --space-id <id> --obj-type <docx|doc|sheet|bitable|mindnote|file|slides> [--title <title>] [--parent-node-token <token>] [--node-type <origin|shortcut>] [--origin-node-token <token>]',
    '',
    'Optional auth overrides:',
    '  --app-id <id> --app-secret <secret>',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function parseArgs(argv) {
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

async function getTenantAccessToken(input) {
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

async function createDocx(token, args) {
  const title = args.title?.trim() || '未命名文档';
  const markdownContent = resolveMarkdownInput(args);
  const docBaseUrl = firstNonEmptyString(args['doc-base-url'], process.env.FEISHU_DOC_BASE_URL);
  const body = {
    title,
    ...(args['folder-token'] ? { folder_token: args['folder-token'] } : {}),
  };
  const payload = await apiRequest(token, 'POST', '/docx/v1/documents', body);
  const document = payload?.data?.document ?? {};
  const documentId = document.document_id ?? null;
  let writeResult = undefined;
  if (documentId && markdownContent) {
    try {
      writeResult = await appendMarkdownToDocx(token, documentId, markdownContent);
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

async function appendDocx(token, args) {
  const locator = firstNonEmptyString(args.document, args['document-id'], args['doc-id'], args.document_id, args.url, args.target);
  const target = await resolveDocxTarget(token, locator);
  const markdownContent = resolveMarkdownInput(args);
  if (!markdownContent?.trim()) {
    throw new Error('missing --markdown or --markdown-file');
  }
  const docBaseUrl = firstNonEmptyString(args['doc-base-url'], process.env.FEISHU_DOC_BASE_URL);
  const writeResult = await appendMarkdownToDocx(token, target.documentId, markdownContent);
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

async function listWikiSpaces(token, args) {
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

async function getWikiNode(token, args) {
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

async function createWikiNode(token, args) {
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

export function markdownToDocxChildren(markdown) {
  const lines = String(markdown ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd());

  const blocks = [];
  let inCodeBlock = false;
  let codeBuffer = [];

  const flushCodeBlock = () => {
    if (!codeBuffer.length) {
      return;
    }
    blocks.push(createTextBlock(14, 'code', codeBuffer.join('\n')));
    codeBuffer = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!trimmed) {
      const last = blocks[blocks.length - 1];
      if (last?.block_type !== 22) {
        blocks.push({ block_type: 22, divider: {} });
      }
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      blocks.push(createTextBlock(level + 2, `heading${level}`, heading[2]));
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      blocks.push(createTextBlock(15, 'quote', quote[1]));
      continue;
    }

    const ordered = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (ordered) {
      blocks.push(createTextBlock(13, 'ordered', ordered[2]));
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      blocks.push(createTextBlock(12, 'bullet', bullet[1]));
      continue;
    }

    blocks.push(createTextBlock(2, 'text', trimmed));
  }

  if (inCodeBlock) {
    flushCodeBlock();
  }

  return blocks.filter((block, index, arr) => {
    if (block.block_type !== 22) {
      return true;
    }
    const prev = arr[index - 1];
    const next = arr[index + 1];
    return !!prev && !!next && prev.block_type !== 22 && next.block_type !== 22;
  });
}

function createTextBlock(blockType, field, content) {
  return {
    block_type: blockType,
    [field]: {
      elements: buildTextElements(content),
    },
  };
}

function buildTextElements(content) {
  const text = String(content ?? '').trim();
  if (!text) {
    return [{ text_run: { content: ' ' } }];
  }

  const elements = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      elements.push({ text_run: { content: text.slice(cursor, index) } });
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      elements.push({
        text_run: {
          content: token.slice(1, -1),
          text_element_style: { inline_code: true },
        },
      });
    } else if (token.startsWith('**') && token.endsWith('**')) {
      elements.push({
        text_run: {
          content: token.slice(2, -2),
          text_element_style: { bold: true },
        },
      });
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        elements.push({
          text_run: {
            content: link[1],
            link: { url: link[2] },
          },
        });
      }
    }
    cursor = index + token.length;
  }

  if (cursor < text.length) {
    elements.push({ text_run: { content: text.slice(cursor) } });
  }

  return elements.length ? elements : [{ text_run: { content: text } }];
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
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
