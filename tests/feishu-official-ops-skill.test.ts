import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { installFeishuOfficialOpsSkill, syncManagedFeishuOfficialOpsSkills } from '../src/services/feishu-official-ops-skill.js';

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
    expect(skillContent).toContain('Shared calendar write commands are disabled in this gateway.');
    expect(skillContent).toContain('For the current user\'s own tasks, default to `task create-personal-task`');
    expect(skillContent).toContain('immediately run `auth diagnose-permission`');
    expect(skillContent).toContain('required-scopes-json');
    expect(agentPrompt).toContain('Prefer personal calendar/task commands for the current user');
    expect(agentPrompt).toContain('immediately run `auth diagnose-permission`');
    expect(agentPrompt).toContain('required-scopes-json');
    expect(agentsMd).toContain('用户说“帮我建日程”这类当前用户个人日历事务时');
    expect(agentsMd).toContain('用户说“我的待办”这类当前用户个人任务事务时');
    expect(agentsMd).toContain('默认走 `calendar create-personal-event`');
    expect(agentsMd).toContain('`calendar create-event` / `calendar create-calendar` 在此网关中已禁用');
    expect(agentsMd).toContain('默认走 `task create-personal-task`');
    expect(agentsMd).toContain('`auth diagnose-permission`');
    expect(agentsMd).toContain('`required-scopes-json`');
    expect(agentsMd).toContain('不要问“要不要我继续”');
  });
});


describe('syncManagedFeishuOfficialOpsSkills', () => {
  it('refreshes a stale shared skill copy from the source skill', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-official-ops-global-'));
    const staleSkillDir = path.join(root, 'feishu-official-ops');
    fs.mkdirSync(path.join(staleSkillDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(staleSkillDir, 'SKILL.md'), 'stale skill', 'utf8');
    fs.writeFileSync(path.join(staleSkillDir, 'scripts', 'feishu-openapi.mjs'), 'console.log("stale")\n', 'utf8');

    syncManagedFeishuOfficialOpsSkills({ roots: [root] });

    expect(fs.readFileSync(path.join(staleSkillDir, 'SKILL.md'), 'utf8')).toContain("For the current user's own calendar");
    expect(fs.readFileSync(path.join(staleSkillDir, 'scripts', 'feishu-openapi.mjs'), 'utf8')).toContain('buildCardkitCreateBody');
  });
});
