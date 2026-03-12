#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildStartupFailureHints } from './lib/install-hints.mjs';

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const cwd = process.cwd();
const forceXvfb = process.env.GATEWAY_FORCE_XVFB === 'true';

function runConfigCheck() {
  return new Promise((resolve) => {
    const check = spawn('node', ['./bin/config-check.mjs'], {
      cwd,
      stdio: 'inherit',
    });
    check.on('exit', (code) => {
      resolve(code === 0);
    });
  });
}

function hasDisplayServer() {
  return Boolean(process.env.DISPLAY && process.env.DISPLAY.trim());
}

function findCommand(command) {
  const pathEnv = process.env.PATH ?? '';
  const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, command);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveCommand(command, args) {
  if (!forceXvfb && hasDisplayServer()) {
    return { command, args };
  }

  const xvfbRun = findCommand('xvfb-run');
  if (!xvfbRun) {
    console.error(
      '当前未检测到可用的 DISPLAY，且系统中未安装 xvfb-run。请安装 xvfb，或在有图形界面的会话中启动。',
    );
    process.exit(1);
  }

  return {
    command: xvfbRun,
    args: ['-a', '--server-args=-screen 0 1440x900x24', command, ...args],
  };
}

function runCommand(command, args) {
  const resolved = resolveCommand(command, args);
  const child = spawn(resolved.command, resolved.args, {
    cwd,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

const ok = await runConfigCheck();
if (!ok) {
  console.error('');
  for (const line of buildStartupFailureHints(process.env)) {
    console.error(line);
  }
  process.exit(1);
}

if (mode === 'start') {
  const distServer = path.join(cwd, 'dist', 'server.js');
  if (!fs.existsSync(distServer)) {
    console.error('未找到 dist/server.js，请先执行 npm run build。');
    process.exit(1);
  }
  runCommand('node', ['./dist/server.js']);
} else {
  runCommand('tsx', ['watch', 'src/server.ts']);
}
