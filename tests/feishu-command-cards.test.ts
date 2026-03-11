import { describe, expect, it } from 'vitest';

import {
  buildFeishuApiLoginFormMessage,
  buildFeishuLoginChoiceMessage,
  buildFeishuPersonalAuthUnavailableMessage,
  buildFeishuUserAuthMessage,
} from '../src/services/feishu-command-cards.js';

describe('buildFeishuLoginChoiceMessage', () => {
  it('renders both device auth and API login actions', () => {
    const payload = buildFeishuLoginChoiceMessage();
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: {
        elements?: Array<Record<string, unknown>>;
      };
    };

    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    const actions = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'action')
      .flatMap((item) => Array.isArray(item.actions) ? item.actions : []) as Array<{
        text?: { content?: string };
        value?: Record<string, unknown>;
      }>;
    expect(actions.some((item) => item.text?.content === '设备授权登录' && item.value?.gateway_action === 'codex_login.start_device_auth')).toBe(true);
    expect(actions.some((item) => item.text?.content === 'API URL / Key 登录' && item.value?.gateway_action === 'codex_login.open_api_form')).toBe(true);
  });

  it('hides device auth when provider does not support it', () => {
    const payload = buildFeishuLoginChoiceMessage({
      provider: 'opencode',
      providerLabel: 'OpenCode',
      supportsDeviceAuth: false,
    });
    const parsed = JSON.parse(payload) as {
      content?: {
        elements?: Array<Record<string, unknown>>;
      };
    };
    const actions = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'action')
      .flatMap((item) => Array.isArray(item.actions) ? item.actions : []) as Array<{
        text?: { content?: string };
      }>;
    expect(actions.some((item) => item.text?.content === '设备授权登录')).toBe(false);
    expect(actions.some((item) => item.text?.content === 'API URL / Key 登录')).toBe(true);
  });
});

describe('buildFeishuApiLoginFormMessage', () => {
  it('wraps login inputs inside a form card element', () => {
    const payload = buildFeishuApiLoginFormMessage();
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: {
        elements?: Array<Record<string, unknown>>;
      };
    };

    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    const form = (parsed.content?.elements ?? []).find((item) => item.tag === 'form') as
      | {
          name?: string;
          value?: Record<string, unknown>;
          elements?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(form?.name).toBe('codex_api_login');
    expect(form?.value?.gateway_action).toBe('codex_login.submit_api_credentials');
    const inputs = (form?.elements ?? []).filter((item) => item.tag === 'input');
    expect(inputs.map((item) => item.name)).toEqual(['base_url', 'api_key', 'model']);
    expect(inputs.every((item) => item.label_position === 'top')).toBe(true);
    const submitButton = (form?.elements ?? []).find((item) => item.tag === 'button') as
      | { action_type?: string; name?: string }
      | undefined;
    expect(submitButton?.action_type).toBe('form_submit');
    expect(submitButton?.name).toBe('submit_api_login');
  });
});

describe('buildFeishuUserAuthMessage', () => {
  it('renders a user auth card with relative auth and status links', () => {
    const payload = buildFeishuUserAuthMessage({
      gatewayUserId: 'ou_123',
      reason: '当前账号尚未绑定飞书个人身份。',
    });
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: {
        header?: { title?: { content?: string } };
        elements?: Array<Record<string, unknown>>;
      };
    };

    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    expect(parsed.content?.header?.title?.content).toBe('飞书个人授权');
    const actions = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'action')
      .flatMap((item) => Array.isArray(item.actions) ? item.actions : []) as Array<{
        text?: { content?: string };
        multi_url?: { url?: string };
      }>;
    expect(actions.some((item) => item.text?.content === '去飞书授权' && item.multi_url?.url === '/feishu/oauth/start?gateway_user_id=ou_123')).toBe(true);
    expect(actions.some((item) => item.text?.content === '查看授权状态' && item.multi_url?.url === '/feishu/auth/status?gateway_user_id=ou_123')).toBe(true);
  });

  it('renders absolute auth links when a public gateway base url is provided', () => {
    const payload = buildFeishuUserAuthMessage({
      gatewayUserId: 'ou_123',
      authStartUrl: 'https://gateway.example.com/feishu/oauth/start?gateway_user_id=ou_123',
      authStatusUrl: 'https://gateway.example.com/feishu/auth/status?gateway_user_id=ou_123',
    });
    const parsed = JSON.parse(payload) as {
      content?: {
        elements?: Array<Record<string, unknown>>;
      };
    };

    const actions = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'action')
      .flatMap((item) => Array.isArray(item.actions) ? item.actions : []) as Array<{
        text?: { content?: string };
        multi_url?: { url?: string };
      }>;
    expect(actions.some((item) => item.text?.content === '去飞书授权' && item.multi_url?.url === 'https://gateway.example.com/feishu/oauth/start?gateway_user_id=ou_123')).toBe(true);
    expect(actions.some((item) => item.text?.content === '查看授权状态' && item.multi_url?.url === 'https://gateway.example.com/feishu/auth/status?gateway_user_id=ou_123')).toBe(true);
  });
});

describe('buildFeishuPersonalAuthUnavailableMessage', () => {
  it('renders an unavailable card without a broken auth button', () => {
    const payload = buildFeishuPersonalAuthUnavailableMessage({
      reason: '当前环境尚未启用飞书个人权限连接。',
    });
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: {
        header?: { title?: { content?: string } };
        elements?: Array<Record<string, unknown>>;
      };
    };

    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    expect(parsed.content?.header?.title?.content).toBe('飞书个人权限连接');
    const actions = (parsed.content?.elements ?? [])
      .filter((item) => item.tag === 'action')
      .flatMap((item) => Array.isArray(item.actions) ? item.actions : []) as Array<{
        text?: { content?: string };
      }>;
    expect(actions.some((item) => item.text?.content === '去飞书授权')).toBe(false);
  });
});
