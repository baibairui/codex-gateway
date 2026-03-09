import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { installGatewayBrowserSkill, renderGatewayBrowserSkill, syncManagedGlobalSkills } from '../src/services/gateway-browser-skill.js';

describe('gateway-browser-skill', () => {
  it('installs gateway browser skill in workspace local skills', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-browser-skill-'));
    installGatewayBrowserSkill(dir);

    const skillFile = path.join(dir, '.codex', 'skills', 'gateway-browser', 'SKILL.md');
    expect(fs.existsSync(skillFile)).toBe(true);
    expect(fs.readFileSync(skillFile, 'utf8')).toContain('name: gateway-browser');
  });

  it('renders browser workflow with evidence and safety rules', () => {
    const skill = renderGatewayBrowserSkill();

    expect(skill).toContain('Read current page state with `browser_snapshot` before deciding the next action.');
    expect(skill).toContain('refs are not stable across navigations');
    expect(skill).toContain('use screenshot/console/network tools to collect evidence');
    expect(skill).toContain('Report format:');
    expect(skill).toContain('Evidence: snapshot/screenshot/console/network findings');
    expect(skill).toContain('Next step: the next minimal action or the exact user takeover request.');
    expect(skill).toContain('Status templates:');
    expect(skill).toContain('In progress: report the latest action');
    expect(skill).toContain('Blocked: report the blocker, risk');
    expect(skill).toContain('Handoff: report why user takeover is required');
    expect(skill).toContain('Done: report what was completed');
    expect(skill).toContain('Stop conditions:');
    expect(skill).toContain('multiple similar targets exist');
    expect(skill).toContain('upload files, or submit content the user did not explicitly approve');
    expect(skill).toContain('report the last confirmed page state');
    expect(skill).toContain('capture evidence and confirm intent');
    expect(skill).toContain('capture a screenshot instead of guessing from stale refs');
    expect(skill).toContain('inspect console/network before retrying');
    expect(skill).toContain('report the exact resume point');
    expect(skill).toContain('cookies, and storage as sensitive data');
  });

  it('syncs managed global skills and removes legacy skill dirs', () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skills-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'global-skills-b-'));

    fs.mkdirSync(path.join(rootA, 'playwright-explore-website'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'react-best-practices'), { recursive: true });
    fs.mkdirSync(path.join(rootB, 'playwright-explore-website'), { recursive: true });
    fs.mkdirSync(path.join(rootB, 'react-best-practices'), { recursive: true });

    syncManagedGlobalSkills({ roots: [rootA, rootB] });

    expect(fs.existsSync(path.join(rootA, 'playwright-explore-website'))).toBe(false);
    expect(fs.existsSync(path.join(rootA, 'react-best-practices'))).toBe(false);
    expect(fs.existsSync(path.join(rootB, 'playwright-explore-website'))).toBe(false);
    expect(fs.existsSync(path.join(rootB, 'react-best-practices'))).toBe(false);
    expect(fs.existsSync(path.join(rootA, 'gateway-browser', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(rootB, 'gateway-browser', 'SKILL.md'))).toBe(true);
  });

  it('uses the current user home for default managed global skill roots', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-browser-home-'));
    const originalHome = process.env.HOME;

    process.env.HOME = tempHome;
    vi.resetModules();
    const mod = await import('../src/services/gateway-browser-skill.js');

    try {
      mod.syncManagedGlobalSkills();

      expect(fs.existsSync(path.join(tempHome, '.codex', 'skills', 'gateway-browser', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempHome, '.agents', 'skills', 'gateway-browser', 'SKILL.md'))).toBe(true);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });
});
