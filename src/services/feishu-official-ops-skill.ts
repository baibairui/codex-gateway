import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FEISHU_OFFICIAL_OPS_SKILL_NAME = 'feishu-official-ops';
const FEISHU_RULE_START = '<!-- gateway:feishu-ops:start -->';
const FEISHU_RULE_END = '<!-- gateway:feishu-ops:end -->';

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
  const section = [
    FEISHU_RULE_START,
    '飞书官方操作规则：',
    '- 用户要求创建飞书文档、知识库节点等真实飞书对象时，优先使用 `./.codex/skills/feishu-official-ops/SKILL.md`。',
    '- 按 `./feishu-ops-playbook.md` 的标准流程执行，先探测后写入。',
    '- 必须执行该 skill 自带脚本完成真实操作，不要口头声称“已创建”。',
    '- 若用户要求往飞书文档插入图片，或上下文里已经有 `local_image_path=...`，优先使用 `docx create/append` 的 `--image-file` 参数，不要假设 markdown 会自动带图。',
    '- 禁止在未执行任何只读探测前，直接下结论“没有飞书 wiki/docx 能力”。',
    '- 若用户问“有没有接入/有没有能力”，先执行一次只读探测（优先 `wiki list-spaces`）；按真实返回给结论：鉴权缺失、权限不足、接口可用三者必须区分清楚。',
    FEISHU_RULE_END,
  ].join('\n');
  const next = upsertManagedSection(content, FEISHU_RULE_START, FEISHU_RULE_END, section, [
    /(?:\n|^)飞书官方操作规则：[\s\S]*?(?=\n[A-Z\u4e00-\u9fff#].*：|\n执行权限规则：|\n提醒规则：|\n$)/m,
  ]);
  if (next !== content) {
    fs.writeFileSync(agentsPath, `${next.trimEnd()}\n`, 'utf8');
  }
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
