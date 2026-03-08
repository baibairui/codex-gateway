import { handleUserCommand } from '../features/user-command.js';
import { formatCommandOutboundMessage } from './feishu-command-cards.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('StartupHelp');

interface PushFeishuStartupHelpInput {
  enabled: boolean;
  adminOpenId?: string;
  sendText: (channel: 'feishu', userId: string, content: string) => Promise<void>;
}

export function buildFeishuStartupHelpMessage(): string {
  const helpText = handleUserCommand('/help').message ?? '输入 /help 查看可用命令。';
  return formatCommandOutboundMessage('feishu', '/help', helpText);
}

export async function pushFeishuStartupHelp(input: PushFeishuStartupHelpInput): Promise<void> {
  if (!input.enabled) {
    return;
  }
  if (!input.adminOpenId?.trim()) {
    log.warn('已启用飞书启动帮助推送，但未配置管理员 open_id，跳过发送');
    return;
  }
  const targetOpenId = input.adminOpenId.trim();
  await input.sendText('feishu', targetOpenId, buildFeishuStartupHelpMessage());
  log.info('飞书启动帮助已发送给固定管理员', { adminOpenId: targetOpenId });
}
