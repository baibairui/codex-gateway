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
      { prompt: 'hello', model: 'gpt-5-codex', workdir: '/tmp/agent-a' },
      'full-auto',
    );
    expect(args).toEqual([
      '--cd',
      '/tmp/agent-a',
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
      { prompt: 'hello', threadId: 'thread_123', workdir: '/tmp/agent-a' },
      'none',
    );
    expect(args).toEqual([
      '--cd',
      '/tmp/agent-a',
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
      { prompt: 'hello', model: 'gpt-5.4', search: true, workdir: '/tmp/agent-b' },
      'full-auto',
    );
    expect(args).toEqual([
      '--search',
      '--cd',
      '/tmp/agent-b',
      'exec',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      '--model',
      'gpt-5.4',
      'hello',
    ]);
  });

  it('injects reminder MCP server config when reminder tool context is provided', () => {
    const args = buildCodexArgs(
      {
        prompt: 'remind me later',
        workdir: '/tmp/agent-d',
        reminderToolContext: {
          dbPath: '/tmp/reminders.db',
          channel: 'wecom',
          userId: 'u1',
          agentId: 'assistant',
        },
      },
      'full-auto',
    );

    expect(args).toContain('-c');
    expect(args).toContain('mcp_servers.gateway_reminder.command="node"');
    expect(args).toContain('mcp_servers.gateway_reminder.env.REMINDER_DB_PATH="/tmp/reminders.db"');
    expect(args).toContain('mcp_servers.gateway_reminder.env.REMINDER_CHANNEL="wecom"');
    expect(args).toContain('mcp_servers.gateway_reminder.env.REMINDER_USER_ID="u1"');
    expect(args).toContain('mcp_servers.gateway_reminder.env.REMINDER_AGENT_ID="assistant"');
  });

});

describe('buildCodexReviewArgs', () => {
  it('builds uncommitted review args', () => {
    const args = buildCodexReviewArgs(
      { mode: 'uncommitted', model: 'gpt-5.4', search: true, workdir: '/tmp/agent-b' },
      'full-auto',
    );
    expect(args).toEqual([
      '--search',
      '--cd',
      '/tmp/agent-b',
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
      { mode: 'base', target: 'main', prompt: 'focus on regressions', workdir: '/tmp/agent-c' },
      'none',
    );
    expect(args).toEqual([
      '--cd',
      '/tmp/agent-c',
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
