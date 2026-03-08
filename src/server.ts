import fs from 'node:fs';
import path from 'node:path';
import { EventDispatcher as LarkEventDispatcher, LoggerLevel as LarkSdkLoggerLevel, WSClient as LarkWSClient } from '@larksuiteoapi/node-sdk';

import { createApp, dispatchFeishuCardActionEvent, dispatchFeishuMessageReceiveEvent } from './app.js';
import { config } from './config.js';
import { WorkspacePublisher } from './services/workspace-publisher.js';
import { AgentWorkspaceManager } from './services/agent-workspace-manager.js';
import { BrowserManager } from './services/browser-manager.js';
import { resolveBrowserMcpRuntime, startBrowserMcpServer } from './services/browser-mcp-server.js';
import { CodexRunner } from './services/codex-runner.js';
import { createChatHandler } from './services/chat-handler.js';
import { MemorySteward } from './services/memory-steward.js';
import { ReminderStore } from './services/reminder-store.js';
import { ReminderDispatcher } from './services/reminder-dispatcher.js';
import { installReminderToolSkill } from './services/reminder-tool-skill.js';
import { installFeishuOfficialOpsSkill } from './services/feishu-official-ops-skill.js';
import { WeComApi } from './services/wecom-api.js';
import { FeishuApi } from './services/feishu-api.js';
import { WeComCrypto } from './utils/wecom-crypto.js';
import { appendFeishuAttachmentMetadata, extractFeishuBinaryRef } from './utils/feishu-inbound.js';
import { isGatewayMessageTypeSupported, parseGatewayStructuredMessage } from './utils/gateway-message.js';
import { SessionStore } from './stores/session-store.js';
import { MessageDedupStore } from './stores/message-dedup-store.js';
import { RateLimitStore } from './stores/rate-limit-store.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Server');
const codexWorkdir = resolveCodexWorkdir(config.codexWorkdir);
const gatewayRootDir = resolveGatewayRootDir(config.gatewayRootDir);

log.info('服务启动初始化...', {
  port: config.port,
  codexBin: config.codexBin,
  codexModel: config.codexModel ?? '(codex cli default)',
  codexSearch: config.codexSearch,
  codexWorkdir,
  gatewayRootDir,
  codexAgentsDir: config.codexAgentsDir,
  commandTimeoutMs: config.commandTimeoutMs ?? '(adaptive)',
  commandTimeoutMinMs: config.commandTimeoutMinMs,
  commandTimeoutMaxMs: config.commandTimeoutMaxMs,
  commandTimeoutPerCharMs: config.commandTimeoutPerCharMs,
  browserMcpEnabled: config.browserMcpEnabled,
  browserMcpUrl: config.browserMcpUrl ?? '(local auto)',
  browserMcpPort: config.browserMcpPort,
  browserProfileDir: config.browserMcpProfileDir ?? '(default)',
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
  feishuLongConnection: config.feishuLongConnection,
  feishuApiTimeoutMs: config.feishuApiTimeoutMs,
});

const dataDir = path.resolve(process.cwd(), '.data');
fs.mkdirSync(dataDir, { recursive: true });
log.debug('数据目录已就绪', { dataDir });
const browserManager = new BrowserManager({
  profileDir: resolveRuntimeDir(config.browserMcpProfileDir, path.join(dataDir, 'browser', 'profile')),
});
const browserMcpRuntime = resolveBrowserMcpRuntime({
  enabled: config.browserMcpEnabled,
  url: config.browserMcpUrl,
  port: config.browserMcpPort,
});
const activeBrowserMcpUrl = await ensureBrowserMcpUrl(browserMcpRuntime, browserManager);
const feishuImageCacheDir = path.join(dataDir, 'feishu-images');
fs.mkdirSync(feishuImageCacheDir, { recursive: true });

const agentsDir = resolveAgentsDir({
  configuredDir: config.codexAgentsDir,
  dataDir,
});
log.debug('Agent 工作区目录已就绪', { agentsDir });
const reminderDbPath = path.join(dataDir, 'reminders.db');

const sessionStore = new SessionStore(path.join(dataDir, 'sessions.db'), {
  defaultWorkspaceDir: agentsDir,
});
log.debug('SessionStore 已初始化');
const agentWorkspaceManager = new AgentWorkspaceManager(agentsDir);
log.debug('AgentWorkspaceManager 已初始化', { agentsDir });
syncBuiltInSkills(codexWorkdir, agentsDir);
const dedupStore = new MessageDedupStore(config.dedupWindowSeconds);
log.debug('MessageDedupStore 已初始化', { dedupWindowSeconds: config.dedupWindowSeconds });
const rateLimitStore = new RateLimitStore(config.rateLimitMaxMessages, config.rateLimitWindowSeconds);
log.debug('RateLimitStore 已初始化', {
  maxMessages: config.rateLimitMaxMessages,
  windowSeconds: config.rateLimitWindowSeconds,
});

