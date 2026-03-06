import { describe, expect, it } from 'vitest';

import { buildCodexArgs, buildCodexReviewArgs, parseCodexJsonl } from '../src/services/codex-runner.js';

describe('parseCodexJsonl', () => {
  it('parses thread id and latest agent message', () => {
    const raw = [
      JSON.stringify({ type: 'thread.started', thread_id: 't_123' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'second' } }),
    ].join('\n');

    const result = parseCodexJsonl(raw);
    expect(result.threadId).toBe('t_123');
    expect(result.answer).toBe('second');
  });

  it('ignores invalid lines and falls back when no answer', () => {
    const raw = '{not-json}\n' + JSON.stringify({ type: 'thread.started', thread_id: 't_456' });
    const result = parseCodexJsonl(raw);

    expect(result.threadId).toBe('t_456');
    expect(result.answer).toContain('未返回可解析内容');
  });
});

describe('buildCodexArgs', () => {
  it('includes --model when model is provided', () => {
    const args = buildCodexArgs(
      { prompt: 'hello', model: 'gpt-5-codex' },
      'full-auto',
    );
    expect(args).toEqual([
      'exec',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      '--model',
      'gpt-5-codex',
      'hello',
    ]);
  });

  it('builds resume args without --model when model is empty', () => {
    const args = buildCodexArgs(
      { prompt: 'hello', threadId: 'thread_123' },
      'none',
    );
    expect(args).toEqual([
      'exec',
      'resume',
      'thread_123',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      'hello',
    ]);
  });

  it('puts --search before exec when enabled', () => {
    const args = buildCodexArgs(
      { prompt: 'hello', model: 'gpt-5.4', search: true },
      'full-auto',
    );
    expect(args).toEqual([
      '--search',
      'exec',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      '--model',
      'gpt-5.4',
      'hello',
    ]);
  });
});

describe('buildCodexReviewArgs', () => {
  it('builds uncommitted review args', () => {
    const args = buildCodexReviewArgs(
      { mode: 'uncommitted', model: 'gpt-5.4', search: true },
      'full-auto',
    );
    expect(args).toEqual([
      '--search',
      'exec',
      'review',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      '--uncommitted',
      '--model',
      'gpt-5.4',
    ]);
  });

  it('builds base review args with prompt', () => {
    const args = buildCodexReviewArgs(
      { mode: 'base', target: 'main', prompt: 'focus on regressions' },
      'none',
    );
    expect(args).toEqual([
      'exec',
      'review',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--base',
      'main',
      'focus on regressions',
    ]);
  });
});
