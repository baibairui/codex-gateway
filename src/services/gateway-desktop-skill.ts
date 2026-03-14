import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GATEWAY_DESKTOP_SKILL_NAME = 'gateway-desktop';
const DESKTOP_RULE_START = '<!-- gateway:desktop-rule:start -->';
const DESKTOP_RULE_END = '<!-- gateway:desktop-rule:end -->';

interface GlobalSkillSyncOptions {
  roots?: string[];
}

export function installGatewayDesktopSkill(workspaceDir: string): void {
  installToSkillRoot(path.join(workspaceDir, '.codex', 'skills'));
  ensureAgentsDesktopRule(workspaceDir);
}

export function syncManagedGlobalDesktopSkills(options: GlobalSkillSyncOptions = {}): void {
  const roots = options.roots ?? defaultGlobalSkillRoots();
  for (const root of roots) {
    installToSkillRoot(root);
  }
}

export function renderGatewayDesktopSkill(): string {
  return [
    '---',
    'name: gateway-desktop',
    'description: Use when tasks require operating desktop applications. Run the bundled desktop script in this skill so actions stay observable and reversible.',
    '---',
    '',
    '# Gateway Desktop Skill',
    '',
    'When the user asks for desktop application operations, run the bundled script in this skill.',
    '',
    'Workflow:',
    '1. Check the current app state with `node ./.codex/skills/gateway-desktop/scripts/gateway-desktop.mjs frontmost-app` before deciding the next action.',
    '2. Execute one minimal action at a time (launch-app/activate-app/click/type-text/press-key/hotkey).',
    '3. capture a screenshot after each critical action and before any irreversible action.',
    '4. Report action, evidence, result, and next step.',
    '',
    'Environment:',
    '- `GATEWAY_DESKTOP_API_BASE`',
    '- `GATEWAY_INTERNAL_API_TOKEN`',
    '',
    'Examples:',
    '- `node ./.codex/skills/gateway-desktop/scripts/gateway-desktop.mjs frontmost-app`',
    '- `node ./.codex/skills/gateway-desktop/scripts/gateway-desktop.mjs launch-app --app-name "Finder"`',
    '- `node ./.codex/skills/gateway-desktop/scripts/gateway-desktop.mjs click --x 640 --y 420 --button left`',
    '- `node ./.codex/skills/gateway-desktop/scripts/gateway-desktop.mjs hotkey --keys Meta,Shift,4`',
    '- `node ./.codex/skills/gateway-desktop/scripts/gateway-desktop.mjs screenshot --filename desktop-step.png`',
    '',
    'Rules:',
    '- Operate the frontmost visible application only.',
    '- Do not run shell commands directly or invent another desktop wrapper.',
    '- If the next action is ambiguous, stop and ask for user direction.',
    '- Before send/delete/submit/payment or other irreversible actions, request confirmation if the user did not state it explicitly.',
    '- If an action fails twice, stop and report the current frontmost app and latest screenshot path.',
    '',
  ].join('\n');
}

function renderGatewayDesktopOpenAiYaml(): string {
  return [
    'interface:',
    '  display_name: "Gateway Desktop"',
    '  short_description: "Operate desktop applications through the gateway-desktop skill."',
    '  default_prompt: "Use $gateway-desktop when the user wants desktop app operations."',
    'policy:',
    '  allow_implicit_invocation: true',
    '',
  ].join('\n');
}

