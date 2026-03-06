import fs from 'node:fs';
import path from 'node:path';

import { createApp } from './app.js';
import { config } from './config.js';
import { CodexRunner } from './services/codex-runner.js';
import { formatCodexModelsText, loadCodexModels, resolveModelFromSnapshot } from './services/codex-models.js';
import { WeComApi } from './services/wecom-api.js';
import { FeishuApi } from './services/feishu-api.js';
import { WeComCrypto } from './utils/wecom-crypto.js';
import { SessionStore } from './stores/session-store.js';
import { MessageDedupStore } from './stores/message-dedup-store.js';
import { RateLimitStore } from './stores/rate-limit-store.js';
import { createLogger } from './utils/logger.js';
import { commandNeedsDetailedSessions, handleUserCommand, maskThreadId } from './features/user-command.js';

const log = createLogger('Server');

log.info('服务启动初始化...', {
  port: config.port,
  codexBin: config.codexBin,
  codexModel: config.codexModel ?? '(codex cli default)',
  codexSearch: config.codexSearch,
  codexWorkdir: config.codexWorkdir,
  commandTimeoutMs: config.commandTimeoutMs ?? '(adaptive)',
  commandTimeoutMinMs: config.commandTimeoutMinMs,
  commandTimeoutMaxMs: config.commandTimeoutMaxMs,
  commandTimeoutPerCharMs: config.commandTimeoutPerCharMs,
  runnerEnabled: config.runnerEnabled,
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

const sessionStore = new SessionStore(path.join(dataDir, 'sessions.db'));
log.debug('SessionStore 已初始化');
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

function clipMessage(message: string, maxLength = 1500): string {
  if (message.length <= maxLength) {
    return message;
  }
  return `${message.slice(0, maxLength)}\n...(截断)`;
}

const userTaskQueue = new Map<string, Promise<void>>();
const outboundSendQueue = new Map<string, Promise<void>>();
const userModelOverrides = new Map<string, string>();
const userSearchOverrides = new Map<string, boolean>();

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

const app = createApp({
  wecomCrypto,
  allowFrom: config.allowFrom,
  feishuVerificationToken: config.feishuVerificationToken,
  isDuplicateMessage: (msgId) => dedupStore.isDuplicate(msgId),
  handleText: async ({ channel, userId, content }) => {
    const sessionUserKey = `${channel}:${userId}`;
    await runInUserQueue(sessionUserKey, async () => {
      const prompt = content.trim();
      if (!prompt) {
        log.debug('handleText 收到空 prompt，跳过', { channel, userId });
        return;
      }

      log.info(`
════════════════════════════════════════════════════════════
📩 用户消息  [${channel}:${userId}]
────────────────────────────────────────────────────────────
${clipMessage(prompt, 500)}
════════════════════════════════════════════════════════════`);

      const existingThreadId = sessionStore.get(sessionUserKey);
      const currentModel = userModelOverrides.get(sessionUserKey) ?? config.codexModel;
      const currentSearch = userSearchOverrides.get(sessionUserKey) ?? config.codexSearch;
      const commandResult = handleUserCommand(
        prompt,
        existingThreadId,
        commandNeedsDetailedSessions(prompt) ? sessionStore.listDetailed(sessionUserKey) : [],
      );
      if (commandResult.handled) {
        if (commandResult.clearSession) {
          sessionStore.clear(sessionUserKey);
        }
        if (commandResult.renameTarget && commandResult.renameName) {
          const resolved = sessionStore.resolveSwitchTarget(sessionUserKey, commandResult.renameTarget);
          if (!resolved) {
            await sendText(channel, userId, '❌ 未找到目标会话，请先发送 /sessions 查看编号。');
            return;
          }
          sessionStore.renameSession(resolved, commandResult.renameName);
          await sendText(channel, userId, `✅ 已重命名会话：${commandResult.renameName}`);
          return;
        }
        if (commandResult.switchTarget) {
          const resolved = sessionStore.resolveSwitchTarget(sessionUserKey, commandResult.switchTarget);
          if (!resolved) {
            await sendText(channel, userId, '❌ 未找到目标会话，请先发送 /sessions 查看编号。');
            return;
          }
          sessionStore.set(sessionUserKey, resolved);
          await sendText(channel, userId, `✅ 已切换到会话：${maskThreadId(resolved)}`);
          return;
        }
        if (commandResult.queryModel) {
          await sendText(channel, userId, `当前模型：${currentModel ?? '(codex cli 默认模型)'}`);
          return;
        }
        if (commandResult.queryModels) {
          await sendText(channel, userId, formatCodexModelsText(loadCodexModels()));
          return;
        }
        if (commandResult.clearModel) {
          userModelOverrides.delete(sessionUserKey);
          await sendText(channel, userId, `✅ 已重置模型：${config.codexModel ?? '(codex cli 默认模型)'}`);
          return;
        }
        if (commandResult.setModel) {
          const snapshot = loadCodexModels();
          const resolved = resolveModelFromSnapshot(commandResult.setModel, snapshot);
          if (!resolved.ok || !resolved.model) {
            await sendText(channel, userId, `❌ ${resolved.reason ?? '模型校验失败'}`);
            return;
          }
          userModelOverrides.set(sessionUserKey, resolved.model);
          const note = resolved.reason ? `\n⚠️ ${resolved.reason}` : '';
          await sendText(channel, userId, `✅ 已切换模型为：${resolved.model}${note}`);
          return;
        }
        if (commandResult.querySearch) {
          await sendText(channel, userId, `联网搜索：${currentSearch ? 'on' : 'off'}`);
          return;
        }
        if (typeof commandResult.setSearchEnabled === 'boolean') {
          userSearchOverrides.set(sessionUserKey, commandResult.setSearchEnabled);
          await sendText(channel, userId, `✅ 已${commandResult.setSearchEnabled ? '开启' : '关闭'}联网搜索`);
          return;
        }
        if (commandResult.reviewMode) {
          if (!rateLimitStore.allow(sessionUserKey)) {
            log.warn('handleText /review 命中限流，拒绝执行', { userId });
            await sendText(channel, userId, '⏳ 请求过于频繁，请稍后再试。');
            return;
          }
          if (!config.runnerEnabled) {
            log.warn('handleText /review runnerEnabled=false，拒绝执行', { userId });
            await sendText(channel, userId, '⚠️ 当前服务已禁用命令执行，请联系管理员。');
            return;
          }
          try {
            let lastStreamSend: Promise<void> = Promise.resolve();
            const startTime = Date.now();
            const reviewResult = await codexRunner.review({
              mode: commandResult.reviewMode,
              target: commandResult.reviewTarget,
              prompt: commandResult.reviewPrompt,
              model: currentModel,
              search: currentSearch,
              onMessage: (text) => {
                log.info(`
════════════════════════════════════════════════════════════
🧪 Codex Review  [${channel}:${userId}]
────────────────────────────────────────────────────────────
${clipMessage(text, 500)}
════════════════════════════════════════════════════════════`);
                lastStreamSend = enqueueSendText(channel, userId, text).catch((err) => {
                  log.error('handleText review onMessage 推送失败', err);
                });
              },
            });
            const elapsed = Date.now() - startTime;
            await lastStreamSend;
            log.info('<<< handleText Codex review 执行完成', {
              userId,
              mode: commandResult.reviewMode,
              target: commandResult.reviewTarget ?? '(none)',
              elapsedMs: elapsed,
              rawOutputLength: reviewResult.rawOutput.length,
            });
          } catch (error) {
            log.error('handleText /review 执行失败', {
              userId,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
            await sendText(channel, userId, '❌ review 执行失败，请稍后重试。');
          }
          return;
        }
        if (commandResult.message) {
          await sendText(channel, userId, commandResult.message);
        }
        return;
      }

      if (!rateLimitStore.allow(sessionUserKey)) {
        log.warn('handleText 命中限流，拒绝执行', { userId });
        await sendText(channel, userId, '⏳ 请求过于频繁，请稍后再试。');
        return;
      }

      if (!config.runnerEnabled) {
        log.warn('handleText runnerEnabled=false，拒绝执行', { userId });
        await sendText(channel, userId, '⚠️ 当前服务已禁用命令执行，请联系管理员。');
        return;
      }

      try {
        const threadId = sessionStore.get(sessionUserKey);
        let lastStreamSend: Promise<void> = Promise.resolve();
        log.debug('handleText 查询 session', {
          userId,
          existingThreadId: threadId ?? '(无，新会话)',
        });

        const startTime = Date.now();
        const result = await codexRunner.run({
          prompt,
          threadId,
          model: currentModel,
          search: currentSearch,
          // 每产出一条 agent_message 就实时推给用户
          onMessage: (text) => {
            log.info(`
════════════════════════════════════════════════════════════
🤖 Codex 回复  [${channel}:${userId}]
────────────────────────────────────────────────────────────
${clipMessage(text, 500)}
════════════════════════════════════════════════════════════`);
            lastStreamSend = enqueueSendText(channel, userId, text).catch((err) => {
              log.error('handleText onMessage 推送失败', err);
            });
          },
        });
        const elapsed = Date.now() - startTime;
        await lastStreamSend;

        log.info('<<< handleText Codex 执行完成', {
          userId,
          threadId: result.threadId,
          elapsedMs: elapsed,
          rawOutputLength: result.rawOutput.length,
        });

        sessionStore.set(sessionUserKey, result.threadId, prompt);
        log.debug('handleText session 已更新', {
          userId,
          threadId: result.threadId,
        });
      } catch (error) {
        log.error('handleText 执行失败', {
          userId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
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
});
