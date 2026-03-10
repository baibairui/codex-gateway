import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeishuUserApi } from '../src/services/feishu-user-api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FeishuUserApi', () => {
  it('creates a personal calendar event with a valid binding', async () => {
    const getByGatewayUserId = vi.fn(() => ({
      gatewayUserId: 'u1',
      feishuOpenId: 'ou_1',
      feishuUserId: 'user_1',
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      expiresAt: Date.now() + 60_000,
      scopeSnapshot: 'calendar:write',
      createdAt: 1,
      updatedAt: 1,
    }));
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe('https://open.feishu.cn/open-apis/calendar/v4/calendars/primary/events');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer access_1',
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        summary: '评审会',
        description: '项目评审',
        start_time: {
          date_time: '2026-03-10T09:00:00+08:00',
          timezone: 'Asia/Shanghai',
        },
        end_time: {
          date_time: '2026-03-10T10:00:00+08:00',
          timezone: 'Asia/Shanghai',
        },
      });
      return new Response(JSON.stringify({
        code: 0,
        data: {
          event: {
            event_id: 'evt_1',
            summary: '评审会',
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = new FeishuUserApi({
      bindingStore: {
        getByGatewayUserId,
        upsertBinding: vi.fn(),
      },
      oauthService: {
        refreshUserToken: vi.fn(),
      },
    });

    await expect(api.createPersonalCalendarEvent({
      gatewayUserId: 'u1',
      summary: '评审会',
      description: '项目评审',
      startTime: '2026-03-10T09:00:00+08:00',
      endTime: '2026-03-10T10:00:00+08:00',
      timezone: 'Asia/Shanghai',
    })).resolves.toEqual({
      ok: true,
      operation: 'calendar.create-event-personal',
      event: {
        event_id: 'evt_1',
        summary: '评审会',
      },
    });
  });

  it('creates a personal task with a valid binding', async () => {
    const getByGatewayUserId = vi.fn(() => ({
      gatewayUserId: 'u1',
      feishuOpenId: 'ou_1',
      feishuUserId: 'user_1',
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      expiresAt: Date.now() + 60_000,
      scopeSnapshot: 'task:write',
      createdAt: 1,
      updatedAt: 1,
    }));
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe('https://open.feishu.cn/open-apis/task/v2/tasks');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer access_1',
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        summary: '整理周报',
      });
      return new Response(JSON.stringify({
        code: 0,
        data: {
          task: {
            id: 'task_1',
            summary: '整理周报',
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = new FeishuUserApi({
      bindingStore: {
        getByGatewayUserId,
        upsertBinding: vi.fn(),
      },
      oauthService: {
        refreshUserToken: vi.fn(),
      },
    });

    await expect(api.createPersonalTask({
      gatewayUserId: 'u1',
      summary: '整理周报',
    })).resolves.toEqual({
      ok: true,
      operation: 'task.create-personal',
      task: {
        id: 'task_1',
        summary: '整理周报',
      },
    });
  });

  it('refreshes an expired binding before creating a personal task', async () => {
    const upsertBinding = vi.fn();
    const refreshUserToken = vi.fn(async () => ({
      accessToken: 'access_2',
      refreshToken: 'refresh_2',
      expiresIn: 7200,
    }));
    const getByGatewayUserId = vi.fn()
      .mockReturnValueOnce({
        gatewayUserId: 'u1',
        feishuOpenId: 'ou_1',
        feishuUserId: 'user_1',
        accessToken: 'access_1',
        refreshToken: 'refresh_1',
        expiresAt: Date.now() - 1,
        scopeSnapshot: 'task:write',
        createdAt: 1,
        updatedAt: 1,
      })
      .mockReturnValueOnce({
        gatewayUserId: 'u1',
        feishuOpenId: 'ou_1',
        feishuUserId: 'user_1',
        accessToken: 'access_2',
        refreshToken: 'refresh_2',
        expiresAt: Date.now() + 7_200_000,
        scopeSnapshot: 'task:write',
        createdAt: 1,
        updatedAt: 2,
      });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        task: {
          id: 'task_2',
          summary: '刷新后任务',
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const api = new FeishuUserApi({
      bindingStore: {
        getByGatewayUserId,
        upsertBinding,
      },
      oauthService: {
        refreshUserToken,
      },
    });

    await expect(api.createPersonalTask({
      gatewayUserId: 'u1',
      summary: '刷新后任务',
    })).resolves.toMatchObject({
      ok: true,
      operation: 'task.create-personal',
    });
    expect(refreshUserToken).toHaveBeenCalledWith('refresh_1');
    expect(upsertBinding).toHaveBeenCalledWith(expect.objectContaining({
      gatewayUserId: 'u1',
      accessToken: 'access_2',
      refreshToken: 'refresh_2',
    }));
  });

  it('fails when no binding exists', async () => {
    const api = new FeishuUserApi({
      bindingStore: {
        getByGatewayUserId: vi.fn(() => undefined),
        upsertBinding: vi.fn(),
      },
      oauthService: {
        refreshUserToken: vi.fn(),
      },
    });

    await expect(api.createPersonalTask({
      gatewayUserId: 'u1',
      summary: '整理周报',
    })).rejects.toThrow('feishu binding required');
  });
});
