import fs from 'node:fs';
import path from 'node:path';
import { formatCommandOutboundMessage } from './feishu-command-cards.js';
import { getCliProviderSpec, type CliProvider } from './cli-provider.js';

type Channel = 'wecom' | 'feishu';

interface StartCodexDeviceLoginInput {
  provider?: CliProvider;
  channel: Channel;
  userId: string;
  sendText: (channel: Channel, userId: string, content: string) => Promise<void>;
  codexHomeDir?: string;
  codexRunner: {
    login(input: {
      onMessage?: (text: string) => void;
    }): Promise<void>;
  };
}

export async function startCodexDeviceLogin(input: StartCodexDeviceLoginInput): Promise<void> {
  const { channel, userId, sendText, codexHomeDir, codexRunner } = input;
  const provider = input.provider ?? 'codex';
  const providerSpec = getCliProviderSpec(provider);
  if (!providerSpec.supportsDeviceAuth) {
    throw new Error(`${providerSpec.label} does not support gateway device auth login`);
  }

  const sendCommandText = async (text: string): Promise<void> => {
    await sendText(channel, userId, formatCommandOutboundMessage(channel, '/login', text));
  };

  await sendCommandText(provider === 'codex'
    ? '⏳ 正在请求设备登录码，请稍候...'
    : `⏳ 正在请求 ${providerSpec.label} 设备登录码，请稍候...`);

  const suspendedConfig = suspendCodexApiConfig(codexHomeDir);

  let lastStreamSend: Promise<void> = Promise.resolve();
  try {
    await codexRunner.login({
      onMessage: (text) => {
        lastStreamSend = sendCommandText(`【登录授权】\n${text}`);
      },
    });
    await lastStreamSend;
    suspendedConfig.commit();
    await sendCommandText(`✅ 登录成功！${providerSpec.label} CLI 已获得授权。`);
  } catch (error) {
    suspendedConfig.restore();
    throw error;
  }
}

function suspendCodexApiConfig(codexHomeDir: string | undefined): {
  commit: () => void;
  restore: () => void;
} {
  if (!codexHomeDir) {
    return {
      commit: () => undefined,
      restore: () => undefined,
    };
  }

  const configPath = path.join(path.resolve(codexHomeDir), 'config.toml');
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
    return {
      commit: () => undefined,
      restore: () => undefined,
    };
  }

  const backupPath = `${configPath}.device-auth-backup`;
  fs.rmSync(backupPath, { force: true });
  fs.renameSync(configPath, backupPath);

  let settled = false;
  return {
    commit: () => {
      if (settled) {
        return;
      }
      settled = true;
      fs.rmSync(backupPath, { force: true });
    },
    restore: () => {
      if (settled) {
        return;
      }
      settled = true;
      if (fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, configPath);
      }
    },
  };
}
