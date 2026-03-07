import type { AgentListItem, AgentRecord, SessionListItem } from '../stores/session-store.js';

export interface UserCommandContext {
  currentThreadId?: string;
  currentAgent?: AgentRecord;
  sessions?: SessionListItem[];
  agents?: AgentListItem[];
}

export interface UserCommandResult {
  handled: boolean;
  message?: string;
  clearSession?: boolean;
  switchTarget?: string;
  renameTarget?: string;
  renameName?: string;
  queryModel?: boolean;
  queryModels?: boolean;
  querySkills?: boolean;
  querySkillsScope?: 'effective' | 'global' | 'agent';
  disableGlobalSkillName?: string;
  enableGlobalSkillName?: string;
  disableAgentSkillName?: string;
  setModel?: string;
  clearModel?: boolean;
  querySearch?: boolean;
  setSearchEnabled?: boolean;
  reviewMode?: 'uncommitted' | 'base' | 'commit';
  reviewTarget?: string;
  reviewPrompt?: string;
  openUrl?: string;
  publishWorkspace?: boolean;
  queryAgent?: boolean;
  queryAgents?: boolean;
  createAgentName?: string;
  createAgentTemplate?: 'default' | 'memory-onboarding' | 'skill-onboarding';
  initMemoryAgent?: boolean;
  initSkillAgent?: boolean;
  useAgentTarget?: string;
  initLogin?: boolean;
}

export function maskThreadId(threadId?: string): string {
  if (!threadId) {
    return '(当前无会话)';
  }
  if (threadId.length <= 8) {
    return '****';
  }
  return `${threadId.slice(0, 4)}...${threadId.slice(-4)}`;
}

function formatSessions(currentThreadId: string | undefined, sessions: SessionListItem[]): string {
  if (sessions.length === 0) {
    return '当前 agent 没有历史会话。先发一条普通消息开始对话。';
  }
  const lines = sessions.map((session, idx) => {
    const marker = session.threadId === currentThreadId ? '👉' : '  ';
    const title = session.name ?? `会话 ${idx + 1}`;
    const preview = session.lastPrompt ? ` - ${session.lastPrompt}` : '';
    return `${marker} ${idx + 1}. ${title} (${maskThreadId(session.threadId)})${preview}`;
  });
  return ['会话列表（当前 agent，最近优先）：', ...lines, '使用 /switch <编号> 切换会话。'].join('\n');
}

function formatCurrentAgent(agent?: AgentRecord): string {
  if (!agent) {
    return '当前没有激活 agent。';
  }
  return [
    `当前 agent：${agent.name} (${agent.agentId})`,
    `工作区：${agent.workspaceDir}`,
    `当前会话：${maskThreadId(undefined)}`,
  ].join('\n');
}

function formatAgents(currentAgent: AgentRecord | undefined, agents: AgentListItem[]): string {
  if (agents.length === 0) {
    return '当前没有可用 agent。';
  }
  const lines = agents.map((agent, idx) => {
    const marker = currentAgent?.agentId === agent.agentId ? '👉' : '  ';
    const suffix = agent.isDefault ? ' [default]' : '';
    return `${marker} ${idx + 1}. ${agent.name} (${agent.agentId})${suffix}\n   ${agent.workspaceDir}`;
  });
  return ['Agent 列表：', ...lines, '使用 /agent use <编号|agentId> 切换 agent。'].join('\n');
}

