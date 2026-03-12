import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { installFeishuCanvasSkill } from '../src/services/feishu-canvas-skill.js';
import { listSkillsForAgentWorkspace } from '../src/services/skill-registry.js';

describe('installFeishuCanvasSkill', () => {
  it('installs the feishu-canvas skill into an agent workspace', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-canvas-workspace-'));

    installFeishuCanvasSkill(workspaceDir);

    const skillFile = path.join(workspaceDir, '.codex', 'skills', 'feishu-canvas', 'SKILL.md');
    expect(fs.existsSync(skillFile)).toBe(true);

    const skills = listSkillsForAgentWorkspace(workspaceDir);
    expect(skills.some((item) => item.name === 'feishu-canvas')).toBe(true);
  });
});
