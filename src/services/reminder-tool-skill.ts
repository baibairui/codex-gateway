import fs from 'node:fs';
import path from 'node:path';

export const REMINDER_TOOL_SKILL_NAME = 'reminder-tool';
const REMINDER_RULE_START = '<!-- gateway:reminder-rule:start -->';
const REMINDER_RULE_END = '<!-- gateway:reminder-rule:end -->';

export function installReminderToolSkill(workspaceDir: string): void {
  installToSkillRoot(path.join(workspaceDir, '.codex', 'skills'));
  removeLegacySkillDirs(workspaceDir);
  ensureAgentsReminderRule(workspaceDir);
}

export function renderReminderToolSkill(): string {
  return [
    '---',
    'name: reminder-tool',
    'description: Use when a user asks to be reminded later, at a time, after a delay, or on a schedule in the current chat. Calls the create_reminder MCP tool to create a durable reminder task instead of emitting reminder-action text blocks or asking the user to run /remind.',
    '---',
    '',
    '# Reminder Tool',
    '',
    'When the user asks for a reminder, call the `create_reminder` tool.',
    '',
    'Use this workflow:',
    '1. Extract the delay and reminder message.',
    '2. If the delay is ambiguous, ask a follow-up question before calling the tool.',
    '3. Call `create_reminder` with either `delay` or `delayMs`, plus `message`.',
    '4. Tell the user the reminder has been created. Do not emit raw tool payloads or fenced action blocks.',
    '',
    'Rules:',
    '- Prefer `delay` for simple durations such as `5min`, `2h`, `1d`.',
    '- Keep `message` short, concrete, and action-oriented.',
    '- Never ask the user to type `/remind`.',
    '- Never output ```reminder-action blocks.',
    '',
    'Examples:',
    '- User: `20分钟后提醒我开会`',
    '  Call: `create_reminder(delay=\"20min\", message=\"开会\")`',
    '- User: `明天提醒我交周报`',
    '  If the exact trigger time is unclear, ask for a concrete time first.',
    '',
  ].join('\n');
}

function renderReminderToolOpenAiYaml(): string {
  return [
    'interface:',
    '  display_name: "Reminder Tool"',
    '  short_description: "Create durable chat reminders with the reminder MCP tool."',
    '  default_prompt: "Use $reminder-tool to create a reminder for this chat with the create_reminder tool."',
    'policy:',
    '  allow_implicit_invocation: true',
    '',
  ].join('\n');
}

function writeIfChanged(filePath: string, content: string): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
  if (existing === content) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function ensureAgentsReminderRule(workspaceDir: string): void {
  const agentsPath = path.join(workspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    return;
  }
  const content = fs.readFileSync(agentsPath, 'utf8');
  const reminderSection = [
    REMINDER_RULE_START,
    '提醒规则：',
    '- 用户提出“稍后提醒我”或定时任务需求时，优先使用 `./.codex/skills/reminder-tool/SKILL.md`。',
    '- 必须调用 `create_reminder` 工具创建提醒，不要要求用户输入 `/remind`。',
    REMINDER_RULE_END,
  ].join('\n');
  const next = upsertManagedSection(content, REMINDER_RULE_START, REMINDER_RULE_END, reminderSection, [
    /(?:\n|^)提醒规则：[\s\S]*?(?=\n[A-Z\u4e00-\u9fff#].*：|\n执行权限规则：|\n飞书官方操作规则：|\n$)/m,
  ]);
  if (next !== content) {
    fs.writeFileSync(agentsPath, `${next.trimEnd()}\n`, 'utf8');
  }
}

function installToSkillRoot(skillRootDir: string): void {
  const skillDir = path.join(skillRootDir, REMINDER_TOOL_SKILL_NAME);
  fs.mkdirSync(path.join(skillDir, 'agents'), { recursive: true });
  writeIfChanged(path.join(skillDir, 'SKILL.md'), renderReminderToolSkill());
  writeIfChanged(path.join(skillDir, 'agents', 'openai.yaml'), renderReminderToolOpenAiYaml());
}

function removeLegacySkillDirs(workspaceDir: string): void {
  fs.rmSync(path.join(workspaceDir, 'skills', REMINDER_TOOL_SKILL_NAME), { recursive: true, force: true });
  fs.rmSync(path.join(workspaceDir, '.agent', 'skills', REMINDER_TOOL_SKILL_NAME), { recursive: true, force: true });
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
