import { describe, expect, it } from 'vitest';

import { formatCodexModelsText, resolveModelFromSnapshot } from '../src/services/codex-models.js';

describe('formatCodexModelsText', () => {
  it('renders listed and hidden models', () => {
    const text = formatCodexModelsText({
      fetchedAt: '2026-03-06T08:45:20Z',
      models: [
        { slug: 'gpt-5.4', visibility: 'list', supportedInApi: true },
        { slug: 'gpt-5.1-codex', visibility: 'hide', supportedInApi: true },
      ],
    });
    expect(text).toContain('可见模型');
    expect(text).toContain('gpt-5.4');
    expect(text).toContain('隐藏/兼容模型');
    expect(text).toContain('gpt-5.1-codex');
    expect(text).toContain('缓存时间');
  });

  it('returns fallback text when no models found', () => {
    const text = formatCodexModelsText({ models: [] });
    expect(text).toContain('未找到模型缓存');
  });
});

describe('resolveModelFromSnapshot', () => {
  const snapshot = {
    models: [
      { slug: 'gpt-5.4', visibility: 'list' as const, supportedInApi: true },
      { slug: 'gpt-5.3-codex', visibility: 'list' as const, supportedInApi: true },
      { slug: 'gpt-5.1-codex', visibility: 'hide' as const, supportedInApi: true },
    ],
  };

  it('accepts exact model name', () => {
    const result = resolveModelFromSnapshot('gpt-5.4', snapshot);
    expect(result.ok).toBe(true);
    expect(result.model).toBe('gpt-5.4');
  });

  it('accepts model name with different case and normalizes slug', () => {
    const result = resolveModelFromSnapshot('GPT-5.3-CODEX', snapshot);
    expect(result.ok).toBe(true);
    expect(result.model).toBe('gpt-5.3-codex');
  });

  it('returns suggestions when model is unsupported', () => {
    const result = resolveModelFromSnapshot('gpt-5', snapshot);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('你可能想用');
  });

  it('allows model when cache is missing', () => {
    const result = resolveModelFromSnapshot('anything-model', { models: [] });
    expect(result.ok).toBe(true);
    expect(result.model).toBe('anything-model');
    expect(result.reason).toContain('跳过合法性校验');
  });
});
