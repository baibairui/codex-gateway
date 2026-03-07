import fs from 'node:fs';
import path from 'node:path';

import { createApp } from './app.js';
import { config } from './config.js';
import { BrowserOpener } from './services/browser-opener.js';
import { WorkspacePublisher } from './services/workspace-publisher.js';
import { AgentWorkspaceManager } from './services/agent-workspace-manager.js';
import { CodexRunner } from './services/codex-runner.js';
import { createChatHandler } from './services/chat-handler.js';
import { MemorySteward } from './services/memory-steward.js';
import { ReminderStore } from './services/reminder-store.js';
import { ReminderDispatcher } from './services/reminder-dispatcher.js';
import { installReminderToolSkill } from './services/reminder-tool-skill.js';
import { WeComApi } from './services/wecom-api.js';
import { FeishuApi } from './services/feishu-api.js';
import { WeComCrypto } from './utils/wecom-crypto.js';
import { SessionStore } from './stores/session-store.js';
import { MessageDedupStore } from './stores/message-dedup-store.js';
import { RateLimitStore } from './stores/rate-limit-store.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Server');

log.info('服务启动初始化...', {
  port: config.port,
  codexBin: config.codexBin,
  codexModel: config.codexModel ?? '(codex cli default)',
  codexSearch: config.codexSearch,
  codexWorkdir: config.codexWorkdir,
  codexAgentsDir: config.codexAgentsDir ?? '(default .data/agents)',
  commandTimeoutMs: config.commandTimeoutMs ?? '(adaptive)',
  commandTimeoutMinMs: config.commandTimeoutMinMs,
  commandTimeoutMaxMs: config.commandTimeoutMaxMs,
  commandTimeoutPerCharMs: config.commandTimeoutPerCharMs,
  runnerEnabled: config.runnerEnabled,
  memoryStewardEnabled: config.memoryStewardEnabled,
  memoryStewardIntervalHours: config.memoryStewardIntervalHours,
  allowFrom: config.allowFrom,
  dedupWindowSeconds: config.dedupWindowSeconds,
  rateLimitMaxMessages: config.rateLimitMaxMessages,
  rateLimitWindowSeconds: config.rateLimitWindowSeconds,
  apiTimeoutMs: config.apiTimeoutMs,
  apiRetryOnTimeout: config.apiRetryOnTimeout,
  wecomEnabled: config.wecomEnabled,
  feishuEnabled: config.feishuEnabled,
  feishuApiTimeoutMs: config.feishuApiTimeoutMs,
});

const dataDir = path.resolve(process.cwd(), '.data');
fs.mkdirSync(dataDir, { recursive: true });
log.debug('数据目录已就绪', { dataDir });
const feishuImageCacheDir = path.join(dataDir, 'feishu-images');
fs.mkdirSync(feishuImageCacheDir, { recursive: true });

const agentsDir = path.resolve(config.codexAgentsDir ?? path.join(dataDir, 'agents'));
fs.mkdirSync(agentsDir, { recursive: true });
log.debug('Agent 工作区目录已就绪', { agentsDir });
const reminderDbPath = path.join(dataDir, 'reminders.db');

const sessionStore = new SessionStore(path.join(dataDir, 'sessions.db'), {
  defaultWorkspaceDir: config.codexWorkdir,
});
log.debug('SessionStore 已初始化');
const agentWorkspaceManager = new AgentWorkspaceManager(agentsDir);
log.debug('AgentWorkspaceManager 已初始化', { agentsDir });
syncReminderToolSkills(config.codexWorkdir, agentsDir);
const dedupStore = new MessageDedupStore(config.dedupWindowSeconds);
log.debug('MessageDedupStore 已初始化', { dedupWindowSeconds: config.dedupWindowSeconds });
const rateLimitStore = new RateLimitStore(config.rateLimitMaxMessages, config.rateLimitWindowSeconds);
log.debug('RateLimitStore 已初始化', {
  maxMessages: config.rateLimitMaxMessages,
  windowSeconds: config.rateLimitWindowSeconds,
});

const codexRunner = new CodexRunner({
  codexBin: config.codexBin,
  workdir: config.codexWorkdir,
  timeoutMs: config.commandTimeoutMs,
  timeoutMinMs: config.commandTimeoutMinMs,
  timeoutMaxMs: config.commandTimeoutMaxMs,
  timeoutPerCharMs: config.commandTimeoutPerCharMs,
  sandbox: config.codexSandbox,
});
log.debug('CodexRunner 已初始化');

const browserOpener = config.browserOpenEnabled
  ? new BrowserOpener({ command: config.browserOpenCommand })
  : undefined;
if (browserOpener) {
  log.debug('BrowserOpener 已初始化', {
    browserOpenCommand: config.browserOpenCommand ?? '(platform default)',
  });
}

const workspacePublisher = new WorkspacePublisher({
  cwd: '/opt/gateway',
});
log.debug('WorkspacePublisher 已初始化', { cwd: '/opt/gateway' });

