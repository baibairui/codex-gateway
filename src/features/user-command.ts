import type { SessionListItem } from '../stores/session-store.js';

export interface UserCommandResult {
  handled: boolean;
  message?: string;
  clearSession?: boolean;
  switchTarget?: string;
  renameTarget?: string;
  renameName?: string;
  queryModel?: boolean;
  queryModels?: boolean;
  setModel?: string;
  clearModel?: boolean;
  querySearch?: boolean;
  setSearchEnabled?: boolean;
  reviewMode?: 'uncommitted' | 'base' | 'commit';
  reviewTarget?: string;
  reviewPrompt?: string;
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
    return '当前没有历史会话。先发一条普通消息开始对话。';
  }
  const lines = sessions.map((session, idx) => {
    const marker = session.threadId === currentThreadId ? '👉' : '  ';
    const title = session.name ?? `会话 ${idx + 1}`;
    const preview = session.lastPrompt ? ` - ${session.lastPrompt}` : '';
    return `${marker} ${idx + 1}. ${title} (${maskThreadId(session.threadId)})${preview}`;
  });
  return ['会话列表（最近优先）：', ...lines, '使用 /switch <编号> 切换会话。'].join('\n');
}

export function handleUserCommand(
  content: string,
  currentThreadId?: string,
  sessions: SessionListItem[] = [],
): UserCommandResult {
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
          '/new - 新建会话（清空当前上下文）',
          '/clear - 清空当前会话',
          '/session - 查看当前会话状态',
          '/sessions - 查看历史会话列表',
          '/rename <编号|threadId> <名称> - 重命名会话',
          '/switch <编号|threadId> - 切换会话',
          '/model - 查看当前模型',
          '/model <模型名> - 切换模型',
          '/model reset - 重置为默认模型',
          '/models - 查看当前 Codex 支持的模型',
          '/search - 查看联网搜索状态',
          '/search on|off - 开启/关闭联网搜索',
          '/review - 审查当前工作区变更',
          '/review base <分支> - 审查相对分支的变更',
          '/review commit <SHA> - 审查指定提交',
        ].join('\n'),
      };
    case '/new':
    case '/clear':
      return {
        handled: true,
        clearSession: true,
        message: '✅ 已清空当前会话。下一条消息将从新会话开始。',
      };
    case '/session':
      return {
        handled: true,
        message: `当前会话：${maskThreadId(currentThreadId)}`,
      };
    case '/sessions':
      return {
        handled: true,
        message: formatSessions(currentThreadId, sessions),
      };
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
