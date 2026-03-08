import fs from 'node:fs';
import path from 'node:path';

import { AgentWorkspaceManager } from '../services/agent-workspace-manager.js';
import { installFeishuOfficialOpsSkill } from '../services/feishu-official-ops-skill.js';
import { installReminderToolSkill } from '../services/reminder-tool-skill.js';

interface RepairStats {
  users: number;
  workspaces: number;
  skipped: number;
}

function resolveAgentsDir(): string {
  const configured = process.env.CODEX_AGENTS_DIR?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  }
  return path.resolve(process.cwd(), '.data', 'agents');
}

function repairWorkspace(workspaceDir: string): void {
  installReminderToolSkill(workspaceDir);
  installFeishuOfficialOpsSkill(workspaceDir);
}

function run(): void {
  const agentsDir = resolveAgentsDir();
  fs.mkdirSync(agentsDir, { recursive: true });
  // 初始化全局 memory 骨架，保证目录结构存在。
  void new AgentWorkspaceManager(agentsDir);

  // 修复默认工作区（占位 default 所在根目录）的内置技能和规则。
  repairWorkspace(agentsDir);

  const usersDir = path.join(agentsDir, 'users');
  if (!fs.existsSync(usersDir)) {
    process.stdout.write(`repair:users done (agentsDir=${agentsDir}, users=0, workspaces=0)\n`);
    return;
  }

  const stats: RepairStats = {
    users: 0,
    workspaces: 0,
    skipped: 0,
  };

  for (const userDirName of fs.readdirSync(usersDir)) {
    const userDir = path.join(usersDir, userDirName);
    if (!fs.statSync(userDir).isDirectory()) {
      continue;
    }
    stats.users += 1;

    for (const workspaceName of fs.readdirSync(userDir)) {
      if (workspaceName === 'shared-memory' || workspaceName === '_memory-steward') {
        continue;
      }
      const workspaceDir = path.join(userDir, workspaceName);
      if (!fs.statSync(workspaceDir).isDirectory()) {
        stats.skipped += 1;
        continue;
      }
      repairWorkspace(workspaceDir);
      stats.workspaces += 1;
    }
  }

  process.stdout.write(
    `repair:users done (agentsDir=${agentsDir}, users=${stats.users}, workspaces=${stats.workspaces}, skipped=${stats.skipped})\n`,
  );
}

run();
