import { describe, expect, it } from 'vitest';

import {
  buildFeishuApiLoginFormMessage,
  buildFeishuLoginChoiceMessage,
  buildFeishuOpenCodeInputFallbackMessage,
  buildFeishuOpenCodeOauthMessage,
} from '../src/services/feishu-command-cards.js';

function getCardElements(payload: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(payload) as {
    content?: {
      schema?: string;
      body?: {
        elements?: Array<Record<string, unknown>>;
      };
    };
  };
  expect(parsed.content?.schema).toBe('2.0');
  return parsed.content?.body?.elements ?? [];
}

function extractButtons(elements: Array<Record<string, unknown>>): Array<{
  text?: { content?: string };
  value?: Record<string, unknown>;
  multi_url?: { url?: string };
}> {
  return elements.flatMap((item) => {
    if (item.tag === 'button') {
      return [item];
    }
    if (item.tag === 'form') {
      return extractButtons(Array.isArray(item.elements) ? item.elements as Array<Record<string, unknown>> : []);
    }
    if (item.tag === 'column_set') {
      const columns = Array.isArray(item.columns) ? item.columns as Array<Record<string, unknown>> : [];
      return columns.flatMap((column) => extractButtons(Array.isArray(column.elements) ? column.elements as Array<Record<string, unknown>> : []));
    }
    return [];
  }) as Array<{
    text?: { content?: string };
    value?: Record<string, unknown>;
    multi_url?: { url?: string };
  }>;
}

describe('buildFeishuLoginChoiceMessage', () => {
  it('renders both device auth and API login actions', () => {
    const payload = buildFeishuLoginChoiceMessage();
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
    };

    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    const elements = getCardElements(payload);
    expect(elements.some((item) => item.tag === 'action')).toBe(false);
    const buttons = extractButtons(elements);
    expect(buttons.some((item) => item.text?.content === '设备授权登录' && item.value?.gateway_action === 'codex_login.start_device_auth')).toBe(true);
    expect(buttons.some((item) => item.text?.content === 'API URL / Key 登录' && item.value?.gateway_action === 'codex_login.open_api_form')).toBe(true);
  });

  it('hides device auth when provider does not support it', () => {
    const payload = buildFeishuLoginChoiceMessage({
      provider: 'opencode',
      providerLabel: 'OpenCode',
      supportsDeviceAuth: false,
    });
    const elements = getCardElements(payload);
    expect(elements.some((item) => item.tag === 'action')).toBe(false);
    const buttons = extractButtons(elements);
    expect(buttons.some((item) => item.text?.content === '设备授权登录')).toBe(false);
    expect(buttons.some((item) => item.text?.content === 'API URL / Key 登录')).toBe(true);
  });

  it('shows only api login for opencode in feishu', () => {
    const payload = buildFeishuLoginChoiceMessage({
      provider: 'opencode',
      providerLabel: 'OpenCode',
      supportsDeviceAuth: false,
    });
    const elements = getCardElements(payload);
    const buttons = extractButtons(elements);

    expect(elements.some((item) => item.tag === 'action')).toBe(false);
    expect(buttons.some((item) => item.text?.content === 'OpenAI')).toBe(false);
    expect(buttons.some((item) => item.text?.content === 'Anthropic')).toBe(false);
    expect(buttons.filter((item) => item.text?.content === 'API URL / Key 登录')).toHaveLength(1);
  });
});

describe('buildFeishuApiLoginFormMessage', () => {
  it('wraps login inputs inside a form card element', () => {
    const payload = buildFeishuApiLoginFormMessage();
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
    };

    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    const form = getCardElements(payload).find((item) => item.tag === 'form') as
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

describe('buildFeishuOpenCodeOauthMessage', () => {
  it('renders an oauth card with a direct open-link button', () => {
    const payload = buildFeishuOpenCodeOauthMessage({
      provider: 'openai',
      url: 'https://auth.example.com/oauth/start',
    });
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
    };

    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    const elements = getCardElements(payload);
    expect(elements.some((item) => item.tag === 'action')).toBe(false);
    const buttons = extractButtons(elements);
    expect(buttons.some((item) => item.text?.content === '打开授权链接' && item.multi_url?.url === 'https://auth.example.com/oauth/start')).toBe(true);
  });
});

describe('buildFeishuOpenCodeInputFallbackMessage', () => {
  it('renders a minimal fallback form when oauth still needs user input', () => {
    const payload = buildFeishuOpenCodeInputFallbackMessage({
      provider: 'openai',
      prompt: 'Enter the one-time code from your authenticator app',
    });
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
    };

    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    const form = getCardElements(payload).find((item) => item.tag === 'form') as
      | {
          name?: string;
          value?: Record<string, unknown>;
          elements?: Array<Record<string, unknown>>;
        }
      | undefined;
    expect(form?.name).toBe('opencode_oauth_input');
    expect(form?.value?.gateway_action).toBe('opencode_login.submit_auth_input');
    const inputs = (form?.elements ?? []).filter((item) => item.tag === 'input');
    expect(inputs.map((item) => item.name)).toEqual(['auth_input']);
  });
});
