import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { installFeishuOfficialOpsSkill } from '../src/services/feishu-official-ops-skill.js';

describe('installFeishuOfficialOpsSkill', () => {
  it('installs personal calendar and task guidance into the existing Feishu skill', () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-official-ops-workspace-'));
    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), '# Agent Rules\n', 'utf8');

    installFeishuOfficialOpsSkill(workspaceDir);

    const skillRoot = path.join(workspaceDir, '.codex', 'skills', 'feishu-official-ops');
    const skillContent = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const agentPrompt = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
    const agentsMd = fs.readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf8');

    expect(skillContent).toContain('For the current user\'s own calendar, default to `calendar create-personal-event`.');
    expect(skillContent).toContain('Do not use `calendar create-event` unless the user explicitly wants a shared calendar');
    expect(skillContent).toContain('For the current user\'s own tasks, default to `task create-personal-task`');
    expect(skillContent).toContain('immediately run `auth diagnose-permission`');
    expect(skillContent).toContain('required-scopes-json');
    expect(agentPrompt).toContain('Prefer personal calendar/task commands for the current user');
    expect(agentPrompt).toContain('immediately run `auth diagnose-permission`');
    expect(agentPrompt).toContain('required-scopes-json');
    expect(agentsMd).toContain('用户说“帮我建日程”这类当前用户个人日历事务时');
    expect(agentsMd).toContain('用户说“我的待办”这类当前用户个人任务事务时');
    expect(agentsMd).toContain('默认走 `calendar create-personal-event`');
    expect(agentsMd).toContain('默认走 `task create-personal-task`');
    expect(agentsMd).toContain('`auth diagnose-permission`');
    expect(agentsMd).toContain('`required-scopes-json`');
    expect(agentsMd).toContain('不要问“要不要我继续”');
  });
});
