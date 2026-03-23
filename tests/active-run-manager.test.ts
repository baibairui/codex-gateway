import { describe, expect, it, vi } from 'vitest';

import { ActiveRunManager } from '../src/services/active-run-manager.js';

describe('ActiveRunManager', () => {
  it('stores and stops a run by runId', async () => {
    const stop = vi.fn(async () => undefined);
    const manager = new ActiveRunManager();

    manager.register({
      runId: 'run_1',
      channel: 'feishu',
      userId: 'u1',
      agentId: 'default',
      status: 'running',
      startedAt: 1,
      lastActivityAt: 1,
      stop,
    });

    const result = await manager.stopRun({
      runId: 'run_1',
      channel: 'feishu',
      userId: 'u1',
    });

    expect(result).toBe('stopped');
    expect(stop).toHaveBeenCalledWith('user_stop');
  });
});
