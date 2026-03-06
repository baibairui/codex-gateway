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
});
