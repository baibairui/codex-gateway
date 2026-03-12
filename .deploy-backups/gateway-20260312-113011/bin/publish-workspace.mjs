#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const SOURCE_DIR = path.resolve(
  process.env.SOURCE_DIR
    ?? (fs.existsSync('/opt/gateway/workspace/wecom-codex-gateway') ? '/opt/gateway/workspace/wecom-codex-gateway' : cwd),
);
const TARGET_DIR = path.resolve(
  process.env.TARGET_DIR
    ?? (fs.existsSync('/opt/gateway') ? '/opt/gateway' : cwd),
);
const BACKUP_DIR = path.resolve(
  process.env.BACKUP_DIR
    ?? (fs.existsSync('/opt/deploy-backups') ? '/opt/deploy-backups' : path.join(TARGET_DIR, '.deploy-backups')),
);
const PM2_APP_NAME = process.env.PM2_APP_NAME ?? 'wecom-codex';
const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL ?? 'http://127.0.0.1:3000/healthz';
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const pm2Bin = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
const EXCLUDED_TOP_LEVEL = new Set([
  '.env',
  '.data',
  'workspace',
  'node_modules',
  'dist',
  '.git',
  '.DS_Store',
  '.deploy-backups',
]);

function log(message) {
  process.stdout.write(`==> ${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function ensureDirExists(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    fail(`${label} does not exist: ${dirPath}`);
  }
}

function ensureRequiredSourceFiles() {
  const required = ['package.json', 'package-lock.json', path.join('bin', 'publish-workspace.mjs')];
  for (const rel of required) {
    const abs = path.join(SOURCE_DIR, rel);
    if (!fs.existsSync(abs)) {
      fail(`missing required source file: ${abs}`);
    }
  }
}

function run(command, args, runCwd) {
  const result = spawnSync(command, args, {
    cwd: runCwd,
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
  if (result.status !== 0) {
    fail(`command failed: ${command} ${args.join(' ')}`);
  }
}

function hasCommand(command) {
  const checker = process.platform === 'win32' ? 'where' : 'command';
  const checkerArgs = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(checker, checkerArgs, {
    stdio: 'ignore',
    shell: process.platform !== 'win32',
  });
  return result.status === 0;
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function shouldExclude(name) {
  if (EXCLUDED_TOP_LEVEL.has(name)) {
    return true;
  }
  return name.startsWith('._');
}

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldExclude(entry.name)) {
        continue;
      }
      copyRecursive(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function removeMissingTargets(sourceDir, targetDir) {
  if (!fs.existsSync(targetDir)) {
    return;
  }
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      continue;
    }
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (!fs.existsSync(sourcePath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      removeMissingTargets(sourcePath, targetPath);
    }
  }
}

function collectTestFiles(rootDir) {
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.test.ts')) {
        out.push(full);
      }
    }
  }
  walk(rootDir);
  return out.sort();
}

async function checkHealth(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`healthcheck failed: ${response.status}`);
  }
}

async function main() {
  ensureDirExists(SOURCE_DIR, 'source dir');
  ensureDirExists(TARGET_DIR, 'target dir');
  ensureRequiredSourceFiles();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const backupSnapshot = path.join(BACKUP_DIR, `gateway-${timestamp()}`);
  log(`Backing up live directory to ${backupSnapshot}`);
  fs.mkdirSync(backupSnapshot, { recursive: true });
  copyRecursive(TARGET_DIR, backupSnapshot);

  log('Syncing workspace into live directory');
  removeMissingTargets(SOURCE_DIR, TARGET_DIR);
  copyRecursive(SOURCE_DIR, TARGET_DIR);

  log('Installing dependencies');
  run(npmBin, ['ci'], TARGET_DIR);

  log('Running tests');
  const testsDir = path.join(TARGET_DIR, 'tests');
  if (!fs.existsSync(testsDir)) {
    fail(`tests dir does not exist: ${testsDir}`);
  }
  const testFiles = collectTestFiles(testsDir);
  if (testFiles.length === 0) {
    fail(`no test files found under ${testsDir}`);
  }
  run(npxBin, ['vitest', 'run', '--exclude', 'workspace/**', ...testFiles], TARGET_DIR);

  log('Building project');
  run(npmBin, ['run', 'build'], TARGET_DIR);

  if (hasCommand(pm2Bin)) {
    log(`Restarting PM2 app ${PM2_APP_NAME}`);
    run(pm2Bin, ['restart', PM2_APP_NAME, '--update-env'], TARGET_DIR);
  } else {
    log('PM2 not found, skipping restart');
  }

  if (HEALTHCHECK_URL.trim()) {
    log(`Checking health endpoint ${HEALTHCHECK_URL}`);
    await checkHealth(HEALTHCHECK_URL);
  }

  log('Publish completed');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
