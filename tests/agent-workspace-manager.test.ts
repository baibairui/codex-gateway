import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentWorkspaceManager } from '../src/services/agent-workspace-manager.js';

describe('AgentWorkspaceManager', () => {
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
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'identity.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'profile.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'preferences.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'projects.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'relationships.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'decisions.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'open-loops.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'daily', 'README.md'))).toBe(true);
    const identity = fs.readFileSync(path.join(result.workspaceDir, 'memory', 'identity.md'), 'utf8');
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
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'reminder-tool', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, '.codex', 'skills', 'reminder-tool', 'agents', 'openai.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'global-memory', 'shared-context.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'global-memory', 'house-rules.md'))).toBe(true);
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
    expect(agentsMd).toContain('./.codex/skills/reminder-tool/SKILL.md');
    expect(checklist).toContain('Skill Install Checklist');
    expect(reminderSkill).toContain('create_reminder');
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
    expect(playbook).toContain('Browser Playbook');
    expect(playbook).toContain('回报格式固定：已执行动作 -> 页面证据 -> 当前结论 -> 下一步。');
    expect(playbook).toContain('## Stop Conditions');
    expect(playbook).toContain('多个相似目标并存');
    expect(playbook).toContain('需要用户做出的精确决策');
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
