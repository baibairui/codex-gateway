import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createChatHandler } from '../src/services/chat-handler.js';

function createSessionStore() {
  const currentAgent = new Map<string, string>();
  const threads = new Map<string, string>();
  const modelOverrides = new Map<string, string>();
  const providerOverrides = new Map<string, 'codex' | 'opencode'>();
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
    getModelOverride(userId: string, agentId: string) {
      return modelOverrides.get(`${userId}:${agentId}`);
    },
    setModelOverride(userId: string, agentId: string, model: string) {
      modelOverrides.set(`${userId}:${agentId}`, model);
    },
    clearModelOverride(userId: string, agentId: string) {
      return modelOverrides.delete(`${userId}:${agentId}`);
    },
    getProviderOverride(userId: string, agentId: string) {
      return providerOverrides.get(`${userId}:${agentId}`);
    },
    setProviderOverride(userId: string, agentId: string, provider: 'codex' | 'opencode') {
      providerOverrides.set(`${userId}:${agentId}`, provider);
    },
    clearProviderOverride(userId: string, agentId: string) {
      return providerOverrides.delete(`${userId}:${agentId}`);
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

async function withMockModelsCache(
  payload: { fetched_at: string; models: Array<{ slug: string; visibility: string; supported_in_api: boolean }> },
  run: () => Promise<void>,
) {
  const cacheDir = path.join(os.homedir(), '.codex');
  const cachePath = path.join(cacheDir, 'models_cache.json');
  const hadOriginal = fs.existsSync(cachePath);
  const original = hadOriginal ? fs.readFileSync(cachePath, 'utf8') : '';
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(payload));
  try {
    await run();
  } finally {
    if (hadOriginal) {
      fs.writeFileSync(cachePath, original);
    } else {
      fs.rmSync(cachePath, { force: true });
    }
  }
}

describe('createChatHandler', () => {
  it('keeps sessions isolated per real user id', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const run = vi
      .fn(async (input: { threadId?: string; onMessage?: (text: string) => void }) => {
        input.onMessage?.('ok');
        return {
          threadId: input.threadId ?? `thread_${run.mock.calls.length}`,
          rawOutput: '',
        };
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
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });
    await handler({ channel: 'wecom', userId: 'u2', content: 'hello' });

    expect(sessionStore.getSession('u1', 'default')).toBe('thread_1');
    expect(sessionStore.getSession('u2', 'default')).toBe('thread_2');
  });

  it('prefers resolved default model over service fallback when no session override exists', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const run = vi.fn(async () => ({ threadId: 'thread_1', rawOutput: '' }));
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
      defaultModel: 'service-fallback-model',
      resolveDefaultModel: () => 'user-config-model',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      model: 'user-config-model',
    }));
  });

  it('uses ensured default workspace for the built-in default agent', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const run = vi.fn(async () => ({ threadId: 'thread_default_ws', rawOutput: '' }));
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        ensureDefaultWorkspace: () => ({ agentId: 'default', workspaceDir: '/tmp/user-default' }),
        isSharedMemoryEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/user-default',
    }));
  });

  it('runs agent again when reminder trigger arrives', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('u1', {
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
      defaultModel: 'gpt-5-codex',
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
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '测试Agent ·\n提醒时间到了，我来继续跟进。');
    expect(sessionStore.getSession('u1', 'test')).toBe('thread_reminder');
  });

  it('does not hijack /help when an opencode auth session exists but is not waiting for manual input', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: vi.fn(async () => ({ threadId: 'thread_1', rawOutput: '' })),
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
      openCodeAuthFlowManager: {
        has: () => true,
        isAwaitingInput: () => false,
        stop: vi.fn(() => true),
        sendInput: vi.fn(async () => true),
      },
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/help' });

    expect(sendText).not.toHaveBeenCalledWith('feishu', 'u1', '已收到，正在继续处理授权流程。');
    expect(sendText).toHaveBeenCalled();
    const helpPayload = String(sendText.mock.calls.at(-1)?.[2] ?? '');
    expect(helpPayload).toContain('命令帮助');
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
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '❌ 请求执行失败，请稍后重试。');
    expect(sessionStore.getSession('u1', 'default')).toBeUndefined();
  });

  it('does not expose raw timeout errors after partial agent output', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async (input) => {
          input.onMessage?.('先给你一个阶段性结论。');
          throw new Error('codex timeout after 1000ms');
        },
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '默认助手 ·\n先给你一个阶段性结论。');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '默认助手 ·\n⚠️ 本次回复中断了，你可以直接回复“继续”让我接着处理。');
    expect(sendText.mock.calls.some((call) => String(call[2] ?? '').includes('codex timeout after'))).toBe(false);
    expect(sendText.mock.calls.some((call) => String(call[2] ?? '').includes('❌ 请求执行失败'))).toBe(false);
  });

  it('persists a new session as soon as thread.started is observed', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async (input) => {
          input.onThreadStarted?.('thread_started_1');
          throw new Error('boom-after-thread');
        },
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sessionStore.getSession('u1', 'default')).toBe('thread_started_1');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '❌ 请求执行失败，请稍后重试。');
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
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '[飞书图片] image_key=img_xxx' });

    expect(sendText).toHaveBeenCalledWith('feishu', 'u1', '✅ 已收到飞书图片消息，正在分析处理。');
    expect(run).toHaveBeenCalled();
  });

  it('prefixes plain agent replies with the current agent name', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.setSession('u1', 'default', 'thread_existing');
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async (input) => {
          input.onMessage?.('你好，我来处理。');
          return { threadId: 'thread_existing', rawOutput: '' };
        },
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '默认助手 ·\n你好，我来处理。');
  });

  it('keeps gateway structured replies unchanged when labeling agent output', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.setSession('u1', 'default', 'thread_existing');
    const structured = '{"__gateway_message__":true,"msg_type":"post","content":"多段说明"}';
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async (input) => {
          input.onMessage?.(structured);
          return { threadId: 'thread_existing', rawOutput: '' };
        },
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', structured);
  });

  it('rewrites sandbox local file paths in structured replies back to host workspace paths', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.setSession('u1', 'default', 'thread_existing');
    const structured = '{"__gateway_message__":true,"msg_type":"image","content":{"local_image_path":"/workspace/out/result.png","caption":"done"}}';
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async (input) => {
          input.onMessage?.(structured);
          return { threadId: 'thread_existing', rawOutput: '' };
        },
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenCalledWith(
      'feishu',
      'u1',
      '{"__gateway_message__":true,"msg_type":"image","content":{"local_image_path":"/repo/default/out/result.png","caption":"done"}}',
    );
  });

  it('stages inbound local attachment paths into the current agent workspace before running codex', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-handler-inbound-attachment-'));
    const workspaceDir = path.join(tempDir, 'workspace');
    const sourceDir = path.join(tempDir, 'gateway-cache');
    const sourcePath = path.join(sourceDir, 'sample.jpg');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sourcePath, Buffer.from('fake-image'));
    sessionStore.createAgent('u1', {
      agentId: 'a1',
      name: '测试Agent',
      workspaceDir,
    });
    sessionStore.setCurrentAgent('u1', 'a1');
    const run = vi.fn(async () => ({ threadId: 'thread_1', rawOutput: '' }));
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({
      channel: 'feishu',
      userId: 'u1',
      content: `[飞书图片] image_key=img_v3_demo
message_id=om_1
[飞书附件元数据]
local_image_path=${sourcePath}`,
    });

    const runInput = run.mock.calls[0]?.[0];
    expect(runInput).toBeTruthy();
    const prompt = String(runInput?.prompt ?? '');
    expect(prompt).not.toContain(sourcePath);
    const match = prompt.match(/local_image_path=([^\n]+)/);
    expect(match?.[1]).toBeTruthy();
    expect(match?.[1]?.startsWith(workspaceDir)).toBe(true);
    expect(fs.readFileSync(match![1], 'utf8')).toBe('fake-image');
  });
  it('falls back to visible default agent when current agent is hidden onboarding agent', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('u1', {
      agentId: 'memory-onboarding',
      name: '记忆初始化引导',
      workspaceDir: '/tmp/memory-onboarding',
    });
    sessionStore.setCurrentAgent('u1', 'memory-onboarding');
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async (input) => {
          input.onMessage?.('继续回答问题');
          return { threadId: 'thread_existing', rawOutput: '' };
        },
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', '默认助手 ·\n继续回答问题');
    const systemPrefixed = sendText.mock.calls.some((call) => String(call[2] ?? '').includes('[记忆初始化引导]'));
    expect(systemPrefixed).toBe(false);
  });

  it('renders current agent and shared memory summary via /memory', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async () => ({ threadId: 'unused', rawOutput: '' }),
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
        getMemorySummary: () => ({
          sharedMemoryDir: '/tmp/shared-memory',
          workspaceMemoryDir: '/repo/default/memory',
          shared: [
            { fileName: 'identity.md', summary: '叫我白瑞 / 中文交流 / 不弄虚作假' },
          ],
          agent: [
            { fileName: 'projects.md', summary: 'wecom-codex-gateway 优化中' },
          ],
        }),
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/memory' });

    expect(sendText).toHaveBeenCalledWith(
      'wecom',
      'u1',
      expect.stringContaining('【Shared Memory】'),
    );
    expect(sendText).toHaveBeenCalledWith(
      'wecom',
      'u1',
      expect.stringContaining('identity.md: 叫我白瑞 / 中文交流 / 不弄虚作假'),
    );
    expect(sendText).toHaveBeenCalledWith(
      'wecom',
      'u1',
      expect.stringContaining('【Agent Memory】'),
    );
  });

  it('sends progress status before running a normal agent task', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.setSession('u1', 'default', 'thread_existing');
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async () => ({ threadId: 'thread_existing', rawOutput: '' }),
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenNthCalledWith(1, 'wecom', 'u1', '默认助手 ·\n⏳ 已接收请求，正在处理...');
    expect(sendText).toHaveBeenNthCalledWith(2, 'wecom', 'u1', '默认助手 ·\n✅ 已处理完成。');
  });

  it('pushes help card automatically when a new feishu session starts', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async (input: { onMessage?: (text: string) => void }) => {
      input.onMessage?.('你好，我已开始处理。');
      return { threadId: 'thread_new', rawOutput: '' };
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
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '你好' });

    const providerPayload = String(sendText.mock.calls[0]?.[2] ?? '');
    const helpPayload = String(sendText.mock.calls[1]?.[2] ?? '');
    const providerParsed = JSON.parse(providerPayload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: { header?: { title?: { content?: string } } };
    };
    const helpParsed = JSON.parse(helpPayload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: {
        header?: { title?: { content?: string } };
        elements?: Array<{ tag?: string; actions?: Array<{ text?: { content?: string } }> }>;
      };
    };
    expect(providerParsed.__gateway_message__).toBe(true);
    expect(providerParsed.msg_type).toBe('interactive');
    expect(providerParsed.content?.header?.title?.content).toBe('框架管理');
    expect(helpParsed.__gateway_message__).toBe(true);
    expect(helpParsed.msg_type).toBe('interactive');
    expect(helpParsed.content?.header?.title?.content).toBe('命令帮助');
    const helpButtons = (helpParsed.content?.elements ?? [])
      .filter((item) => item.tag === 'action')
      .flatMap((item) => item.actions ?? [])
      .map((item) => item.text?.content ?? '');
    expect(helpButtons).not.toContain('运行器切换');
    expect(helpButtons).not.toContain('⬅️ 上一页');
    expect(helpButtons).not.toContain('下一页 ➡️');
    expect(sendText).toHaveBeenCalledWith('feishu', 'u1', '默认助手 ·\n你好，我已开始处理。');
  });

  it('recommends provider selection on the first message when current agent has no explicit provider choice', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_new', rawOutput: '' }));
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
        getProvider: () => 'codex',
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultProvider: 'codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '你好' });

    expect(sendText.mock.calls.some((call) => String(call[2] ?? '').includes('建议首轮先发送'))).toBe(true);
    expect(sendText.mock.calls.some((call) => String(call[2] ?? '').includes('/provider opencode'))).toBe(true);
  });

  it('allows ordinary feishu messages through', async () => {
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
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '你好' });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('pushes help text automatically when a new wecom session starts', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async (input: { onMessage?: (text: string) => void }) => {
      input.onMessage?.('开始处理。');
      return { threadId: 'thread_new', rawOutput: '' };
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
        isWorkspaceIdentityEmpty: () => false,
      },
      runnerEnabled: true,
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '你好' });

    expect(sendText).toHaveBeenNthCalledWith(1, 'wecom', 'u1', expect.stringContaining('当前 agent 尚未显式选择模型通道'));
    expect(sendText).toHaveBeenNthCalledWith(2, 'wecom', 'u1', expect.stringContaining('可用命令（按功能分组，帮助页 1/3）：'));
    expect(sendText).toHaveBeenNthCalledWith(3, 'wecom', 'u1', '默认助手 ·\n⏳ 已接收请求，正在处理...');
    expect(sendText).toHaveBeenNthCalledWith(4, 'wecom', 'u1', '默认助手 ·\n开始处理。');
  });

  it('keeps running when the progress status push fails', async () => {
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
    sessionStore.setSession('u1', 'default', 'existing-thread');
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
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: 'hello' });

    expect(sendText).toHaveBeenNthCalledWith(1, 'wecom', 'u1', '默认助手 ·\n⏳ 已接收请求，正在处理...');
    expect(sendText).toHaveBeenNthCalledWith(2, 'wecom', 'u1', '默认助手 ·\n第一条回复');
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
    expect(sessionStore.getCurrentAgent('u1').agentId).toBe('frontend');
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
      defaultModel: 'gpt-5-codex',
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
    expect(card.header?.title?.content).toBe('命令帮助');
    const merged = (card.elements ?? []).map((item) => String(item.content ?? '')).join('\n');
    expect(merged).toContain('帮助目录');
    expect(merged).toContain('会话与 Agent · 1/3');
    expect(merged).toContain('快捷操作');
    const noteContents = (card.elements ?? [])
      .filter((item) => (item as { tag?: string }).tag === 'note')
      .flatMap((item) => ((item as { elements?: Array<{ content?: string }> }).elements ?? []).map((element) => String(element.content ?? '')));
    expect(noteContents).not.toContain('按功能分组浏览可用命令，并直接点击执行常用操作。');
    const fieldGrid = (card.elements ?? []).find((item) => (item as { tag?: string }).tag === 'div') as {
      fields?: Array<{ text?: { content?: string } }>;
    } | undefined;
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**当前分组**'))).toBe(true);
    const actionElements = (card.elements ?? []).filter((item) => (item as { tag?: string }).tag === 'action') as Array<{
      actions?: Array<{ text?: { content?: string }; value?: { gateway_cmd?: string } }>;
    }>;
    const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
    const labels = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.text?.content));
    expect(labels).toContain('框架管理');
    expect(cmds).toContain('/provider');
    expect(cmds).toContain('/sessions');
    expect(cmds).toContain('/agents');
    expect(cmds).toContain('/help 1');
    expect(cmds).toContain('/help 2');
  });

  it('renders third help page commands in feishu interactive card', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async () => ({ threadId: 'thread_new', rawOutput: '' }),
      },
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/help 3' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as {
      content?: {
        elements?: Array<{ content?: string }>;
      };
    };
    const card = parsed.content ?? { elements: [] };
    const merged = (card.elements ?? []).map((item) => String(item.content ?? '')).join('\n');
    expect(merged).toContain('工作区与运维 · 3/3');
    expect(merged).not.toContain('/deploy-workspace - 发布当前 agent 工作区');
    expect(merged).not.toContain('/publish-workspace - 发布当前 agent 工作区');
    const actionElements = (card.elements ?? []).filter((item) => (item as { tag?: string }).tag === 'action') as Array<{
      actions?: Array<{ value?: { gateway_cmd?: string } }>;
    }>;
    const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
    expect(cmds).toContain('/help 2');
    expect(cmds).toContain('/help 3');
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
      defaultModel: 'gpt-5-codex',
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
    expect(card.header?.title?.content).toBe('联网搜索');
    const markdownContents = (card.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String(item.content ?? ''));
    expect(markdownContents.join('\n')).toContain('**当前状态**');
    const fieldGrid = (card.elements ?? []).find((item) => item.tag === 'div') as {
      fields?: Array<{ text?: { content?: string } }>;
    } | undefined;
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**联网搜索**'))).toBe(true);
    const actionElements = (card.elements ?? []).filter((item) => item.tag === 'action') as Array<{
      actions?: Array<{ value?: { gateway_cmd?: string } }>;
    }>;
    expect(actionElements).toHaveLength(1);
    const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
    expect(cmds).toContain('/search on');
    expect(cmds).toContain('/search off');
  });

  it('returns a login choice card for feishu /login without starting device auth', async () => {
    const sendText = vi.fn(async () => undefined);
    const login = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run: async () => ({ threadId: 'thread_new', rawOutput: '' }),
        review: async () => ({ rawOutput: '' }),
        login,
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'a1', workspaceDir: '/tmp/a1' }),
        isSharedMemoryEmpty: () => false,
      },
      runnerEnabled: true,
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/login' });

    expect(login).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: {
        header?: { title?: { content?: string } };
        elements?: Array<{ tag?: string; actions?: Array<{ text?: { content?: string }; value?: Record<string, unknown> }> }>;
      };
    };
    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    expect(parsed.content?.header?.title?.content).toBe('登录授权');
    const actionRows = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action');
    const buttons = actionRows.flatMap((item) => item.actions ?? []);
    const labels = buttons.map((button) => String(button.text?.content ?? ''));
    expect(labels).toContain('设备授权登录');
    expect(labels).toContain('API URL / Key 登录');
    expect(buttons.some((button) => button.value?.gateway_action === 'codex_login.start_device_auth')).toBe(true);
    expect(buttons.some((button) => button.value?.gateway_action === 'codex_login.open_api_form')).toBe(true);
  });

  it('treats /feishu-auth as an unknown command in feishu channel', async () => {
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
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'feishu', userId: 'u1', content: '/feishu-auth' });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(String(sendText.mock.calls[0]?.[2] ?? '')).toContain('未识别命令');
  });

  it('treats /feishu-auth as an unknown command outside feishu channel', async () => {
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
      defaultModel: 'gpt-5-codex',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/feishu-auth' });

    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('未识别命令'));
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
    const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
      actions?: Array<{ type?: string; value?: { gateway_cmd?: string } }>;
    }>;
    const offAction = actionElements
      .flatMap((item) => item.actions ?? [])
      .find((item) => item.value?.gateway_cmd === '/search off');
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
    const parsed = JSON.parse(payload) as { content?: { header?: { template?: string }; elements?: Array<Record<string, unknown>> } };
    expect(parsed.content?.header?.template).toBe('turquoise');
    const markdownContents = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String((item as { content?: unknown }).content ?? ''));
    expect(markdownContents.join('\n')).toContain('**Skills**');
    expect(markdownContents.join('\n')).toContain('**技能**');
    const fieldGrid = parsed.content?.elements?.find((item) => item.tag === 'div') as {
      fields?: Array<{ text?: { content?: string } }>;
    } | undefined;
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**范围**'))).toBe(true);
    const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
      actions?: Array<{ value?: { gateway_cmd?: string } }>;
    }>;
    const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
    expect(cmds).toContain('/skills');
    expect(cmds).toContain('/skills global');
    expect(cmds).toContain('/skills agent');
  });

  it('renders sessions command card with switch buttons', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.setSession('u1', 'default', 'thread_1');
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
    expect(markdownContents.join('\n')).toContain('**会话切换**');
    const fieldGrid = parsed.content?.elements?.find((item) => item.tag === 'div') as {
      fields?: Array<{ text?: { content?: string } }>;
    } | undefined;
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**会话数量**'))).toBe(true);
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**当前会话**'))).toBe(true);
    const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
      actions?: Array<{ type?: string; text?: { content?: string }; value?: { gateway_cmd?: string } }>;
    }>;
    const switchCurrent = actionElements
      .flatMap((item) => item.actions ?? [])
      .find((action) => action.value?.gateway_cmd === '/switch 1');
    const switchOther = actionElements
      .flatMap((item) => item.actions ?? [])
      .find((action) => action.value?.gateway_cmd === '/switch 2');
    expect(switchCurrent?.type).toBe('primary');
    expect(switchCurrent?.text?.content).toContain('当前会话');
    expect(switchCurrent?.text?.content).toContain('hello');
    expect(switchOther?.text?.content).toContain('历史会话');
    expect(switchOther?.text?.content).toContain('world');
  });

  it('renders agents command card with switch buttons', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('u1', {
      agentId: 'frontend',
      name: '前端工作区',
      workspaceDir: '/repo/frontend',
    });
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

    await handler({ channel: 'feishu', userId: 'u1', content: '/agents' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
    const markdownContents = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String((item as { content?: unknown }).content ?? ''));
    expect(markdownContents.join('\n')).toContain('**Agent 切换**');
    const fieldGrid = parsed.content?.elements?.find((item) => item.tag === 'div') as {
      fields?: Array<{ text?: { content?: string } }>;
    } | undefined;
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**Agent 数量**'))).toBe(true);
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**当前 Agent**'))).toBe(true);
    const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
      actions?: Array<{ type?: string; text?: { content?: string }; value?: { gateway_cmd?: string } }>;
    }>;
    const useDefault = actionElements
      .flatMap((item) => item.actions ?? [])
      .find((action) => action.value?.gateway_cmd === '/agent use 1');
    const useFrontend = actionElements
      .flatMap((item) => item.actions ?? [])
      .find((action) => action.value?.gateway_cmd === '/agent use 2');
    expect(useDefault?.type).toBe('primary');
    expect(useDefault?.text?.content).toContain('默认');
    expect(useFrontend?.text?.content).toContain('前端工作区');
    expect(useFrontend?.text?.content).toContain('frontend');
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
    const fieldGrid = parsed.content?.elements?.find((item) => item.tag === 'div') as {
      fields?: Array<{ text?: { content?: string } }>;
    } | undefined;
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**工作区**'))).toBe(true);
    const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
      actions?: Array<{ value?: { gateway_cmd?: string } }>;
    }>;
    const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
    expect(cmds).toContain('/agents');
    expect(cmds).toContain('/sessions');
  });

  it('renders model command card with current model section', async () => {
    await withMockModelsCache({
      fetched_at: '2026-03-08T11:00:00Z',
      models: [
        { slug: 'gpt-5-codex', visibility: 'list', supported_in_api: true },
        { slug: 'gpt-5', visibility: 'list', supported_in_api: true },
        { slug: 'legacy-hidden', visibility: 'hide', supported_in_api: true },
      ],
    }, async () => {
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
        defaultModel: 'gpt-5-codex',
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
      expect(markdownContents.join('\n')).toContain('**可选模型**');
      const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
        actions?: Array<{ type?: string; text?: { content?: string }; value?: { gateway_cmd?: string } }>;
      }>;
      const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
      expect(cmds.some((cmd) => typeof cmd === 'string' && cmd.startsWith('/model ') && cmd !== '/model gpt-5-codex')).toBe(true);
      const currentModelAction = actionElements
        .flatMap((item) => item.actions ?? [])
        .find((action) => String(action.text?.content ?? '').includes('当前 ·'));
      expect(currentModelAction?.text?.content).toBe('当前 · gpt-5-codex');
      expect(currentModelAction?.type).toBe('primary');
    });
  });

  it('keeps model switch card interactive after changing model', async () => {
    await withMockModelsCache({
      fetched_at: '2026-03-08T11:00:00Z',
      models: [
        { slug: 'gpt-5-codex', visibility: 'list', supported_in_api: true },
        { slug: 'gpt-5', visibility: 'list', supported_in_api: true },
      ],
    }, async () => {
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
        defaultModel: 'gpt-5-codex',
        defaultSearch: false,
        reminderDbPath: '/tmp/reminders.db',
        sendText,
      });

      await handler({ channel: 'feishu', userId: 'u1', content: '/model gpt-5' });

      const payload = String(sendText.mock.calls[0]?.[2] ?? '');
      const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
      const markdownContents = (parsed.content?.elements ?? [])
        .filter((item) => item.tag === 'markdown')
        .map((item) => String((item as { content?: unknown }).content ?? ''));
      expect(markdownContents.join('\n')).toContain('**当前模型**');
      expect(markdownContents.join('\n')).toContain('**可选模型**');
      const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
        actions?: Array<{ type?: string; value?: { gateway_cmd?: string } }>;
      }>;
      const currentModelAction = actionElements
        .flatMap((item) => item.actions ?? [])
        .find((action) => action.value?.gateway_cmd === '/model');
      expect(currentModelAction?.type).toBe('primary');
    });
  });

  it('reads persisted model selection per agent when switching agents', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('u1', {
      agentId: 'frontend',
      name: '前端Agent',
      workspaceDir: '/tmp/frontend',
    });
    sessionStore.setModelOverride('u1', 'default', 'gpt-5');
    sessionStore.setModelOverride('u1', 'frontend', 'gpt-5-codex');

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
      defaultModel: 'fallback-model',
      defaultSearch: false,
      reminderDbPath: '/tmp/reminders.db',
      sendText,
    });

    await handler({ channel: 'wecom', userId: 'u1', content: '/model' });
    await handler({ channel: 'wecom', userId: 'u1', content: '/agent use frontend' });
    await handler({ channel: 'wecom', userId: 'u1', content: '/model' });

    expect(String(sendText.mock.calls[0]?.[2] ?? '')).toContain('当前模型：gpt-5');
    expect(String(sendText.mock.calls[2]?.[2] ?? '')).toContain('当前模型：gpt-5-codex');
  });

  it('truncates long model list and adds full-list entry', async () => {
    await withMockModelsCache({
      fetched_at: '2026-03-08T11:00:00Z',
      models: Array.from({ length: 12 }, (_, index) => ({
        slug: `model-${index + 1}`,
        visibility: 'list',
        supported_in_api: true,
      })),
    }, async () => {
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
        defaultModel: 'model-1',
        defaultSearch: false,
        reminderDbPath: '/tmp/reminders.db',
        sendText,
      });

      await handler({ channel: 'feishu', userId: 'u1', content: '/model' });

      const payload = String(sendText.mock.calls[0]?.[2] ?? '');
      const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
      const noteContents = (parsed.content?.elements ?? [])
        .filter((item) => item.tag === 'note')
        .flatMap((item) => ((item as { elements?: Array<{ content?: string }> }).elements ?? []).map((element) => String(element.content ?? '')));
      expect(noteContents).toContain('还有更多可见模型，点击下方按钮继续查看。');
      const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
        actions?: Array<{ value?: { gateway_cmd?: string } }>;
      }>;
      const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
      expect(cmds).toContain('/model page 2');
    });
  });

  it('renders paginated models card with page navigation buttons', async () => {
    await withMockModelsCache({
      fetched_at: '2026-03-08T11:00:00Z',
      models: Array.from({ length: 12 }, (_, index) => ({
        slug: `page-model-${index + 1}`,
        visibility: 'list',
        supported_in_api: true,
      })),
    }, async () => {
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
        defaultModel: 'page-model-1',
        defaultSearch: false,
        reminderDbPath: '/tmp/reminders.db',
        sendText,
      });

      await handler({ channel: 'feishu', userId: 'u1', content: '/model page 2' });

      const payload = String(sendText.mock.calls[0]?.[2] ?? '');
      const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
      const markdownContents = (parsed.content?.elements ?? [])
        .filter((item) => item.tag === 'markdown')
        .map((item) => String((item as { content?: unknown }).content ?? ''));
      expect(markdownContents.join('\n')).toContain('模型翻页');
      expect(markdownContents.join('\n')).toContain('模型翻页');
      const actionElements = (parsed.content?.elements ?? []).filter((item) => item.tag === 'action') as Array<{
        actions?: Array<{ text?: { content?: string }; value?: { gateway_cmd?: string } }>;
      }>;
      const cmds = actionElements.flatMap((item) => (item.actions ?? []).map((action) => action.value?.gateway_cmd));
      expect(cmds).toContain('/model page 1');
      expect(cmds).toContain('/model page 2');
      const pageModelAction = actionElements
        .flatMap((item) => item.actions ?? [])
        .find((action) => action.value?.gateway_cmd === '/model page-model-10');
      expect(pageModelAction?.text?.content).toBe('page-model-10');
    });
  });

  it('renders status change response as structured feishu card', async () => {
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

    await handler({ channel: 'feishu', userId: 'u1', content: '/skills disable global using-superpowers' });

    const payload = String(sendText.mock.calls[0]?.[2] ?? '');
    const parsed = JSON.parse(payload) as { content?: { elements?: Array<Record<string, unknown>> } };
    const markdownContents = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'markdown')
      .map((item) => String((item as { content?: unknown }).content ?? ''));
    expect(markdownContents.join('\n')).toContain('**执行成功**');
    const fieldGrid = parsed.content?.elements?.find((item) => item.tag === 'div') as {
      fields?: Array<{ text?: { content?: string } }>;
    } | undefined;
    expect(fieldGrid?.fields?.some((field) => String(field.text?.content ?? '').includes('**状态**'))).toBe(true);
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
    expect(sessionStore.getCurrentAgent('u1').agentId).toBe('default');
    expect(sessionStore.getSession('u1', 'memory-onboarding')).toBe('thread_onboarding');
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
    expect(sessionStore.getCurrentAgent('u1').agentId).toBe('skill-onboarding');
    expect(sessionStore.getSession('u1', 'skill-onboarding')).toBe('thread_skill');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('技能扩展助手'));
  });

  it('reuses existing skill onboarding session when already initialized', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('u1', {
      agentId: 'skill-onboarding',
      name: '技能扩展助手',
      workspaceDir: '/tmp/skill-onboarding',
    });
    sessionStore.setSession('u1', 'skill-onboarding', 'thread_skill');
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
    expect(sessionStore.getCurrentAgent('u1').agentId).toBe('skill-onboarding');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('已有进行中的会话'));
  });

  it('reuses legacy named onboarding agent instead of creating duplicates', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    sessionStore.createAgent('u1', {
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
    sessionStore.createAgent('u1', {
      agentId: 'frontend',
      name: '前端工作区',
      workspaceDir: '/tmp/frontend',
    });
    sessionStore.setCurrentAgent('u1', 'frontend');

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
    expect(sessionStore.getSession('u1', 'frontend')).toBe('thread_new');
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
    expect(prompt).toContain('简单一句话优先 text；多段说明或列表优先 markdown');
    expect(prompt).toContain('若是在汇报浏览器执行中的阶段性进度、阻塞原因、用户接管请求或完成态总结');
    expect(prompt).toContain('优先使用 markdown');
    expect(prompt).toContain('浏览器人工接管触发条件包括但不限于');
    expect(prompt).toContain('登录、验证码、扫码、支付确认、权限弹窗、高风险提交、页面目标歧义');
    expect(prompt).toContain('如果不确定该用哪种类型，优先退回 text');
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
    expect(prompt).toContain('若是在汇报浏览器执行中的阶段性进度');
    expect(prompt).toContain('Action/Evidence/Result/Next step');
    expect(prompt).toContain('若是在请求用户接管浏览器步骤');
    expect(prompt).toContain('阻塞原因、风险点、待确认项');
    expect(prompt).toContain('若是在汇报浏览器任务已完成');
    expect(prompt).toContain('最终结果、产出物和后续建议');
    expect(prompt).toContain('浏览器人工接管触发条件包括但不限于');
    expect(prompt).toContain('登录、验证码、扫码、支付确认、权限弹窗、高风险提交、页面目标歧义');
    expect(prompt).toContain('若要更新已发送的飞书消息，可输出 op=update');
    expect(prompt).toContain('若要撤回已发送的飞书消息，可输出 op=recall');
    expect(prompt).toContain('"message_id":"<飞书消息ID>"');
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

  it('keeps normal conversation and shows onboarding suggestion when shared memory is empty', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_default', rawOutput: '' }));
    const sessionStore = createSessionStore();
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

    await handler({ channel: 'wecom', userId: 'u1', content: '我们开始吧' });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/repo/default',
      search: false,
      prompt: expect.stringContaining('我们开始吧'),
    }));
    expect(sessionStore.getCurrentAgent('u1').agentId).toBe('default');
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('shared-memory 尚未初始化'));
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('/agent init-memory'));
  });

  it('keeps normal conversation and shows onboarding suggestion when current agent identity is empty', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_default', rawOutput: '' }));
    const sessionStore = createSessionStore();
    const handler = createChatHandler({
      sessionStore,
      rateLimitStore: { allow: () => true },
      codexRunner: {
        run,
        review: async () => ({ rawOutput: '' }),
      },
      agentWorkspaceManager: {
        createWorkspace: () => ({ agentId: 'memory-onboarding', workspaceDir: '/tmp/memory-onboarding' }),
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

    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
      workdir: '/repo/default',
      search: false,
      prompt: expect.stringContaining('继续'),
    }));
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('当前 agent 自身份尚未初始化'));
    expect(sendText).toHaveBeenCalledWith('wecom', 'u1', expect.stringContaining('/agent init-memory'));
  });

  it('keeps normal conversation on visible agent even when onboarding session exists', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_onboarding', rawOutput: '' }));
    const sessionStore = createSessionStore();
    sessionStore.createAgent('u1', {
      agentId: 'memory-onboarding',
      name: '记忆初始化引导',
      workspaceDir: '/tmp/memory-onboarding',
    });
    sessionStore.setSession('u1', 'memory-onboarding', 'thread_onboarding');

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
      prompt: expect.stringContaining('我叫 Alice'),
      workdir: '/repo/default',
    }));
    expect(run).not.toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_onboarding',
    }));
    expect(sessionStore.getCurrentAgent('u1').agentId).toBe('default');
  });

  it('shows onboarding suggestion only on the first message of the current agent', async () => {
    const sendText = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ threadId: 'thread_default', rawOutput: '' }));
    const sessionStore = createSessionStore();
    sessionStore.setSession('u1', 'default', 'thread_default');

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

    await handler({ channel: 'wecom', userId: 'u1', content: '继续做当前任务' });

    const suggestionCalls = sendText.mock.calls.filter((call) => String(call[2] ?? '').includes('/agent init-memory'));
    expect(suggestionCalls).toHaveLength(0);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread_default',
      prompt: expect.stringContaining('继续做当前任务'),
    }));
  });

  it('does not repeat onboarding suggestion once a normal session already exists', async () => {
    const sendText = vi.fn(async () => undefined);
    const sessionStore = createSessionStore();
    const createWorkspace = vi.fn(() => ({ agentId: 'memory-onboarding', workspaceDir: '/tmp/memory-onboarding' }));
    const run = vi.fn(async () => ({ threadId: 'thread_default', rawOutput: '' }));

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

    await handler({ channel: 'wecom', userId: 'u1', content: '开始吧' });
    await handler({ channel: 'wecom', userId: 'u1', content: '我补充一下' });

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(2);
    const suggestionCalls = sendText.mock.calls.filter((call) => String(call[2] ?? '').includes('/agent init-memory'));
    expect(suggestionCalls).toHaveLength(1);
  });

  it('redacts internal file details in manual onboarding stream output', async () => {
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

    await handler({ channel: 'wecom', userId: 'u1', content: '/agent init-memory' });

    const payloads = sendText.mock.calls.map((call) => String(call[2]));
    const sanitized = payloads.find((text) => text.includes('[内部路径]') || text.includes('[记忆文件]'));
    expect(sanitized).toBeTruthy();
    expect(sanitized).not.toContain('shared-memory');
    expect(sanitized).not.toContain('agent.md');
  });
});
