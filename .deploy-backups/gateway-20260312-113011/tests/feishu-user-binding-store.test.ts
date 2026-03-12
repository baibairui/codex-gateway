import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FeishuUserBindingStore } from '../src/stores/feishu-user-binding-store.js';

describe('FeishuUserBindingStore', () => {
  it('upserts, reads, clears, and lists bindings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-binding-'));
    const filePath = path.join(dir, 'bindings.db');
    const store = new FeishuUserBindingStore(filePath);

    expect(store.getByGatewayUserId('u1')).toBeUndefined();

    store.upsertBinding({
      gatewayUserId: 'u1',
      feishuOpenId: 'ou_1',
      feishuUserId: 'user_1',
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      expiresAt: 111,
      scopeSnapshot: 'task:write calendar:read',
    });

    expect(store.getByGatewayUserId('u1')).toEqual(expect.objectContaining({
      gatewayUserId: 'u1',
      feishuOpenId: 'ou_1',
      feishuUserId: 'user_1',
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      expiresAt: 111,
      scopeSnapshot: 'task:write calendar:read',
    }));

    store.upsertBinding({
      gatewayUserId: 'u1',
      feishuOpenId: 'ou_1b',
      feishuUserId: 'user_1b',
      accessToken: 'access_2',
      refreshToken: 'refresh_2',
      expiresAt: 222,
      scopeSnapshot: undefined,
    });

    expect(store.getByGatewayUserId('u1')).toEqual(expect.objectContaining({
      gatewayUserId: 'u1',
      feishuOpenId: 'ou_1b',
      feishuUserId: 'user_1b',
      accessToken: 'access_2',
      refreshToken: 'refresh_2',
      expiresAt: 222,
      scopeSnapshot: undefined,
    }));

    expect(store.listBindings()).toHaveLength(1);
    expect(store.clearBinding('u1')).toBe(true);
    expect(store.getByGatewayUserId('u1')).toBeUndefined();
    expect(store.clearBinding('u1')).toBe(false);
  });
});
