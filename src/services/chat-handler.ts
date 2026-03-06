import { commandNeedsAgentList, commandNeedsDetailedSessions, handleUserCommand, maskThreadId } from '../features/user-command.js';
import type { AgentListItem, AgentRecord, SessionListItem } from '../stores/session-store.js';
import { formatCodexModelsText, loadCodexModels, resolveModelFromSnapshot } from './codex-models.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChatHandler');

type Channel = 'wecom' | 'feishu';

interface SessionStoreLike {
  getCurrentAgent(userId: string): AgentRecord;
  listAgents(userId: string): AgentListItem[];
  createAgent(userId: string, input: { agentId: string; name: string; workspaceDir: string }): AgentRecord;
  setCurrentAgent(userId: string, agentId: string): boolean;
  resolveAgentTarget(userId: string, target: string): string | undefined;
  getSession(userId: string, agentId: string): string | undefined;
  setSession(userId: string, agentId: string, threadId: string, lastPrompt?: string): void;
  clearSession(userId: string, agentId: string): boolean;
  listDetailed(userId: string, agentId: string): SessionListItem[];
  resolveSwitchTarget(userId: string, agentId: string, target: string): string | undefined;
  renameSession(targetThreadId: string, name: string): boolean;
}

interface RateLimitStoreLike {
  allow(key: string): boolean;
}

interface CodexRunnerLike {
  run(input: {
    prompt: string;
    threadId?: string;
    model?: string;
    search?: boolean;
    workdir?: string;
    onMessage?: (text: string) => void;
  }): Promise<{ threadId: string; rawOutput: string }>;
  review(input: {
    mode: 'uncommitted' | 'base' | 'commit';
    target?: string;
    prompt?: string;
    model?: string;
    search?: boolean;
    workdir?: string;
    onMessage?: (text: string) => void;
  }): Promise<{ rawOutput: string }>;
}

interface BrowserOpenerLike {
  open(url: string): Promise<void>;
}

interface AgentWorkspaceManagerLike {
  createWorkspace(input: {
    userId: string;
    agentName: string;
    existingAgentIds: string[];
  }): { agentId: string; workspaceDir: string };
}

interface ChatHandlerDeps {
  sessionStore: SessionStoreLike;
  rateLimitStore: RateLimitStoreLike;
  codexRunner: CodexRunnerLike;
  agentWorkspaceManager: AgentWorkspaceManagerLike;
  browserOpener?: BrowserOpenerLike;
  browserOpenEnabled: boolean;
  runnerEnabled: boolean;
  defaultModel?: string;
  defaultSearch: boolean;
  sendText: (channel: Channel, userId: string, content: string) => Promise<void>;
}