function renderGatewayDesktopScript(): string {
  return [
    '#!/usr/bin/env node',
    '',
    "import process from 'node:process';",
    '',
    "const apiBaseUrl = requireEnv('GATEWAY_DESKTOP_API_BASE');",
    "const internalToken = requireEnv('GATEWAY_INTERNAL_API_TOKEN');",
    'const argv = process.argv.slice(2);',
    "if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {",
    '  printHelp();',
    '  process.exit(0);',
    '}',
    '',
    'const [command, ...rest] = argv;',
    'const parsed = parseArgs(rest);',
    'const args = normalizeArgs(command, parsed);',
    '',
    'const response = await fetch(`${apiBaseUrl.replace(/\\/+$/, "")}/execute`, {',
    "  method: 'POST',",
    '  headers: {',
    "    'content-type': 'application/json',",
    "    'x-gateway-internal-token': internalToken,",
    '  },',
    '  body: JSON.stringify({ command, args }),',
    '});',
    '',
    'const payload = await response.json().catch(() => ({}));',
    'if (!response.ok || payload.ok !== true) {',
    "  const message = typeof payload.error === 'string' ? payload.error : `desktop command failed: ${response.status}`;",
    '  fail(message);',
    '}',
    '',
    'process.stdout.write(`${JSON.stringify(payload, null, 2)}\\n`);',
    '',
    'function printHelp() {',
    "  process.stdout.write([",
    "    'Gateway Desktop CLI',",
    "    '',",
    "    'Commands:',",
    "    '  launch-app --app-name <name>',",
    "    '  activate-app --app-name <name>',",
    "    '  frontmost-app',",
    "    '  move-mouse --x <n> --y <n>',",
    "    '  click [--x <n>] [--y <n>] [--button left|right] [--double true]',",
    "    '  drag --from-x <n> --from-y <n> --to-x <n> --to-y <n>',",
    "    '  type-text --text <value>',",
    "    '  press-key --key <key>',",
    "    '  hotkey --keys Meta,Shift,4',",
    "    '  screenshot [--filename desktop-step.png]',",
    "  ].join('\\n'));",
    '}',
    '',
    'function parseArgs(tokens) {',
    '  const output = {};',
    '  for (let i = 0; i < tokens.length; i += 1) {',
    '    const token = tokens[i];',
    "    if (!token.startsWith('--')) {",
    '      fail(`unexpected argument: ${token}`);',
    '    }',
    '    const key = token.slice(2);',
    '    const value = tokens[i + 1];',
    "    if (!value || value.startsWith('--')) {",
    "      output[key] = 'true';",
    '      continue;',
    '    }',
    '    output[key] = value;',
    '    i += 1;',
    '  }',
    '  return output;',
    '}',
    '',
    'function normalizeArgs(command, parsed) {',
    '  switch (command) {',
    "    case 'frontmost-app':",
    '      return {};',
    "    case 'launch-app':",
    "    case 'activate-app':",
    '      return { appName: stringValue(parsed["app-name"] ?? parsed.appName) };',
    "    case 'move-mouse':",
    '      return { x: requiredNumber(parsed.x, "--x"), y: requiredNumber(parsed.y, "--y") };',
    "    case 'click':",
    '      return {',
    '        x: optionalNumber(parsed.x),',
    '        y: optionalNumber(parsed.y),',
    '        button: optionalString(parsed.button) ?? "left",',
    '        double: booleanValue(parsed.double),',
    '      };',
    "    case 'drag':",
    '      return {',
    '        from: { x: requiredNumber(parsed["from-x"], "--from-x"), y: requiredNumber(parsed["from-y"], "--from-y") },',
    '        to: { x: requiredNumber(parsed["to-x"], "--to-x"), y: requiredNumber(parsed["to-y"], "--to-y") },',
    '      };',
    "    case 'type-text':",
    '      return { text: stringValue(parsed.text) };',
    "    case 'press-key':",
    '      return { key: stringValue(parsed.key) };',
    "    case 'hotkey':",
    '      return { keys: arrayValue(parsed.keys) };',
    "    case 'screenshot':",
    '      return { filename: optionalString(parsed.filename) };',
    '    default:',
    '      fail(`unsupported desktop command: ${command}`);',
    '  }',
    '}',
    '',
    'function arrayValue(value) {',
    "  return typeof value === 'string' && value.trim() ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];",
    '}',
    '',
    'function stringValue(value) {',
    "  if (typeof value === 'string' && value.trim()) {",
    '    return value.trim();',
    '  }',
    "  fail('missing required string argument');",
    '}',
    '',
    'function optionalString(value) {',
    "  return typeof value === 'string' && value.trim() ? value.trim() : undefined;",
    '}',
    '',
    'function requiredNumber(value, flagName) {',
    '  const next = Number(value);',
    '  if (Number.isFinite(next)) {',
    '    return next;',
    '  }',
    '  fail(`missing or invalid ${flagName}`);',
    '}',
    '',
    'function optionalNumber(value) {',
    '  const next = Number(value);',
    '  return Number.isFinite(next) ? next : undefined;',
    '}',
    '',
    'function booleanValue(value) {',
    "  return value === true || value === 'true';",
    '}',
    '',
    'function requireEnv(name) {',
    '  const value = process.env[name];',
    "  if (typeof value === 'string' && value.trim()) {",
    '    return value.trim();',
    '  }',
    "  if (name === 'GATEWAY_DESKTOP_API_BASE') {",
    "    fail('desktop gateway is unavailable in this session. Restart the gateway after desktop automation initializes successfully; do not ask the user to configure this env manually.');",
    '  }',
    "  if (name === 'GATEWAY_INTERNAL_API_TOKEN') {",
    "    fail('desktop gateway internal auth is unavailable in this session. Restart the gateway; do not ask the user to configure this env manually.');",
    '  }',
    '  fail(`missing required env: ${name}`);',
    '}',
    '',
    'function fail(message) {',
    '  process.stderr.write(`${message}\\n`);',
    '  process.exit(1);',
    '}',
    '',
  ].join('\n');
}

