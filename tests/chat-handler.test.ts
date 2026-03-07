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
  it('runs agent again when reminder trigger arrives', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('local-owner', {
      agentId: 'test',
      name: '测试Agent',
      workspaceDir: '/tmp/test',
    });
    const run = vi.fn(async (input: {
      prompt: string;
      onMessage?: (text: string) => void;
      workdir?: string;
    }) => {
      input.onMessage?.('提醒时间到了，我来继续跟进。');
      return { threadId: 'thread_reminder', rawOutput: '' };
    });
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({
      channel: 'wecom',
      userId: 'u1',
      content: '喝水',
      reminderTrigger: {
        reminderId: 'r1',
        message: '喝水',
        sourceAgentId: 'test',
      },
    });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/test',
      search: false,
      reminderToolContext: expect.objectContaining({
        channel: 'wecom',
        userId: 'u1',
        agentId: 'test',
      }),
    }));
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '提醒时间到了，我来继续跟进。');
    expect(sessionStore.getSession('local-owner', 'test')).toBe('thread_reminder');
  });

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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '❌ 请求执行失败，请稍后重试。');
    expect(sessionStore.getSession('local-owner', 'default')).toBeUndefined();
  });

  it('sends ack when receiving normalized non-text inbound message', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 't1', rawOutput: '' }));
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '[飞书图片] image_key=img_xxx' });

    expect(sendText).toHaveBeenCalledWith('feishu', 'u1', '✅ 已收到飞书图片消息，正在分析处理。');
    expect(run).toHaveBeenCalled();
  });

  it('sends fallback error text when stream push fails', async () => {
    const sendText = vi
      .fn<(
        channel: 'wecom' | 'feishu',
        userId: string,
        content: string
      ) => Promise<void>>()
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValue(undefined);
    const run = vi.fn(async (input: { onMessage?: (text: string) => void }) => {
      input.onMessage?.('第一条回复');
      return { threadId: 't1', rawOutput: '' };
    });
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenNthCalledWith(1, 'wecom', 'u1', '第一条回复');
    expect(sendText).toHaveBeenNthCalledWith(2, 'wecom', 'u1', '⚠️ 消息发送失败，请检查机器人发送权限或消息类型配置。');
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/agent create 前端工作区' });

    expect(createWorkspace).toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      'wecom',
      'u1',
      expect.stringContaining('已创建并切换到 agent：前端工作区 (frontend)'),
    );
    expect(sessionStore.getCurrentAgent('local-owner').agentId).toBe('frontend');
  });

  it('formats built-in command response as feishu interactive card', async () => {
    const sendText = vi.fn(async () => undefined);
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/help' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: unknown;
    };
    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    expect(typeof parsed.content).toBe('object');
    const card = parsed.content as {
      header?: { title?: { content?: string } };
      elements?: Array<{ content?: string }>;
    };
    expect(card.header?.title?.content).toContain('/help');
    const merged = (card.elements ?? []).map((item) => String(item.content ?? '')).join('\n');
    expect(merged).toContain('帮助目录');
    expect(merged).toContain('帮助页 1/3');
    const actionElements = (card.elements ?? []).filter((item) => (item as { tag?: string }).tag === 'action') as Array<{
      actions?: Array<{ value?: { gateway_cmd?: string } }>;
    }>;
    const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
    expect(cmds).toContain('/help');
    expect(cmds).toContain('/new');
    expect(cmds).toContain('/help 1');
    expect(cmds).toContain('/help 2');
  });

  it('formats short command response as feishu interactive card', async () => {
    const sendText = vi.fn(async () => undefined);
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/search' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: unknown;
    };
    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    const card = parsed.content as {
      header?: { title?: { content?: string } };
      elements?: Array<{ content?: string; tag?: string; actions?: Array<{ value?: { gateway_cmd?: string } }> }>;
    };
    expect(card.header?.title?.content).toContain('/search');
    const markdownContents = (card.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String(item.content ?? ''));
    expect(markdownContents.join('\n')).toContain('**当前状态**');
    expect(markdownContents.join('\n')).toContain('联网搜索：');
    const actionElement = (card.elements ?? []).find((item) => item.tag === 'action');
    const cmds = (actionElement?.actions ?? []).map((item) => item.value?.gateway_cmd);
    expect(cmds).toContain('/search on');
    expect(cmds).toContain('/search off');
  });

  it('renders search toggle card with dynamic button emphasis', async () => {
    const sendText = vi.fn(async () => undefined);
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/search on' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as {
      content?: { elements?: Array<{ tag?: string; actions?: Array<{ type?: string; value?: { gateway_cmd?: string } }> }> };
    };
    const actionElement = parsed.content?.elements?.find((item) => item.tag === 'action');
    const offAction = (actionElement?.actions ?? []).find((item) => item.value?.gateway_cmd === '/search off');
    expect(offAction?.type).toBe('danger');
  });

  it('renders skills command card with quick action buttons', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const skillManager = {
      listEffectiveSkills: vi.fn(() => ([
        { name: 'using-superpowers', source: 'global' as const, skillDir: '/root/.agents/skills/using-superpowers' },
      ])),
      listGlobalSkills: vi.fn(() => []),
      listAgentLocalSkills: vi.fn(() => []),
      disableGlobalSkill: vi.fn(() => ({ ok: true })),
      enableGlobalSkill: vi.fn(() => ({ ok: true })),
      disableAgentSkill: vi.fn(() => ({ ok: true })),
    };
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
      skillManager,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/skills' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
    const markdownContents = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String((item as { content?: unknown }).content ?? ''));
    expect(markdownContents.join('\n')).toContain('**Skills**');
    const actionElement = parsed.content?.elements?.find((item) => item.tag === 'action') as { actions?: Array<{ value?: { gateway_cmd?: string } }> } | undefined;
    const cmds = (actionElement?.actions ?? []).map((item) => item.value?.gateway_cmd);
    expect(cmds).toContain('/skills');
    expect(cmds).toContain('/skills global');
    expect(cmds).toContain('/skills agent');
  });

  it('renders sessions command card with session item section', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.setSession('local-owner', 'default', 'thread_1');
    sessionStore.listDetailed = () => ([
      { threadId: 'thread_1', name: '当前会话', lastPrompt: 'hello', updatedAt: Date.now() },
      { threadId: 'thread_2', name: '历史会话', lastPrompt: 'world', updatedAt: Date.now() - 1 },
    ]);
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/sessions' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
    const markdownContents = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String((item as { content?: unknown }).content ?? ''));
    expect(markdownContents.join('\n')).toContain('**会话项**');
  });

  it('renders agent command card with agent status sections', async () => {
    const sendText = vi.fn(async () => undefined);
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/agent' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
    const markdownContents = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String((item as { content?: unknown }).content ?? ''));
    expect(markdownContents.join('\n')).toContain('**Agent**');
    expect(markdownContents.join('\n')).toContain('**状态**');
  });

  it('renders model command card with current model section', async () => {
    const sendText = vi.fn(async () => undefined);
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/model' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
    const markdownContents = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String((item as { content?: unknown }).content ?? ''));
    expect(markdownContents.join('\n')).toContain('**当前模型**');
  });

  it('lists merged skills for current agent by /skills command', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const skillManager = {
      listEffectiveSkills: vi.fn(() => ([
        { name: 'using-superpowers', source: 'global' as const, skillDir: '/root/.agents/skills/using-superpowers' },
        { name: 'reminder-tool', source: 'agent-local' as const, skillDir: '/tmp/agent/.codex/skills/reminder-tool' },
      ])),
      listGlobalSkills: vi.fn(() => []),
      listAgentLocalSkills: vi.fn(() => []),
      disableGlobalSkill: vi.fn(() => ({ ok: true })),
      enableGlobalSkill: vi.fn(() => ({ ok: true })),
      disableAgentSkill: vi.fn(() => ({ ok: true })),
    };
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
      skillManager,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/skills' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('当前会话可用 skill'));
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('using-superpowers [global]'));
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('reminder-tool [agent-local]'));
  });

  it('disables global skill for current agent by /skills command', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const skillManager = {
      listEffectiveSkills: vi.fn(() => []),
      listGlobalSkills: vi.fn(() => []),
      listAgentLocalSkills: vi.fn(() => []),
      disableGlobalSkill: vi.fn(() => ({ ok: true })),
      enableGlobalSkill: vi.fn(() => ({ ok: true })),
      disableAgentSkill: vi.fn(() => ({ ok: true })),
    };
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
      skillManager,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/skills disable global using-superpowers' });

    expect(skillManager.disableGlobalSkill).toHaveBeenCalledWith('/repo/default', 'using-superpowers');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('已禁用全局 skill'));
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/agent init-memory' });

    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      template: 'memory-onboarding',
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp',
      search: false,
      prompt: expect.stringContaining('language style'),
    }));
    expect(sessionStore.getCurrentAgent('local-owner').agentId).toBe('default');
    expect(sessionStore.getSession('local-owner', 'memory-onboarding')).toBe('thread_onboarding');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('开始记忆初始化引导'));
  });

  it('creates skill onboarding agent by command and switches to it', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const createWorkspace = vi.fn(() => ({ agentId: 'skill-onboarding', workspaceDir: '/tmp/skill-onboarding' }));
    const run = vi.fn(async () => ({ threadId: 'thread_skill', rawOutput: '' }));
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/skill-agent' });

    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      template: 'skill-onboarding',
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/skill-onboarding',
      search: false,
    }));
    expect(sessionStore.getCurrentAgent('local-owner').agentId).toBe('skill-onboarding');
    expect(sessionStore.getSession('local-owner', 'skill-onboarding')).toBe('thread_skill');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('技能扩展助手'));
  });

  it('reuses existing skill onboarding session when already initialized', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('local-owner', {
      agentId: 'skill-onboarding',
      name: '技能扩展助手',
      workspaceDir: '/tmp/skill-onboarding',
    });
    sessionStore.setSession('local-owner', 'skill-onboarding', 'thread_skill');
    const createWorkspace = vi.fn(() => ({ agentId: 'skill-onboarding', workspaceDir: '/tmp/skill-onboarding' }));
    const run = vi.fn(async () => ({ threadId: 'thread_skill', rawOutput: '' }));
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/skill-agent' });

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(sessionStore.getCurrentAgent('local-owner').agentId).toBe('skill-onboarding');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('已有进行中的会话'));
  });

  it('reuses legacy named onboarding agent instead of creating duplicates', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('local-owner', {
      agentId: 'agent-5',
      name: '记忆初始化引导',
      workspaceDir: '/tmp/agent-5',
    });
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/agent init-memory' });

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/agent-5',
    }));
  });

  it('runs codex in the current agent workspace', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_new', rawOutput: '' }));
    const sessionStore = createSessionStore();
    sessionStore.createAgent('local-owner', {
      agentId: 'frontend',
      name: '前端工作区',
      workspaceDir: '/tmp/frontend',
    });
    sessionStore.setCurrentAgent('local-owner', 'frontend');

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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/frontend',
    }));
    expect(sessionStore.getSession('local-owner', 'frontend')).toBe('thread_new');
  });

  it('uses channel-specific outbound prompt for wecom', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_new', rawOutput: '' }));
    const sessionStore = createSessionStore();
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
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    const prompt = run.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain('你必须遵循以下企微回发协议：');
    expect(prompt).toContain('企微常用 msg_type：text、markdown、image、voice、video、file。');
    expect(prompt).not.toContain('飞书常用 msg_type');
  });

  it('includes message type selection rules in feishu prompt', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_new', rawOutput: '' }));
    const sessionStore = createSessionStore();
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
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: 'hello' });

    const prompt = run.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain('简单一句话优先 text；多段说明/列表/摘要优先 post；需要强结构化展示、模板卡片或交互按钮时用 interactive。');
    expect(prompt).toContain('如果不确定该用哪种类型，优先退回 text');
  });

  it('publishes workspace for /deploy-workspace command', async () => {
    const sendText = vi.fn(async () => undefined);
    const publish = vi.fn(async () => ({ output: 'publish ok' }));
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
      workspacePublisher: { publish },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/deploy-workspace' });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '⏳ 正在发布 workspace，请稍候...');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('workspace 发布完成'));
  });

  it('starts hidden memory onboarding flow when shared memory is empty', async () => {
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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '我们开始吧' });

    expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      template: 'memory-onboarding',
    }));
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp',
      search: false,
    }));
    expect(sessionStore.getCurrentAgent('local-owner').agentId).toBe('default');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('shared-memory 为空'));
  });

  it('bootstraps current agent identity directly when shared memory is ready', async () => {
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
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => true,
        getSharedMemorySnapshot: () => ({
          sharedMemoryDir: '/tmp/shared-memory',
          identityContent: '# Identity\n- Preferred name: 白瑞\n',
          identityVersion: 'v1',
          hasIdentity: true,
        }),
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '继续' });

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      workdir: '/repo/default',
      search: false,
      prompt: expect.stringContaining('系统身份注入'),
    }));
  });

  it('routes follow-up user replies to hidden onboarding session while shared memory is still empty', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_onboarding', rawOutput: '' }));
    const sessionStore = createSessionStore();
    sessionStore.createAgent('local-owner', {
      agentId: 'memory-onboarding',
      name: '记忆初始化引导',
      workspaceDir: '/tmp/memory-onboarding',
    });
    sessionStore.setSession('local-owner', 'memory-onboarding', 'thread_onboarding');

    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'memory-onboarding', workspaceDir: '/tmp/memory-onboarding' }),
        isSharedMemoryEmpty: () => true,
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '我叫 Alice' });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('用户输入如下：\n我叫 Alice'),
      threadId: 'thread_onboarding',
      workdir: '/tmp',
    }));
    expect(sessionStore.getCurrentAgent('local-owner').agentId).toBe('default');
  });

  it('does not kick off memory onboarding twice while the first kickoff is still in flight', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const createWorkspace = vi.fn(() => ({ agentId: 'memory-onboarding', workspaceDir: '/tmp/memory-onboarding' }));
    let resolveRun: ((value: { threadId: string; rawOutput: string }) => void) | undefined;
    const run = vi.fn(() => new Promise<{ threadId: string; rawOutput: string }>((resolve) => {
      resolveRun = resolve;
    }));

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
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    const first = handler({ channel: 'wecom', userId: 'u1', content: '开始吧' });
    await Promise.resolve();
    await handler({ channel: 'wecom', userId: 'u1', content: '我补充一下' });

    expect(createWorkspace).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('正在启动'));

    resolveRun?.({ threadId: 'thread_onboarding', rawOutput: '' });
    await first;
  });

  it('redacts internal file details in onboarding stream output', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const run = vi.fn(async (input: {
      prompt: string;
      onMessage?: (text: string) => void;
    }) => {
      input.onMessage?.('我会写入 `./shared-memory/profile.md`，并读取 `./agent.md`。');
      return { threadId: 'thread_onboarding', rawOutput: '' };
    });
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'memory-onboarding', workspaceDir: '/tmp/memory-onboarding' }),
        isSharedMemoryEmpty: () => true,
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '开始' });

    const payloads = sendText.mock.calls.map((call) => String(call[2]));
    const sanitized = payloads.find((text) => text.includes('[内部路径]') || text.includes('[记忆文件]'));
    expect(sanitized).toBeTruthy();
    expect(sanitized).not.toContain('shared-memory');
    expect(sanitized).not.toContain('agent.md');
  });
});
