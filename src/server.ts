import fs from 'node:fs';
import path from 'node:path';

import { createApp } from './app.js';
import { config } from './config.js';
import { BrowserOpener } from './services/browser-opener.js';
import { AgentWorkspaceManager } from './services/agent-workspace-manager.js';
import { CodexRunner } from './services/codex-runner.js';
import { createChatHandler } from './services/chat-handler.js';
import { MemorySteward } from './services/memory-steward.js';
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
  feishuEnabled: config.feishuEnabled,
  feishuApiTimeoutMs: config.feishuApiTimeoutMs,
});

const dataDir = path.resolve(process.cwd(), '.data');
fs.mkdirSync(dataDir, { recursive: true });
log.debug('数据目录已就绪', { dataDir });

const agentsDir = path.resolve(config.codexAgentsDir ?? path.join(dataDir, 'agents'));
fs.mkdirSync(agentsDir, { recursive: true });
log.debug('Agent 工作区目录已就绪', { agentsDir });

const sessionStore = new SessionStore(path.join(dataDir, 'sessions.db'), {
  defaultWorkspaceDir: config.codexWorkdir,
});
log.debug('SessionStore 已初始化');
const agentWorkspaceManager = new AgentWorkspaceManager(agentsDir);
log.debug('AgentWorkspaceManager 已初始化', { agentsDir });
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

const weComApi = new WeComApi({
  corpId: config.corpId,
  secret: config.corpSecret,
  agentId: config.agentId,
  timeoutMs: config.apiTimeoutMs,
  retryOnTimeout: config.apiRetryOnTimeout,
});
log.debug('WeComApi 已初始化');

const feishuApi = config.feishuEnabled && config.feishuAppId && config.feishuAppSecret
  ? new FeishuApi({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      timeoutMs: config.feishuApiTimeoutMs,
      retryOnTimeout: config.apiRetryOnTimeout,
    })
  : undefined;
if (feishuApi) {
  log.debug('FeishuApi 已初始化');
}

const wecomCrypto = new WeComCrypto({
  token: config.token,
  encodingAesKey: config.encodingAesKey,
  corpId: config.corpId,
});
log.debug('WeComCrypto 已初始化');

const userTaskQueue = new Map<string, Promise<void>>();
const outboundSendQueue = new Map<string, Promise<void>>();

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
  browserOpenEnabled: config.browserOpenEnabled,
  runnerEnabled: config.runnerEnabled,
  defaultModel: config.codexModel,
  defaultSearch: config.codexSearch,
  sendText,
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
  wecomCrypto,
  allowFrom: config.allowFrom,
  feishuVerificationToken: config.feishuVerificationToken,
  isDuplicateMessage: (msgId) => dedupStore.isDuplicate(msgId),
  handleText: async ({ channel, userId, content }) => {
    const sessionUserKey = `${channel}:${userId}`;
    await runInUserQueue(sessionUserKey, async () => {
      await handleChatText({ channel, userId, content });
    });
  },
});

async function sendText(channel: 'wecom' | 'feishu', userId: string, content: string): Promise<void> {
  await enqueueSendText(channel, userId, content);
}

async function enqueueSendText(channel: 'wecom' | 'feishu', userId: string, content: string): Promise<void> {
  await enqueueOutboundSend(channel, userId, async () => {
    if (channel === 'wecom') {
      await weComApi.sendText(userId, content);
      return;
    }
    if (!feishuApi) {
      throw new Error('feishu api not configured');
    }
    await feishuApi.sendText(userId, content);
  });
}

app.listen(config.port, () => {
  log.info(`✅ wecom-codex gateway 已启动，监听 http://127.0.0.1:${config.port}`);
  memorySteward.start();
});
