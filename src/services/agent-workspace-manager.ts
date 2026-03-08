import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installReminderToolSkill } from './reminder-tool-skill.js';

export interface AgentWorkspaceRecord {
  agentId: string;
  workspaceDir: string;
}

export interface SystemMemoryStewardWorkspaceRecord {
  workspaceDir: string;
  sharedMemoryDir: string;
}

export interface SharedMemorySnapshot {
  sharedMemoryDir: string;
  identityContent: string;
  identityVersion: string;
  hasIdentity: boolean;
}

interface CreateAgentWorkspaceInput {
  userId: string;
  agentName: string;
  existingAgentIds: string[];
  template?: 'default' | 'memory-onboarding' | 'skill-onboarding';
}

const MEMORY_ONBOARDING_AGENT_ID = 'memory-onboarding';
const SKILL_ONBOARDING_AGENT_ID = 'skill-onboarding';

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

    const agentId = resolveAgentId(input);
    const userDir = this.resolveUserDir(input.userId);
    const sharedMemoryDir = this.ensureUserSharedMemory(userDir);
    const workspaceDir = path.join(userDir, agentId);
    const template = input.template ?? 'default';
    const initialIdentityContent = this.resolveInitialAgentIdentityContent(
      sharedMemoryDir,
      input.agentName,
      agentId,
      template,
    );

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
      path.join(workspaceDir, 'memory', 'identity.md'),
      initialIdentityContent,
    );
    this.upgradeIdentityTemplateFile(path.join(workspaceDir, 'memory', 'identity.md'));
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
    if (template === 'skill-onboarding') {
      this.writeIfMissing(
        path.join(workspaceDir, 'skill-install-checklist.md'),
        renderSkillInstallChecklist(),
      );
    }
    this.writeIfMissing(
      path.join(workspaceDir, 'browser-playbook.md'),
      renderBrowserPlaybook(),
    );
    installReminderToolSkill(workspaceDir);

    return {
      agentId,
      workspaceDir,
    };
  }

  isSharedMemoryEmpty(userId: string): boolean {
    const userDir = this.resolveUserDir(userId);
    const sharedMemoryDir = this.ensureUserSharedMemory(userDir);
    const files = [
      'identity.md',
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

  isWorkspaceIdentityEmpty(workspaceDir: string): boolean {
    const identityPath = path.join(workspaceDir, 'memory', 'identity.md');
    if (!fs.existsSync(identityPath)) {
      return true;
    }
    const content = fs.readFileSync(identityPath, 'utf8');
    return !hasMeaningfulMemoryContent(content);
  }

  getSharedMemorySnapshot(userId: string): SharedMemorySnapshot {
    const userDir = this.resolveUserDir(userId);
    const sharedMemoryDir = this.ensureUserSharedMemory(userDir);
    const identityPath = path.join(sharedMemoryDir, 'identity.md');
    const identityContent = fs.existsSync(identityPath)
      ? fs.readFileSync(identityPath, 'utf8')
      : renderIdentityMemory();
    const normalized = normalizeIdentityText(identityContent);
    return {
      sharedMemoryDir,
      identityContent,
      identityVersion: normalized
        ? createHash('sha1').update(normalized).digest('hex').slice(0, 16)
        : 'empty',
      hasIdentity: !!normalized,
    };
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
    this.writeIfMissing(path.join(sharedMemoryDir, 'identity.md'), renderIdentityMemory());
    this.upgradeIdentityTemplateFile(path.join(sharedMemoryDir, 'identity.md'));
    this.upgradeUserAgentIdentityTemplates(userDir);
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
        '- `identity.md`: 用户身份内核（身份名字、角色、语言风格、表达风格、原则）',
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
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  private upgradeIdentityTemplateFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('- Language style:')) {
      return;
    }
    const lines = content.split('\n');
    const insertAfter = lines.findIndex((line) => line.trim() === '- Communication style:');
    if (insertAfter >= 0) {
      lines.splice(insertAfter + 1, 0, '- Language style:');
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      return;
    }
    const fallback = content.trimEnd();
    fs.writeFileSync(filePath, `${fallback}\n- Language style:\n`, 'utf8');
  }

  private upgradeUserAgentIdentityTemplates(userDir: string): void {
    if (!fs.existsSync(userDir)) {
      return;
    }
    for (const entry of fs.readdirSync(userDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === 'shared-memory') {
        continue;
      }
      const identityPath = path.join(userDir, entry.name, 'memory', 'identity.md');
      this.upgradeIdentityTemplateFile(identityPath);
    }
  }

  private resolveInitialAgentIdentityContent(
    sharedMemoryDir: string,
    agentName: string,
    agentId: string,
    template: 'default' | 'memory-onboarding' | 'skill-onboarding',
  ): string {
    const sharedFallback = renderIdentityMemory();
    const sharedIdentityPath = path.join(sharedMemoryDir, 'identity.md');
    const sharedIdentity = fs.existsSync(sharedIdentityPath)
      ? fs.readFileSync(sharedIdentityPath, 'utf8')
      : sharedFallback;
    const sharedContent = hasMeaningfulMemoryContent(sharedIdentity) ? sharedIdentity : sharedFallback;
    return renderAgentIdentityMemory(agentName, agentId, template, sharedContent);
  }
}

