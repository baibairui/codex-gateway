import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  installGatewayDesktopSkill,
  renderGatewayDesktopSkill,
  syncManagedGlobalDesktopSkills,
} from '../src/services/gateway-desktop-skill.js';

describe('gateway-desktop-skill', () => {
  it('installs gateway desktop skill in workspace local skills', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-desktop-skill-'));
    installGatewayDesktopSkill(dir);

    const skillFile = path.join(dir, '.codex', 'skills', 'gateway-desktop', 'SKILL.md');
    const scriptFile = path.join(dir, '.codex', 'skills', 'gateway-desktop', 'scripts', 'gateway-desktop.mjs');
    expect(fs.existsSync(skillFile)).toBe(true);
    expect(fs.existsSync(scriptFile)).toBe(true);
    expect(fs.readFileSync(skillFile, 'utf8')).toContain('name: gateway-desktop');
    expect(fs.readFileSync(scriptFile, 'utf8')).toContain("GATEWAY_DESKTOP_API_BASE");
    expect(fs.readFileSync(scriptFile, 'utf8')).toContain("GATEWAY_INTERNAL_API_TOKEN");
  });

  it('upgrades legacy desktop rules in AGENTS.md to the skill-only workflow', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-desktop-skill-'));
    fs.writeFileSync(
      path.join(dir, 'AGENTS.md'),
      [
        '# AGENTS.md',
        '',
        '桌面操作职责：',
        '- 当任务需要桌面软件交互时，只允许使用 shell 命令或 osascript 直接操作系统。',
        '- 每次操作前先说明计划步骤，操作后回报关键结果与下一步。',
        '',
      ].join('\n'),
      'utf8',
    );

    installGatewayDesktopSkill(dir);

    const agentsMd = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('<!-- gateway:desktop-rule:start -->');
    expect(agentsMd).toContain('./.codex/skills/gateway-desktop/SKILL.md');
    expect(agentsMd).toContain('前台可见应用');
    expect(agentsMd).not.toContain('shell 命令或 osascript 直接操作系统');
  });

  it('renders desktop workflow with screenshot evidence and frontmost-app limits', () => {
    const skill = renderGatewayDesktopSkill();

    expect(skill).toContain('gateway-desktop.mjs frontmost-app');
    expect(skill).toContain('Execute one minimal action at a time');
    expect(skill).toContain('capture a screenshot after each critical action');
    expect(skill).toContain('frontmost visible application only');
    expect(skill).toContain('Do not run shell commands directly');
    expect(skill).toContain('request confirmation');
  });

  it('explains that missing desktop env means the gateway runtime is unavailable, not user config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-desktop-skill-'));
    installGatewayDesktopSkill(dir);

    const scriptFile = path.join(dir, '.codex', 'skills', 'gateway-desktop', 'scripts', 'gateway-desktop.mjs');
    const script = fs.readFileSync(scriptFile, 'utf8');

    expect(script).toContain('desktop gateway is unavailable in this session');
    expect(script).toContain('Restart the gateway');
  });

  it('syncs managed desktop skills into global skill roots', () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'global-desktop-skills-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'global-desktop-skills-b-'));

    syncManagedGlobalDesktopSkills({ roots: [rootA, rootB] });

    expect(fs.existsSync(path.join(rootA, 'gateway-desktop', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(rootB, 'gateway-desktop', 'SKILL.md'))).toBe(true);
  });

  it('uses the current user home for default managed global desktop skill roots', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-desktop-home-'));
    const originalHome = process.env.HOME;

    process.env.HOME = tempHome;
    vi.resetModules();
    const mod = await import('../src/services/gateway-desktop-skill.js');

    try {
      mod.syncManagedGlobalDesktopSkills();

      expect(fs.existsSync(path.join(tempHome, '.codex', 'skills', 'gateway-desktop', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempHome, '.agents', 'skills', 'gateway-desktop', 'SKILL.md'))).toBe(true);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });
});
