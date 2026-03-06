import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface AgentWorkspaceRecord {
  agentId: string;
  workspaceDir: string;
}

export interface SystemMemoryStewardWorkspaceRecord {
  workspaceDir: string;
  sharedMemoryDir: string;
}

interface CreateAgentWorkspaceInput {
  userId: string;
  agentName: string;
  existingAgentIds: string[];
  template?: 'default' | 'memory-onboarding';
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
    const userDir = this.resolveUserDir(input.userId);
    const sharedMemoryDir = this.ensureUserSharedMemory(userDir);
    const workspaceDir = path.join(userDir, agentId);
    const template = input.template ?? 'default';

    fs.mkdirSync(path.join(workspaceDir, 'memory', 'daily'), { recursive: true });

    this.writeIfMissing(
      path.join(workspaceDir, 'AGENTS.md'),
      renderWorkspaceAgentsMd(
        input.agentName,
        agentId,
        path.relative(workspaceDir, this.globalMemoryDir),
        path.relative(workspaceDir, sharedMemoryDir),
        template,
      ),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'agent.md'),
      renderAgentMd(input.agentName, agentId, template),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'profile.md'),
      renderProfileMemory(),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'preferences.md'),
      renderPreferencesMemory(),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'projects.md'),
      renderProjectsMemory(),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'relationships.md'),
      renderRelationshipsMemory(),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'decisions.md'),
      renderDecisionsMemory(),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'open-loops.md'),
      renderOpenLoopsMemory(),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'memory', 'daily', 'README.md'),
      renderDailyMemoryReadme(),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'README.md'),
      renderWorkspaceReadme(input.agentName, agentId, template),
    );
    if (template === 'memory-onboarding') {
      this.writeIfMissing(
        path.join(workspaceDir, 'memory-init-checklist.md'),
        renderMemoryInitChecklist(),
      );
    }

    return {
      agentId,
      workspaceDir,
    };
  }

  isSharedMemoryEmpty(userId: string): boolean {
    const userDir = this.resolveUserDir(userId);
    const sharedMemoryDir = this.ensureUserSharedMemory(userDir);
    const files = [
      'profile.md',
      'preferences.md',
      'projects.md',
      'relationships.md',
      'decisions.md',
      'open-loops.md',
    ];
    for (const fileName of files) {
      const filePath = path.join(sharedMemoryDir, fileName);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      if (hasMeaningfulMemoryContent(content)) {
        return false;
      }
    }
    return true;
  }

  ensureSystemMemoryStewardWorkspace(userId: string): SystemMemoryStewardWorkspaceRecord {
    this.ensureGlobalMemory();

    const userDir = this.resolveUserDir(userId);
    const sharedMemoryDir = this.ensureUserSharedMemory(userDir);
    const workspaceDir = path.join(userDir, '_memory-steward');
    fs.mkdirSync(workspaceDir, { recursive: true });

    this.writeIfMissing(
      path.join(workspaceDir, 'AGENTS.md'),
      renderSystemMemoryStewardAgentsMd(
        path.relative(workspaceDir, this.globalMemoryDir),
        path.relative(workspaceDir, sharedMemoryDir),
      ),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'agent.md'),
      renderSystemMemoryStewardAgentMd(),
    );
    this.writeIfMissing(
      path.join(workspaceDir, 'README.md'),
      renderSystemMemoryStewardReadme(),
    );

    return {
      workspaceDir,
      sharedMemoryDir,
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
        '- `house-rules.md`：所有 personal agent 共用的行为规则',
        '',
      ].join('\n'),
    );
    this.writeIfMissing(
      path.join(this.globalMemoryDir, 'shared-context.md'),
      '# Shared Context\n\n- 用户背景：\n- 常用术语：\n- 共用约束：\n',
    );
    this.writeIfMissing(
      path.join(this.globalMemoryDir, 'house-rules.md'),
      [
        '# House Rules',
        '',
        '- 默认优先保护用户隐私，高敏感信息不要自动写入长期记忆。',
        '- 只有跨会话稳定、未来还值得再读的信息，才进入长期记忆。',
        '- 用户明确要求“记住这个”时，应优先考虑写入对应 memory 文件。',
        '- 临时情绪、一次性细节、过期安排写入 daily 目录或直接丢弃。',
        '',
      ].join('\n'),
    );
  }

  private resolveUserDir(userId: string): string {
    const digest = shortHash(userId);
    const slug = toSlug(userId, 'user');
    return path.join(this.rootDir, 'users', `${slug}-${digest}`);
  }

  private ensureUserSharedMemory(userDir: string): string {
    const sharedMemoryDir = path.join(userDir, 'shared-memory');
    fs.mkdirSync(path.join(sharedMemoryDir, 'daily'), { recursive: true });

    this.writeIfMissing(path.join(sharedMemoryDir, 'profile.md'), renderProfileMemory());
    this.writeIfMissing(path.join(sharedMemoryDir, 'preferences.md'), renderPreferencesMemory());
    this.writeIfMissing(path.join(sharedMemoryDir, 'projects.md'), renderProjectsMemory());
    this.writeIfMissing(path.join(sharedMemoryDir, 'relationships.md'), renderRelationshipsMemory());
    this.writeIfMissing(path.join(sharedMemoryDir, 'decisions.md'), renderDecisionsMemory());
    this.writeIfMissing(path.join(sharedMemoryDir, 'open-loops.md'), renderOpenLoopsMemory());
    this.writeIfMissing(path.join(sharedMemoryDir, 'daily', 'README.md'), renderDailyMemoryReadme());
    this.writeIfMissing(
      path.join(sharedMemoryDir, 'README.md'),
      [
        '# Shared Memory',
        '',
        '这个目录保存同一用户下多个 agent 共享的长期记忆。',
        '- `profile.md`: 用户稳定画像',
        '- `preferences.md`: 用户偏好和表达习惯',
        '- `projects.md`: 长期项目与状态',
        '- `relationships.md`: 长期重要关系',
        '- `decisions.md`: 已确认的重要决定',
        '- `open-loops.md`: 尚未闭环但未来要继续跟进的事',
        '- `daily/`: 等待系统记忆管家整理的短期上下文',
        '',
      ].join('\n'),
    );

    return sharedMemoryDir;
  }

  private writeIfMissing(filePath: string, content: string): void {
    if (fs.existsSync(filePath)) {
      return;
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function renderWorkspaceAgentsMd(
  agentName: string,
  agentId: string,
  relativeGlobalDir: string,
  relativeSharedDir: string,
  template: 'default' | 'memory-onboarding',
): string {
  const globalDir = normalizeRelativeDir(relativeGlobalDir);
  const sharedDir = normalizeRelativeDir(relativeSharedDir);
  const onboardingRules = template === 'memory-onboarding'
    ? [
        '初始化职责：',
        '- 你不是通用助手；你的主要职责是引导用户完成记忆初始化。',
        '- 必须分轮次提问，每轮最多 3 个问题，等待用户回答后再继续。',
        '- 每轮总结并写入 shared-memory 对应文件，再继续下一轮。',
        '- 遇到敏感信息先确认“是否写入长期记忆”。',
        '',
      ]
    : [];
  return [
    `# AGENTS.md`,
    '',
    `当前工作区属于 agent \`${agentName}\`（ID: \`${agentId}\`）。`,
    '',
    ...onboardingRules,
    '开始任何任务前，先阅读这些记忆文件：',
    '- `./agent.md`',
    '- `./memory/profile.md`',
    '- `./memory/preferences.md`',
    '- `./memory/projects.md`',
    '- `./memory/relationships.md`',
    '- `./memory/decisions.md`',
    '- `./memory/open-loops.md`',
    `- \`${sharedDir}/profile.md\``,
    `- \`${sharedDir}/preferences.md\``,
    `- \`${sharedDir}/projects.md\``,
    `- \`${sharedDir}/relationships.md\``,
    `- \`${sharedDir}/decisions.md\``,
    `- \`${sharedDir}/open-loops.md\``,
    `- \`${globalDir}/shared-context.md\``,
    `- \`${globalDir}/house-rules.md\``,
    '',
    '记忆规则：',
    '- `memory/daily/YYYY-MM-DD.md` 用于记录当天短期上下文和临时笔记。',
    `- \`${sharedDir}/daily/YYYY-MM-DD.md\` 用于沉淀跨 agent 的用户短期上下文，供系统记忆管家整理。`,
    '- 只有跨会话稳定、未来还值得再读的信息，才写入长期记忆文件。',
    '- 用户明确说“记住这个”时，应判断归档到哪个 memory 文件；高敏感信息先征求确认。',
    '- `profile/preferences/projects/relationships` 适合结构化更新；`decisions/open-loops` 适合按条目维护。',
    '- agent 专属记忆写入 `./memory/`，所有 agent 共享的记忆写入全局 memory 目录。',
    '',
  ].join('\n');
}

function renderAgentMd(agentName: string, agentId: string, template: 'default' | 'memory-onboarding'): string {
  const role = template === 'memory-onboarding'
    ? '- Role: Memory Onboarding Guide'
    : '- Role:';
  const goals = template === 'memory-onboarding'
    ? '- Primary Goals: Guide the user to initialize shared-memory with confirmed facts and preferences'
    : '- Primary Goals:';
  const boundaries = template === 'memory-onboarding'
    ? '- Boundaries: Ask before writing sensitive details; keep each round short and structured'
    : '- Boundaries:';
  return [
    '# Agent Memory Index',
    '',
    `- Agent Name: ${agentName}`,
    `- Agent ID: ${agentId}`,
    role,
    goals,
    boundaries,
    '- Notes:',
    '',
    '记忆地图：',
    '- `memory/profile.md`: 用户稳定画像',
    '- `memory/preferences.md`: 用户偏好和表达习惯',
    '- `memory/projects.md`: 长期项目与状态',
    '- `memory/relationships.md`: 长期重要关系',
    '- `memory/decisions.md`: 已确认的重要决定',
    '- `memory/open-loops.md`: 尚未闭环但未来要继续跟进的事',
    '- `memory/daily/`: 当天短期上下文与临时笔记',
    '',
  ].join('\n');
}

function renderWorkspaceReadme(agentName: string, agentId: string, template: 'default' | 'memory-onboarding'): string {
  const tips = template === 'memory-onboarding'
    ? [
        '- 该 agent 用于一次性或阶段性初始化 shared-memory。',
        '- 使用 `memory-init-checklist.md` 跟踪初始化进度。',
        '- 每轮提问后都要把已确认信息写入 shared-memory。',
      ]
    : [
        '- 用户的长期稳定信息维护在 `memory/*.md`。',
        '- 当天短期上下文和临时笔记维护在 `memory/daily/`。',
        '- 跨 agent 共享的知识和规则维护在上层 `global-memory/`。',
      ];
  return [
    `# ${agentName}`,
    '',
    `这个目录是 agent \`${agentId}\` 的独立工作空间。`,
    '',
    '建议：',
    '- 项目代码直接放在当前目录或其子目录。',
    ...tips,
    '',
  ].join('\n');
}

function renderMemoryInitChecklist(): string {
  return [
    '# Memory Init Checklist',
    '',
    '## Progress',
    '- [ ] Round 1: Profile (name, roles, timezone, long-term goals)',
    '- [ ] Round 2: Preferences (language, response style, work style)',
    '- [ ] Round 3: Projects (active projects, goals, constraints, next steps)',
    '- [ ] Round 4: Relationships (important people and communication notes)',
    '- [ ] Round 5: Decisions & Open Loops',
    '',
    '## Safety',
    '- [ ] Sensitive items were explicitly confirmed before writing to shared-memory',
    '',
    '## Notes',
    '-',
    '',
  ].join('\n');
}

function renderSystemMemoryStewardAgentsMd(relativeGlobalDir: string, relativeSharedDir: string): string {
  const globalDir = normalizeRelativeDir(relativeGlobalDir);
  const sharedDir = normalizeRelativeDir(relativeSharedDir);
  return [
    '# AGENTS.md',
    '',
    '你是系统默认的 Memory Steward。这个工作区不由最终用户直接操作。',
    '',
    '职责：',
    '- 定期检查同一用户下的 shared-memory 与各 agent memory 目录。',
    '- 将跨会话稳定、低噪声的信息整理进 shared-memory 长期记忆文件。',
    '- 将高敏感信息标记到 `steward-log.md`，等待用户确认，不要直接写入长期记忆。',
    '- 把只适合短期保留的信息留在 daily 目录，不要污染长期记忆。',
    '',
    '开始任务前，先阅读这些文件：',
    '- `./agent.md`',
    `- \`${sharedDir}/README.md\``,
    `- \`${sharedDir}/profile.md\``,
    `- \`${sharedDir}/preferences.md\``,
    `- \`${sharedDir}/projects.md\``,
    `- \`${sharedDir}/relationships.md\``,
    `- \`${sharedDir}/decisions.md\``,
    `- \`${sharedDir}/open-loops.md\``,
    `- \`${sharedDir}/daily/README.md\``,
    `- \`${globalDir}/shared-context.md\``,
    `- \`${globalDir}/house-rules.md\``,
    '',
    '工作规则：',
    '- 优先整理 shared-memory，必要时参考同级 agent 目录下的 `memory/` 文件。',
    '- 不要创建面向用户的会话式回答；你的产出应是对 memory 文件的直接修改。',
    '- 每次运行后把做过的整理、跳过的高敏感项、待确认项记录到 `./steward-log.md`。',
    '',
  ].join('\n');
}

function renderSystemMemoryStewardAgentMd(): string {
  return [
    '# System Memory Steward',
    '',
    '- Role: System Memory Steward',
    '- Primary Goals: Keep shared-memory current, low-noise, privacy-aware, and useful across sessions',
    '- Boundaries: Do not act as a general-purpose assistant; only maintain memory artifacts',
    '- Inputs: user shared-memory, sibling agent memory files, global house rules',
    '- Outputs: updated shared-memory markdown files and steward-log.md',
    '',
  ].join('\n');
}

function renderSystemMemoryStewardReadme(): string {
  return [
    '# Memory Steward Workspace',
    '',
    '这个目录属于系统后台任务，不面向最终用户。',
    '定时任务会在这里运行 Codex，用于整理当前用户的 shared-memory。 ',
    '',
  ].join('\n');
}

function renderProfileMemory(): string {
  return [
    '# Profile',
    '',
    '## Identity',
    '- Preferred name:',
    '- Primary roles:',
    '- Timezone:',
    '',
    '## Long-term Goals',
    '-',
    '',
    '## Stable Facts',
    '-',
    '',
  ].join('\n');
}

function renderPreferencesMemory(): string {
  return [
    '# Preferences',
    '',
    '## Language',
    '- Default language:',
    '',
    '## Response Style',
    '-',
    '',
    '## Work Style',
    '-',
    '',
    '## Personal Preferences',
    '-',
    '',
  ].join('\n');
}

function renderProjectsMemory(): string {
  return [
    '# Projects',
    '',
    '## Active Projects',
    '- Name:',
    '  Goal:',
    '  Status:',
    '  Constraints:',
    '  Next step:',
    '',
  ].join('\n');
}

function renderRelationshipsMemory(): string {
  return [
    '# Relationships',
    '',
    '> 只记录跨会话有价值、且适合长期保存的信息。高敏感信息先征求用户确认。',
    '',
    '## Important People',
    '- Name:',
    '  Relationship:',
    '  Context:',
    '  Communication notes:',
    '',
  ].join('\n');
}

function renderDecisionsMemory(): string {
  return [
    '# Decisions',
    '',
    '## Confirmed Decisions',
    '- Date:',
    '  Decision:',
    '  Reason:',
    '  Impact:',
    '',
  ].join('\n');
}

function renderOpenLoopsMemory(): string {
  return [
    '# Open Loops',
    '',
    '## Pending',
    '- Item:',
    '  Status:',
    '  Next step:',
    '  Due:',
    '  Source:',
    '',
  ].join('\n');
}

function renderDailyMemoryReadme(): string {
  return [
    '# Daily Memory',
    '',
    '在这个目录里按日期创建短期记忆文件，例如 `2026-03-06.md`。',
    '适合记录：当天上下文、临时事项、零散发现、尚未整理进长期记忆的内容。',
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

function hasMeaningfulMemoryContent(content: string): boolean {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('>')) {
      continue;
    }
    if (line === '-' || line.startsWith('- [ ]')) {
      continue;
    }
    if (/: +\S/.test(line)) {
      return true;
    }
    if (/^-\s+\S/.test(line) && !line.endsWith(':')) {
      return true;
    }
  }
  return false;
}
