import { describe, expect, it } from 'vitest';

import {
  buildFeishuApiLoginFormMessage,
  buildFeishuLoginChoiceMessage,
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