function clipMessage(message: string, maxLength = 1500): string {
  if (message.length <= maxLength) {
    return message;
  }
  return `${message.slice(0, maxLength)}\n...(截断)`;
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const userModelOverrides = new Map<string, string>();
  const userSearchOverrides = new Map<string, boolean>();

  return async function handleText(input: { channel: Channel; userId: string; content: string }): Promise<void> {
    const { channel, userId, content } = input;
    const sessionUserKey = `${channel}:${userId}`;
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

    const currentAgent = deps.sessionStore.getCurrentAgent(sessionUserKey);
    const existingThreadId = deps.sessionStore.getSession(sessionUserKey, currentAgent.agentId);
    const currentModel = userModelOverrides.get(sessionUserKey) ?? deps.defaultModel;
    const currentSearch = userSearchOverrides.get(sessionUserKey) ?? deps.defaultSearch;
    const agents = commandNeedsAgentList(prompt) ? deps.sessionStore.listAgents(sessionUserKey) : [];
    const commandResult = handleUserCommand(prompt, {
      currentThreadId: existingThreadId,
      currentAgent,
      agents,
      sessions: commandNeedsDetailedSessions(prompt)
        ? deps.sessionStore.listDetailed(sessionUserKey, currentAgent.agentId)
        : [],
    });

    if (commandResult.handled) {
      if (commandResult.clearSession) {
        deps.sessionStore.clearSession(sessionUserKey, currentAgent.agentId);
      }
      if (commandResult.renameTarget && commandResult.renameName) {
        const resolved = deps.sessionStore.resolveSwitchTarget(sessionUserKey, currentAgent.agentId, commandResult.renameTarget);
        if (!resolved) {
          await deps.sendText(channel, userId, '❌ 未找到目标会话，请先发送 /sessions 查看编号。');
          return;
        }
        deps.sessionStore.renameSession(resolved, commandResult.renameName);
        await deps.sendText(channel, userId, `✅ 已重命名会话：${commandResult.renameName}`);
        return;
      }
      if (commandResult.createAgentName) {
        const workspace = deps.agentWorkspaceManager.createWorkspace({
          userId: sessionUserKey,
          agentName: commandResult.createAgentName,
          existingAgentIds: deps.sessionStore.listAgents(sessionUserKey).map((item) => item.agentId),
        });
        const agent = deps.sessionStore.createAgent(sessionUserKey, {
          agentId: workspace.agentId,
          name: commandResult.createAgentName,
          workspaceDir: workspace.workspaceDir,
        });
        deps.sessionStore.setCurrentAgent(sessionUserKey, agent.agentId);
        await deps.sendText(
          channel,
          userId,
          [
            `✅ 已创建并切换到 agent：${agent.name} (${agent.agentId})`,
            `工作区：${agent.workspaceDir}`,
            `记忆入口：${agent.workspaceDir}/AGENTS.md`,
          ].join('\n'),
        );
        return;
      }
      if (commandResult.useAgentTarget) {
        const resolved = deps.sessionStore.resolveAgentTarget(sessionUserKey, commandResult.useAgentTarget);
        if (!resolved) {
          await deps.sendText(channel, userId, '❌ 未找到目标 agent，请先发送 /agents 查看编号。');
          return;
        }
        deps.sessionStore.setCurrentAgent(sessionUserKey, resolved);
        const nextAgent = deps.sessionStore.getCurrentAgent(sessionUserKey);
        const nextThreadId = deps.sessionStore.getSession(sessionUserKey, nextAgent.agentId);
        await deps.sendText(
          channel,
          userId,
          [
            `✅ 已切换到 agent：${nextAgent.name} (${nextAgent.agentId})`,
            `工作区：${nextAgent.workspaceDir}`,
            `当前会话：${maskThreadId(nextThreadId)}`,
          ].join('\n'),
        );
        return;
      }
      if (commandResult.switchTarget) {
        const resolved = deps.sessionStore.resolveSwitchTarget(sessionUserKey, currentAgent.agentId, commandResult.switchTarget);
        if (!resolved) {
          await deps.sendText(channel, userId, '❌ 未找到目标会话，请先发送 /sessions 查看编号。');
          return;
        }
        deps.sessionStore.setSession(sessionUserKey, currentAgent.agentId, resolved);
        await deps.sendText(channel, userId, `✅ 已切换到会话：${maskThreadId(resolved)}`);
        return;
      }
      if (commandResult.queryAgent || commandResult.queryAgents) {
        if (commandResult.message) {
          await deps.sendText(channel, userId, commandResult.message);
        }
        return;
      }
      if (commandResult.queryModel) {
        await deps.sendText(channel, userId, `当前模型：${currentModel ?? '(codex cli 默认模型)'}`);
        return;
      }
      if (commandResult.queryModels) {
        await deps.sendText(channel, userId, formatCodexModelsText(loadCodexModels()));
        return;
      }
      if (commandResult.clearModel) {
        userModelOverrides.delete(sessionUserKey);
        await deps.sendText(channel, userId, `✅ 已重置模型：${deps.defaultModel ?? '(codex cli 默认模型)'}`);
        return;
      }
      if (commandResult.setModel) {
        const snapshot = loadCodexModels();
        const resolved = resolveModelFromSnapshot(commandResult.setModel, snapshot);
        if (!resolved.ok || !resolved.model) {
          await deps.sendText(channel, userId, `❌ ${resolved.reason ?? '模型校验失败'}`);
          return;
        }
        userModelOverrides.set(sessionUserKey, resolved.model);
        const note = resolved.reason ? `\n⚠️ ${resolved.reason}` : '';
        await deps.sendText(channel, userId, `✅ 已切换模型为：${resolved.model}${note}`);
        return;
      }
      if (commandResult.querySearch) {
        await deps.sendText(channel, userId, `联网搜索：${currentSearch ? 'on' : 'off'}`);
        return;
      }
      if (typeof commandResult.setSearchEnabled === 'boolean') {
        userSearchOverrides.set(sessionUserKey, commandResult.setSearchEnabled);
        await deps.sendText(channel, userId, `✅ 已${commandResult.setSearchEnabled ? '开启' : '关闭'}联网搜索`);
        return;
      }
      if (commandResult.openUrl) {
        if (!deps.browserOpenEnabled || !deps.browserOpener) {
          await deps.sendText(channel, userId, '⚠️ 当前服务未开启浏览器打开能力，请联系管理员。');
          return;
        }
        try {
          await deps.browserOpener.open(commandResult.openUrl);
          await deps.sendText(channel, userId, `✅ 已尝试打开浏览器：${commandResult.openUrl}`);
        } catch (error) {
          log.error('handleText /open 执行失败', {
            userId,
            url: commandResult.openUrl,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          await deps.sendText(channel, userId, '❌ 打开浏览器失败，请检查 URL 或宿主机图形环境。');
        }
        return;
      }
      if (commandResult.reviewMode) {
        if (!deps.rateLimitStore.allow(sessionUserKey)) {
          log.warn('handleText /review 命中限流，拒绝执行', { userId });
          await deps.sendText(channel, userId, '⏳ 请求过于频繁，请稍后再试。');
          return;
        }
        if (!deps.runnerEnabled) {
          log.warn('handleText /review runnerEnabled=false，拒绝执行', { userId });
          await deps.sendText(channel, userId, '⚠️ 当前服务已禁用命令执行，请联系管理员。');
          return;
        }
        try {
          let lastStreamSend: Promise<void> = Promise.resolve();
          const startTime = Date.now();
          const reviewResult = await deps.codexRunner.review({
            mode: commandResult.reviewMode,
            target: commandResult.reviewTarget,
            prompt: commandResult.reviewPrompt,
            model: currentModel,
            search: currentSearch,
            workdir: currentAgent.workspaceDir,
            onMessage: (text) => {
              log.info(`
════════════════════════════════════════════════════════════
🧪 Codex Review  [${channel}:${userId}]
────────────────────────────────────────────────────────────
${clipMessage(text, 500)}
════════════════════════════════════════════════════════════`);
              lastStreamSend = deps.sendText(channel, userId, text).catch((err) => {
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
            agentId: currentAgent.agentId,
            workdir: currentAgent.workspaceDir,
            elapsedMs: elapsed,
            rawOutputLength: reviewResult.rawOutput.length,
          });
        } catch (error) {
          log.error('handleText /review 执行失败', {
            userId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          await deps.sendText(channel, userId, '❌ review 执行失败，请稍后重试。');
        }
        return;
      }
      if (commandResult.message) {
        await deps.sendText(channel, userId, commandResult.message);
      }
      return;
    }

    if (!deps.rateLimitStore.allow(sessionUserKey)) {
      log.warn('handleText 命中限流，拒绝执行', { userId });
      await deps.sendText(channel, userId, '⏳ 请求过于频繁，请稍后再试。');
      return;
    }

    if (!deps.runnerEnabled) {
      log.warn('handleText runnerEnabled=false，拒绝执行', { userId });
      await deps.sendText(channel, userId, '⚠️ 当前服务已禁用命令执行，请联系管理员。');
      return;
    }

    try {
      let lastStreamSend: Promise<void> = Promise.resolve();
      log.debug('handleText 查询 session', {
        userId,
        agentId: currentAgent.agentId,
        workdir: currentAgent.workspaceDir,
        existingThreadId: existingThreadId ?? '(无，新会话)',
      });

      const startTime = Date.now();
      const result = await deps.codexRunner.run({
        prompt,
        threadId: existingThreadId,
        model: currentModel,
        search: currentSearch,
        workdir: currentAgent.workspaceDir,
        onMessage: (text) => {
          log.info(`
════════════════════════════════════════════════════════════
🤖 Codex 回复  [${channel}:${userId}]
────────────────────────────────────────────────────────────
${clipMessage(text, 500)}
════════════════════════════════════════════════════════════`);
          lastStreamSend = deps.sendText(channel, userId, text).catch((err) => {
            log.error('handleText onMessage 推送失败', err);
          });
        },
      });
      const elapsed = Date.now() - startTime;
      await lastStreamSend;

      log.info('<<< handleText Codex 执行完成', {
        userId,
        agentId: currentAgent.agentId,
        threadId: result.threadId,
        workdir: currentAgent.workspaceDir,
        elapsedMs: elapsed,
        rawOutputLength: result.rawOutput.length,
      });

      deps.sessionStore.setSession(sessionUserKey, currentAgent.agentId, result.threadId, prompt);
      log.debug('handleText session 已更新', {
        userId,
        agentId: currentAgent.agentId,
        threadId: result.threadId,
      });
    } catch (error) {
      log.error('handleText 执行失败', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await deps.sendText(channel, userId, '❌ 请求执行失败，请稍后重试。');
    }
  };
}
