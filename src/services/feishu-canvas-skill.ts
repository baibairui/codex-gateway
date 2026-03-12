import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FEISHU_CANVAS_SKILL_NAME = 'feishu-canvas';

const SOURCE_SKILL_DIR = fileURLToPath(
  new URL(`../../.codex/skills/${FEISHU_CANVAS_SKILL_NAME}`, import.meta.url),
);

export function installFeishuCanvasSkill(workspaceDir: string): void {
  const skillRootDir = path.join(workspaceDir, '.codex', 'skills');
  const targetSkillDir = path.join(skillRootDir, FEISHU_CANVAS_SKILL_NAME);
  if (path.resolve(targetSkillDir) === path.resolve(SOURCE_SKILL_DIR)) {
    return;
  }
  fs.mkdirSync(skillRootDir, { recursive: true });
  fs.rmSync(targetSkillDir, { recursive: true, force: true });
  fs.cpSync(SOURCE_SKILL_DIR, targetSkillDir, { recursive: true, force: true });
}