export function handleUserCommand(content: string, context: UserCommandContext = {}): UserCommandResult {
  const raw = content.trim();
  if (!raw.startsWith('/')) {
    return { handled: false };
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  const cmd = (parts[0] ?? '').toLowerCase();

  switch (cmd) {
    case '/help':
      return {
        handled: true,
        message: [
          '可用命令：',
          '/help - 查看帮助',
          '/new - 清空当前 agent 的当前会话',
          '/clear - 清空当前 agent 的当前会话',
          '/session - 查看当前会话状态',
          '/sessions - 查看当前 agent 的历史会话列表',
          '/rename <编号|threadId> <名称> - 重命名会话',
          '/switch <编号|threadId> - 切换会话',
          '/agents - 查看 agent 列表',
          '/agent - 查看当前 agent',
          '/agent create <名称> - 创建独立 agent 工作区',
          '/skill-agent - 启动技能扩展助手 agent',
          '/agent use <编号|agentId> - 切换 agent',
          '/model - 查看当前模型',
          '/model <模型名> - 切换模型',
          '/model reset - 重置为默认模型',
          '/models - 查看当前 Codex 支持的模型',
          '/skills - 查看当前会话生效 skill 列表（全局 + 当前 agent）',
          '/skills global - 查看全局 skill',
          '/skills agent - 查看当前 agent skill',
          '/skills disable global <skillName> - 禁用某个全局 skill（仅当前 agent）',
          '/skills add global <skillName> - 重新启用某个全局 skill（仅当前 agent）',
          '/skills disable agent <skillName> - 禁用某个当前 agent skill',
          '/search - 查看联网搜索状态',
          '/search on|off - 开启/关闭联网搜索',
          '/remind - 已废弃，请直接描述提醒需求，交由 agent 调用提醒工具处理',
          '/open <URL> - 在宿主机打开浏览器',
          '/deploy-workspace - 发布当前 workspace 到网关运行目录',
          '/review - 审查当前 agent 工作区变更',
          '/review base <分支> - 审查相对分支的变更',
          '/review commit <SHA> - 审查指定提交',
          '/login - 使用设备码登录 Codex',
          '提醒任务请直接用自然语言描述，由已安装的 reminder-tool skill 调用提醒工具执行。',
        ].join('\n'),
      };
    case '/new':
    case '/clear':
      return {
        handled: true,
        clearSession: true,
        message: '✅ 已清空当前 agent 的当前会话。下一条消息将从新会话开始。',
      };
    case '/session':
      return {
        handled: true,
        message: `当前会话：${maskThreadId(context.currentThreadId)}`,
      };
    case '/sessions':
      return {
        handled: true,
        message: formatSessions(context.currentThreadId, context.sessions ?? []),
      };
    case '/agents':
      return {
        handled: true,
        queryAgents: true,
        message: formatAgents(context.currentAgent, context.agents ?? []),
      };
    case '/agent': {
      const sub = (parts[1] ?? '').toLowerCase();
      if (!sub || sub === 'current') {
        const currentThreadLine = `当前会话：${maskThreadId(context.currentThreadId)}`;
        const message = context.currentAgent
          ? [`当前 agent：${context.currentAgent.name} (${context.currentAgent.agentId})`, `工作区：${context.currentAgent.workspaceDir}`, currentThreadLine].join('\n')
          : formatCurrentAgent(context.currentAgent);
        return {
          handled: true,
          queryAgent: true,
          message,
        };
      }
      if (sub === 'create' || sub === 'new') {
        const name = parts.slice(2).join(' ').trim();
        if (!name) {
          return {
            handled: true,
            message: '用法：/agent create <名称>',
          };
        }
        return {
          handled: true,
          createAgentName: name,
          createAgentTemplate: 'default',
        };
      }
      if (sub === 'init-memory' || sub === 'init' || sub === 'bootstrap-memory') {
        return {
          handled: true,
          initMemoryAgent: true,
        };
      }
      if (sub === 'use' || sub === 'switch') {
        const target = parts[2] ?? '';
        if (!target) {
          return {
            handled: true,
            message: '用法：/agent use <编号|agentId>',
          };
        }
        return {
          handled: true,
          useAgentTarget: target,
        };
      }
      return {
        handled: true,
        message: '用法：/agent | /agent create <名称> | /agent use <编号|agentId>',
      };
    }
    case '/switch': {
      const target = parts[1] ?? '';
      if (!target) {
        return {
          handled: true,
          message: '用法：/switch <编号|threadId>',
        };
      }
      return {
        handled: true,
        switchTarget: target,
      };
    }
    case '/skill-agent':
    case '/skillagent':
    case '/skill':
      return {
        handled: true,
        initSkillAgent: true,
      };
    case '/login':
      return {
        handled: true,
        initLogin: true,
      };
    case '/rename': {
      const target = parts[1] ?? '';
      const name = parts.slice(2).join(' ').trim();
      if (!target || !name) {
        return {
          handled: true,
          message: '用法：/rename <编号|threadId> <名称>',
        };
      }
      return {
        handled: true,
        renameTarget: target,
        renameName: name,
      };
    }
    case '/model': {
      const model = parts.slice(1).join(' ').trim();
      if (!model) {
        return {
          handled: true,
          queryModel: true,
        };
      }
      const action = model.toLowerCase();
      if (action === 'reset' || action === 'default' || action === 'clear') {
        return {
          handled: true,
          clearModel: true,
        };
      }
      if (/\s/.test(model)) {
        return {
          handled: true,
          message: '用法：/model <模型名>；模型名不能包含空格',
        };
      }
      return {
        handled: true,
        setModel: model,
      };
    }
    case '/models':
      return {
        handled: true,
        queryModels: true,
      };
    case '/skills': {
      const action = (parts[1] ?? '').toLowerCase();
      const scope = (parts[2] ?? '').toLowerCase();
      const skillName = parts.slice(3).join(' ').trim();
      if (!action || action === 'list') {
        return {
          handled: true,
          querySkills: true,
          querySkillsScope: 'effective',
        };
      }
      if (action === 'global') {
        return {
          handled: true,
          querySkills: true,
          querySkillsScope: 'global',
        };
      }
      if (action === 'agent' || action === 'local') {
        return {
          handled: true,
          querySkills: true,
          querySkillsScope: 'agent',
        };
      }
      if (action === 'disable' && scope === 'global' && skillName) {
        return {
          handled: true,
          disableGlobalSkillName: skillName,
        };
      }
      if ((action === 'add' || action === 'enable') && scope === 'global' && skillName) {
        return {
          handled: true,
          enableGlobalSkillName: skillName,
        };
      }
      if (action === 'disable' && (scope === 'agent' || scope === 'local') && skillName) {
        return {
          handled: true,
          disableAgentSkillName: skillName,
        };
      }
      return {
        handled: true,
        message: '用法：/skills | /skills global | /skills agent | /skills disable global <skillName> | /skills add global <skillName> | /skills disable agent <skillName>',
      };
    }
    case '/search': {
      const action = (parts[1] ?? '').toLowerCase();
      if (!action) {
        return {
          handled: true,
          querySearch: true,
        };
      }
      if (action === 'on' || action === 'true' || action === '1') {
        return {
          handled: true,
          setSearchEnabled: true,
        };
      }
      if (action === 'off' || action === 'false' || action === '0') {
        return {
          handled: true,
          setSearchEnabled: false,
        };
      }
      return {
        handled: true,
        message: '用法：/search on|off',
      };
    }
    case '/remind':
    case '/reminder':
      return {
        handled: true,
        message: '该命令已废弃。请直接描述提醒需求（例如“1小时后提醒我开会”），由 agent 调用提醒工具自动执行。',
      };
    case '/open': {
      const url = parts[1] ?? '';
      if (!url) {
        return {
          handled: true,
          message: '用法：/open <URL>',
        };
      }
      return {
        handled: true,
        openUrl: url,
      };
    }
    case '/deploy-workspace':
    case '/publish-workspace':
      return {
        handled: true,
        publishWorkspace: true,
      };
    case '/review': {
      const args = parts.slice(1);
      if (args.length === 0) {
        return {
          handled: true,
          reviewMode: 'uncommitted',
        };
      }
      const mode = (args[0] ?? '').toLowerCase();
      if (mode === 'uncommitted') {
        return {
          handled: true,
          reviewMode: 'uncommitted',
        };
      }
      if (mode === 'base') {
        const target = args[1] ?? '';
        if (!target) {
          return {
            handled: true,
            message: '用法：/review base <分支>',
          };
        }
        return {
          handled: true,
          reviewMode: 'base',
          reviewTarget: target,
        };
      }
      if (mode === 'commit') {
        const target = args[1] ?? '';
        if (!target) {
          return {
            handled: true,
            message: '用法：/review commit <SHA>',
          };
        }
        return {
          handled: true,
          reviewMode: 'commit',
          reviewTarget: target,
        };
      }
      return {
        handled: true,
        reviewMode: 'uncommitted',
        reviewPrompt: args.join(' '),
      };
    }
    default:
      return {
        handled: true,
        message: '未识别命令。输入 /help 查看可用命令。',
      };
  }
}

export function commandNeedsDetailedSessions(content: string): boolean {
  const raw = content.trim();
  if (!raw.startsWith('/')) {
    return false;
  }
  const cmd = (raw.split(/\s+/, 1)[0] ?? '').toLowerCase();
  return cmd === '/sessions';
}

export function commandNeedsAgentList(content: string): boolean {
  const raw = content.trim();
  if (!raw.startsWith('/')) {
    return false;
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const cmd = (parts[0] ?? '').toLowerCase();
  const sub = (parts[1] ?? '').toLowerCase();
  return cmd === '/agents'
    || (cmd === '/agent' && (
      sub === ''
      || sub === 'current'
      || sub === 'use'
      || sub === 'switch'
    ));
}
