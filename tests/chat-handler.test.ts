import { describe, expect, it, vi } from 'vitest';

import { createChatHandler } from '../src/services/chat-handler.js';

function createSessionStore() {
  const currentAgent = new Map<string, string>();
  const threads = new Map<string, string>();
  const agents = new Map<string, Array<{
    agentId: string;
    name: string;
    workspaceDir: string;
    createdAt: number;
    updatedAt: number;
    current: boolean;
    isDefault: boolean;
  }>>();

  function ensureAgents(userId: string) {
    if (!agents.has(userId)) {
      agents.set(userId, [
        {
          agentId: 'default',
          name: '默认Agent',
          workspaceDir: '/repo/default',
          createdAt: 0,
          updatedAt: 0,
          current: true,
          isDefault: true,
        },
      ]);
    }
    return agents.get(userId)!;
  }

  return {
    getCurrentAgent(userId: string) {
      const list = ensureAgents(userId);
      const agentId = currentAgent.get(userId) ?? 'default';
      return list.find((item) => item.agentId === agentId) ?? list[0]!;
    },
    listAgents(userId: string) {
      const list = ensureAgents(userId);
      const agentId = currentAgent.get(userId) ?? 'default';
      return list.map((item) => ({ ...item, current: item.agentId === agentId }));
    },
    createAgent(userId: string, input: { agentId: string; name: string; workspaceDir: string }) {
      const list = ensureAgents(userId);
      const record = {
        agentId: input.agentId,
        name: input.name,
        workspaceDir: input.workspaceDir,
        createdAt: 1,
        updatedAt: 1,
        current: false,
        isDefault: false,
      };
      list.push(record);
      return record;
    },
    setCurrentAgent(userId: string, agentId: string) {
      currentAgent.set(userId, agentId);
      return true;
    },
    resolveAgentTarget(userId: string, target: string) {
      const list = ensureAgents(userId);
      if (/^\d+$/.test(target)) {
        return list[Number(target) - 1]?.agentId;
      }
      return list.find((item) => item.agentId === target)?.agentId;
    },
    getSession(userId: string, agentId: string) {
      return threads.get(`${userId}:${agentId}`);
    },
    setSession(userId: string, agentId: string, threadId: string) {
      threads.set(`${userId}:${agentId}`, threadId);
    },
    clearSession(userId: string, agentId: string) {
      return threads.delete(`${userId}:${agentId}`);
    },
    listDetailed() {
      return [];
    },
    resolveSwitchTarget(_userId: string, _agentId: string, target: string) {
      return target;
    },
    renameSession() {
      return true;
    },
  };
}

describe('createChatHandler', () => {
  it('sends a visible error message when codex run fails', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async () => {
          throw new Error('boom');
        },
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
      },
      browserOpenEnabled: false,
      runnerEnabled: true,
      defaultSearch: false,
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '❌ 请求执行失败，请稍后重试。');
    expect(sessionStore.getSession('wecom:u1', 'default')).toBeUndefined();
  });

  it('creates and switches agent by command', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const createWorkspace = vi.fn(() => ({ agentId: 'frontend', workspaceDir: '/tmp/frontend' }));
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async () => ({ threadId: 'thread_new', rawOutput: '' }),
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace,
        isSharedMemoryEmpty: () => false,
      },
      browserOpenEnabled: false,
      runnerEnabled: true,
      defaultSearch: false,
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/agent create 前端工作区' });

    expect(createWorkspace).toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      'wecom',
      'u1',
      expect.stringContaining('已创建并切换到 agent：前端工作区 (frontend)'),
    );
    expect(sessionStore.getCurrentAgent('wecom:u1').agentId).toBe('frontend');
  });

  it('creates memory onboarding agent by command', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const createWorkspace = vi.fn(() => ({ agentId: 'memory-onboarding', workspaceDir: '/tmp/memory-onboarding' }));
    const run = vi.fn(async () => ({ threadId: 'thread_onboarding', rawOutput: '' }));
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace,
        isSharedMemoryEmpty: () => false,
      },
      browserOpenEnabled: false,
      runnerEnabled: true,
      defaultSearch: false,
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/agent init-memory' });

    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      template: 'memory-onboarding',
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/memory-onboarding',
      search: false,
    }));
    expect(sessionStore.getCurrentAgent('wecom:u1').agentId).toBe('memory-onboarding');
    expect(sessionStore.getSession('wecom:u1', 'memory-onboarding')).toBe('thread_onboarding');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('记忆初始化引导'));
  });

  it('runs codex in the current agent workspace', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_new', rawOutput: '' }));
    const sessionStore = createSessionStore();
    sessionStore.createAgent('wecom:u1', {
      agentId: 'frontend',
      name: '前端工作区',
      workspaceDir: '/tmp/frontend',
    });
    sessionStore.setCurrentAgent('wecom:u1', 'frontend');

    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'frontend', workspaceDir: '/tmp/frontend' }),
        isSharedMemoryEmpty: () => false,
      },
      browserOpenEnabled: false,
      runnerEnabled: true,
      defaultSearch: false,
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/frontend',
    }));
    expect(sessionStore.getSession('wecom:u1', 'frontend')).toBe('thread_new');
  });

  it('opens browser for /open when enabled', async () => {
    const sendText = vi.fn(async () => undefined);
    const open = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async () => ({ threadId: 'thread_new', rawOutput: '' }),
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
      },
      browserOpener: { open },
      browserOpenEnabled: true,
      runnerEnabled: true,
      defaultSearch: false,
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/open https://example.com' });

    expect(open).toHaveBeenCalledWith('https://example.com');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '✅ 已尝试打开浏览器：https://example.com');
  });

  it('auto switches to memory onboarding when shared memory is empty', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_onboarding', rawOutput: '' }));
    const sessionStore = createSessionStore();
    const createWorkspace = vi.fn(() => ({ agentId: 'memory-onboarding', workspaceDir: '/tmp/memory-onboarding' }));
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace,
        isSharedMemoryEmpty: () => true,
      },
      browserOpenEnabled: false,
      runnerEnabled: true,
      defaultSearch: false,
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '我们开始吧' });

    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      template: 'memory-onboarding',
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/memory-onboarding',
      search: false,
    }));
    expect(sessionStore.getCurrentAgent('wecom:u1').agentId).toBe('memory-onboarding');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('shared-memory 仍为空'));
  });
});
