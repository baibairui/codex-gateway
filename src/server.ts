import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventDispatcher as LarkEventDispatcher, LoggerLevel as LarkSdkLoggerLevel, WSClient as LarkWSClient } from '@larksuiteoapi/node-sdk';

import { createApp, dispatchFeishuCardActionEvent, dispatchFeishuMessageReceiveEvent } from './app.js';
import { config } from './config.js';
import { WorkspacePublisher } from './services/workspace-publisher.js';
import { AgentWorkspaceManager } from './services/agent-workspace-manager.js';
import { BrowserManager } from './services/browser-manager.js';
import { createBrowserAutomationBackend } from './services/browser-service.js';
import { CodexRunner } from './services/codex-runner.js';
import { createChatHandler } from './services/chat-handler.js';
import { getCliProviderSpec, readCliHomeDefaultModel, runnerHomeDirName, writeCliApiLoginConfig } from './services/cli-provider.js';
import { startCodexDeviceLogin } from './services/codex-login-flow.js';
import { buildFeishuApiLoginFormMessage, buildFeishuApiLoginResultMessage } from './services/feishu-command-cards.js';
import { MemorySteward } from './services/memory-steward.js';
import { ReminderStore } from './services/reminder-store.js';
import { ReminderDispatcher } from './services/reminder-dispatcher.js';
import { installReminderToolSkill } from './services/reminder-tool-skill.js';
import { installFeishuOfficialOpsSkill } from './services/feishu-official-ops-skill.js';
import { installGatewayBrowserSkill, syncManagedGlobalSkills } from './services/gateway-browser-skill.js';
import { OpenCodeAuthFlowManager, buildOpenCodeAuthSessionKey } from './services/opencode-auth-flow.js';
import { pushFeishuStartupHelp } from './services/startup-help.js';
import { WeComApi } from './services/wecom-api.js';
import { FeishuApi } from './services/feishu-api.js';
import { WeComCrypto } from './utils/wecom-crypto.js';
import { appendFeishuAttachmentMetadata, extractFeishuBinaryRef } from './utils/feishu-inbound.js';
import { buildFeishuStatusSummary } from './utils/feishu-status.js';
import { isGatewayMessageTypeSupported, parseGatewayStructuredMessage } from './utils/gateway-message.js';
import { SessionStore } from './stores/session-store.js';
import { MessageDedupStore } from './stores/message-dedup-store.js';
import { RateLimitStore } from './stores/rate-limit-store.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Server');
const gatewayRootDir = resolveGatewayRootDir(config.gatewayRootDir);
const dataDir = path.join(gatewayRootDir, '.data');
fs.mkdirSync(dataDir, { recursive: true });
const agentsDir = resolveAgentsDir({
  configuredDir: config.codexAgentsDir,
  dataDir,
});
const codexWorkdir = resolveCodexWorkdir(config.codexWorkdir, agentsDir);
const codexHomeDir = path.join(dataDir, runnerHomeDirName('codex'));
const opencodeHomeDir = path.join(dataDir, runnerHomeDirName('opencode'));
const cliProviderSpec = getCliProviderSpec(config.codexProvider);
const feishuStatusSummary = buildFeishuStatusSummary({
  enabled: config.feishuEnabled,
  longConnection: config.feishuLongConnection,
  groupRequireMention: config.feishuGroupRequireMention,
  docBaseUrlConfigured: true,
  startupHelpEnabled: config.feishuStartupHelpEnabled,
  startupHelpAdminConfigured: Boolean(config.feishuStartupHelpAdminOpenId),
});

