import { describe, expect, it } from 'vitest';

import { WorkspacePublisher } from '../src/services/workspace-publisher.js';

describe('WorkspacePublisher', () => {
  it('exposes the current npm-script based publish and repair entrypoints', () => {
    const publisher = new WorkspacePublisher();

    expect(publisher).toBeInstanceOf(WorkspacePublisher);
    expect(typeof publisher.publish).toBe('function');
    expect(typeof publisher.repairUsers).toBe('function');
  });
});
