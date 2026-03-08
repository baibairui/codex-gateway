import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FEISHU_OFFICIAL_OPS_SKILL_NAME = 'feishu-official-ops';

const SOURCE_SKILL_DIR = fileURLToPath(
  new URL(`../../.codex/skills/${FEISHU_OFFICIAL_OPS_SKILL_NAME}`, import.meta.url),
);

export function installFeishuOfficialOpsSkill(workspaceDir: string): void {
  installToSkillRoot(path.join(workspaceDir, '.codex', 'skills'));
  ensureAgentsFeishuOpsRule(workspaceDir);
}

function installToSkillRoot(skillRootDir: string): void {
  const targetSkillDir = path.join(skillRootDir, FEISHU_OFFICIAL_OPS_SKILL_NAME);
  if (path.resolve(targetSkillDir) === path.resolve(SOURCE_SKILL_DIR)) {
    return;
  }
  fs.mkdirSync(skillRootDir, { recursive: true });
  fs.rmSync(targetSkillDir, { recursive: true, force: true });
  fs.cpSync(SOURCE_SKILL_DIR, targetSkillDir, { recursive: true, force: true });
}

function ensureAgentsFeishuOpsRule(workspaceDir: string): void {
  const agentsPath = path.join(workspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    return;
  }
  const content = fs.readFileSync(agentsPath, 'utf8');
  if (
    content.includes('./.codex/skills/feishu-official-ops/SKILL.md')
    || content.includes('$feishu-official-ops')
  ) {
    return;
  }
  const section = [
    '',
    '飞书官方操作规则：',
    '- 用户要求创建飞书文档、知识库节点等真实飞书对象时，优先使用 `./.codex/skills/feishu-official-ops/SKILL.md`。',
    '- 必须调用该 skill 附带的 OpenAPI CLI 执行真实操作，不要口头声称“已创建”。',
    '',
  ].join('\n');
  fs.writeFileSync(agentsPath, `${content.trimEnd()}\n${section}`, 'utf8');
}