const codexRunner = new CodexRunner({
  codexBin: config.codexBin,
  workdir: codexWorkdir,
  timeoutMs: config.commandTimeoutMs,
  timeoutMinMs: config.commandTimeoutMinMs,
  timeoutMaxMs: config.commandTimeoutMaxMs,
  timeoutPerCharMs: config.commandTimeoutPerCharMs,
  browserMcpUrl: activeBrowserMcpUrl,
  sandbox: config.codexSandbox,
});
log.debug('CodexRunner 已初始化');

const workspacePublisher = new WorkspacePublisher({
  cwd: gatewayRootDir,
});
log.debug('WorkspacePublisher 已初始化', { cwd: gatewayRootDir });

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
const inboundReplyContext = new Map<string, {
  messageId?: string;
  allowReply: boolean;
  replyTargetId?: string;
  replyTargetType?: 'open_id' | 'chat_id';
}>();

interface InboundEnrichResult {
  content: string;
  attachmentRequired: boolean;
  attachmentDownloaded: boolean;
  errorMessage?: string;
}

function extractFeishuReplyOptions(
  content: Record<string, unknown> | string,
): {
  content: Record<string, unknown> | string;
  replyInThread?: boolean;
} {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { content };
  }

  const replyInThread = typeof content.reply_in_thread === 'boolean'
    ? content.reply_in_thread
    : (typeof content.replyInThread === 'boolean' ? content.replyInThread : undefined);

  if (replyInThread === undefined) {
    return { content };
  }

  const normalizedContent = { ...content };
  delete normalizedContent.reply_in_thread;
  delete normalizedContent.replyInThread;

  return {
    content: normalizedContent,
    replyInThread,
  };
}

function resolveUserKey(userId: string): string {
  void userId;
  return 'local-owner';
}

