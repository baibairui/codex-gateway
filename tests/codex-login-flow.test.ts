import { describe, expect, it, vi } from 'vitest';

import { startCodexDeviceLogin } from '../src/services/codex-login-flow.js';

describe('startCodexDeviceLogin', () => {
  it('streams device auth progress to Feishu and finishes successfully', async () => {
    const sendText = vi.fn(async () => undefined);
    const login = vi.fn(async (input?: { onMessage?: (text: string) => void }) => {
      input?.onMessage?.('Open this URL and enter code ABCD-EFGH');
    });

    await startCodexDeviceLogin({
      channel: 'feishu',
      userId: 'ou_1',
      sendText,
      codexRunner: { login },
    });

    expect(login).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(3);
    expect(String(sendText.mock.calls[0]?.[2] ?? '')).toContain('正在请求设备登录码');
    expect(String(sendText.mock.calls[1]?.[2] ?? '')).toContain('Open this URL and enter code ABCD-EFGH');
    expect(String(sendText.mock.calls[2]?.[2] ?? '')).toContain('登录成功');
  });
});
