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
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'profile.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'preferences.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'projects.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'relationships.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'decisions.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'open-loops.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspaceDir, 'memory', 'daily', 'README.md'))).toBe(true);
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

    expect(agentsMd).toContain('初始化职责');
    expect(checklist).toContain('Round 1: Profile');
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
});
