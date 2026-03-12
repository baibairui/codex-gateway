#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildCanvasSectionMarkdown,
  clearCanvasSession,
  loadCanvasSession,
  saveCanvasSession,
} from './feishu-canvas-state.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');
const feishuOpenApiScript = path.resolve(repoRoot, '.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs');
const statePath = path.resolve(process.cwd(), '.data', 'feishu-canvas', 'latest-session.json');
const ACTIONS = new Set(['create', 'rewrite', 'expand', 'compress', 'outline', 'restructure', 'show', 'reset']);

const [action, ...rest] = process.argv.slice(2);
if (!ACTIONS.has(action)) {
  printHelp();
  process.exit(action ? 1 : 0);
}

const args = parseArgs(rest);
if (action === 'show') {
  const session = loadCanvasSession(statePath);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    action,
    session: session ?? null,
  }, null, 2)}\n`);
  process.exit(0);
}
if (action === 'reset') {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    action,
    cleared: clearCanvasSession(statePath),
  }, null, 2)}\n`);
  process.exit(0);
}
const title = firstNonEmpty(args.title, 'Canvas Workspace');
const markdown = readMarkdownInput(args);
if (!markdown) {
  fail('missing --markdown or --markdown-file');
}

if (action === 'create') {
  const result = runFeishuOpenApi([
    'docx',
    'create',
    '--title',
    title,
    '--markdown-file',
    writeTempMarkdown(markdown),
  ]);
  persistSession({
    action,
    title,
    payload: result,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    action,
    title,
    document_id: result.document_id ?? null,
    document_url: result.document_url ?? null,
    payload: result,
  }, null, 2)}\n`);
  process.exit(0);
}

const existing = resolveSession(args.document);
const section = buildCanvasSectionMarkdown({
  action,
  markdown,
  heading: firstNonEmpty(args.heading),
});
const result = runFeishuOpenApi([
  'docx',
  'append',
  '--document',
  existing.document_url || existing.document_id,
  '--markdown-file',
  writeTempMarkdown(section.markdown),
]);

persistSession({
  action,
  title: existing.title || title,
  payload: {
    ...existing,
    ...result,
  },
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  action,
  title: existing.title || title,
  document_id: existing.document_id ?? result.document_id ?? null,
  document_url: existing.document_url ?? result.document_url ?? null,
  payload: result,
}, null, 2)}\n`);

function printHelp() {
  process.stdout.write([
    'Feishu Canvas',
    '',
    'Commands:',
    '  create --title <title> --markdown <text>',
    '  create --title <title> --markdown-file <path>',
    '  rewrite --markdown <text> [--document <url|id>]',
    '  expand --markdown <text> [--document <url|id>]',
    '  compress --markdown <text> [--document <url|id>]',
    '  outline --markdown <text> [--document <url|id>]',
    '  restructure --markdown <text> [--document <url|id>]',
    '',
  ].join('\n'));
}

function parseArgs(tokens) {
  const output = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token?.startsWith('--')) {
      fail(`unexpected argument: ${token || '(empty)'}`);
    }
    const key = token.slice(2);
    const value = tokens[i + 1];
    if (!value || value.startsWith('--')) {
      output[key] = 'true';
      continue;
    }
    output[key] = value;
    i += 1;
  }
  return output;
}

function readMarkdownInput(args) {
  const inline = firstNonEmpty(args.markdown);
  if (inline) {
    return inline;
  }
  const markdownFile = firstNonEmpty(args['markdown-file']);
  if (!markdownFile) {
    return '';
  }
  const resolved = path.resolve(process.cwd(), markdownFile);
  if (!fs.existsSync(resolved)) {
    fail(`markdown file not found: ${resolved}`);
  }
  return fs.readFileSync(resolved, 'utf8');
}

function writeTempMarkdown(markdown) {
  const tempDir = path.resolve(process.cwd(), '.data', 'feishu-canvas');
  fs.mkdirSync(tempDir, { recursive: true });
  const filePath = path.join(tempDir, `canvas-${Date.now()}.md`);
  fs.writeFileSync(filePath, `${markdown.trim()}\n`, 'utf8');
  return filePath;
}

function runFeishuOpenApi(args) {
  const child = spawnSync(process.execPath, [feishuOpenApiScript, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  if (child.status !== 0) {
    fail((child.stderr || child.stdout || `feishu-openapi failed (${child.status ?? 'unknown'})`).trim());
  }
  try {
    return JSON.parse(child.stdout.trim());
  } catch {
    fail(`unexpected feishu-openapi output: ${child.stdout.trim()}`);
  }
}

function resolveSession(documentArg) {
  const explicit = firstNonEmpty(documentArg);
  if (explicit) {
    return {
      document_id: explicit,
      document_url: explicit,
      title: undefined,
    };
  }
  const existing = loadCanvasSession(statePath);
  if (!existing) {
    fail('no existing canvas session; run create first or provide --document');
  }
  return existing;
}

function persistSession(input) {
  const documentId = firstNonEmpty(
    input.payload?.document_id,
    input.payload?.documentId,
  );
  const documentUrl = firstNonEmpty(
    input.payload?.document_url,
    input.payload?.documentUrl,
  );
  saveCanvasSession(statePath, {
    document_id: documentId,
    document_url: documentUrl,
    title: input.title,
    last_action: input.action,
    last_heading: firstNonEmpty(input.heading),
    updated_at: Date.now(),
  });
}
function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