log.info('服务启动初始化...', {
  port: config.port,
  codexProvider: config.codexProvider,
  codexBin: config.codexBin,
  opencodeBin: config.opencodeBin,
  codexModel: config.codexModel ?? '(codex cli default)',
  codexSearch: config.codexSearch,
  codexWorkdir,
  gatewayRootDir,
  codexAgentsDir: config.codexAgentsDir,
  commandTimeoutMs: config.commandTimeoutMs ?? '(adaptive)',
  commandTimeoutMinMs: config.commandTimeoutMinMs,
  commandTimeoutMaxMs: config.commandTimeoutMaxMs,
  commandTimeoutPerCharMs: config.commandTimeoutPerCharMs,
  browserAutomationEnabled: config.browserAutomationEnabled,
  browserApiBaseUrl: '(gateway-owned local only)',
  browserProfileDir: config.browserProfileDir ?? '(default)',
  codexWorkdirIsolation: config.codexWorkdirIsolation,
  codexHomeDir: config.codexProvider === 'opencode' ? opencodeHomeDir : codexHomeDir,
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
  feishuLongConnection: feishuStatusSummary.mode === 'long-connection',
  feishuApiTimeoutMs: config.feishuApiTimeoutMs,
  feishuStatus: feishuStatusSummary,
});

log.debug('数据目录已就绪', { dataDir });
const browserManager = new BrowserManager({
  profileDir: resolveRuntimeDir(config.browserProfileDir, path.join(dataDir, 'browser', 'profile')),
});
const internalApiToken = randomUUID();
const browserAutomation = config.browserAutomationEnabled
  ? createBrowserAutomationBackend(browserManager)
  : undefined;
const activeBrowserApiBaseUrl = config.browserAutomationEnabled
  ? `http://127.0.0.1:${config.port}/internal/browser`
  : undefined;
const internalApiBaseUrl = `http://127.0.0.1:${config.port}/internal`;
const feishuImageCacheDir = path.join(dataDir, 'feishu-images');
fs.mkdirSync(codexHomeDir, { recursive: true });
fs.mkdirSync(opencodeHomeDir, { recursive: true });
fs.mkdirSync(feishuImageCacheDir, { recursive: true });

log.debug('Agent 工作区目录已就绪', { agentsDir });
const reminderDbPath = path.join(dataDir, 'reminders.db');
const openCodeAuthFlowManager = new OpenCodeAuthFlowManager();

const sessionStore = new SessionStore(path.join(dataDir, 'sessions.db'), {
  defaultWorkspaceDir: agentsDir,
});
log.debug('SessionStore 已初始化');
const agentWorkspaceManager = new AgentWorkspaceManager(agentsDir);
log.debug('AgentWorkspaceManager 已初始化', { agentsDir });
syncBuiltInSkills(agentsDir);
const dedupStore = new MessageDedupStore(config.dedupWindowSeconds);
log.debug('MessageDedupStore 已初始化', { dedupWindowSeconds: config.dedupWindowSeconds });
const rateLimitStore = new RateLimitStore(config.rateLimitMaxMessages, config.rateLimitWindowSeconds);
log.debug('RateLimitStore 已初始化', {
  maxMessages: config.rateLimitMaxMessages,
  windowSeconds: config.rateLimitWindowSeconds,
});

const codexRunner = new CodexRunner({
  provider: 'codex',
  codexBin: config.codexBin,
  workdir: codexWorkdir,
  timeoutMs: config.commandTimeoutMs,
  timeoutMinMs: config.commandTimeoutMinMs,
  timeoutMaxMs: config.commandTimeoutMaxMs,
  timeoutPerCharMs: config.commandTimeoutPerCharMs,
  browserApiBaseUrl: activeBrowserApiBaseUrl,
  internalApiBaseUrl,
  internalApiToken,
  gatewayRootDir,
  sandbox: config.codexSandbox,
  workdirIsolation: config.codexWorkdirIsolation,
  codexHomeDir,
});
const opencodeRunner = new CodexRunner({
  provider: 'opencode',
  codexBin: config.opencodeBin,
  workdir: codexWorkdir,
  timeoutMs: config.commandTimeoutMs,
  timeoutMinMs: config.commandTimeoutMinMs,
  timeoutMaxMs: config.commandTimeoutMaxMs,
  timeoutPerCharMs: config.commandTimeoutPerCharMs,
  browserApiBaseUrl: activeBrowserApiBaseUrl,
  internalApiBaseUrl,
  internalApiToken,
  gatewayRootDir,
  sandbox: config.codexSandbox,
  workdirIsolation: config.codexWorkdirIsolation,
  codexHomeDir: opencodeHomeDir,
});
log.debug('Runners 已初始化');