function renderWorkspaceAgentsMd(
  agentName: string,
  agentId: string,
  relativeGlobalDir: string,
  relativeSharedDir: string,
  template: 'default' | 'memory-onboarding' | 'skill-onboarding',
): string {
  const globalDir = normalizeRelativeDir(relativeGlobalDir);
  const sharedDir = normalizeRelativeDir(relativeSharedDir);
  const onboardingRules = template === 'memory-onboarding'
    ? [
        '初始化职责：',
        '- 你不是通用助手；你的主要职责是引导用户完成记忆初始化。',
        '- 必须分轮次提问，每轮最多 3 个问题，等待用户回答后再继续。',
        '- 第一轮必须优先建立 identity（身份名字、角色、语言风格、表达风格、原则），并写入 shared-memory/identity.md。',
        '- 当检测到某个 agent 的自身份未初始化时，也要引导并完成该 agent 的 identity 初始化。',
        '- 处理顺序：先全局身份，再当前目标 agent 自身份，最后做一次双向一致性确认。',
        '- 每轮总结后直接覆盖写入 shared-memory 对应文件，再继续下一轮。',
        '- 对用户只输出引导问题和确认结论，不透露目录结构、文件名、工作区路径、系统实现细节。',
        '',
      ]
    : template === 'skill-onboarding'
    ? [
        '技能扩展职责：',
        '- 你不是通用助手；你的主要职责是帮助用户给“其他 agent”安装和配置 skills。',
        '- 必须先确认目标 agent（名称/ID）和目标能力，再执行安装。',
        '- 安装后要给出验证步骤（如何确认 skill 已生效）。',
        '- 如需改动目标 agent 的 AGENTS.md，先展示计划，再执行最小改动。',
        '- 对用户只输出可操作结论，不透露系统实现细节。',
        '',
      ]
    : [];
  return [
    `# AGENTS.md`,
    '',
    `当前工作区属于 agent \`${agentName}\`（ID: \`${agentId}\`）。`,
    '',
    ...onboardingRules,
    '浏览器操作职责：',
    '- 当任务需要网页交互时，只允许使用 gateway 提供的 browser_* MCP 工具完成操作，不要让用户手工点击。',
    '- 禁止使用 playwright-cli、npx @playwright/mcp、任何自定义 wrapper script、/open 或其他 shell/browser 启动通道。',
    '- 每次操作前先说明计划步骤，操作后回报关键结果与下一步。',
    '- 如果网页需要登录、验证码或支付确认，先提示用户接管，不要编造已完成。',
    '',
    '定时提醒职责：',
    '- 当用户提出“稍后提醒我”这类需求时，不要要求用户输入 `/remind` 命令。',
    '- 优先使用 `./.codex/skills/reminder-tool/SKILL.md`，并调用 `create_reminder` 工具创建提醒。',
    '- 不要输出 reminder-action 文本块，也不要要求用户输入 `/remind`。',
    '',
    '开始任何任务前，先阅读这些记忆文件：',
    '- `./agent.md`',
    '- `./memory/identity.md`',
    '- `./memory/profile.md`',
    '- `./memory/preferences.md`',
    '- `./memory/projects.md`',
    '- `./memory/relationships.md`',
    '- `./memory/decisions.md`',
    '- `./memory/open-loops.md`',
    '- `./browser-playbook.md`',
    `- \`${sharedDir}/identity.md\``,
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
    '- `identity.md` 是身份内核，记录身份名字、角色、语言风格、表达风格、决策原则；冲突时以最新用户输入直接覆盖。',
    '- `memory/daily/YYYY-MM-DD.md` 用于记录当天短期上下文和临时笔记。',
    `- \`${sharedDir}/daily/YYYY-MM-DD.md\` 用于沉淀跨 agent 的用户短期上下文，供系统记忆管家整理。`,
    '- 只有跨会话稳定、未来还值得再读的信息，才写入长期记忆文件。',
    '- 用户明确说“记住这个”时，应判断归档到哪个 memory 文件；高敏感信息先征求确认。',
    '- `profile/preferences/projects/relationships` 适合结构化更新；`decisions/open-loops` 适合按条目维护。',
    '- agent 专属记忆写入 `./memory/`，所有 agent 共享的记忆写入全局 memory 目录。',
    '',
  ].join('\n');
}