const weComApi = config.wecomEnabled && config.corpId && config.corpSecret && config.agentId !== undefined
  ? new WeComApi({
      corpId: config.corpId,
      secret: config.corpSecret,
      agentId: config.agentId,
      timeoutMs: config.apiTimeoutMs,
      retryOnTimeout: config.apiRetryOnTimeout,
    })
  : undefined;
if (weComApi) {
  log.debug('WeComApi 已初始化');
}

const feishuApi = config.feishuEnabled && config.feishuAppId && config.feishuAppSecret
  ? new FeishuApi({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      timeoutMs: config.feishuApiTimeoutMs,
      retryOnTimeout: config.apiRetryOnTimeout,
      imageCacheDir: feishuImageCacheDir,
    })
  : undefined;
if (feishuApi) {
  log.debug('FeishuApi 已初始化');
}

const wecomCrypto = config.wecomEnabled && config.token && config.encodingAesKey && config.corpId
  ? new WeComCrypto({
      token: config.token,
      encodingAesKey: config.encodingAesKey,
      corpId: config.corpId,
    })
  : undefined;
if (wecomCrypto) {
  log.debug('WeComCrypto 已初始化');
}

const userTaskQueue = new Map<string, Promise<void>>();
const outboundSendQueue = new Map<string, Promise<void>>();

interface GatewayStructuredMessage {
  __gateway_message__: true;
  msg_type: string;
  content: Record<string, unknown> | string;
}

interface InboundEnrichResult {
  content: string;
  attachmentRequired: boolean;
  attachmentDownloaded: boolean;
  errorMessage?: string;
}

function resolveUserKey(userId: string): string {
  void userId;
  return 'local-owner';
}

function runInUserQueue(userId: string, task: () => Promise<void>): Promise<void> {
  const previous = userTaskQueue.get(userId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (userTaskQueue.get(userId) === next) {
        userTaskQueue.delete(userId);
      }
    });

  userTaskQueue.set(userId, next);
  return next;
}

function enqueueOutboundSend(
  channel: 'wecom' | 'feishu',
  userId: string,
  task: () => Promise<void>,
): Promise<void> {
  const key = `${channel}:${userId}`;
  const previous = outboundSendQueue.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (outboundSendQueue.get(key) === next) {
        outboundSendQueue.delete(key);
      }
    });
  outboundSendQueue.set(key, next);
  return next;
}

const handleChatText = createChatHandler({
  sessionStore,
  rateLimitStore,
  codexRunner,
  agentWorkspaceManager,
  browserOpener,
  workspacePublisher,
  browserOpenEnabled: config.browserOpenEnabled,
  runnerEnabled: config.runnerEnabled,
  defaultModel: config.codexModel,
  defaultSearch: config.codexSearch,
  reminderDbPath,
  sendText,
});

const reminderStore = new ReminderStore(reminderDbPath);
const reminderDispatcher = new ReminderDispatcher({
  store: reminderStore,
  sendText,
  onTriggerAgent: async (reminder) => {
    const sessionUserKey = resolveUserKey(reminder.userId);
    await runInUserQueue(sessionUserKey, async () => {
      await handleChatText({
        channel: reminder.channel,
        userId: reminder.userId,
        content: reminder.message,
        reminderTrigger: {
          reminderId: reminder.id,
          message: reminder.message,
          sourceAgentId: reminder.sourceAgentId,
        },
      });
    });
  },
});

const memorySteward = new MemorySteward({
  sessionStore,
  agentWorkspaceManager,
  codexRunner,
  enabled: config.memoryStewardEnabled,
  intervalMs: config.memoryStewardIntervalHours * 60 * 60_000,
  model: config.codexModel,
});

const app = createApp({
  wecomEnabled: config.wecomEnabled,
  wecomCrypto,
  allowFrom: config.allowFrom,
  feishuVerificationToken: config.feishuVerificationToken,
  isDuplicateMessage: (msgId) => dedupStore.isDuplicate(msgId),
  handleText: async ({ channel, userId, content }) => {
    const enrichResult = await enrichInboundContent(channel, content);
    if (enrichResult.attachmentRequired && !enrichResult.attachmentDownloaded) {
      await sendText(
        channel,
        userId,
        `❌ 附件下载失败，未调用 Codex。${enrichResult.errorMessage ? `原因：${enrichResult.errorMessage}` : ''}`,
      );
      return;
    }
    const sessionUserKey = resolveUserKey(userId);
    await runInUserQueue(sessionUserKey, async () => {
      await handleChatText({ channel, userId, content: enrichResult.content });
    });
  },
});

async function sendText(channel: 'wecom' | 'feishu', userId: string, content: string): Promise<void> {
  await enqueueSendText(channel, userId, content);
}