function resolveRunnerHomeDir(provider: 'codex' | 'opencode'): string {
  return provider === 'opencode' ? opencodeHomeDir : codexHomeDir;
}

function resolveRunner(provider: 'codex' | 'opencode'): CodexRunner {
  return provider === 'opencode' ? opencodeRunner : codexRunner;
}

function resolveChatDefaultModel(provider: 'codex' | 'opencode'): string | undefined {
  return readCliHomeDefaultModel(provider, resolveRunnerHomeDir(provider))
    ?? (provider === config.codexProvider ? config.codexModel : undefined);
}

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

function normalizeFeishuStructuredMessage(
  msgType: string,
  content: Record<string, unknown> | string,
): {
  msgType: string;
  content: Record<string, unknown> | string;
} {
  if (msgType !== 'markdown') {
    return { msgType, content };
  }
  const markdownText = typeof content === 'string'
    ? content
    : (typeof content.content === 'string'
      ? content.content
      : (typeof content.text === 'string' ? content.text : ''));
  const normalized = markdownText.trim();
  return {
    msgType: 'interactive',
    content: {
      config: {
        wide_screen_mode: true,
        enable_forward: true,
      },
      header: {
        template: 'blue',
        title: {
          tag: 'plain_text',
          content: 'Markdown',
        },
      },
      elements: [
        {
          tag: 'markdown',
          content: normalized || '(empty markdown)',
        },
      ],
    },
  };
}

