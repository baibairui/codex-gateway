import fs from 'node:fs';
import path from 'node:path';

import { listSkillsForAgentWorkspace, type SkillCatalogEntry } from './skill-registry.js';

interface AgentSkillPolicy {
  disabledGlobalSkills: string[];
  disabledAgentSkills: string[];
}

const POLICY_FILE = path.join('.codex', 'agent-skill-policy.json');

export class AgentSkillManager {
  listGlobalSkills(workspaceDir: string): SkillCatalogEntry[] {
    return listSkillsForAgentWorkspace(workspaceDir).filter((item) => item.source === 'global');
  }

  listAgentLocalSkills(workspaceDir: string): SkillCatalogEntry[] {
    return listSkillsForAgentWorkspace(workspaceDir).filter((item) => item.source === 'agent-local');
  }

  listEffectiveSkills(workspaceDir: string): SkillCatalogEntry[] {
    const policy = this.readPolicy(workspaceDir);
    const disabledGlobal = new Set(policy.disabledGlobalSkills.map(normalizeSkillName));
    const disabledAgent = new Set(policy.disabledAgentSkills.map(normalizeSkillName));
    return listSkillsForAgentWorkspace(workspaceDir).filter((item) => {
      const normalized = normalizeSkillName(item.name);
      return item.source === 'global'
        ? !disabledGlobal.has(normalized)
        : !disabledAgent.has(normalized);
    });
  }

  disableGlobalSkill(workspaceDir: string, skillName: string): { ok: boolean; reason?: string } {
    const normalized = normalizeSkillName(skillName);
    const exists = this.listGlobalSkills(workspaceDir).some((item) => normalizeSkillName(item.name) === normalized);
    if (!exists) {
      return { ok: false, reason: `未找到全局 skill：${skillName}` };
    }
    const policy = this.readPolicy(workspaceDir);
    policy.disabledGlobalSkills = addUnique(policy.disabledGlobalSkills, normalized);
    this.writePolicy(workspaceDir, policy);
    return { ok: true };
  }

  enableGlobalSkill(workspaceDir: string, skillName: string): { ok: boolean; reason?: string } {
    const normalized = normalizeSkillName(skillName);
    const exists = this.listGlobalSkills(workspaceDir).some((item) => normalizeSkillName(item.name) === normalized);
    if (!exists) {
      return { ok: false, reason: `未找到全局 skill：${skillName}` };
    }
    const policy = this.readPolicy(workspaceDir);
    policy.disabledGlobalSkills = policy.disabledGlobalSkills.filter((item) => normalizeSkillName(item) !== normalized);
    this.writePolicy(workspaceDir, policy);
    return { ok: true };
  }

  disableAgentSkill(workspaceDir: string, skillName: string): { ok: boolean; reason?: string } {
    const normalized = normalizeSkillName(skillName);
    const exists = this.listAgentLocalSkills(workspaceDir).some((item) => normalizeSkillName(item.name) === normalized);
    if (!exists) {
      return { ok: false, reason: `未找到当前 agent skill：${skillName}` };
    }
    const policy = this.readPolicy(workspaceDir);
    policy.disabledAgentSkills = addUnique(policy.disabledAgentSkills, normalized);
    this.writePolicy(workspaceDir, policy);
    return { ok: true };
  }

  getPolicy(workspaceDir: string): AgentSkillPolicy {
    return this.readPolicy(workspaceDir);
  }

  private readPolicy(workspaceDir: string): AgentSkillPolicy {
    const filePath = path.join(workspaceDir, POLICY_FILE);
    if (!fs.existsSync(filePath)) {
      return {
        disabledGlobalSkills: [],
        disabledAgentSkills: [],
      };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      return {
        disabledGlobalSkills: Array.isArray(raw.disabledGlobalSkills)
          ? raw.disabledGlobalSkills.map((item) => normalizeSkillName(String(item)))
          : [],
        disabledAgentSkills: Array.isArray(raw.disabledAgentSkills)
          ? raw.disabledAgentSkills.map((item) => normalizeSkillName(String(item)))
          : [],
      };
    } catch {
      return {
        disabledGlobalSkills: [],
        disabledAgentSkills: [],
      };
    }
  }

  private writePolicy(workspaceDir: string, policy: AgentSkillPolicy): void {
    const filePath = path.join(workspaceDir, POLICY_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(policy, null, 2), 'utf8');
  }
}

function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase();
}

function addUnique(list: string[], value: string): string[] {
  const exists = list.some((item) => normalizeSkillName(item) === value);
  if (exists) {
    return list;
  }
  return [...list, value];
}
