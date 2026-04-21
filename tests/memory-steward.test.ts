import { describe, expect, it, vi } from 'vitest';

import { MemorySteward } from '../src/services/memory-steward.js';

describe('MemorySteward', () => {
  it('runs hidden steward for users with custom agents and targets the new identity model', async () => {
    const runForSystem = vi.fn(async () => ({ threadId: 'thread_memory', rawOutput: '' }));
    const ensureSystemMemoryStewardWorkspace = vi.fn(() => ({
      workspaceDir: '/tmp/users/u1/internal/memory-steward',
      userDir: '/tmp/users/u1',
      userIdentityPath: '/tmp/users/u1/user.md',
      sharedMemoryDir: '/tmp/users/u1',
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
            workspaceDir: '/tmp/users/u1/agents/assistant',
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
      codexRunner: { runForSystem },
      enabled: true,
      intervalMs: 60_000,
      model: 'gpt-5-codex',
    });

    await steward.runCycle();

    expect(ensureSystemMemoryStewardWorkspace).toHaveBeenCalledWith('u1');
    expect(runForSystem).toHaveBeenCalledWith(expect.objectContaining({
      workdir: '/tmp/users/u1/internal/memory-steward',
      model: 'gpt-5-codex',
      search: false,
    }));
    expect(runForSystem.mock.calls[0]?.[0]?.prompt).toContain('user identity: /tmp/users/u1/user.md');
    expect(runForSystem.mock.calls[0]?.[0]?.prompt).toContain('soul: /tmp/users/u1/agents/assistant/SOUL.md');
    expect(runForSystem.mock.calls[0]?.[0]?.prompt).toContain('daily: /tmp/users/u1/agents/assistant/memory/daily');
    expect(runForSystem.mock.calls[0]?.[0]?.prompt).not.toContain('shared-memory');
    expect(runForSystem.mock.calls[0]?.[0]?.prompt).not.toContain('profile.md');
  });

  it('skips users without custom agents', async () => {
    const runForSystem = vi.fn(async () => ({ threadId: 'thread_memory', rawOutput: '' }));
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
          workspaceDir: '/tmp/users/u1/internal/memory-steward',
          userDir: '/tmp/users/u1',
          userIdentityPath: '/tmp/users/u1/user.md',
          sharedMemoryDir: '/tmp/users/u1',
        }),
      },
      codexRunner: { runForSystem },
      enabled: true,
      intervalMs: 60_000,
    });

    await steward.runCycle();

    expect(runForSystem).not.toHaveBeenCalled();
  });

  it('does not run immediately on start and waits for the next interval', async () => {
    vi.useFakeTimers();
    const runForSystem = vi.fn(async () => ({ threadId: 'thread_memory', rawOutput: '' }));
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
          workspaceDir: '/tmp/users/u1/internal/memory-steward',
          userDir: '/tmp/users/u1',
          userIdentityPath: '/tmp/users/u1/user.md',
          sharedMemoryDir: '/tmp/users/u1',
        }),
      },
      codexRunner: { runForSystem },
      enabled: true,
      intervalMs: 3_600_000,
    });

    steward.start();
    expect(runForSystem).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(runForSystem).toHaveBeenCalledTimes(1);

    steward.stop();
    vi.useRealTimers();
  });
});
