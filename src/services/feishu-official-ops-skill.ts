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
    '- 用户要求创建飞书文档、知识库节点、个人日程、个人待办等真实飞书对象时，优先使用 `./.codex/skills/feishu-official-ops/SKILL.md`。',
    '- DocX / Wiki 走 `./feishu-ops-playbook.md` 的标准流程；不要再尝试任何个人授权链路。',
    '- DocX / Wiki 写入完成的判定标准是真实返回 document_id / document_url / node token；只产出 markdown 文本不算完成。',
    '- DocX / Wiki 使用应用凭据直接写，不需要用户个人授权；禁止把文档写入结果再引导到任何用户登录。',
    '- 用户说“帮我建日程”这类当前用户个人日历事务时，默认走 `calendar create-personal-event`，不要误用共享 `calendar create-event`。',
    '- 用户说“我的待办”这类当前用户个人任务事务时，默认走 `task create-personal-task`，不要误用共享 `task create`。',
    '- 只有当用户明确要求共享日历、项目日历、共享任务对象，或已经提供了 `calendar-id` / `task_guid` / `tasklist_guid` 之类共享对象标识时，才走共享命令。',
    '- 当前聊天用户标识优先复用 `GATEWAY_USER_ID`；不要让用户重复手填自己的 gateway user id。',
    '- 个人日历 / 个人任务如果返回 `authorization_required`，优先复用结果里的 `required-scopes-json` 执行 device auth，成功后重试同一个个人命令，不要切回共享命令凑结果。',
    '- 个人日历 / 个人任务如果返回 `99991679`、`99991672` 或缺 scope 错误，立刻执行 `auth diagnose-permission` 继续分类；需要重授权时把缺失 scope 回填到 `auth start-device-auth`，不要只停在泛化解释，更不要问“要不要我继续”。',
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