function canUseDir(targetDir: string): boolean {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function resolveAgentsDir(input: { configuredDir?: string; dataDir: string }): string {
  const fallbackDir = path.resolve(input.dataDir, 'agents');
  if (input.configuredDir) {
    const configured = path.resolve(input.configuredDir);
    if (canUseDir(configured)) {
      return configured;
    }
    log.warn('配置的 CODEX_AGENTS_DIR 不可用，回退到默认目录', { configured, fallbackDir });
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
  fs.mkdirSync(fallbackDir, { recursive: true });
  return fallbackDir;
}

function resolveCodexWorkdir(configuredDir: string): string {
  const resolved = path.resolve(configuredDir);
  try {
    if (fs.statSync(resolved).isDirectory()) {
      return resolved;
    }
  } catch {
    // noop
  }
  const fallback = path.resolve(process.cwd());
  log.warn('配置的 CODEX_WORKDIR 不可用，回退到当前目录', {
    configured: resolved,
    fallback,
  });
  return fallback;
}

function resolveRuntimeDir(configuredDir: string | undefined, fallbackDir: string): string {
  if (!configuredDir?.trim()) {
    return path.resolve(fallbackDir);
  }
  return path.resolve(configuredDir);
}

function resolveGatewayRootDir(configuredDir: string | undefined): string {
  if (configuredDir && configuredDir.trim()) {
    const resolved = path.resolve(configuredDir);
    if (canUseDir(resolved)) {
      return resolved;
    }
    log.warn('配置的 GATEWAY_ROOT_DIR 不可用，回退到当前目录', {
      configured: resolved,
      fallback: path.resolve(process.cwd()),
    });
  }
  return path.resolve(process.cwd());
}

async function ensureBrowserMcpUrl(
  runtime: ReturnType<typeof resolveBrowserMcpRuntime>,
  manager: BrowserManager,
): Promise<string | undefined> {
  if (!runtime) {
    return undefined;
  }

  try {
    await startBrowserMcpServer(runtime, manager);
    log.debug('Browser MCP 运行时已启用', {
      url: runtime.url,
      shouldAutoStart: runtime.shouldAutoStart,
    });
    return runtime.url;
  } catch (error) {
    log.warn('Browser MCP 启动失败，当前将以无浏览器工具模式运行', {
      url: runtime.url,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
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
  workspacePublisher,
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
  feishuLongConnection: config.feishuLongConnection,
  feishuGroupRequireMention: config.feishuGroupRequireMention,
  isDuplicateMessage: (msgId) => dedupStore.isDuplicate(msgId),
  handleText: appDepsHandleText,
});

async function sendText(channel: 'wecom' | 'feishu', userId: string, content: string): Promise<void> {
  await enqueueSendText(channel, userId, content);
}

async function enqueueSendText(channel: 'wecom' | 'feishu', userId: string, content: string): Promise<void> {
  const structured = parseGatewayStructuredMessage(content);
  await enqueueOutboundSend(channel, userId, async () => {
    const replyContext = inboundReplyContext.get(`${channel}:${userId}`);
    const replyToMessageId = replyContext?.allowReply ? replyContext.messageId : undefined;
    const feishuReplyTarget = {
      receiveId: replyContext?.replyTargetId ?? userId,
      receiveIdType: replyContext?.replyTargetType ?? 'open_id',
    } as const;
    if (structured) {
      if (!isGatewayMessageTypeSupported(channel, structured.msg_type)) {
        const message = `❌ 不支持的 ${channel === 'feishu' ? '飞书' : '企微'} msg_type：${structured.msg_type}`;
        if (channel === 'wecom') {
          if (!weComApi) {
            throw new Error('wecom api not configured');
          }
          await weComApi.sendText(userId, message);
          return;
        }
        if (!feishuApi) {
          throw new Error('feishu api not configured');
        }
        await feishuApi.sendText(feishuReplyTarget, message, {
          replyToMessageId,
        });
        return;
      }
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
      const feishuReplyOptions = extractFeishuReplyOptions(structured.content);
      await feishuApi.sendMessage(feishuReplyTarget, {
        msgType: structured.msg_type,
        content: feishuReplyOptions.content,
        replyToMessageId,
        replyInThread: feishuReplyOptions.replyInThread,
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
    await feishuApi.sendText(feishuReplyTarget, content, {
      replyToMessageId,
    });
  });
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
      type: mapFeishuResourceTypes(inboundRef.kind),
    });
    return {
      content: appendFeishuAttachmentMetadata(content, {
        kind: inboundRef.kind,
        localPath,
      }),
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

function mapFeishuResourceTypes(kind: 'image' | 'file' | 'audio' | 'media' | 'sticker'): Array<'image' | 'file'> {
  if (kind === 'image') {
    return ['image'];
  }
  if (kind === 'sticker') {
    throw new Error('sticker resource download is not supported by feishu message resource API');
  }
  if (kind === 'media') {
    return ['file', 'image'];
  }
  return ['file', 'image'];
}

app.listen(config.port, () => {
  log.info(`✅ codex gateway 已启动，监听 http://127.0.0.1:${config.port}`);
  if (config.feishuEnabled && config.feishuLongConnection && config.feishuAppId && config.feishuAppSecret) {
    const wsClient = new LarkWSClient({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      loggerLevel: LarkSdkLoggerLevel.error,
    });
    const eventDispatcher = new LarkEventDispatcher({
      loggerLevel: LarkSdkLoggerLevel.error,
    }).register({
      'im.message.receive_v1': async (data: Record<string, unknown>) => {
        log.info('飞书长连接收到事件', { eventType: 'im.message.receive_v1' });
        dispatchFeishuMessageReceiveEvent({
          allowFrom: config.allowFrom,
          feishuGroupRequireMention: config.feishuGroupRequireMention,
          isDuplicateMessage: (msgId) => dedupStore.isDuplicate(msgId),
          handleText: async (input) => appDepsHandleText(input),
        }, data);
      },
      'card.action.trigger': async (data: Record<string, unknown>) => {
        log.info('飞书长连接收到事件', { eventType: 'card.action.trigger' });
        dispatchFeishuCardActionEvent({
          allowFrom: config.allowFrom,
          feishuGroupRequireMention: config.feishuGroupRequireMention,
          isDuplicateMessage: (msgId) => dedupStore.isDuplicate(msgId),
          handleText: async (input) => appDepsHandleText(input),
        }, data);
      },
    });
    wsClient.start({ eventDispatcher }).then(() => {
      log.info('✅ 飞书长连接已启动');
    }).catch((error) => {
      log.error('❌ 飞书长连接启动失败', error);
    });
  }
  memorySteward.start();
  reminderDispatcher.start();
});

async function appDepsHandleText(input: {
  channel: 'wecom' | 'feishu';
  userId: string;
  content: string;
  sourceMessageId?: string;
  allowReply?: boolean;
  replyTargetId?: string;
  replyTargetType?: 'open_id' | 'chat_id';
}): Promise<void> {
  const enrichResult = await enrichInboundContent(input.channel, input.content);
  if (enrichResult.attachmentRequired && !enrichResult.attachmentDownloaded) {
    await sendText(
      input.channel,
      input.userId,
      `❌ 附件下载失败，未调用 Codex。${enrichResult.errorMessage ? `原因：${enrichResult.errorMessage}` : ''}`,
    );
    return;
  }
  const sessionUserKey = resolveUserKey(input.userId);
  await runInUserQueue(sessionUserKey, async () => {
    const contextKey = `${input.channel}:${input.userId}`;
    inboundReplyContext.set(contextKey, {
      messageId: input.channel === 'feishu' ? input.sourceMessageId : undefined,
      allowReply: input.channel === 'feishu' ? input.allowReply === true : false,
      replyTargetId: input.channel === 'feishu' ? input.replyTargetId : undefined,
      replyTargetType: input.channel === 'feishu' ? input.replyTargetType : undefined,
    });
    try {
      await handleChatText({ channel: input.channel, userId: input.userId, content: enrichResult.content });
    } finally {
      inboundReplyContext.delete(contextKey);
    }
  });
}

function syncBuiltInSkills(defaultWorkspaceDir: string, customAgentsRootDir: string): void {
  installReminderToolSkill(path.resolve(defaultWorkspaceDir));
  installFeishuOfficialOpsSkill(path.resolve(defaultWorkspaceDir));
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
      installFeishuOfficialOpsSkill(workspaceDir);
    }
  }
}