function renderAgentMd(
  agentName: string,
  agentId: string,
  template: 'default' | 'memory-onboarding' | 'skill-onboarding',
): string {
  const role = template === 'memory-onboarding'
    ? '- Role: Memory Onboarding Guide'
    : template === 'skill-onboarding'
    ? '- Role: Skill Enablement Guide'
    : '- Role:';
  const goals = template === 'memory-onboarding'
    ? '- Primary Goals: Guide the user to initialize shared-memory with confirmed facts and preferences'
    : template === 'skill-onboarding'
    ? '- Primary Goals: Install and configure skills for target agents with explicit verification'
    : '- Primary Goals:';
  const boundaries = template === 'memory-onboarding'
    ? '- Boundaries: Ask before writing sensitive details; keep each round short and structured'
    : template === 'skill-onboarding'
    ? '- Boundaries: Confirm target agent before changes; avoid broad or unrelated edits'
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
    '- `memory/identity.md`: 身份内核（身份名字、角色、语言风格、原则）',
    '- `memory/profile.md`: 用户稳定画像',
    '- `memory/preferences.md`: 用户偏好和表达习惯',
    '- `memory/projects.md`: 长期项目与状态',
    '- `memory/relationships.md`: 长期重要关系',
    '- `memory/decisions.md`: 已确认的重要决定',
    '- `memory/open-loops.md`: 尚未闭环但未来要继续跟进的事',
    '- `memory/daily/`: 当天短期上下文与临时笔记',
    '- `browser-playbook.md`: 浏览器操作规范',
    '',
  ].join('\n');
}

function renderWorkspaceReadme(
  agentName: string,
  agentId: string,
  template: 'default' | 'memory-onboarding' | 'skill-onboarding',
): string {
  const tips = template === 'memory-onboarding'
    ? [
        '- 该 agent 用于一次性或阶段性初始化 shared-memory。',
        '- 使用 `memory-init-checklist.md` 跟踪初始化进度。',
        '- 第一轮优先完成 identity（身份名字、角色、语言风格、表达风格、原则）。',
        '- 若当前业务 agent 的自身份缺失，也由该引导 agent 负责补齐。',
        '- 每轮提问后都要把信息写入 shared-memory；冲突按最新用户输入直接覆盖。',
        '- 浏览器操作策略写在 `browser-playbook.md`。',
      ]
    : template === 'skill-onboarding'
    ? [
        '- 该 agent 专门用于给其它 agent 拓展能力（安装/配置 skills）。',
        '- 使用 `skill-install-checklist.md` 跟踪安装进度与验证项。',
        '- 每次安装前先确认目标 agent，再执行最小改动。',
        '- 浏览器操作策略写在 `browser-playbook.md`。',
      ]
    : [
        '- 用户的长期稳定信息维护在 `memory/*.md`。',
        '- 当天短期上下文和临时笔记维护在 `memory/daily/`。',
        '- 跨 agent 共享的知识和规则维护在上层 `global-memory/`。',
        '- 浏览器操作策略写在 `browser-playbook.md`。',
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
    '- [ ] Round 1: Identity (preferred name, role, language style, communication style, decision principles)',
    '- [ ] Round 1b: Current Agent Identity (agent name, id, role, mission, boundaries)',
    '- [ ] Round 2: Profile (timezone, long-term goals, stable facts)',
    '- [ ] Round 3: Preferences (language, response style, work style)',
    '- [ ] Round 4: Projects (active projects, goals, constraints, next steps)',
    '- [ ] Round 5: Relationships + Decisions + Open Loops',
    '- [ ] Final Verify: shared identity 与当前 agent identity 不冲突',
    '',
    '## Notes',
    '-',
    '',
  ].join('\n');
}

function renderSkillInstallChecklist(): string {
  return [
    '# Skill Install Checklist',
    '',
    '## Scope',
    '- [ ] 目标 agent 已确认（名称/ID）',
    '- [ ] 目标能力与验收标准已确认',
    '',
    '## Install',
    '- [ ] 已选择技能来源（内置 skill / 社区 skill / GitHub）',
    '- [ ] 已完成安装并记录必要配置',
    '',
    '## Verify',
    '- [ ] 已通过最小任务验证 skill 生效',
    '- [ ] 已给出回滚或替代方案',
    '',
  ].join('\n');
}

