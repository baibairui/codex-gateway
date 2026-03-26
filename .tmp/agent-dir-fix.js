const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const agentsRoot = '/opt/gateway/.data/agents';
const usersRoot = path.join(agentsRoot, 'users');
const sessionsDbPath = '/opt/gateway/.data/sessions.db';
const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const backupDir = `/opt/deploy-backups/agent-dir-fix-${ts}`;

function resolveUserDirFromWorkspace(workspaceDir) {
  const normalized = path.resolve(workspaceDir);
  const parent = path.dirname(normalized);
  const parentBase = path.basename(parent);
  if (parentBase === 'agents' || parentBase === 'internal') {
    return path.dirname(parent);
  }
  return parent;
}

function resolveCanonicalWorkspaceDir(workspaceDir, agentId) {
  return path.join(resolveUserDirFromWorkspace(workspaceDir), 'agents', agentId);
}

fs.mkdirSync(backupDir, { recursive: true });
execFileSync('tar', ['-czf', path.join(backupDir, 'agents-users.tgz'), '-C', agentsRoot, 'users'], { stdio: 'inherit' });
fs.copyFileSync(sessionsDbPath, path.join(backupDir, 'sessions.db'));

try {
  execFileSync('node', ['/opt/gateway/dist/scripts/repair-users.js'], { stdio: 'inherit' });
} catch (error) {
  console.error('repair-users failed before db sync');
  throw error;
}

const db = new DatabaseSync(sessionsDbPath);
const rows = db.prepare('SELECT user_id AS userId, agent_id AS agentId, workspace_dir AS workspaceDir FROM user_agent ORDER BY user_id, agent_id').all();
const updateStmt = db.prepare('UPDATE user_agent SET workspace_dir = ?, updated_at = ? WHERE user_id = ? AND agent_id = ?');
const now = Date.now();

let moved = 0;
let updated = 0;
let conflicts = 0;

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
    console.log(`CONFLICT\t${row.userId}\t${row.agentId}\t${currentDir}\t${targetDir}`);
    continue;
  }

  if (fs.existsSync(targetDir)) {
    updateStmt.run(targetDir, now, row.userId, row.agentId);
    updated += 1;
    console.log(`UPDATED\t${row.userId}\t${row.agentId}\t${targetDir}`);
  }
}

const orphanProjectDir = path.join(agentsRoot, 'codex-gateway');
if (fs.existsSync(orphanProjectDir)) {
  const quarantineRoot = '/opt/deploy-backups/agent-dir-orphans';
  fs.mkdirSync(quarantineRoot, { recursive: true });
  const target = path.join(quarantineRoot, `codex-gateway-${Date.now()}`);
  fs.renameSync(orphanProjectDir, target);
  console.log(`QUARANTINED\t${orphanProjectDir}\t${target}`);
}

console.log(`BACKUP_DIR\t${backupDir}`);
console.log(`MOVED_COUNT\t${moved}`);
console.log(`UPDATED_COUNT\t${updated}`);
console.log(`CONFLICT_COUNT\t${conflicts}`);
