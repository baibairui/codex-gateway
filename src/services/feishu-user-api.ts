import type { FeishuUserBindingRecord, UpsertFeishuUserBindingInput } from '../stores/feishu-user-binding-store.js';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

interface FeishuUserApiOptions {
  bindingStore: {
    getByGatewayUserId: (gatewayUserId: string) => FeishuUserBindingRecord | undefined;
    upsertBinding: (input: UpsertFeishuUserBindingInput) => unknown;
  };
  oauthService: {
    refreshUserToken: (refreshToken: string) => Promise<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>;
  };
}

export class FeishuUserApi {
  private readonly bindingStore: FeishuUserApiOptions['bindingStore'];
  private readonly oauthService: FeishuUserApiOptions['oauthService'];

  constructor(options: FeishuUserApiOptions) {
    this.bindingStore = options.bindingStore;
    this.oauthService = options.oauthService;
  }

  async createPersonalTask(input: {
    gatewayUserId: string;
    summary: string;
    description?: string;
  }): Promise<{
    ok: true;
    operation: 'task.create-personal';
    task: Record<string, unknown> | null;
  }> {
    const binding = await this.getValidBinding(input.gatewayUserId);
    const payload = await requestJson(`${FEISHU_API_BASE}/task/v2/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${binding.accessToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        summary: input.summary.trim(),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      }),
    });
    return {
      ok: true,
      operation: 'task.create-personal',
      task: asObject(payload.data)?.task && asObject(asObject(payload.data)?.task)
        ? asObject(asObject(payload.data)?.task) ?? null
        : (asObject(payload.data)?.task as Record<string, unknown> | null ?? null),
    };
  }

  async createPersonalCalendarEvent(input: {
    gatewayUserId: string;
    summary: string;
    description?: string;
    startTime: string;
    endTime: string;
    timezone?: string;
  }): Promise<{
    ok: true;
    operation: 'calendar.create-event-personal';
    event: Record<string, unknown> | null;
  }> {
    const binding = await this.getValidBinding(input.gatewayUserId);
    const timezone = input.timezone?.trim() || 'Asia/Shanghai';
    const payload = await requestJson(`${FEISHU_API_BASE}/calendar/v4/calendars/primary/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${binding.accessToken}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        summary: input.summary.trim(),
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        start_time: {
          date_time: input.startTime.trim(),
          timezone,
        },
        end_time: {
          date_time: input.endTime.trim(),
          timezone,
        },
      }),
    });
    return {
      ok: true,
      operation: 'calendar.create-event-personal',
      event: asObject(payload.data)?.event && asObject(asObject(payload.data)?.event)
        ? asObject(asObject(payload.data)?.event) ?? null
        : (asObject(payload.data)?.event as Record<string, unknown> | null ?? null),
    };
  }

  private async getValidBinding(gatewayUserId: string): Promise<FeishuUserBindingRecord> {
    const binding = this.bindingStore.getByGatewayUserId(gatewayUserId);
    if (!binding) {
      throw new Error('feishu binding required');
    }
    if (binding.expiresAt > Date.now() + 10_000) {
      return binding;
    }
    const refreshed = await this.oauthService.refreshUserToken(binding.refreshToken);
    this.bindingStore.upsertBinding({
      gatewayUserId: binding.gatewayUserId,
      feishuOpenId: binding.feishuOpenId,
      feishuUserId: binding.feishuUserId,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: Date.now() + refreshed.expiresIn * 1000,
      scopeSnapshot: binding.scopeSnapshot,
    });
    const next = this.bindingStore.getByGatewayUserId(gatewayUserId);
    if (!next) {
      throw new Error('feishu binding required');
    }
    return next;
  }
}

async function requestJson(input: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(input, init);
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(`feishu user api failed: ${String(payload.code ?? response.status)} ${String(payload.msg ?? 'unknown error')}`);
  }
  return payload;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
