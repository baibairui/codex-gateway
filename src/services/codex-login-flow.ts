import { formatCommandOutboundMessage } from './feishu-command-cards.js';

type Channel = 'wecom' | 'feishu';

interface StartCodexDeviceLoginInput {
  channel: Channel;
  userId: string;
  sendText: (channel: Channel, userId: string, content: string) => Promise<void>;
  codexRunner: {
    login(input: {
      onMessage?: (text: string) => void;
    }): Promise<void>;
  };
}

export async function startCodexDeviceLogin(input: StartCodexDeviceLoginInput): Promise<void> {
  const { channel, userId, sendText, codexRunner } = input;

  const sendCommandText = async (text: string): Promise<void> => {
    await sendText(channel, userId, formatCommandOutboundMessage(channel, '/login', text));
  };

  await sendCommandText('⏳ 正在请求设备登录码，请稍候...');

  let lastStreamSend: Promise<void> = Promise.resolve();
  await codexRunner.login({
    onMessage: (text) => {
      lastStreamSend = sendCommandText(`【登录授权】\n${text}`);
    },
  });
  await lastStreamSend;
  await sendCommandText('✅ 登录成功！Codex CLI 已获得授权。');
}
