#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

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
    '',
    'Commands:',
    '  docx create --title <title> [--folder-token <token>] [--markdown <text>] [--markdown-file <path>]',
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
  return {
    ok: true,
    operation: 'docx.create',
    title: document.title ?? title,
    document_id: documentId,
    revision_id: document.revision_id ?? null,
    content_write: writeResult ?? null,
    raw: payload.data ?? null,
  };
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
  const nodeToken = args.token?.trim() || args['node-token']?.trim();
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
  const children = markdownToDocxChildren(markdown);
  if (children.length === 0) {
    return { ok: true, blocks_appended: 0 };
  }

  let appended = 0;
  for (const chunk of chunkArray(children, 20)) {
    await apiRequest(
      token,
      'POST',
      `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`,
      {
        index: -1,
        children: chunk,
      },
    );
    appended += chunk.length;
  }
  return {
    ok: true,
    blocks_appended: appended,
  };
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
