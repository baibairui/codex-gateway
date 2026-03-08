import { describe, expect, it, vi } from 'vitest';

import { buildFeishuStartupHelpMessage, pushFeishuStartupHelp } from '../src/services/startup-help.js';

describe('startup help', () => {
  it('builds feishu startup help as interactive card', () => {
    const payload = buildFeishuStartupHelpMessage();
    const parsed = JSON.parse(payload) as {
      __gateway_message__?: boolean;
      msg_type?: string;
      content?: { header?: { title?: { content?: string } } };
    };
    expect(parsed.__gateway_message__).toBe(true);
    expect(parsed.msg_type).toBe('interactive');
    expect(parsed.content?.header?.title?.content).toBe('命令帮助');
  });

  it('sends startup help to fixed admin when enabled', async () => {
    const sendText = vi.fn(async () => undefined);

    await pushFeishuStartupHelp({
      enabled: true,
      adminOpenId: 'ou_admin',
      sendText,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith('feishu', 'ou_admin', expect.stringContaining('"msg_type":"interactive"'));
  });

  it('skips startup help when disabled or admin is missing', async () => {
    const sendText = vi.fn(async () => undefined);

    await pushFeishuStartupHelp({
      enabled: false,
      adminOpenId: 'ou_admin',
      sendText,
    });
    await pushFeishuStartupHelp({
      enabled: true,
      adminOpenId: undefined,
      sendText,
    });

    expect(sendText).not.toHaveBeenCalled();
  });
});
