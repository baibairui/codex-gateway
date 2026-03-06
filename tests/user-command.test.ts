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
