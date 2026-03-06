import fs from 'node:fs';
import path from 'node:path';

import { createApp } from './app.js';
import { config } from './config.js';
import { CodexRunner } from './services/codex-runner.js';
import { WeComApi } from './services/wecom-api.js';
import { FeishuApi } from './services/feishu-api.js';
import { WeComCrypto } from './utils/wecom-crypto.js';
import { SessionStore } from './stores/session-store.js';
import { MessageDedupStore } from './stores/message-dedup-store.js';
import { RateLimitStore } from './stores/rate-limit-store.js';
import { createLogger } from './utils/logger.js';
import { handleUserCommand, maskThreadId } from './features/user-command.js';

const log = createLogger('Server');

log.info('服务启动初始化...', {
  port: config.port,
  codexBin: config.codexBin,
  codexWorkdir: config.codexWorkdir,
  commandTimeoutMs: config.commandTimeoutMs,
  runnerEnabled: config.runnerEnabled,
  allowFrom: config.allowFrom,
  dedupWindowSeconds: config.dedupWindowSeconds,
  rateLimitMaxMessages: config.rateLimitMaxMessages,
  rateLimitWindowSeconds: config.rateLimitWindowSeconds,
  apiTimeoutMs: config.apiTimeoutMs,
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
  sandbox: config.codexSandbox,
});
log.debug('CodexRunner 已初始化');

const weComApi = new WeComApi({
  corpId: config.corpId,
  secret: config.corpSecret,
  agentId: config.agentId,
  timeoutMs: config.apiTimeoutMs,
});
log.debug('WeComApi 已初始化');

const feishuApi = config.feishuEnabled && config.feishuAppId && config.feishuAppSecret
  ? new FeishuApi({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      timeoutMs: config.feishuApiTimeoutMs,
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
      const commandResult = handleUserCommand(prompt, existingThreadId, sessionStore.listDetailed(sessionUserKey));
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
        log.debug('handleText 查询 session', {
          userId,
          existingThreadId: threadId ?? '(无，新会话)',
        });

        await sendText(channel, userId, '⏳ 已收到，正在处理，请稍候...');

        const startTime = Date.now();
        const result = await codexRunner.run({
          prompt,
          threadId,
          // 每产出一条 agent_message 就实时推给用户
          onMessage: (text) => {
            log.info(`
════════════════════════════════════════════════════════════
🤖 Codex 回复  [${channel}:${userId}]
────────────────────────────────────────────────────────────
${clipMessage(text, 500)}
════════════════════════════════════════════════════════════`);
            sendText(channel, userId, text).catch((err) => {
              log.error('handleText onMessage 推送失败', err);
            });
          },
        });
        const elapsed = Date.now() - startTime;

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

        const message = error instanceof Error ? error.message : String(error);
        try {
          await sendText(channel, userId, `❌ 执行失败：${clipMessage(message, 1000)}`);
          log.debug('handleText 已推送失败通知给用户', { userId });
        } catch (sendErr) {
          log.error('handleText 推送失败通知也失败', sendErr);
        }
      }
    });
  },
});

async function sendText(channel: 'wecom' | 'feishu', userId: string, content: string): Promise<void> {
  if (channel === 'wecom') {
    await weComApi.sendText(userId, content);
    return;
  }
  if (!feishuApi) {
    throw new Error('feishu api not configured');
  }
  await feishuApi.sendText(userId, content);
}

app.listen(config.port, () => {
  log.info(`✅ wecom-codex gateway 已启动，监听 http://127.0.0.1:${config.port}`);
});
