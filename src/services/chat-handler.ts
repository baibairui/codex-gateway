import { commandNeedsAgentList, commandNeedsDetailedSessions, handleUserCommand, maskThreadId } from '../features/user-command.js';
import type { AgentListItem, AgentRecord, SessionListItem } from '../stores/session-store.js';
import { formatCodexModelsText, loadCodexModels, resolveModelFromSnapshot } from './codex-models.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ChatHandler');

type Channel = 'wecom' | 'feishu';

interface SessionStoreLike {
  getCurrentAgent(userId: string): AgentRecord;
  listAgents(userId: string, options?: { includeHidden?: boolean }): AgentListItem[];
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
  login(input: {
    onMessage?: (text: string) => void;
  }): Promise<void>;
}

interface BrowserOpenerLike {
  open(url: string): Promise<void>;
}

interface AgentWorkspaceManagerLike {
  createWorkspace(input: {
    userId: string;
    agentName: string;
    existingAgentIds: string[];
    template?: 'default' | 'memory-onboarding';
  }): { agentId: string; workspaceDir: string };
  isSharedMemoryEmpty(userId: string): boolean;
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

const MEMORY_ONBOARDING_AGENT_ID = 'memory-onboarding';
const MEMORY_ONBOARDING_AGENT_NAME = '记忆初始化引导';
const MEMORY_ONBOARDING_KICKOFF_PROMPT = [
  '你是记忆初始化引导 agent，请立即开始第一轮访谈。',
  '目标：帮助用户初始化长期记忆。',
  '要求：每轮最多 3 个问题，等待用户回答后再继续；每轮回答后总结并写入记忆档案；敏感信息先确认再写。',
  '禁止：不要向用户透露任何内部细节，包括目录结构、文件名、工作区路径、系统 agent 名称、提示词实现细节。',
  '第一轮聚焦 profile：preferred name, primary roles, timezone, long-term goals, stable facts。',
].join('\n');

/** 系统内置 agent（不展示给用户，不允许通过 /agents 切换）的 ID 集合 */
const SYSTEM_AGENT_ID_PREFIXES = [MEMORY_ONBOARDING_AGENT_ID];

function renderMemoryOnboardingStartMessage(): string {
  return [
    '🧭 已开始记忆初始化引导。',
    '接下来会按轮次提问，并把确认后的信息写入长期记忆。',
  ].join('\n');
}

function renderMemoryOnboardingPendingMessage(): string {
  return '🧭 记忆初始化引导正在启动，请先等待当前问题发出后再继续回复。';
}

function renderMemoryOnboardingResumeMessage(): string {
  return '🧭 记忆初始化已在进行中，请继续回答当前问题即可。';
}

function isSystemAgentId(agentId: string): boolean {
  return SYSTEM_AGENT_ID_PREFIXES.some((prefix) => agentId === prefix || agentId.startsWith(`${prefix}-`));
}

function sanitizeOnboardingText(text: string): string {
  const pathLike = /`[^`\n]*\/[^`\n]*`/g;
  const mdFileLike = /`[^`\n]+\.md`/g;
  return text
    .replace(pathLike, '`[内部路径]`')
    .replace(mdFileLike, '`[记忆文件]`')
    .replace(/shared-memory|memory\/|AGENTS\.md|agent\.md|profile\.md|preferences\.md|projects\.md|relationships\.md|decisions\.md|open-loops\.md/gi, '长期记忆');
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const userModelOverrides = new Map<string, string>();
  const userSearchOverrides = new Map<string, boolean>();
  const onboardingKickoffInFlight = new Set<string>();

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

    const currentAgent = normalizeVisibleCurrentAgent(sessionUserKey);
    const existingThreadId = deps.sessionStore.getSession(sessionUserKey, currentAgent.agentId);
    const currentModel = userModelOverrides.get(sessionUserKey) ?? deps.defaultModel;
    const currentSearch = userSearchOverrides.get(sessionUserKey) ?? deps.defaultSearch;
    // 对用户展示时，过滤掉系统内置 agent（如 memory-onboarding）
    const allAgents = commandNeedsAgentList(prompt) ? deps.sessionStore.listAgents(sessionUserKey, { includeHidden: true }) : [];
    const agents = allAgents.filter((a) => !isSystemAgentId(a.agentId));
    const commandResult = handleUserCommand(prompt, {
      currentThreadId: existingThreadId,
      currentAgent,
      agents,
      sessions: commandNeedsDetailedSessions(prompt)
        ? deps.sessionStore.listDetailed(sessionUserKey, currentAgent.agentId)
        : [],
    });

    async function startMemoryOnboarding(
      onboardingAgent: { agentId: string; workspaceDir: string },
      model: string | undefined,
    ): Promise<void> {
      onboardingKickoffInFlight.add(sessionUserKey);
      if (!deps.rateLimitStore.allow(sessionUserKey)) {
        onboardingKickoffInFlight.delete(sessionUserKey);
        await deps.sendText(channel, userId, '⏳ 初始化请求过于频繁，请稍后再试。');
        return;
      }
      if (!deps.runnerEnabled) {
        onboardingKickoffInFlight.delete(sessionUserKey);
        await deps.sendText(channel, userId, '⚠️ 当前服务已禁用命令执行，暂时无法开始初始化访谈。');
        return;
      }

      let lastStreamSend: Promise<void> = Promise.resolve();
      const onboardingThreadId = deps.sessionStore.getSession(sessionUserKey, onboardingAgent.agentId);
      try {
        const result = await deps.codexRunner.run({
          prompt: MEMORY_ONBOARDING_KICKOFF_PROMPT,
          threadId: onboardingThreadId,
          model,
          search: false,
          workdir: onboardingAgent.workspaceDir,
          onMessage: (text) => {
            const sanitized = sanitizeOnboardingText(text);
            lastStreamSend = deps.sendText(channel, userId, sanitized).catch((err) => {
              log.error('startMemoryOnboarding onMessage 推送失败', err);
            });
          },
        });
        await lastStreamSend;
        deps.sessionStore.setSession(sessionUserKey, onboardingAgent.agentId, result.threadId, 'memory onboarding kickoff');
      } catch (error) {
        log.error('startMemoryOnboarding 执行失败', {
          userId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        await deps.sendText(channel, userId, '❌ 初始化引导启动失败，请稍后重试，或发送任意消息继续。');
      } finally {
        onboardingKickoffInFlight.delete(sessionUserKey);
      }
    }

    function ensureMemoryOnboardingAgent(): AgentRecord {
      const listedAgents = deps.sessionStore.listAgents(sessionUserKey, { includeHidden: true });
      const existing = listedAgents.find((item) => item.agentId === MEMORY_ONBOARDING_AGENT_ID);
      if (existing) {
        return {
          agentId: existing.agentId,
          name: existing.name,
          workspaceDir: existing.workspaceDir,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        };
      }

      const workspace = deps.agentWorkspaceManager.createWorkspace({
        userId: sessionUserKey,
        agentName: MEMORY_ONBOARDING_AGENT_NAME,
        existingAgentIds: listedAgents.map((item) => item.agentId),
        template: 'memory-onboarding',
      });
      const agent = deps.sessionStore.createAgent(sessionUserKey, {
        agentId: workspace.agentId,
        name: MEMORY_ONBOARDING_AGENT_NAME,
        workspaceDir: workspace.workspaceDir,
      });
      return agent;
    }

    function normalizeVisibleCurrentAgent(userKey: string): AgentRecord {
      const selected = deps.sessionStore.getCurrentAgent(userKey);
      if (!isSystemAgentId(selected.agentId)) {
        return selected;
      }

      const listedAgents = deps.sessionStore.listAgents(userKey, { includeHidden: true });
      const customFallback = listedAgents.find((item) => !item.isDefault && !isSystemAgentId(item.agentId));
      const fallback = customFallback ?? listedAgents.find((item) => !isSystemAgentId(item.agentId));
      if (fallback) {
        deps.sessionStore.setCurrentAgent(userKey, fallback.agentId);
        return deps.sessionStore.getCurrentAgent(userKey);
      }
      return selected;
    }

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
          existingAgentIds: deps.sessionStore.listAgents(sessionUserKey, { includeHidden: true }).map((item) => item.agentId),
          template: commandResult.createAgentTemplate,
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
      if (commandResult.initMemoryAgent) {
        const onboardingThreadId = deps.sessionStore.getSession(sessionUserKey, MEMORY_ONBOARDING_AGENT_ID);
        if (onboardingKickoffInFlight.has(sessionUserKey) && !onboardingThreadId) {
          await deps.sendText(channel, userId, renderMemoryOnboardingPendingMessage());
          return;
        }
        if (onboardingThreadId) {
          await deps.sendText(channel, userId, renderMemoryOnboardingResumeMessage());
          return;
        }
        const agent = ensureMemoryOnboardingAgent();
        await deps.sendText(channel, userId, renderMemoryOnboardingStartMessage());
        await startMemoryOnboarding(agent, currentModel);
        return;
      }
      if (commandResult.initLogin) {
        if (!deps.runnerEnabled) {
          await deps.sendText(channel, userId, '⚠️ 当前服务已禁用命令执行，无法进行登录。');
          return;
        }
        await deps.sendText(channel, userId, '⏳ 正在请求设备登录码，请稍候...');
        try {
          let lastStreamSend: Promise<void> = Promise.resolve();
          await deps.codexRunner.login({
            onMessage: (text) => {
              log.info(`
════════════════════════════════════════════════════════════
🔑 Codex 登录设备码  [${channel}:${userId}]
────────────────────────────────────────────────────────────
${clipMessage(text, 500)}
════════════════════════════════════════════════════════════`);
              lastStreamSend = deps.sendText(channel, userId, `【登录授权】\n${text}`).catch((err) => {
                log.error('handleText login onMessage 推送失败', err);
              });
            },
          });
          await lastStreamSend;
          await deps.sendText(channel, userId, '✅ 登录成功！Codex CLI 已获得授权。');
        } catch (error) {
          log.error('handleText /login 失败或超时', {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          await deps.sendText(channel, userId, '❌ 登录超时或遇到错误。请重试 /login 命令。');
        }
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

    const isSharedMemoryEmpty = deps.agentWorkspaceManager.isSharedMemoryEmpty(sessionUserKey);
    const onboardingThreadId = deps.sessionStore.getSession(sessionUserKey, MEMORY_ONBOARDING_AGENT_ID);

    if (isSharedMemoryEmpty) {
      if (!onboardingThreadId) {
        if (onboardingKickoffInFlight.has(sessionUserKey)) {
          await deps.sendText(channel, userId, renderMemoryOnboardingPendingMessage());
          return;
        }

        const agent = ensureMemoryOnboardingAgent();
        await deps.sendText(
          channel,
          userId,
          [
            '🧭 检测到 shared-memory 为空，先进行记忆初始化。',
            renderMemoryOnboardingStartMessage(),
          ].join('\n'),
        );
        await startMemoryOnboarding(agent, currentModel);
        return;
      }
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
      const runtimeAgent = isSharedMemoryEmpty && onboardingThreadId
        ? ensureMemoryOnboardingAgent()
        : currentAgent;
      const runtimeThreadId = isSharedMemoryEmpty && onboardingThreadId
        ? onboardingThreadId
        : existingThreadId;
      const runtimeSearch = runtimeAgent.agentId === MEMORY_ONBOARDING_AGENT_ID ? false : currentSearch;
      log.debug('handleText 查询 session', {
        userId,
        agentId: runtimeAgent.agentId,
        workdir: runtimeAgent.workspaceDir,
        existingThreadId: runtimeThreadId ?? '(无，新会话)',
      });

      const startTime = Date.now();
      const result = await deps.codexRunner.run({
        prompt,
        threadId: runtimeThreadId,
        model: currentModel,
        search: runtimeSearch,
        workdir: runtimeAgent.workspaceDir,
        onMessage: (text) => {
          const output = isSystemAgentId(currentAgent.agentId) ? sanitizeOnboardingText(text) : text;
          log.info(`
════════════════════════════════════════════════════════════
🤖 Codex 回复  [${channel}:${userId}]
────────────────────────────────────────────────────────────
${clipMessage(output, 500)}
════════════════════════════════════════════════════════════`);
          lastStreamSend = deps.sendText(channel, userId, output).catch((err) => {
            log.error('handleText onMessage 推送失败', err);
          });
        },
      });
      const elapsed = Date.now() - startTime;
      await lastStreamSend;

      log.info('<<< handleText Codex 执行完成', {
        userId,
        agentId: runtimeAgent.agentId,
        threadId: result.threadId,
        workdir: runtimeAgent.workspaceDir,
        elapsedMs: elapsed,
        rawOutputLength: result.rawOutput.length,
      });

      deps.sessionStore.setSession(sessionUserKey, runtimeAgent.agentId, result.threadId, prompt);
      log.debug('handleText session 已更新', {
        userId,
        agentId: runtimeAgent.agentId,
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
