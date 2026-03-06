import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface AgentWorkspaceRecord {
  agentId: string;
  workspaceDir: string;
}

interface CreateAgentWorkspaceInput {
  userId: string;
  agentName: string;
  existingAgentIds: string[];
}

export class AgentWorkspaceManager {
  private readonly rootDir: string;
  private readonly globalMemoryDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.globalMemoryDir = path.join(this.rootDir, 'global-memory');
    this.ensureGlobalMemory();
  }

  createWorkspace(input: CreateAgentWorkspaceInput): AgentWorkspaceRecord {
    this.ensureGlobalMemory();

    const agentId = createUniqueAgentId(input.agentName, input.existingAgentIds);
    const workspaceDir = path.join(this.resolveUserDir(input.userId), agentId);

    fs.mkdirSync(path.join(workspaceDir, 'memory'), { recursive: true });

    this.writeIfMissing(
      path.join(workspaceDir, 'AGENTS.md'),
      renderWorkspaceAgentsMd(input.agentName, agentId, path.relative(workspaceDir, this.globalMemoryDir)),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'agent.md'),
      renderAgentMd(input.agentName, agentId),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'profile.md'),
      '# Agent Profile\n\n- 角色定位：\n- 擅长领域：\n- 目标用户：\n',
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'context.md'),
      '# Working Context\n\n- 当前项目：\n- 关键约束：\n- 长期目标：\n',
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'notes.md'),
      '# Durable Notes\n\n- 记录需要跨会话保留的稳定事实。\n',
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'README.md'),
      renderWorkspaceReadme(input.agentName, agentId),
    );

    return {
      agentId,
      workspaceDir,
    };
  }

  private ensureGlobalMemory(): void {
    fs.mkdirSync(this.globalMemoryDir, { recursive: true });

    this.writeIfMissing(
      path.join(this.globalMemoryDir, 'README.md'),
      [
        '# Global Memory',
        '',
        '这里存放所有 agent 共享的长期记忆。',
        '- `shared-context.md`：跨 agent 的业务背景和术语',
        '- `engineering-rules.md`：团队共用工程约束',
        '',
      ].join('\n'),
    );
    this.writeIfMissing(
      path.join(this.globalMemoryDir, 'shared-context.md'),
      '# Shared Context\n\n- 产品背景：\n- 常用术语：\n- 共享依赖：\n',
    );
    this.writeIfMissing(
      path.join(this.globalMemoryDir, 'engineering-rules.md'),
      '# Engineering Rules\n\n- 通用编码规范：\n- 交付原则：\n- 风险边界：\n',
    );
  }

  private resolveUserDir(userId: string): string {
    const digest = shortHash(userId);
    const slug = toSlug(userId, 'user');
    return path.join(this.rootDir, 'users', `${slug}-${digest}`);
  }

  private writeIfMissing(filePath: string, content: string): void {
    if (fs.existsSync(filePath)) {
      return;
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function renderWorkspaceAgentsMd(agentName: string, agentId: string, relativeGlobalDir: string): string {
  const globalDir = normalizeRelativeDir(relativeGlobalDir);
  return [
    `# AGENTS.md`,
    '',
    `当前工作区属于 agent \`${agentName}\`（ID: \`${agentId}\`）。`,
    '',
    '开始任何任务前，先阅读这些记忆文件：',
    '- `./agent.md`',
    '- `./memory/profile.md`',
    '- `./memory/context.md`',
    '- `./memory/notes.md`',
    `- \`${globalDir}/shared-context.md\``,
    `- \`${globalDir}/engineering-rules.md\``,
    '',
    '工作规则：',
    '- 这些 markdown 文件是长期记忆，做决策前先对齐。',
    '- 如果有可复用、跨会话稳定的信息，请更新到对应 memory 文件，而不是只留在当前对话里。',
    '- agent 专属记忆写入 `./memory/`，所有 agent 共享的记忆写入全局 memory 目录。',
    '',
  ].join('\n');
}

function renderAgentMd(agentName: string, agentId: string): string {
  return [
    '# Agent Memory Index',
    '',
    `- Agent Name: ${agentName}`,
    `- Agent ID: ${agentId}`,
    '- Workspace Purpose:',
    '- Primary Goals:',
    '- Owner Notes:',
    '',
    '把需要长期保留的信息沉淀到 `memory/` 目录中的 markdown 文件。',
    '',
  ].join('\n');
}

function renderWorkspaceReadme(agentName: string, agentId: string): string {
  return [
    `# ${agentName}`,
    '',
    `这个目录是 agent \`${agentId}\` 的独立工作空间。`,
    '',
    '建议：',
    '- 项目代码直接放在当前目录或其子目录。',
    '- 长期记忆维护在 `agent.md` 与 `memory/*.md`。',
    '- 跨 agent 共享的知识维护在上层 `global-memory/`。',
    '',
  ].join('\n');
}

function createUniqueAgentId(name: string, existingAgentIds: string[]): string {
  const base = toSlug(name, 'agent');
  const existing = new Set(existingAgentIds);
  if (!existing.has(base)) {
    return base;
  }
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

function toSlug(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 8);
}

function normalizeRelativeDir(relativeDir: string): string {
  const normalized = relativeDir.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}
