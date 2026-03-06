import { describe, expect, it } from 'vitest';

import { commandNeedsDetailedSessions, handleUserCommand } from '../src/features/user-command.js';

describe('handleUserCommand', () => {
  it('passes through normal text', () => {
    const result = handleUserCommand('hello', 't_1234');
    expect(result.handled).toBe(false);
  });

  it('supports /help', () => {
    const result = handleUserCommand('/help', 't_1234');
    expect(result.handled).toBe(true);
    expect(result.message).toContain('可用命令');
  });

  it('supports /clear', () => {
    const result = handleUserCommand('/clear', 't_1234');
    expect(result.handled).toBe(true);
    expect(result.clearSession).toBe(true);
  });

  it('supports /session', () => {
    const result = handleUserCommand('/session', 'thread_abcdef123456');
    expect(result.handled).toBe(true);
    expect(result.message).toContain('当前会话');
  });

  it('supports /switch with thread id', () => {
    const result = handleUserCommand('/switch thread_1234567890', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.switchTarget).toBe('thread_1234567890');
    expect(result.message).toBeUndefined();
  });

  it('shows usage when /switch has no args', () => {
    const result = handleUserCommand('/switch', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.switchTarget).toBeUndefined();
    expect(result.message).toContain('/switch <编号|threadId>');
  });

  it('supports /sessions list rendering', () => {
    const result = handleUserCommand('/sessions', 'thread_aabbccdd0011', [
      { threadId: 'thread_aabbccdd0011', name: '当前任务', lastPrompt: '修复回调签名错误', updatedAt: 1 },
      { threadId: 'thread_223344556677', lastPrompt: '补充 README', updatedAt: 1 },
    ]);
    expect(result.handled).toBe(true);
    expect(result.message).toContain('会话列表');
    expect(result.message).toContain('当前任务');
    expect(result.message).toContain('修复回调签名错误');
    expect(result.message).toContain('1.');
    expect(result.message).toContain('/switch <编号>');
  });

  it('supports /rename', () => {
    const result = handleUserCommand('/rename 2 发布准备', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.renameTarget).toBe('2');
    expect(result.renameName).toBe('发布准备');
  });

  it('shows usage when /rename args missing', () => {
    const result = handleUserCommand('/rename 2', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.message).toContain('/rename <编号|threadId> <名称>');
  });

  it('supports /model query', () => {
    const result = handleUserCommand('/model', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.queryModel).toBe(true);
  });

  it('supports /model set', () => {
    const result = handleUserCommand('/model gpt-5-codex', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.setModel).toBe('gpt-5-codex');
  });

  it('supports /model reset', () => {
    const result = handleUserCommand('/model reset', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.clearModel).toBe(true);
  });

  it('rejects /model with spaces in model name', () => {
    const result = handleUserCommand('/model gpt 5', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.message).toContain('模型名不能包含空格');
  });

  it('supports /models query', () => {
    const result = handleUserCommand('/models', 'thread_old');
    expect(result.handled).toBe(true);
    expect(result.queryModels).toBe(true);
  });

  it('supports /search query and toggle', () => {
    const query = handleUserCommand('/search', 'thread_old');
    expect(query.handled).toBe(true);
    expect(query.querySearch).toBe(true);

    const on = handleUserCommand('/search on', 'thread_old');
    expect(on.handled).toBe(true);
    expect(on.setSearchEnabled).toBe(true);

    const off = handleUserCommand('/search off', 'thread_old');
    expect(off.handled).toBe(true);
    expect(off.setSearchEnabled).toBe(false);
  });

  it('supports /review command', () => {
    const uncommitted = handleUserCommand('/review', 'thread_old');
    expect(uncommitted.handled).toBe(true);
    expect(uncommitted.reviewMode).toBe('uncommitted');

    const base = handleUserCommand('/review base main', 'thread_old');
    expect(base.handled).toBe(true);
    expect(base.reviewMode).toBe('base');
    expect(base.reviewTarget).toBe('main');

    const commit = handleUserCommand('/review commit abc123', 'thread_old');
    expect(commit.handled).toBe(true);
    expect(commit.reviewMode).toBe('commit');
    expect(commit.reviewTarget).toBe('abc123');
  });
});

describe('commandNeedsDetailedSessions', () => {
  it('returns true for /sessions command', () => {
    expect(commandNeedsDetailedSessions('/sessions')).toBe(true);
    expect(commandNeedsDetailedSessions(' /sessions  ')).toBe(true);
    expect(commandNeedsDetailedSessions('/sessions 2')).toBe(true);
  });

  it('returns false for non-/sessions commands and normal text', () => {
    expect(commandNeedsDetailedSessions('/session')).toBe(false);
    expect(commandNeedsDetailedSessions('/switch 1')).toBe(false);
    expect(commandNeedsDetailedSessions('hello')).toBe(false);
  });
});
