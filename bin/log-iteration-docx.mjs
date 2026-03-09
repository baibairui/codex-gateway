#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const nodeBin = process.execPath;
const cliPath = './.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs';

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
log-iteration-docx

Usage:
  node ./bin/log-iteration-docx.mjs --markdown-file <path> [--document <url|token|document_id>]
  node ./bin/log-iteration-docx.mjs --markdown "<text>" [--document <url|token|document_id>]

Rules:
  - --document 优先使用命令行参数，否则依次读取 FEISHU_ITERATION_DOCX_REF / FEISHU_ITERATION_DOCX / FEISHU_ITERATION_DOCX_ID
  - 如果上面都没提供，则自动回退到最近一次成功创建或写入的 DocX
  - markdown 内容不能为空
`.trim());
}

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const documentFromArgs = readArg('--document') || readArg('--document-id') || readArg('--target') || readArg('--url');
const document = documentFromArgs
  || process.env.FEISHU_ITERATION_DOCX_REF?.trim()
  || process.env.FEISHU_ITERATION_DOCX?.trim()
  || process.env.FEISHU_ITERATION_DOCX_ID?.trim();

const hasMarkdown = Boolean(readArg('--markdown'));
const hasMarkdownFile = Boolean(readArg('--markdown-file'));
if (!hasMarkdown && !hasMarkdownFile) {
  console.error('missing --markdown or --markdown-file');
  process.exit(1);
}

const passthroughArgs = [];
for (let i = 0; i < args.length; i += 1) {
  const token = args[i];
  if (token === '--document' || token === '--document-id' || token === '--target' || token === '--url') {
    i += 1;
    continue;
  }
  passthroughArgs.push(token);
}

const childArgs = [cliPath, 'docx', 'append'];
if (document) {
  childArgs.push('--document', document);
}
childArgs.push(...passthroughArgs);
const result = spawnSync(nodeBin, childArgs, {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);

function readArg(flag) {
  const index = args.indexOf(flag);
  if (index < 0) {
    return '';
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    return '';
  }
  return value.trim();
}
