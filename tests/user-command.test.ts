import { describe, expect, it } from 'vitest';

import { commandNeedsAgentList, commandNeedsDetailedSessions, handleUserCommand } from '../src/features/user-command.js';

const context = {
  currentThreadId: 'thread_aabbccdd0011',
  currentAgent: {
    agentId: 'frontend',
    name: '前端Agent',
    workspaceDir: '/tmp/agents/frontend',
    createdAt: 1,
    updatedAt: 1,
  },
  agents: [
    {
      agentId: 'default',
      name: '默认Agent',
      workspaceDir: '/repo',
      createdAt: 0,
      updatedAt: 0,
      current: false,
      isDefault: true,
    },
    {
      agentId: 'frontend',
      name: '前端Agent',
      workspaceDir: '/tmp/agents/frontend',
      createdAt: 1,
      updatedAt: 1,
      current: true,
      isDefault: false,
    },
  ],
  sessions: [
    { threadId: 'thread_aabbccdd0011', name: '当前任务', lastPrompt: '修复回调签名错误', updatedAt: 1 },
    { threadId: 'thread_223344556677', lastPrompt: '补充 README', updatedAt: 1 },
  ],
};

describe('handleUserCommand', () => {
  it('passes through normal text', () => {
    const result = handleUserCommand('hello', context);
    expect(result.handled).toBe(false);
  });

  it('supports /help', () => {
    const result = handleUserCommand('/help', context);
    expect(result.handled).toBe(true);
    expect(result.message).toContain('可用命令');
    expect(result.message).toContain('/agent create <名称>');
    expect(result.message).toContain('/agent init-memory');
  });

  it('supports /clear', () => {
    const result = handleUserCommand('/clear', context);
    expect(result.handled).toBe(true);
    expect(result.clearSession).toBe(true);
  });

  it('supports /session', () => {
    const result = handleUserCommand('/session', context);
    expect(result.handled).toBe(true);
    expect(result.message).toContain('当前会话');
  });

  it('supports /sessions list rendering', () => {
    const result = handleUserCommand('/sessions', context);
    expect(result.handled).toBe(true);
    expect(result.message).toContain('会话列表');
    expect(result.message).toContain('当前任务');
    expect(result.message).toContain('/switch <编号>');
  });

  it('supports /agents and /agent current', () => {
    const list = handleUserCommand('/agents', context);
    expect(list.handled).toBe(true);
    expect(list.message).toContain('Agent 列表');
    expect(list.message).toContain('前端Agent');

    const current = handleUserCommand('/agent', context);
    expect(current.handled).toBe(true);
    expect(current.queryAgent).toBe(true);
    expect(current.message).toContain('/tmp/agents/frontend');
  });

  it('supports /agent create and use', () => {
    const create = handleUserCommand('/agent create 测试工作流', context);
    expect(create.handled).toBe(true);
    expect(create.createAgentName).toBe('测试工作流');
    expect(create.createAgentTemplate).toBe('default');

    const init = handleUserCommand('/agent init-memory', context);
    expect(init.handled).toBe(true);
    expect(init.initMemoryAgent).toBe(true);

    const useAgent = handleUserCommand('/agent use 2', context);
    expect(useAgent.handled).toBe(true);
    expect(useAgent.useAgentTarget).toBe('2');
  });

  it('shows usage when /agent args are missing', () => {
    const result = handleUserCommand('/agent create', context);
    expect(result.handled).toBe(true);
    expect(result.message).toContain('/agent create <名称>');
  });

  it('supports /switch with thread id', () => {
    const result = handleUserCommand('/switch thread_1234567890', context);
    expect(result.handled).toBe(true);
    expect(result.switchTarget).toBe('thread_1234567890');
  });

  it('shows usage when /switch has no args', () => {
    const result = handleUserCommand('/switch', context);
    expect(result.handled).toBe(true);
    expect(result.message).toContain('/switch <编号|threadId>');
  });

  it('supports /rename', () => {
    const result = handleUserCommand('/rename 2 发布准备', context);
    expect(result.handled).toBe(true);
    expect(result.renameTarget).toBe('2');
    expect(result.renameName).toBe('发布准备');
  });

  it('supports /model query and set', () => {
    expect(handleUserCommand('/model', context).queryModel).toBe(true);
    expect(handleUserCommand('/model gpt-5-codex', context).setModel).toBe('gpt-5-codex');
  });

  it('supports /models and /search', () => {
    expect(handleUserCommand('/models', context).queryModels).toBe(true);
    expect(handleUserCommand('/search', context).querySearch).toBe(true);
    expect(handleUserCommand('/search on', context).setSearchEnabled).toBe(true);
    expect(handleUserCommand('/search off', context).setSearchEnabled).toBe(false);
  });

  it('supports /open and /review', () => {
    expect(handleUserCommand('/open https://example.com', context).openUrl).toBe('https://example.com');
    expect(handleUserCommand('/review', context).reviewMode).toBe('uncommitted');
    expect(handleUserCommand('/review base main', context).reviewTarget).toBe('main');
  });
});

describe('commandNeedsDetailedSessions', () => {
  it('returns true for /sessions command', () => {
    expect(commandNeedsDetailedSessions('/sessions')).toBe(true);
    expect(commandNeedsDetailedSessions(' /sessions  ')).toBe(true);
  });

  it('returns false for non-/sessions commands', () => {
    expect(commandNeedsDetailedSessions('/session')).toBe(false);
    expect(commandNeedsDetailedSessions('/agent')).toBe(false);
  });
});

describe('commandNeedsAgentList', () => {
  it('returns true for agent-related listing commands', () => {
    expect(commandNeedsAgentList('/agents')).toBe(true);
    expect(commandNeedsAgentList('/agent')).toBe(true);
    expect(commandNeedsAgentList('/agent use 2')).toBe(true);
    expect(commandNeedsAgentList('/agent init-memory')).toBe(true);
  });

  it('returns false for other commands', () => {
    expect(commandNeedsAgentList('/sessions')).toBe(false);
    expect(commandNeedsAgentList('hello')).toBe(false);
  });
});
