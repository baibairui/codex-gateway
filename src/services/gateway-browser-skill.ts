import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GATEWAY_BROWSER_SKILL_NAME = 'gateway-browser';
const LEGACY_SKILL_NAMES = ['playwright-explore-website', 'react-best-practices'];

interface GlobalSkillSyncOptions {
  roots?: string[];
}

export function installGatewayBrowserSkill(workspaceDir: string): void {
  installToSkillRoot(path.join(workspaceDir, '.codex', 'skills'));
}

export function syncManagedGlobalSkills(options: GlobalSkillSyncOptions = {}): void {
  const roots = options.roots ?? defaultGlobalSkillRoots();
  for (const root of roots) {
    installToSkillRoot(root);
    purgeLegacySkills(root);
  }
}

export function renderGatewayBrowserSkill(): string {
  return [
    '---',
    'name: gateway-browser',
    'description: Use when tasks require operating web pages. Prefer gateway_browser MCP tools and keep actions observable and reversible.',
    '---',
    '',
    '# Gateway Browser Skill',
    '',
    'When the user asks for browser operations, use `gateway_browser` MCP tools.',
    '',
    'Workflow:',
    '1. Read current page state with `browser_snapshot`.',
    '2. Execute one minimal action at a time (click/type/select/navigate/wait).',
    '3. Re-check state with `browser_snapshot` or screenshot after each key action.',
    '4. Report action, evidence, result, and next step.',
    '',
    'Rules:',
    '- Reuse existing tabs whenever possible.',
    '- Do not run playwright-cli or external browser scripts.',
    '- On login/OTP/captcha/payment confirmation, request user takeover.',
    '- If an action fails twice, stop and ask for user decision.',
    '',
  ].join('\n');
}

function installToSkillRoot(skillRootDir: string): void {
  const skillDir = path.join(skillRootDir, GATEWAY_BROWSER_SKILL_NAME);
  fs.mkdirSync(skillDir, { recursive: true });
  writeIfChanged(path.join(skillDir, 'SKILL.md'), renderGatewayBrowserSkill());
}

function purgeLegacySkills(skillRootDir: string): void {
  for (const name of LEGACY_SKILL_NAMES) {
    fs.rmSync(path.join(skillRootDir, name), { recursive: true, force: true });
  }
}

function writeIfChanged(filePath: string, content: string): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
  if (existing === content) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function defaultGlobalSkillRoots(): string[] {
  const homeDir = process.env.HOME?.trim() || os.homedir();
  return [
    path.join(homeDir, '.codex', 'skills'),
    path.join(homeDir, '.agents', 'skills'),
  ];
}