function renderBrowserPlaybook(): string {
  return [
    '# Browser Playbook',
    '',
    '## Runtime Model (Single User Server)',
    '- 使用单一持久化浏览器 profile（不做多用户隔离）。',
    '- 优先非无头模式，尽量复用已有登录态。',
    '- 目标：稳定完成任务，不追求反检测伪装。',
    '- 唯一允许的浏览器通道是 gateway 暴露的 browser_* MCP 工具。',
    '',
    '## Default Workflow',
    '1. Clarify target outcome and constraints before acting.',
    '2. 默认复用当前标签页：用 browser_navigate 打开目标页，再调用 browser_snapshot 获取结构化页面状态。',
    '3. 之后只用 browser_click / browser_type / browser_select_option / browser_press_key / browser_wait_for 做小步操作；只有用户明确要求时才切换已有标签页。',
    '4. 需要录屏时，先调用 browser_start_recording，再执行页面步骤，结束后调用 browser_stop_recording 返回本地 mp4 路径。',
    '5. After each step, report what changed and what remains.',
    '',
    '## Guardrails',
    '- Do not claim completion without visible page evidence.',
    '- If login, OTP, CAPTCHA, or payment confirmation is required, ask user to take over and wait.',
    '- 人工接管完成后，要求用户明确回复“继续”，再恢复后续步骤。',
    '- 默认不要关闭当前标签页；只有当用户明确要求多标签页时才新建标签页。',
    '- 禁止改走 playwright-cli、npx @playwright/mcp、shell 命令或其他浏览器自动化入口。',
    '- Do not expose internal paths, file names, or hidden implementation details in user-facing replies.',
    '',
    '## Output Style',
    '- Keep updates short and specific: action -> observed result -> next action.',
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
    `- \`${sharedDir}/identity.md\``,
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

function renderIdentityMemory(): string {
  return [
    '# Identity',
    '',
    '## Agent Identity Core',
    '- Preferred name:',
    '- Core role:',
    '- Communication style:',
    '- Language style:',
    '- Decision principles:',
    '- Boundaries:',
    '',
    '## Voice Hints',
    '-',
    '',
  ].join('\n');
}

function renderAgentIdentityMemory(
  agentName: string,
  agentId: string,
  template: 'default' | 'memory-onboarding' | 'skill-onboarding',
  sharedIdentityContent: string,
): string {
  const sharedCore = stripIdentityTitle(sharedIdentityContent);
  const role = template === 'memory-onboarding'
    ? '记忆初始化引导'
    : template === 'skill-onboarding'
    ? '技能扩展助手'
    : agentName;
  return [
    '# Identity',
    '',
    '## Global User Identity',
    ...sharedCore,
    '',
    '## Current Agent Identity',
    `- Agent name: ${agentName}`,
    `- Agent ID: ${agentId}`,
    `- Agent role: ${role}`,
    '- Primary responsibility:',
    '- Expertise focus:',
    '- Collaboration style:',
    '- Mission:',
    '- Working style:',
    '- Decision principles:',
    '  -',
    '- Boundaries:',
    '  -',
    '- Success criteria:',
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
    '- 默认慢节奏引导：先澄清目标，再分步提问，帮助用户产出更有意义的结果',
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

function resolveAgentId(input: CreateAgentWorkspaceInput): string {
  if (input.template === 'memory-onboarding') {
    return MEMORY_ONBOARDING_AGENT_ID;
  }
  if (input.template === 'skill-onboarding') {
    return SKILL_ONBOARDING_AGENT_ID;
  }
  return createUniqueAgentId(input.agentName, input.existingAgentIds);
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
  const seededLines = new Set([
    '- 默认慢节奏引导：先澄清目标，再分步提问，帮助用户产出更有意义的结果',
  ]);
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('>')) {
      continue;
    }
    if (seededLines.has(line)) {
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

function normalizeIdentityText(content: string): string {
  const lines = content.split('\n');
  const filtered: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('>')) {
      continue;
    }
    if (line === '-' || line.endsWith(':')) {
      continue;
    }
    filtered.push(line);
  }
  return filtered.join('\n');
}

function stripIdentityTitle(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length && !lines[start]!.trim()) {
    start += 1;
  }
  if (start < lines.length && lines[start]!.trim() === '# Identity') {
    start += 1;
  }
  return lines.slice(start);
}
