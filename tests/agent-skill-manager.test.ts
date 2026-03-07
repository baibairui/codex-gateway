import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentSkillManager } from '../src/services/agent-skill-manager.js';

describe('AgentSkillManager', () => {
  it('disables and enables global skills per workspace policy', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-manager-'));
    fs.mkdirSync(path.join(workspace, '.codex', 'skills', 'reminder-tool', 'agents'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, '.codex', 'skills', 'reminder-tool', 'SKILL.md'),
      ['---', 'name: reminder-tool', 'description: local reminder', '---', ''].join('\n'),
      'utf8',
    );

    const manager = new AgentSkillManager();
    const global = manager.listGlobalSkills(workspace);
    if (global.length === 0) {
      return;
    }
    const skill = global[0]!.name;

    expect(manager.disableGlobalSkill(workspace, skill).ok).toBe(true);
    const afterDisable = manager.listEffectiveSkills(workspace);
    expect(afterDisable.some((item) => item.source === 'global' && item.name.toLowerCase() === skill.toLowerCase())).toBe(false);

    expect(manager.enableGlobalSkill(workspace, skill).ok).toBe(true);
    const afterEnable = manager.listEffectiveSkills(workspace);
    expect(afterEnable.some((item) => item.source === 'global' && item.name.toLowerCase() === skill.toLowerCase())).toBe(true);
  });
});
