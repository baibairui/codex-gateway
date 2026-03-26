import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { AgentWorkspaceManager } from '../services/agent-workspace-manager.js';
import { installFeishuCanvasSkill } from '../services/feishu-canvas-skill.js';
import { installFeishuOfficialOpsSkill } from '../services/feishu-official-ops-skill.js';
import { installGatewayBrowserSkill } from '../services/gateway-browser-skill.js';
import { installReminderToolSkill } from '../services/reminder-tool-skill.js';

interface RepairStats {
  users: number;
  workspaces: number;
  skipped: number;
  repairedDefaultWorkdir: boolean;
  repairedConfiguredWorkdir: boolean;
  syncedWorkspaceDirs: number;
  movedLegacyWorkspaceDirs: number;
  workspaceDirConflicts: number;
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
  fs.mkdirSync(workspaceDir, { recursive: true });
  installGatewayBrowserSkill(workspaceDir);
  installReminderToolSkill(workspaceDir);
  installFeishuOfficialOpsSkill(workspaceDir);
  installFeishuCanvasSkill(workspaceDir);
}

function listUserWorkspaceDirs(userDir: string): string[] {
  const output: string[] = [];
  const agentsDir = path.join(userDir, 'agents');
  if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
    for (const workspaceName of fs.readdirSync(agentsDir)) {
      const workspaceDir = path.join(agentsDir, workspaceName);
      if (fs.statSync(workspaceDir).isDirectory()) {
        output.push(workspaceDir);
      }
    }
  }

  for (const workspaceName of fs.readdirSync(userDir)) {
    if (workspaceName === 'agents' || workspaceName === 'internal' || workspaceName === 'shared-memory' || workspaceName === '_memory-steward' || workspaceName === '_legacy') {
      continue;
    }
    const workspaceDir = path.join(userDir, workspaceName);
    if (!fs.statSync(workspaceDir).isDirectory()) {
      continue;
    }
    output.push(workspaceDir);
  }

  return Array.from(new Set(output.map((dir) => path.resolve(dir))));
}

function tryEnsureDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function resolveUserDirFromWorkspace(workspaceDir: string): string {
  const normalized = path.resolve(workspaceDir);
  const parent = path.dirname(normalized);
  const parentBase = path.basename(parent);
  if (parentBase === 'agents' || parentBase === 'internal') {
    return path.dirname(parent);
  }
  return parent;
}

function resolveCanonicalWorkspaceDir(workspaceDir: string, agentId: string): string {
  return path.join(resolveUserDirFromWorkspace(workspaceDir), 'agents', agentId);
}

function syncSessionWorkspaceDirs(dbPath: string): {
  synced: number;
  moved: number;
  conflicts: number;
} {
  if (!fs.existsSync(dbPath)) {
    return { synced: 0, moved: 0, conflicts: 0 };
  }

  const db = new DatabaseSync(dbPath);
  const rows = db
    .prepare('SELECT user_id AS userId, agent_id AS agentId, workspace_dir AS workspaceDir FROM user_agent')
    .all() as Array<{ userId: string; agentId: string; workspaceDir: string }>;
  const updateStmt = db.prepare(`
    UPDATE user_agent
    SET workspace_dir = ?, updated_at = ?
    WHERE user_id = ? AND agent_id = ?
  `);

  let synced = 0;
  let moved = 0;
  let conflicts = 0;
  const now = Date.now();

  for (const row of rows) {
    const currentDir = path.resolve(row.workspaceDir);
    const targetDir = resolveCanonicalWorkspaceDir(currentDir, row.agentId);
    if (currentDir === targetDir) {
      continue;
    }

    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    const currentExists = fs.existsSync(currentDir);
    const targetExists = fs.existsSync(targetDir);

    if (currentExists && !targetExists) {
      fs.renameSync(currentDir, targetDir);
      moved += 1;
    } else if (currentExists && targetExists) {
      conflicts += 1;
      continue;
    }

    if (fs.existsSync(targetDir)) {
      updateStmt.run(targetDir, now, row.userId, row.agentId);
      synced += 1;
    }
  }

  return { synced, moved, conflicts };
}

function run(): void {
  const agentsDir = resolveAgentsDir();
  fs.mkdirSync(agentsDir, { recursive: true });
  // 初始化全局 memory 骨架，保证目录结构存在。
  const workspaceManager = new AgentWorkspaceManager(agentsDir);

  // 修复默认工作区（占位 default 所在根目录）的内置技能和规则。
  repairWorkspace(agentsDir);
  workspaceManager.repairWorkspaceScaffold(agentsDir);

  const usersDir = path.join(agentsDir, 'users');
  if (!fs.existsSync(usersDir)) {
    process.stdout.write(`repair:users done (agentsDir=${agentsDir}, users=0, workspaces=0)\n`);
    return;
  }

  const stats: RepairStats = {
    users: 0,
    workspaces: 0,
    skipped: 0,
    repairedDefaultWorkdir: false,
    repairedConfiguredWorkdir: false,
    syncedWorkspaceDirs: 0,
    movedLegacyWorkspaceDirs: 0,
    workspaceDirConflicts: 0,
  };

  const defaultWorkdir = path.resolve(agentsDir);
  stats.repairedDefaultWorkdir = tryEnsureDir(defaultWorkdir);
  const configuredWorkdirRaw = process.env.CODEX_WORKDIR?.trim();
  if (configuredWorkdirRaw) {
    stats.repairedConfiguredWorkdir = tryEnsureDir(path.resolve(configuredWorkdirRaw));
  }

  for (const userDirName of fs.readdirSync(usersDir)) {
    const userDir = path.join(usersDir, userDirName);
    if (!fs.statSync(userDir).isDirectory()) {
      continue;
    }
    stats.users += 1;
    workspaceManager.repairUserSharedMemoryTree(userDir);

    for (const workspaceDir of listUserWorkspaceDirs(userDir)) {
      repairWorkspace(workspaceDir);
      workspaceManager.repairWorkspaceScaffold(workspaceDir);
      stats.workspaces += 1;
    }
  }

  const syncStats = syncSessionWorkspaceDirs(path.resolve(process.cwd(), '.data', 'sessions.db'));
  stats.syncedWorkspaceDirs = syncStats.synced;
  stats.movedLegacyWorkspaceDirs = syncStats.moved;
  stats.workspaceDirConflicts = syncStats.conflicts;

  process.stdout.write(
    `repair:users done (agentsDir=${agentsDir}, users=${stats.users}, workspaces=${stats.workspaces}, skipped=${stats.skipped}, defaultWorkdirReady=${stats.repairedDefaultWorkdir}, configuredWorkdirReady=${stats.repairedConfiguredWorkdir}, syncedWorkspaceDirs=${stats.syncedWorkspaceDirs}, movedLegacyWorkspaceDirs=${stats.movedLegacyWorkspaceDirs}, workspaceDirConflicts=${stats.workspaceDirConflicts})\n`,
  );
}

run();
