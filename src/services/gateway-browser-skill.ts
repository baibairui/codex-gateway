import fs from 'node:fs';
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
  const roots = options.roots ?? ['/root/.codex/skills', '/root/.agents/skills'];
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
    '1. Read current page state with `browser_snapshot` before deciding the next action.',
    '2. Execute one minimal action at a time (click/type/select/navigate/wait).',
    '3. Re-run `browser_snapshot` after each key action; refs are not stable across navigations.',
    '4. If needed, use screenshot/console/network tools to collect evidence.',
    '5. Report action, evidence, result, and next step.',
    '',
    'Rules:',
    '- Reuse existing tabs whenever possible.',
    '- Prefer visible, reversible actions over hidden shortcuts.',
    '- Do not run playwright-cli or external browser scripts.',
    '- On login/OTP/captcha/payment confirmation, request user takeover.',
    '- Before submit/delete/publish/payment or other irreversible actions, capture evidence and confirm intent if the user did not state it explicitly.',
    '- If the page is visually unclear or the user asks what is on screen, capture a screenshot instead of guessing from stale refs.',
    '- If an action fails twice, stop and ask for user decision.',
    '- If a click/type fails, refresh the snapshot first, then inspect console/network before retrying.',
    '- During user takeover, keep the current tab/state intact and report the exact resume point.',
    '- Treat logged-in browser profiles, cookies, and storage as sensitive data.',
    '- Avoid arbitrary page-context JS unless it is necessary to inspect or unblock the task.',
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
