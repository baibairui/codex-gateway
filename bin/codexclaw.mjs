#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const cliFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(cliFile), '..');
const invokedCwd = process.cwd();

function isGatewayProject(dir) {
  return fs.existsSync(path.join(dir, 'package.json'))
    && fs.existsSync(path.join(dir, 'bin', 'start-gateway.mjs'))
    && fs.existsSync(path.join(dir, 'src', 'server.ts'));
}

const runtimeRoot = isGatewayProject(invokedCwd) ? invokedCwd : projectRoot;
process.chdir(runtimeRoot);
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

function run(bin, binArgs) {
  const child = spawn(bin, binArgs, {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function printHelp() {
  console.log(`
codexclaw <command>

Commands:
  up            启动（开发模式，启动前自动配置检查）
  dev           同 up
  start         生产启动（启动前自动配置检查）
  setup         逐行交互配置向导（写入 .env）
  check         仅执行配置检查
  doctor        同 check，更适合做安装自检
  update        拉取远程最新代码并更新依赖/构建
  build         执行构建
  test          执行测试
  help          查看帮助
`.trim());
}

switch (command) {
  case 'up':
  case 'dev':
    run('node', ['./bin/start-gateway.mjs', 'dev']);
    break;
  case 'start':
    run('node', ['./bin/start-gateway.mjs', 'start']);
    break;
  case 'setup':
    run('node', ['./bin/setup-wizard.mjs']);
    break;
  case 'check':
  case 'doctor':
    run('node', ['./bin/config-check.mjs']);
    break;
  case 'update':
    run('node', ['./bin/update-gateway.mjs']);
    break;
  case 'build':
    run(npmBin, ['run', 'build']);
    break;
  case 'test':
    run(npmBin, ['run', 'test']);
    break;
  case 'help':
  default:
    printHelp();
    process.exit(command === 'help' ? 0 : 1);
}