async function enqueueSendText(channel: 'wecom' | 'feishu', userId: string, content: string): Promise<void> {
  const structured = parseStructuredMessage(content);
  await enqueueOutboundSend(channel, userId, async () => {
    if (structured) {
      if (channel === 'wecom') {
        if (!weComApi) {
          throw new Error('wecom api not configured');
        }
        await weComApi.sendMessage(userId, {
          msgType: structured.msg_type,
          content: structured.content,
        });
        return;
      }
      if (!feishuApi) {
        throw new Error('feishu api not configured');
      }
      await feishuApi.sendMessage(userId, {
        msgType: structured.msg_type,
        content: structured.content,
      });
      return;
    }

    if (channel === 'wecom') {
      if (!weComApi) {
        throw new Error('wecom api not configured');
      }
      await weComApi.sendText(userId, content);
      return;
    }
    if (!feishuApi) {
      throw new Error('feishu api not configured');
    }
    await feishuApi.sendText(userId, content);
  });
}

function parseStructuredMessage(content: string): GatewayStructuredMessage | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.__gateway_message__ !== true) {
      return undefined;
    }
    if (typeof parsed.msg_type !== 'string') {
      return undefined;
    }
    const payload = parsed.content;
    if (!(typeof payload === 'string' || (payload && typeof payload === 'object' && !Array.isArray(payload)))) {
      return undefined;
    }
    return {
      __gateway_message__: true,
      msg_type: parsed.msg_type,
      content: payload as Record<string, unknown> | string,
    };
  } catch {
    return undefined;
  }
}

async function enrichInboundContent(channel: 'wecom' | 'feishu', content: string): Promise<InboundEnrichResult> {
  if (channel !== 'feishu' || !feishuApi) {
    return {
      content,
      attachmentRequired: false,
      attachmentDownloaded: false,
    };
  }
  const inboundRef = extractFeishuBinaryRef(content);
  if (!inboundRef) {
    return {
      content,
      attachmentRequired: false,
      attachmentDownloaded: false,
    };
  }
  try {
    if (!inboundRef.messageId) {
      return {
        content,
        attachmentRequired: true,
        attachmentDownloaded: false,
        errorMessage: 'missing message_id for feishu message.resource.get',
      };
    }
    const localPath = await feishuApi.downloadMessageResource({
      messageId: inboundRef.messageId,
      fileKey: inboundRef.key,
      type: inboundRef.kind,
    });
    return {
      content: `${content}\nlocal_${inboundRef.kind}_path=${localPath}`,
      attachmentRequired: true,
      attachmentDownloaded: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn('飞书二进制消息下载失败，继续仅使用 key 处理', {
      kind: inboundRef.kind,
      key: inboundRef.key,
      error: errorMessage,
    });
    return {
      content,
      attachmentRequired: true,
      attachmentDownloaded: false,
      errorMessage,
    };
  }
}

function extractFeishuBinaryRef(content: string): {
  kind: 'image' | 'file' | 'audio' | 'media' | 'sticker';
  key: string;
  messageId?: string;
} | undefined {
  const messageId = content.match(/\bmessage_id=([^\s]+)/)?.[1];
  const image = content.match(/^\[飞书图片]\s+image_key=([^\s]+)/);
  if (image?.[1]) {
    return { kind: 'image', key: image[1], messageId };
  }
  const file = content.match(/^\[飞书文件]\s+file_key=([^\s]+)/);
  if (file?.[1]) {
    return { kind: 'file', key: file[1], messageId };
  }
  const audio = content.match(/^\[飞书语音]\s+file_key=([^\s]+)/);
  if (audio?.[1]) {
    return { kind: 'audio', key: audio[1], messageId };
  }
  const media = content.match(/^\[飞书媒体]\s+file_key=([^\s]+)/);
  if (media?.[1]) {
    return { kind: 'media', key: media[1], messageId };
  }
  const sticker = content.match(/^\[飞书表情]\s+file_key=([^\s]+)/);
  if (sticker?.[1]) {
    return { kind: 'sticker', key: sticker[1], messageId };
  }
  return undefined;
}

app.listen(config.port, () => {
  log.info(`✅ codex gateway 已启动，监听 http://127.0.0.1:${config.port}`);
  memorySteward.start();
  reminderDispatcher.start();
});

function syncReminderToolSkills(defaultWorkspaceDir: string, customAgentsRootDir: string): void {
  installReminderToolSkill(path.resolve(defaultWorkspaceDir));
  const usersDir = path.join(customAgentsRootDir, 'users');
  if (!fs.existsSync(usersDir)) {
    return;
  }
  for (const userDirName of fs.readdirSync(usersDir)) {
    const userDir = path.join(usersDir, userDirName);
    if (!fs.statSync(userDir).isDirectory()) {
      continue;
    }
    for (const workspaceName of fs.readdirSync(userDir)) {
      if (workspaceName === 'shared-memory' || workspaceName === '_memory-steward') {
        continue;
      }
      const workspaceDir = path.join(userDir, workspaceName);
      if (!fs.statSync(workspaceDir).isDirectory()) {
        continue;
      }
      installReminderToolSkill(workspaceDir);
    }
  }
}