function resolveUserKey(userId: string): string {
  const normalized = userId.trim();
  return normalized || 'anonymous-user';
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

function resolveCodexWorkdir(configuredDir: string, agentsDir: string): string {
  const resolved = path.resolve(configuredDir);
  if (canUseDir(resolved)) {
    return resolved;
  }
  const fallback = path.resolve(agentsDir);
  if (canUseDir(fallback)) {
    log.warn('配置的 CODEX_WORKDIR 不可用，回退到 agents 工作目录', {
      configured: resolved,
      fallback,
    });
    return fallback;
  }
  const finalFallback = path.resolve(process.cwd());
  log.warn('配置的 CODEX_WORKDIR 与 agents 工作目录都不可用，回退到当前目录', {
    configured: resolved,
    fallback: finalFallback,
  });
  return finalFallback;
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
  codexHomeDir: resolveRunnerHomeDir(config.codexProvider),
  agentWorkspaceManager,
  workspacePublisher,
  runnerEnabled: config.runnerEnabled,
  defaultProvider: config.codexProvider,
  resolveDefaultModel: resolveChatDefaultModel,
  resolveRunner,
  defaultSearch: config.codexSearch,
  reminderDbPath,
  sendText,
  openCodeAuthFlowManager,
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
  feishuEnabled: config.feishuEnabled,
  wecomCrypto,
  allowFrom: config.allowFrom,
  internalApiToken,
  browserAutomation,
  feishuVerificationToken: config.feishuVerificationToken,
  feishuLongConnection: feishuStatusSummary.mode === 'long-connection',
  feishuGroupRequireMention: feishuStatusSummary.groupRequireMention,
  feishuDocBaseUrlConfigured: feishuStatusSummary.docBaseUrlConfigured,
  feishuStartupHelpEnabled: feishuStatusSummary.startupHelpEnabled,
  feishuStartupHelpAdminConfigured: feishuStatusSummary.startupHelpAdminConfigured,
  isDuplicateMessage: (msgId) => dedupStore.isDuplicate(msgId),
  handleText: appDepsHandleText,
  handleFeishuCardAction: appDepsHandleFeishuCardAction,
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
      if (structured.op === 'recall') {
        if (channel === 'wecom') {
          if (!weComApi) {
            throw new Error('wecom api not configured');
          }
          await weComApi.sendText(userId, '❌ 企微暂不支持 recall 消息操作。');
          return;
        }
        if (!feishuApi) {
          throw new Error('feishu api not configured');
        }
        await feishuApi.recallMessage(structured.message_id);
        return;
      }
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
        if (structured.op !== 'send') {
          await weComApi.sendText(userId, `❌ 企微暂不支持 ${structured.op} 消息操作。`);
          return;
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
      const normalizedFeishuMessage = normalizeFeishuStructuredMessage(structured.msg_type, structured.content);
      const feishuReplyOptions = extractFeishuReplyOptions(normalizedFeishuMessage.content);
      if (structured.op === 'update') {
        if (!isFeishuUpdateMessageType(normalizedFeishuMessage.msgType)) {
          const message = `❌ 不支持的飞书 update msg_type：${normalizedFeishuMessage.msgType}`;
          await feishuApi.sendText(feishuReplyTarget, message, {
            replyToMessageId,
          });
          return;
        }
        await feishuApi.updateMessage({
          messageId: structured.message_id,
          msgType: normalizedFeishuMessage.msgType,
          content: feishuReplyOptions.content,
        });
        return;
      }
      await feishuApi.sendMessage(feishuReplyTarget, {
        msgType: normalizedFeishuMessage.msgType,
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

function isFeishuUpdateMessageType(msgType: string): msgType is 'text' | 'post' | 'interactive' {
  return msgType === 'text' || msgType === 'post' || msgType === 'interactive';
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
  log.info('飞书运行状态摘要', feishuStatusSummary);
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
          handleFeishuCardAction: async (input) => appDepsHandleFeishuCardAction(input),
        }, data);
      },
      'card.action.trigger': async (data: Record<string, unknown>) => {
        log.info('飞书长连接收到事件', { eventType: 'card.action.trigger' });
        dispatchFeishuCardActionEvent({
          allowFrom: config.allowFrom,
          feishuGroupRequireMention: config.feishuGroupRequireMention,
          isDuplicateMessage: (msgId) => dedupStore.isDuplicate(msgId),
          handleText: async (input) => appDepsHandleText(input),
          handleFeishuCardAction: async (input) => appDepsHandleFeishuCardAction(input),
        }, data);
      },
    });
    wsClient.start({ eventDispatcher }).then(async () => {
      log.info('✅ 飞书长连接已启动');
      try {
        await pushFeishuStartupHelp({
          enabled: config.feishuStartupHelpEnabled,
          adminOpenId: config.feishuStartupHelpAdminOpenId,
          sendText,
        });
      } catch (error) {
        log.warn('飞书启动帮助发送失败', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }).catch((error) => {
      log.error('❌ 飞书长连接启动失败', error);
    });
  } else if (config.feishuEnabled && feishuApi) {
    void pushFeishuStartupHelp({
      enabled: config.feishuStartupHelpEnabled,
      adminOpenId: config.feishuStartupHelpAdminOpenId,
      sendText,
    }).catch((error) => {
      log.warn('飞书启动帮助发送失败', {
        error: error instanceof Error ? error.message : String(error),
      });
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function extractCardField(value: Record<string, unknown>, key: string): string | undefined {
  const direct = value[key];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const nested = asRecord(direct);
  if (typeof nested?.value === 'string' && nested.value.trim()) {
    return nested.value.trim();
  }
  if (typeof nested?.default_value === 'string' && nested.default_value.trim()) {
    return nested.default_value.trim();
  }
  return undefined;
}

async function appDepsHandleFeishuCardAction(input: {
  userId: string;
  chatId?: string;
  action: string;
  value: Record<string, unknown>;
}): Promise<void> {
  const currentAgent = sessionStore.getCurrentAgent(resolveUserKey(input.userId));
  const runtimeProvider = sessionStore.getProviderOverride?.(resolveUserKey(input.userId), currentAgent.agentId) ?? config.codexProvider;
  const runtimeProviderSpec = getCliProviderSpec(runtimeProvider);
  const runtimeRunner = resolveRunner(runtimeProvider);
  const runtimeHomeDir = resolveRunnerHomeDir(runtimeProvider);
  if (input.action === 'codex_login.start_device_auth') {
    try {
      await startCodexDeviceLogin({
        provider: runtimeProvider,
        channel: 'feishu',
        userId: input.userId,
        sendText,
        codexHomeDir: runtimeHomeDir,
        codexRunner: runtimeRunner,
      });
    } catch (error) {
      log.error('飞书设备授权登录失败', {
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      await sendText('feishu', input.userId, '❌ 登录超时或遇到错误。请重试 /login 命令。');
    }
    return;
  }

  if (input.action === 'opencode_login.start_provider_auth') {
    const providerId = extractCardField(input.value, 'provider_id') ?? '';
    if (!providerId) {
      await sendText('feishu', input.userId, '❌ 缺少 OpenCode provider，无法启动登录。');
      return;
    }
    const authSessionKey = buildOpenCodeAuthSessionKey('feishu', input.userId, currentAgent.agentId);
    await openCodeAuthFlowManager.start({
      key: authSessionKey,
      provider: providerId,
      opencodeBin: config.opencodeBin,
      cliHomeDir: opencodeHomeDir,
      cwd: currentAgent.workspaceDir,
      baseEnv: process.env,
      onOutput: async (text) => {
        await sendText('feishu', input.userId, text);
      },
      onExit: async (result) => {
        await sendText('feishu', input.userId, result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
      },
    });
    return;
  }

  if (input.action === 'codex_login.open_api_form') {
    await sendText('feishu', input.userId, buildFeishuApiLoginFormMessage({
      provider: runtimeProvider,
      baseUrl: extractCardField(input.value, 'base_url'),
      model: extractCardField(input.value, 'model'),
    }));
    return;
  }

  if (input.action === 'codex_login.submit_api_credentials') {
    try {
      const result = await writeCliApiLoginConfig({
        provider: runtimeProvider,
        cliHomeDir: runtimeHomeDir,
        baseUrl: extractCardField(input.value, 'base_url') ?? '',
        apiKey: extractCardField(input.value, 'api_key') ?? '',
        model: extractCardField(input.value, 'model') ?? runtimeProviderSpec.defaultModel,
      });
      await sendText('feishu', input.userId, buildFeishuApiLoginResultMessage({
        provider: runtimeProvider,
        ok: true,
        message: `项目内 ${runtimeProviderSpec.label} API 配置已更新。`,
        baseUrl: result.baseUrl,
        model: result.model,
        maskedApiKey: result.maskedApiKey,
      }));
    } catch (error) {
      await sendText('feishu', input.userId, buildFeishuApiLoginResultMessage({
        provider: runtimeProvider,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        baseUrl: extractCardField(input.value, 'base_url') ?? '',
        model: extractCardField(input.value, 'model') ?? runtimeProviderSpec.defaultModel,
      }));
    }
    return;
  }

  log.warn('收到未识别的飞书卡片受控动作', {
    userId: input.userId,
    chatId: input.chatId ?? '(empty)',
    action: input.action,
  });
}

function syncBuiltInSkills(agentsRootDir: string): void {
  syncManagedGlobalSkills();
  installReminderToolSkill(path.resolve(agentsRootDir));
  installFeishuOfficialOpsSkill(path.resolve(agentsRootDir));
  const usersDir = path.join(agentsRootDir, 'users');
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
      installGatewayBrowserSkill(workspaceDir);
      installReminderToolSkill(workspaceDir);
      installFeishuOfficialOpsSkill(workspaceDir);
    }
  }
}
