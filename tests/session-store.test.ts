import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SessionStore } from '../src/stores/session-store.js';

function makeStore(): SessionStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'));
  return new SessionStore(path.join(dir, 'sessions.db'), {
    defaultWorkspaceDir: '/repo/default-workdir',
  });
}

function makeStorePair(): { filePath: string; createStore: () => SessionStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'));
  const filePath = path.join(dir, 'sessions.db');
  return {
    filePath,
    createStore: () => new SessionStore(filePath, {
      defaultWorkspaceDir: '/repo/default-workdir',
    }),
  };
}

describe('SessionStore', () => {
  it('defaults to the built-in default agent', () => {
    const store = makeStore();
    const agent = store.getCurrentAgent('u1');

    expect(agent.agentId).toBe('default');
    expect(agent.workspaceDir).toBe('/repo/default-workdir');
    expect(store.listAgents('u1')[0]?.isDefault).toBe(true);
  });

  it('creates agents and resolves numeric targets', () => {
    const store = makeStore();
    store.createAgent('u1', {
      agentId: 'frontend',
      name: '前端Agent',
      workspaceDir: '/tmp/frontend',
    });
    store.createAgent('u1', {
      agentId: 'backend',
      name: '后端Agent',
      workspaceDir: '/tmp/backend',
    });

    const listed = store.listAgents('u1');
    expect(listed).toHaveLength(3);
    expect(store.resolveAgentTarget('u1', '2')).toBeTruthy();
    expect(store.resolveAgentTarget('u1', 'frontend')).toBe('frontend');

    expect(store.setCurrentAgent('u1', 'frontend')).toBe(true);
    expect(store.getCurrentAgent('u1').agentId).toBe('frontend');
  });

  it('keeps session history isolated per agent', () => {
    const store = makeStore();
    store.createAgent('u1', {
      agentId: 'frontend',
      name: '前端Agent',
      workspaceDir: '/tmp/frontend',
    });

    store.setSession('u1', 'default', 'thread_default_1', 'first prompt');
    store.setSession('u1', 'frontend', 'thread_front_1', 'second prompt');
    store.setSession('u1', 'frontend', 'thread_front_2', 'third prompt');

    expect(store.getSession('u1', 'default')).toBe('thread_default_1');
    expect(store.getSession('u1', 'frontend')).toBe('thread_front_2');
    expect(store.resolveSwitchTarget('u1', 'frontend', '2')).toBe('thread_front_1');
    expect(store.listDetailed('u1', 'default')).toHaveLength(1);
    expect(store.listDetailed('u1', 'frontend')).toHaveLength(2);

    store.renameSession('thread_front_1', '发布修复');
    expect(store.listDetailed('u1', 'frontend')[1]?.name).toBe('发布修复');
  });

  it('lists known users across session and agent tables', () => {
    const store = makeStore();
    store.setSession('u1', 'default', 'thread_default_1', 'first prompt');
    store.createAgent('u2', {
      agentId: 'assistant',
      name: '助理',
      workspaceDir: '/tmp/assistant',
    });

    expect(store.listKnownUsers()).toEqual(['u1', 'u2']);
  });

  it('hides system agents from list but can include them for internal logic', () => {
    const store = makeStore();
    store.createAgent('u1', {
      agentId: 'memory-onboarding',
      name: '记忆初始化引导',
      workspaceDir: '/tmp/memory-onboarding',
    });
    store.createAgent('u1', {
      agentId: 'memory-onboarding-2',
      name: '记忆初始化引导-2',
      workspaceDir: '/tmp/memory-onboarding-2',
    });
    store.createAgent('u1', {
      agentId: 'assistant',
      name: '助理',
      workspaceDir: '/tmp/assistant',
    });
    store.createAgent('u1', {
      agentId: 'agent-legacy',
      name: '记忆初始化引导',
      workspaceDir: '/tmp/legacy-onboarding',
    });

    const visible = store.listAgents('u1');
    const all = store.listAgents('u1', { includeHidden: true });
    expect(visible.some((item) => item.agentId.startsWith('memory-onboarding'))).toBe(false);
    expect(visible.some((item) => item.name === '记忆初始化引导')).toBe(false);
    expect(all.some((item) => item.agentId === 'memory-onboarding')).toBe(true);
    expect(all.some((item) => item.agentId === 'memory-onboarding-2')).toBe(true);
    expect(all.some((item) => item.agentId === 'agent-legacy')).toBe(true);
    expect(store.resolveAgentTarget('u1', 'memory-onboarding')).toBeUndefined();
    expect(store.resolveAgentTarget('u1', 'agent-legacy')).toBeUndefined();
  });

  it('persists model overrides per agent across restarts', () => {
    const pair = makeStorePair();
    const store = pair.createStore();
    store.createAgent('u1', {
      agentId: 'frontend',
      name: '前端Agent',
      workspaceDir: '/tmp/frontend',
    });

    store.setModelOverride('u1', 'default', 'gpt-5');
    store.setModelOverride('u1', 'frontend', 'gpt-5-codex');

    const reopened = pair.createStore();
    expect(reopened.getModelOverride('u1', 'default')).toBe('gpt-5');
    expect(reopened.getModelOverride('u1', 'frontend')).toBe('gpt-5-codex');

    reopened.clearModelOverride('u1', 'frontend');

    const reopenedAgain = pair.createStore();
    expect(reopenedAgain.getModelOverride('u1', 'default')).toBe('gpt-5');
    expect(reopenedAgain.getModelOverride('u1', 'frontend')).toBeUndefined();
  });

  it('persists provider overrides per agent across restarts', () => {
    const pair = makeStorePair();
    const store = pair.createStore();
    store.createAgent('u1', {
      agentId: 'frontend',
      name: '前端Agent',
      workspaceDir: '/tmp/frontend',
    });

    store.setProviderOverride('u1', 'default', 'codex');
    store.setProviderOverride('u1', 'frontend', 'opencode');

    const reopened = pair.createStore();
    expect(reopened.getProviderOverride('u1', 'default')).toBe('codex');
    expect(reopened.getProviderOverride('u1', 'frontend')).toBe('opencode');

    reopened.clearProviderOverride('u1', 'frontend');

    const reopenedAgain = pair.createStore();
    expect(reopenedAgain.getProviderOverride('u1', 'default')).toBe('codex');
    expect(reopenedAgain.getProviderOverride('u1', 'frontend')).toBeUndefined();
  });
});