function renderAgentsDesktopRuleSection(): string {
  return [
    DESKTOP_RULE_START,
    '桌面操作职责：',
    '- 当任务需要桌面软件交互时，只允许使用 `./.codex/skills/gateway-desktop/SKILL.md` 及其自带脚本完成操作，不要直接执行 shell 命令或自行调用 osascript。',
    '- 只操作前台可见应用；如果目标应用不在前台，先用 skill 激活或启动它。',
    '- 每次关键动作后都要补一张截图作为证据，按“Action / Evidence / Result / Next step”回报。',
    '- 涉及发送、删除、支付、权限确认等不可逆动作时，若用户未明确授权，先暂停并请求确认。',
    DESKTOP_RULE_END,
  ].join('\n');
}

function installToSkillRoot(skillRootDir: string): void {
  const skillDir = path.join(skillRootDir, GATEWAY_DESKTOP_SKILL_NAME);
  fs.mkdirSync(path.join(skillDir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
  writeIfChanged(path.join(skillDir, 'SKILL.md'), renderGatewayDesktopSkill());
  writeIfChanged(path.join(skillDir, 'agents', 'openai.yaml'), renderGatewayDesktopOpenAiYaml());
  writeIfChanged(path.join(skillDir, 'scripts', 'gateway-desktop.mjs'), renderGatewayDesktopScript());
}

function ensureAgentsDesktopRule(workspaceDir: string): void {
  const agentsPath = path.join(workspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    return;
  }
  const content = fs.readFileSync(agentsPath, 'utf8');
  const next = upsertManagedSection(
    content,
    DESKTOP_RULE_START,
    DESKTOP_RULE_END,
    renderAgentsDesktopRuleSection(),
    [
      /(?:\n|^)桌面操作职责：[\s\S]*?(?=\n开始任何任务前，先阅读这些记忆文件：|\n<!-- gateway:desktop-rule:start -->|\n$)/m,
    ],
  );
  if (next !== content) {
    fs.writeFileSync(agentsPath, `${next.trimEnd()}\n`, 'utf8');
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

function defaultGlobalSkillRoots(): string[] {
  const homeDir = process.env.HOME?.trim() || os.homedir();
  return [
    path.join(homeDir, '.codex', 'skills'),
    path.join(homeDir, '.agents', 'skills'),
  ];
}

function upsertManagedSection(
  content: string,
  startMarker: string,
  endMarker: string,
  section: string,
  legacyPatterns: RegExp[],
): string {
  let next = content;
  for (const pattern of legacyPatterns) {
    next = next.replace(pattern, '\n');
  }
  const start = next.indexOf(startMarker);
  const end = next.indexOf(endMarker);
  if (start >= 0 && end > start) {
    const before = next.slice(0, start).trimEnd();
    const after = next.slice(end + endMarker.length).trimStart();
    return [before, section, after].filter(Boolean).join('\n\n');
  }
  return `${next.trimEnd()}\n\n${section}\n`;
}
