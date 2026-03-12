import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  it('removes previous api login config after device auth succeeds', async () => {
    const codexHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-device-login-'));
    const configPath = path.join(codexHomeDir, 'config.toml');
    fs.writeFileSync(configPath, 'base_url = "https://codex.ai02.cn"\n', 'utf8');

    await startCodexDeviceLogin({
      channel: 'feishu',
      userId: 'ou_2',
      sendText: vi.fn(async () => undefined),
      codexHomeDir,
      codexRunner: {
        login: vi.fn(async () => undefined),
      },
    });

    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('restores previous api login config when device auth fails', async () => {
    const codexHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-device-login-fail-'));
    const configPath = path.join(codexHomeDir, 'config.toml');
    fs.writeFileSync(configPath, 'base_url = "https://codex.ai02.cn"\n', 'utf8');

    await expect(startCodexDeviceLogin({
      channel: 'feishu',
      userId: 'ou_3',
      sendText: vi.fn(async () => undefined),
      codexHomeDir,
      codexRunner: {
        login: vi.fn(async () => {
          throw new Error('device auth failed');
        }),
      },
    })).rejects.toThrow('device auth failed');

    expect(fs.readFileSync(configPath, 'utf8')).toContain('https://codex.ai02.cn');
  });
});
