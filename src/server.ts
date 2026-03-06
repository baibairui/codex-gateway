import fs from 'node:fs';
import path from 'node:path';

import { createApp } from './app.js';
import { config } from './config.js';
import { CodexRunner } from './services/codex-runner.js';
import { WeComApi } from './services/wecom-api.js';
import { WeComCrypto } from './utils/wecom-crypto.js';
import { SessionStore } from './stores/session-store.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Server');

log.info('服务启动初始化...', {
  port: config.port,
  codexBin: config.codexBin,
  codexWorkdir: config.codexWorkdir,
  commandTimeoutMs: config.commandTimeoutMs,
  runnerEnabled: config.runnerEnabled,
});

const dataDir = path.resolve(process.cwd(), '.data');
fs.mkdirSync(dataDir, { recursive: true });
log.debug('数据目录已就绪', { dataDir });

const sessionStore = new SessionStore(path.join(dataDir, 'sessions.json'));
log.debug('SessionStore 已初始化');

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
});
log.debug('WeComApi 已初始化');

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

const app = createApp({
  wecomCrypto,
  handleText: async ({ userId, content }) => {
    const prompt = content.trim();
    if (!prompt) {
      log.debug('handleText 收到空 prompt，跳过', { userId });
      return;
    }

    log.info(`
════════════════════════════════════════════════════════════
📩 用户消息  [${userId}]
────────────────────────────────────────────────────────────
${prompt}
════════════════════════════════════════════════════════════`);

    try {
      const threadId = sessionStore.get(userId);
      log.debug('handleText 查询 session', {
        userId,
        existingThreadId: threadId ?? '(无，新会话)',
      });

      const startTime = Date.now();
      const result = await codexRunner.run({
        prompt,
        threadId,
        // 每产出一条 agent_message 就实时推给用户
        onMessage: (text) => {
          log.info(`
════════════════════════════════════════════════════════════
🤖 Codex 回复  [${userId}]
────────────────────────────────────────────────────────────
${text}
════════════════════════════════════════════════════════════`);
          weComApi.sendText(userId, clipMessage(text)).catch((err) => {
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

      sessionStore.set(userId, result.threadId);
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
        await weComApi.sendText(userId, `❌ 执行失败：${clipMessage(message, 1000)}`);
        log.debug('handleText 已推送失败通知给用户', { userId });
      } catch (sendErr) {
        log.error('handleText 推送失败通知也失败', sendErr);
      }
    }
  },
});

app.listen(config.port, () => {
  log.info(`✅ wecom-codex gateway 已启动，监听 http://127.0.0.1:${config.port}`);
});
