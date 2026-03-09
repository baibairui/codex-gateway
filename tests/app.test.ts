import { afterAll, describe, expect, it, vi } from 'vitest';

import { createApp, dispatchFeishuCardActionEvent, dispatchFeishuMessageReceiveEvent } from '../src/app.js';

const serverRefs: Array<{ close: () => void }> = [];

afterAll(() => {
  for (const server of serverRefs) {
    server.close();
  }
});

async function startTestServer(options?: {
  feishuVerificationToken?: string;
  feishuLongConnection?: boolean;
  feishuGroupRequireMention?: boolean;
  feishuDocBaseUrlConfigured?: boolean;
  feishuStartupHelpEnabled?: boolean;
  feishuStartupHelpAdminConfigured?: boolean;
  handleText?: (input: {
    channel: 'wecom' | 'feishu';
    userId: string;
    content: string;
    sourceMessageId?: string;
    allowReply?: boolean;
    replyTargetId?: string;
    replyTargetType?: 'open_id' | 'chat_id';
  }) => Promise<void>;
  handleFeishuCardAction?: (input: {
    userId: string;
    chatId?: string;
    action: string;
    value: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const app = createApp({
    wecomEnabled: true,
    feishuEnabled: true,
    wecomCrypto: {
      verifySignature: () => true,
      decrypt: (input: string) => input,
    } as never,
    allowFrom: '*',
    feishuVerificationToken: options?.feishuVerificationToken,
    feishuLongConnection: options?.feishuLongConnection,
    feishuGroupRequireMention: options?.feishuGroupRequireMention,
    feishuDocBaseUrlConfigured: options?.feishuDocBaseUrlConfigured,
    feishuStartupHelpEnabled: options?.feishuStartupHelpEnabled,
    feishuStartupHelpAdminConfigured: options?.feishuStartupHelpAdminConfigured,
    isDuplicateMessage: () => false,
    handleText: options?.handleText ?? (async () => undefined),
    handleFeishuCardAction: options?.handleFeishuCardAction,
  });

  const server = app.listen(0);
  serverRefs.push(server);
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to acquire test server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function startWecomDisabledServer() {
  const app = createApp({
    wecomEnabled: false,
    feishuEnabled: false,
    allowFrom: '*',
    feishuGroupRequireMention: true,
    isDuplicateMessage: () => false,
    handleText: async () => undefined,
  });

  const server = app.listen(0);
  serverRefs.push(server);
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to acquire test server address');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('createApp wecom toggle', () => {
  it('does not expose wecom callback when disabled', async () => {
    const baseUrl = await startWecomDisabledServer();

    const response = await fetch(`${baseUrl}/wecom/callback`);

    expect(response.status).toBe(404);
  });

  it('exposes channel status in healthz', async () => {
    const baseUrl = await startTestServer({
      feishuLongConnection: true,
      feishuGroupRequireMention: true,
    });

    const response = await fetch(`${baseUrl}/healthz`);
    const payload = await response.json() as {
      ok?: boolean;
      channels?: {
        wecom?: { enabled?: boolean };
        feishu?: {
          enabled?: boolean;
          mode?: string;
          webhookEnabled?: boolean;
          groupRequireMention?: boolean;
          docBaseUrlConfigured?: boolean;
          startupHelpEnabled?: boolean;
          startupHelpAdminConfigured?: boolean;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.channels?.wecom?.enabled).toBe(true);
    expect(payload.channels?.feishu?.enabled).toBe(true);
    expect(payload.channels?.feishu?.mode).toBe('long-connection');
    expect(payload.channels?.feishu?.webhookEnabled).toBe(false);
    expect(payload.channels?.feishu?.groupRequireMention).toBe(true);
    expect(payload.channels?.feishu?.docBaseUrlConfigured).toBe(true);
    expect(payload.channels?.feishu?.startupHelpEnabled).toBe(false);
    expect(payload.channels?.feishu?.startupHelpAdminConfigured).toBe(false);
  });

  it('exposes feishu install-related status in healthz', async () => {
    const baseUrl = await startTestServer({
      feishuLongConnection: false,
      feishuGroupRequireMention: false,
      feishuDocBaseUrlConfigured: true,
      feishuStartupHelpEnabled: true,
      feishuStartupHelpAdminConfigured: true,
    });

    const response = await fetch(`${baseUrl}/healthz`);
    const payload = await response.json() as {
      channels?: {
        feishu?: {
          mode?: string;
          webhookEnabled?: boolean;
          groupRequireMention?: boolean;
          docBaseUrlConfigured?: boolean;
          startupHelpEnabled?: boolean;
          startupHelpAdminConfigured?: boolean;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.channels?.feishu?.mode).toBe('webhook');
    expect(payload.channels?.feishu?.webhookEnabled).toBe(true);
    expect(payload.channels?.feishu?.groupRequireMention).toBe(false);
    expect(payload.channels?.feishu?.docBaseUrlConfigured).toBe(true);
    expect(payload.channels?.feishu?.startupHelpEnabled).toBe(true);
    expect(payload.channels?.feishu?.startupHelpAdminConfigured).toBe(true);
  });
});

describe('createApp feishu callback', () => {
  it('does not expose webhook endpoint when long connection mode is enabled', async () => {
    const baseUrl = await startTestServer({
      feishuLongConnection: true,
      feishuVerificationToken: 'expected-token',
    });

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
  });

  it('rejects url_verification when token mismatch', async () => {
    const baseUrl = await startTestServer({ feishuVerificationToken: 'expected-token' });

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'url_verification',
        token: 'wrong-token',
        challenge: 'ping',
      }),
    });
    const payload = await response.json() as { code?: number; msg?: string };

    expect(response.status).toBe(403);
    expect(payload.code).toBe(403);
    expect(payload.msg).toBe('token mismatch');
  });

  it('accepts url_verification when token matches', async () => {
    const baseUrl = await startTestServer({ feishuVerificationToken: 'expected-token' });

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'url_verification',
        token: 'expected-token',
        challenge: 'ping',
      }),
    });
    const payload = await response.json() as { challenge?: string };

    expect(response.status).toBe(200);
    expect(payload.challenge).toBe('ping');
  });

  it('accepts image message and forwards normalized content', async () => {
    const handleText = vi.fn(async () => undefined);
    const baseUrl = await startTestServer({
      feishuVerificationToken: 'expected-token',
      handleText,
    });

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: '2.0',
        header: {
          token: 'expected-token',
          event_type: 'im.message.receive_v1',
        },
        event: {
          sender: { sender_id: { open_id: 'ou_1' } },
          message: {
            message_id: 'om_1',
            chat_id: 'oc_dm_1',
            chat_type: 'p2p',
            message_type: 'image',
            content: JSON.stringify({ image_key: 'img_1' }),
          },
        },
      }),
    });
    const payload = await response.json() as { code?: number; msg?: string };

    expect(response.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.msg).toBe('success');
    expect(handleText).toHaveBeenCalledWith({
      channel: 'feishu',
      userId: 'ou_1',
      content: '[飞书图片] image_key=img_1\nmessage_id=om_1',
      sourceMessageId: 'om_1',
      allowReply: true,
      replyTargetId: 'ou_1',
      replyTargetType: 'open_id',
    });
  });

  it('accepts card.action.trigger and forwards gateway command', async () => {
    const handleText = vi.fn(async () => undefined);
    const baseUrl = await startTestServer({
      feishuVerificationToken: 'expected-token',
      handleText,
    });

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: '2.0',
        header: {
          token: 'expected-token',
          event_type: 'card.action.trigger',
        },
        event: {
          open_message_id: 'om_card_1',
          operator: {
            operator_id: {
              open_id: 'ou_card_1',
            },
          },
          context: {
            chat_id: 'oc_group_1',
          },
          action: {
            value: {
              gateway_cmd: '/skills global',
            },
          },
        },
      }),
    });
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({});
    expect(handleText).toHaveBeenCalledWith({
      channel: 'feishu',
      userId: 'ou_card_1',
      content: '/skills global',
      replyTargetId: 'oc_group_1',
      replyTargetType: 'chat_id',
    });
  });

  it('accepts card.action.trigger and routes gateway action without forwarding text', async () => {
    const handleText = vi.fn(async () => undefined);
    const handleFeishuCardAction = vi.fn(async () => undefined);
    const baseUrl = await startTestServer({
      feishuVerificationToken: 'expected-token',
      handleText,
      handleFeishuCardAction,
    });

    const response = await fetch(`${baseUrl}/feishu/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: '2.0',
        header: {
          token: 'expected-token',
          event_type: 'card.action.trigger',
        },
        event: {
          operator: {
            operator_id: {
              open_id: 'ou_card_2',
            },
          },
          context: {
            chat_id: 'oc_group_2',
          },
          action: {
            value: {
              gateway_action: 'codex_login.open_api_form',
              base_url: 'https://codex.ai02.cn',
            },
          },
        },
      }),
    });
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({});
    expect(handleText).not.toHaveBeenCalled();
    expect(handleFeishuCardAction).toHaveBeenCalledWith({
      userId: 'ou_card_2',
      chatId: 'oc_group_2',
      action: 'codex_login.open_api_form',
      value: {
        gateway_action: 'codex_login.open_api_form',
        base_url: 'https://codex.ai02.cn',
      },
    });
  });
});

describe('dispatchFeishuMessageReceiveEvent', () => {
  it('accepts long connection event payload and forwards normalized content', async () => {
    const handleText = vi.fn(async () => undefined);

    const result = dispatchFeishuMessageReceiveEvent({
      allowFrom: '*',
      feishuGroupRequireMention: false,
      isDuplicateMessage: () => false,
      handleText,
    }, {
      sender: { sender_id: { open_id: 'ou_ws_1' } },
      message: {
        message_id: 'om_ws_1',
        chat_id: 'oc_dm_2',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello from ws' }),
      },
    });

    expect(result).toBe('success');
    expect(handleText).toHaveBeenCalledWith({
      channel: 'feishu',
      userId: 'ou_ws_1',
      content: 'hello from ws',
      sourceMessageId: 'om_ws_1',
      allowReply: true,
      replyTargetId: 'ou_ws_1',
      replyTargetType: 'open_id',
    });
  });

  it('uses chat_id as reply target for group messages', async () => {
    const handleText = vi.fn(async () => undefined);

    const result = dispatchFeishuMessageReceiveEvent({
      allowFrom: '*',
      feishuGroupRequireMention: false,
      isDuplicateMessage: () => false,
      handleText,
    }, {
      sender: { sender_id: { open_id: 'ou_group_1' } },
      message: {
        message_id: 'om_group_1',
        chat_id: 'oc_group_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello group' }),
      },
    });

    expect(result).toBe('success');
    expect(handleText).toHaveBeenCalledWith({
      channel: 'feishu',
      userId: 'ou_group_1',
      content: 'hello group',
      sourceMessageId: 'om_group_1',
      allowReply: true,
      replyTargetId: 'oc_group_1',
      replyTargetType: 'chat_id',
    });
  });

  it('ignores group messages without @ mention when mention trigger is enabled', async () => {
    const handleText = vi.fn(async () => undefined);

    const result = dispatchFeishuMessageReceiveEvent({
      allowFrom: '*',
      feishuGroupRequireMention: true,
      isDuplicateMessage: () => false,
      handleText,
    }, {
      sender: { sender_id: { open_id: 'ou_group_2' } },
      message: {
        message_id: 'om_group_2',
        chat_id: 'oc_group_2',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'plain group message' }),
      },
    });

    expect(result).toBe('success');
    expect(handleText).not.toHaveBeenCalled();
  });

  it('accepts group messages with text_without_at_bot when mention trigger is enabled', async () => {
    const handleText = vi.fn(async () => undefined);

    const result = dispatchFeishuMessageReceiveEvent({
      allowFrom: '*',
      feishuGroupRequireMention: true,
      isDuplicateMessage: () => false,
      handleText,
    }, {
      sender: { sender_id: { open_id: 'ou_group_3' } },
      message: {
        message_id: 'om_group_3',
        chat_id: 'oc_group_3',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({
          text: '@机器人 帮我总结',
          text_without_at_bot: '帮我总结',
        }),
      },
    });

    expect(result).toBe('success');
    expect(handleText).toHaveBeenCalledWith({
      channel: 'feishu',
      userId: 'ou_group_3',
      content: '帮我总结',
      sourceMessageId: 'om_group_3',
      allowReply: true,
      replyTargetId: 'oc_group_3',
      replyTargetType: 'chat_id',
    });
  });
});

describe('dispatchFeishuCardActionEvent', () => {
  it('forwards card command to chat handler', async () => {
    const handleText = vi.fn(async () => undefined);
    const result = dispatchFeishuCardActionEvent({
      allowFrom: '*',
      isDuplicateMessage: () => false,
      handleText,
    }, {
      operator: {
        operator_id: {
          open_id: 'ou_2',
        },
      },
      context: {
        chat_id: 'oc_2',
      },
      action: {
        value: {
          gateway_cmd: '/agents',
        },
      },
    });
    expect(result).toBe('success');
    expect(handleText).toHaveBeenCalledWith({
      channel: 'feishu',
      userId: 'ou_2',
      content: '/agents',
      replyTargetId: 'oc_2',
      replyTargetType: 'chat_id',
    });
  });
});
