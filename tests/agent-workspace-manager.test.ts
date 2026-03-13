import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentWorkspaceManager } from '../src/services/agent-workspace-manager.js';

describe('AgentWorkspaceManager', () => {
  it('creates scaffold for the built-in default workspace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-default-'));
    const manager = new AgentWorkspaceManager(dir);

    const result = manager.ensureDefaultWorkspace('wecom:u1');

    expect(result.agentId).toBe('default');
    expect(result.workspaceDir).toContain(path.join('users'));
    expect(result.workspaceDir).toContain(path.join('default'));
    expect(fs.existsSync(path.join(result.workspaceDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'gateway-browser', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'reminder-tool', 'SKILL.md'))).toBe(true);
  });

  it('creates workspace scaffold and global memory files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);

    const result = manager.createWorkspace({
      userId: 'wecom:u1',
      agentName: 'Frontend Pair',
      existingAgentIds: [],
    });

    expect(result.agentId).toBe('frontend-pair');
    expect(fs.existsSync(path.join(result.workspaceDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'agent.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'SOUL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'TOOLS.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'feishu-ops-playbook.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'identity.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'profile.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'preferences.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'projects.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'relationships.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'decisions.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'open-loops.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'daily', 'README.md'))).toBe(true);
    const identity = fs.readFileSync(path.join(result.workspaceDir, 'memory', 'identity.md'), 'utf8');
    const tools = fs.readFileSync(path.join(result.workspaceDir, 'TOOLS.md'), 'utf8');
    const feishuPlaybook = fs.readFileSync(path.join(result.workspaceDir, 'feishu-ops-playbook.md'), 'utf8');
    const feishuSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'feishu-official-ops', 'SKILL.md'), 'utf8');
    expect(identity).toContain('## Global User Identity');
    expect(identity).toContain('## Current Agent Identity');
    expect(identity).toContain('- Agent name: Frontend Pair');
    expect(identity).toContain('- Agent ID: frontend-pair');
    expect(identity).toContain('- Agent role: Frontend Pair');
    expect(identity).toContain('- Mission:');
    expect(identity).toContain('- Decision principles:');
    expect(identity).toContain('- Success criteria:');
    expect(identity).toContain('- Language style:');
    expect(fs.existsSync(path.join(result.workspaceDir, 'browser-playbook.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'gateway-browser', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'gateway-browser', 'scripts', 'gateway-browser.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'reminder-tool', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'reminder-tool', 'scripts', 'reminder-cli.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'feishu-official-ops', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'social-intel', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'social-doc-writer', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'x-research', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'xiaohongshu-research', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'douyin-research', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'bilibili-research', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'wechat-article-research', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'reminder-tool', 'agents', 'openai.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'global-memory', 'shared-context.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'global-memory', 'house-rules.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'users', fs.readdirSync(path.join(dir, 'users'))[0]!, 'shared-memory', 'USER.md'))).toBe(true);
    const socialIntelSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'social-intel', 'SKILL.md'), 'utf8');
    const socialDocSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'social-doc-writer', 'SKILL.md'), 'utf8');
    const xSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'x-research', 'SKILL.md'), 'utf8');
    const xiaohongshuSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'xiaohongshu-research', 'SKILL.md'), 'utf8');
    const douyinSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'douyin-research', 'SKILL.md'), 'utf8');
    const bilibiliSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'bilibili-research', 'SKILL.md'), 'utf8');
    const wechatArticleSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'wechat-article-research', 'SKILL.md'), 'utf8');
    expect(tools).toContain('`gateway-browser` skill');
    expect(tools).toContain('`reminder-tool` skill');
    expect(tools).toContain('`feishu-official-ops` skill');
    expect(tools).toContain('个人日历 / 个人任务');
    expect(tools).toContain('`social-intel` skill');
    expect(tools).toContain('`social-doc-writer` skill');
    expect(tools).toContain('自带脚本执行真实 OpenAPI');
    expect(tools).not.toContain('MCP');
    expect(tools).not.toContain('gateway_feishu');
    expect(feishuPlaybook).toContain('DocX / Wiki');
    expect(feishuPlaybook).toContain('`docx create`');
    expect(feishuPlaybook).toContain('skill 自带执行脚本');
    expect(feishuPlaybook).toContain('应用凭据可直接完成');
    expect(feishuPlaybook).toContain('只回 markdown 文本不算完成');
    expect(feishuPlaybook).toContain('不要把用户引到任何个人授权或登录页面');
    expect(feishuPlaybook).toContain('calendar create-personal-event');
    expect(feishuPlaybook).toContain('task create-personal-task');
    expect(feishuPlaybook).toContain('`99991679`');
    expect(feishuPlaybook).toContain('auth diagnose-permission');
    expect(feishuPlaybook).toContain('required-scopes-json');
    expect(feishuPlaybook).toContain('不要反问用户要不要继续');
    expect(feishuPlaybook).not.toContain('gateway_feishu');
    expect(feishuSkill).toContain('Use the bundled script');
    expect(feishuSkill).toContain('a chat markdown answer is not a successful write');
    expect(feishuSkill).toContain('do not bounce the user into personal auth');
    expect(feishuSkill).toContain('For the current user\'s own calendar');
    expect(feishuSkill).toContain('For personal calendar or task scope errors, continue the diagnostic flow yourself');
    expect(feishuSkill).toContain('required-scopes-json');
    expect(feishuSkill).not.toContain('gateway_feishu');
    expect(socialIntelSkill).toContain('name: social-intel');
    expect(socialIntelSkill).toContain('sources, publish time, author/account, summary, and evidence');
    expect(socialIntelSkill).toContain('`./.codex/skills/gateway-browser/SKILL.md`');
    expect(socialDocSkill).toContain('name: social-doc-writer');
    expect(socialDocSkill).toContain('`./.codex/skills/feishu-official-ops/SKILL.md`');
    expect(socialDocSkill).toContain('Create a Feishu DocX or append to an existing DocX');
    expect(socialDocSkill).toContain('markdown answer in chat is not a substitute');
    expect(socialDocSkill).toContain('Do not ask the user for any personal Feishu auth or user login');
    expect(xSkill).toContain('name: x-research');
    expect(xSkill).toContain('posts, threads, search results, and account pages');
    expect(xiaohongshuSkill).toContain('name: xiaohongshu-research');
    expect(xiaohongshuSkill).toContain('笔记、搜索结果、作者主页');
    expect(douyinSkill).toContain('name: douyin-research');
    expect(douyinSkill).toContain('公开视频、搜索结果、账号页');
    expect(bilibiliSkill).toContain('name: bilibili-research');
    expect(bilibiliSkill).toContain('视频页、合集页、UP 主主页');
    expect(wechatArticleSkill).toContain('name: wechat-article-research');
    expect(wechatArticleSkill).toContain('公众号文章链接');
  });

  it('creates hidden system memory steward workspace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);

    const result = manager.ensureSystemMemoryStewardWorkspace('wecom:u1');

    const agentsMd = fs.readFileSync(path.join(result.workspaceDir, 'AGENTS.md'), 'utf8');
    const agentMd = fs.readFileSync(path.join(result.workspaceDir, 'agent.md'), 'utf8');

    expect(result.sharedMemoryDir).toContain('shared-memory');
    expect(agentsMd).toContain('你是系统默认的 Memory Steward');
    expect(agentMd).toContain('- Role: System Memory Steward');
  });

  it('creates onboarding scaffold for memory onboarding template', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);

    const result = manager.createWorkspace({
      userId: 'wecom:u1',
      agentName: '记忆初始化引导',
      existingAgentIds: [],
      template: 'memory-onboarding',
    });

    const agentsMd = fs.readFileSync(path.join(result.workspaceDir, 'AGENTS.md'), 'utf8');
    const checklist = fs.readFileSync(path.join(result.workspaceDir, 'memory-init-checklist.md'), 'utf8');

    expect(result.agentId).toBe('memory-onboarding');
    expect(agentsMd).toContain('初始化职责');
    expect(agentsMd).toContain('语言风格');
    expect(checklist).toContain('Round 1: Identity');
    expect(checklist).toContain('language style');
  });

  it('creates scaffold for skill onboarding template', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);

    const result = manager.createWorkspace({
      userId: 'wecom:u1',
      agentName: '技能扩展助手',
      existingAgentIds: [],
      template: 'skill-onboarding',
    });

    const agentsMd = fs.readFileSync(path.join(result.workspaceDir, 'AGENTS.md'), 'utf8');
    const checklist = fs.readFileSync(path.join(result.workspaceDir, 'skill-install-checklist.md'), 'utf8');
    const reminderSkill = fs.readFileSync(path.join(result.workspaceDir, '.codex', 'skills', 'reminder-tool', 'SKILL.md'), 'utf8');

    expect(result.agentId).toBe('skill-onboarding');
    expect(agentsMd).toContain('技能扩展职责');
    expect(agentsMd).toContain('定时提醒职责');
    expect(agentsMd).toContain('社媒调研职责');
    expect(agentsMd).toContain('./.codex/skills/reminder-tool/SKILL.md');
    expect(checklist).toContain('Skill Install Checklist');
    expect(reminderSkill).toContain('reminder-cli.mjs create');
  });

  it('includes browser operation guidance in default agent scaffold', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);

    const result = manager.createWorkspace({
      userId: 'wecom:u1',
      agentName: '浏览器操作助手',
      existingAgentIds: [],
    });

    const agentsMd = fs.readFileSync(path.join(result.workspaceDir, 'AGENTS.md'), 'utf8');
    const playbook = fs.readFileSync(path.join(result.workspaceDir, 'browser-playbook.md'), 'utf8');

    expect(agentsMd).toContain('浏览器操作职责');
    expect(agentsMd).toContain('./SOUL.md');
    expect(agentsMd).toContain('./TOOLS.md');
    expect(agentsMd).toContain('Action / Evidence / Result / Next step');
    expect(agentsMd).toContain('./.codex/skills/social-intel/SKILL.md');
    expect(agentsMd).toContain('./.codex/skills/social-doc-writer/SKILL.md');
    expect(agentsMd).toContain('多个相似目标并存');
    expect(agentsMd).toContain('文件上传时，若用户未明确授权，先暂停并确认');
    expect(agentsMd).toContain('人工接管触发条件可直接按这组理解');
    expect(agentsMd).toContain('gateway-browser/SKILL.md');
    expect(playbook).toContain('Browser Playbook');
    expect(playbook).toContain('回报格式固定：已执行动作 -> 页面证据 -> 当前结论 -> 下一步。');
    expect(playbook).toContain('## Status Templates');
    expect(playbook).toContain('进行中：汇报最新动作');
    expect(playbook).toContain('阻塞：汇报阻塞点、风险');
    expect(playbook).toContain('接管：汇报为什么必须人工接管');
    expect(playbook).toContain('完成：汇报已完成事项');
    expect(playbook).toContain('## Stop Conditions');
    expect(playbook).toContain('人工接管触发条件总览');
    expect(playbook).toContain('多个相似目标并存');
    expect(playbook).toContain('需要用户做出的精确决策');
    expect(playbook).toContain('gateway-browser.mjs');
  });

  it('repairs existing workspace scaffold with bootstrap files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);
    const userId = 'wecom:u1';
    const created = manager.createWorkspace({
      userId,
      agentName: 'Repair Target',
      existingAgentIds: [],
    });

    fs.rmSync(path.join(created.workspaceDir, 'SOUL.md'));
    fs.rmSync(path.join(created.workspaceDir, 'TOOLS.md'));

    manager.repairWorkspaceScaffold(created.workspaceDir);

    expect(fs.existsSync(path.join(created.workspaceDir, 'SOUL.md'))).toBe(true);
    expect(fs.existsSync(path.join(created.workspaceDir, 'TOOLS.md'))).toBe(true);
  });

  it('repairs legacy browser instructions and reinstalls the browser skill', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);
    const created = manager.createWorkspace({
      userId: 'wecom:u1',
      agentName: 'Legacy Browser Agent',
      existingAgentIds: [],
    });

    fs.writeFileSync(
      path.join(created.workspaceDir, 'AGENTS.md'),
      [
        '# AGENTS.md',
        '',
        '浏览器操作职责：',
        '- 当任务需要网页交互时，只允许使用 gateway 提供的 browser_* MCP 工具完成操作，而不是让用户手工点击。',
        '- 禁止使用 playwright-cli、npx @playwright/mcp、任何自定义 wrapper script、/open 或其他 shell/browser 启动通道。',
        '',
        '开始任何任务前，先阅读这些记忆文件：',
        '- `./agent.md`',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.rmSync(path.join(created.workspaceDir, '.codex', 'skills', 'gateway-browser'), { recursive: true, force: true });
    fs.rmSync(path.join(created.workspaceDir, 'TOOLS.md'));

    manager.repairWorkspaceScaffold(created.workspaceDir);

    const agentsMd = fs.readFileSync(path.join(created.workspaceDir, 'AGENTS.md'), 'utf8');
    expect(fs.existsSync(path.join(created.workspaceDir, '.codex', 'skills', 'gateway-browser', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(created.workspaceDir, 'TOOLS.md'))).toBe(true);
    expect(agentsMd).toContain('<!-- gateway:browser-rule:start -->');
    expect(agentsMd).toContain('./.codex/skills/gateway-browser/SKILL.md');
    expect(agentsMd).not.toContain('browser_* MCP 工具');
    expect(agentsMd).not.toContain('@playwright/mcp');
  });

  it('detects shared memory emptiness by meaningful content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);
    const userId = 'wecom:u1';

    manager.createWorkspace({
      userId,
      agentName: '个人助理',
      existingAgentIds: [],
    });
    expect(manager.isSharedMemoryEmpty(userId)).toBe(true);

    const userHashDir = fs.readdirSync(path.join(dir, 'users'))[0]!;
    const profilePath = path.join(dir, 'users', userHashDir, 'shared-memory', 'profile.md');
    fs.appendFileSync(profilePath, '- Preferred name: Alice\n', 'utf8');

    expect(manager.isSharedMemoryEmpty(userId)).toBe(false);
  });

  it('upgrades legacy identity templates for existing users', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);
    const userId = 'wecom:u1';
    const created = manager.createWorkspace({
      userId,
      agentName: 'legacy',
      existingAgentIds: [],
    });

    const userHashDir = fs.readdirSync(path.join(dir, 'users'))[0]!;
    const sharedIdentity = path.join(dir, 'users', userHashDir, 'shared-memory', 'identity.md');
    const agentIdentity = path.join(created.workspaceDir, 'memory', 'identity.md');
    fs.writeFileSync(sharedIdentity, fs.readFileSync(sharedIdentity, 'utf8').replace('- Language style:\n', ''), 'utf8');
    fs.writeFileSync(agentIdentity, fs.readFileSync(agentIdentity, 'utf8').replace('- Language style:\n', ''), 'utf8');

    manager.getSharedMemorySnapshot(userId);

    expect(fs.readFileSync(sharedIdentity, 'utf8')).toContain('- Language style:');
    expect(fs.readFileSync(agentIdentity, 'utf8')).toContain('- Language style:');
  });

  it('seeds new agent identity from shared identity when already initialized', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);
    const userId = 'wecom:u1';

    manager.createWorkspace({
      userId,
      agentName: 'first-agent',
      existingAgentIds: [],
    });

    const userHashDir = fs.readdirSync(path.join(dir, 'users'))[0]!;
    const sharedIdentity = path.join(dir, 'users', userHashDir, 'shared-memory', 'identity.md');
    fs.writeFileSync(
      sharedIdentity,
      [
        '# Identity',
        '',
        '## Agent Identity Core',
        '- Preferred name: 白瑞',
        '- Core role: AI 应用开发者',
        '- Communication style: 直接、基于事实',
        '- Language style: 中文（默认）',
        '- Decision principles:',
        '  - 遵守事实，不弄虚作假',
        '- Boundaries:',
        '  - 不接受半途方案',
        '',
        '## Voice Hints',
        '- 真实、直接、执行到底',
        '',
      ].join('\n'),
      'utf8',
    );

    const next = manager.createWorkspace({
      userId,
      agentName: 'second-agent',
      existingAgentIds: ['first-agent'],
    });

    const nextIdentity = fs.readFileSync(path.join(next.workspaceDir, 'memory', 'identity.md'), 'utf8');
    expect(nextIdentity).toContain('- Preferred name: 白瑞');
    expect(nextIdentity).toContain('- Language style: 中文（默认）');
    expect(nextIdentity).toContain('- Communication style: 直接、基于事实');
    expect(nextIdentity).toContain('- Agent name: second-agent');
    expect(nextIdentity).toContain('- Agent ID: second-agent');
    expect(nextIdentity).toContain('- Agent role: second-agent');
  });

  it('detects whether a workspace identity is initialized', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'));
    const manager = new AgentWorkspaceManager(dir);
    const userId = 'wecom:u1';

    const first = manager.createWorkspace({
      userId,
      agentName: 'first-agent',
      existingAgentIds: [],
    });
    expect(manager.isWorkspaceIdentityEmpty(first.workspaceDir)).toBe(true);

    fs.writeFileSync(path.join(first.workspaceDir, 'memory', 'identity.md'), [
      '# Identity',
      '',
      '## Current Agent Identity',
      '- Primary responsibility: 负责需求澄清与实现',
      '- Mission: 确保需求高质量交付',
      '- Success criteria: 可验证、可回归、可上线',
      '- Decision principles:',
      '  - 遵守事实',
      '- Boundaries:',
      '  - 不做半途兼容方案',
      '',
    ].join('\n'), 'utf8');
    expect(manager.isWorkspaceIdentityEmpty(first.workspaceDir)).toBe(false);

    const legacy = manager.createWorkspace({
      userId,
      agentName: 'legacy-agent',
      existingAgentIds: ['first-agent'],
    });
    fs.writeFileSync(path.join(legacy.workspaceDir, 'memory', 'identity.md'), renderLegacyIdentityTemplate(), 'utf8');

    expect(manager.isWorkspaceIdentityEmpty(legacy.workspaceDir)).toBe(true);
  });
});

function renderLegacyIdentityTemplate(): string {
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
