import { describe, expect, it, vi } from 'vitest';

import { MemorySteward } from '../src/services/memory-steward.js';

describe('MemorySteward', () => {
  it('runs hidden steward for users with custom agents', async () => {
    const run = vi.fn(async () => ({ threadId: 'thread_memory', rawOutput: '' }));
    const ensureSystemMemoryStewardWorkspace = vi.fn(() => ({
      workspaceDir: '/tmp/users/u1/_memory-steward',
      sharedMemoryDir: '/tmp/users/u1/shared-memory',
    }));

    const steward = new MemorySteward({
      sessionStore: {
        listKnownUsers: () => ['u1'],
        listAgents: () => [
          {
            agentId: 'default',
            name: '默认Agent',
            workspaceDir: '/repo',
            createdAt: 0,
            updatedAt: 0,
            current: true,
            isDefault: true,
          },
          {
            agentId: 'assistant',
            name: '个人助理',
            workspaceDir: '/tmp/users/u1/assistant',
            createdAt: 1,
            updatedAt: 1,
            current: false,
            isDefault: false,
          },
        ],
      },
      agentWorkspaceManager: {
        ensureSystemMemoryStewardWorkspace,
      },
      codexRunner: { run },
      enabled: true,
      intervalMs: 60_000,
      model: 'gpt-5-codex',
    });

    await steward.runCycle();

    expect(ensureSystemMemoryStewardWorkspace).toHaveBeenCalledWith('u1');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/users/u1/_memory-steward',
      model: 'gpt-5-codex',
      search: false,
    }));
  });

  it('skips users without custom agents', async () => {
    const run = vi.fn(async () => ({ threadId: 'thread_memory', rawOutput: '' }));
    const steward = new MemorySteward({
      sessionStore: {
        listKnownUsers: () => ['u1'],
        listAgents: () => [
          {
            agentId: 'default',
            name: '默认Agent',
            workspaceDir: '/repo',
            createdAt: 0,
            updatedAt: 0,
            current: true,
            isDefault: true,
          },
        ],
      },
      agentWorkspaceManager: {
        ensureSystemMemoryStewardWorkspace: () => ({
          workspaceDir: '/tmp/users/u1/_memory-steward',
          sharedMemoryDir: '/tmp/users/u1/shared-memory',
        }),
      },
      codexRunner: { run },
      enabled: true,
      intervalMs: 60_000,
    });

    await steward.runCycle();

    expect(run).not.toHaveBeenCalled();
  });

  it('does not run immediately on start and waits for the next interval', async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ threadId: 'thread_memory', rawOutput: '' }));
    const steward = new MemorySteward({
      sessionStore: {
        listKnownUsers: () => ['u1'],
        listAgents: () => [
          {
            agentId: 'default',
            name: '默认Agent',
            workspaceDir: '/repo',
            createdAt: 0,
            updatedAt: 0,
            current: true,
            isDefault: true,
          },
          {
            agentId: 'assistant',
            name: '个人助理',
            workspaceDir: '/tmp/users/u1/assistant',
            createdAt: 1,
            updatedAt: 1,
            current: false,
            isDefault: false,
          },
        ],
      },
      agentWorkspaceManager: {
        ensureSystemMemoryStewardWorkspace: () => ({
          workspaceDir: '/tmp/users/u1/_memory-steward',
          sharedMemoryDir: '/tmp/users/u1/shared-memory',
        }),
      },
      codexRunner: { run },
      enabled: true,
      intervalMs: 3_600_000,
    });

    steward.start();
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(run).toHaveBeenCalledTimes(1);

    steward.stop();
    vi.useRealTimers();
  });
});
