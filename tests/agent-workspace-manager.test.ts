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
    expect(fs.existsSync(path.join(dir, 'global-memory', 'shared-context.md'))).toBe(true);
  });
});
