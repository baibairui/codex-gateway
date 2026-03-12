#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const c = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function paint(color, text) {
  return `${color}${text}${c.reset}`;
}

function run(command, args, title) {
  if (title) {
    console.log(paint(c.cyan, `\n[${title}]`));
  }
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(paint(c.red, `命令执行失败: ${command} ${args.join(' ')}`));
    process.exit(result.status ?? 1);
  }
}

function runWithOutput(command, args) {
  return spawnSync(command, args, {
    stdio: 'pipe',
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
}

console.log(paint(c.bold, '=== codexclaw update ==='));

const gitCheck = runWithOutput('git', ['rev-parse', '--is-inside-work-tree']);
if (gitCheck.status !== 0 || String(gitCheck.stdout).trim() !== 'true') {
  console.error(paint(c.red, '当前目录不是 git 仓库，无法执行更新。'));
  process.exit(1);
}

const branchResult = runWithOutput('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branchResult.status !== 0) {
  console.error(paint(c.red, '无法识别当前分支。'));
  process.exit(1);
}
const currentBranch = String(branchResult.stdout).trim() || 'master';

console.log(paint(c.yellow, `当前分支: ${currentBranch}`));

run('git', ['fetch', '--all', '--prune'], '同步远端信息');
run('git', ['pull', '--ff-only', 'origin', currentBranch], '拉取最新代码');
run(npmBin, ['install'], '更新依赖');
run(npmBin, ['run', 'build'], '重新构建');

console.log(paint(c.green, '\n✅ 更新完成。'));
console.log('如服务正在运行，请重启服务使新版本生效。');
