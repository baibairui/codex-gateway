import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexModelInfo {
  slug: string;
  visibility: 'list' | 'hide' | string;
  supportedInApi: boolean;
}

export interface CodexModelsSnapshot {
  fetchedAt?: string;
  models: CodexModelInfo[];
}

export function defaultModelsCachePath(): string {
  return path.join(os.homedir(), '.codex', 'models_cache.json');
}

export function loadCodexModels(cachePath = defaultModelsCachePath()): CodexModelsSnapshot {
  if (!fs.existsSync(cachePath)) {
    return { models: [] };
  }
  const raw = fs.readFileSync(cachePath, 'utf8');
  const parsed = JSON.parse(raw) as { fetched_at?: unknown; models?: unknown[] };
  const models = (parsed.models ?? [])
    .map((item) => normalizeModel(item))
    .filter((item): item is CodexModelInfo => !!item);
  return {
    fetchedAt: typeof parsed.fetched_at === 'string' ? parsed.fetched_at : undefined,
    models,
  };
}

function normalizeModel(input: unknown): CodexModelInfo | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const data = input as Record<string, unknown>;
  const slug = typeof data.slug === 'string' ? data.slug : '';
  if (!slug) {
    return undefined;
  }
  return {
    slug,
    visibility: typeof data.visibility === 'string' ? data.visibility : 'list',
    supportedInApi: data.supported_in_api !== false,
  };
}

export function formatCodexModelsText(snapshot: CodexModelsSnapshot): string {
  if (snapshot.models.length === 0) {
    return '未找到模型缓存。先在本机执行一次 codex 命令后再试 /models。';
  }
  const listed = snapshot.models
    .filter((m) => m.visibility === 'list')
    .map((m) => `- ${m.slug}`);
  const hidden = snapshot.models
    .filter((m) => m.visibility !== 'list')
    .map((m) => `- ${m.slug}`);
  const lines = ['Codex 模型列表（来自本机缓存）：'];
  if (listed.length > 0) {
    lines.push('可见模型：', ...listed);
  }
  if (hidden.length > 0) {
    lines.push('隐藏/兼容模型：', ...hidden);
  }
  if (snapshot.fetchedAt) {
    lines.push(`缓存时间：${snapshot.fetchedAt}`);
  }
  return lines.join('\n');
}

export interface ResolveModelResult {
  ok: boolean;
  model?: string;
  reason?: string;
}

export function resolveModelFromSnapshot(input: string, snapshot: CodexModelsSnapshot): ResolveModelResult {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, reason: '模型名不能为空' };
  }
  if (snapshot.models.length === 0) {
    return {
      ok: true,
      model: raw,
      reason: '未找到本机模型缓存，已跳过合法性校验',
    };
  }

  const exact = snapshot.models.find((m) => m.slug === raw);
  if (exact) {
    return { ok: true, model: exact.slug };
  }

  const lower = raw.toLowerCase();
  const ci = snapshot.models.find((m) => m.slug.toLowerCase() === lower);
  if (ci) {
    return { ok: true, model: ci.slug };
  }

  const suggestions = snapshot.models
    .map((m) => m.slug)
    .filter((slug) => slug.includes(lower))
    .slice(0, 6);

  return {
    ok: false,
    reason: suggestions.length > 0
      ? `模型不受支持：${raw}\n你可能想用：${suggestions.join(', ')}`
      : `模型不受支持：${raw}\n发送 /models 查看当前支持列表。`,
  };
}
