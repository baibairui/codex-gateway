import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OpenCodeAuthFlow');

type Channel = 'wecom' | 'feishu';

interface OpenCodeAuthSession {
  key: string;
  provider: string;
  child: ChildProcessWithoutNullStreams;
}

interface StartOpenCodeAuthInput {
  key: string;
  provider: string;
  opencodeBin: string;
  cliHomeDir: string;
  cwd: string;
  baseEnv: NodeJS.ProcessEnv;
  onOutput: (text: string) => Promise<void>;
  onExit: (result: { ok: boolean; provider: string; message: string }) => Promise<void>;
}

export class OpenCodeAuthFlowManager {
  private readonly sessions = new Map<string, OpenCodeAuthSession>();

  has(key: string): boolean {
    return this.sessions.has(key);
  }

  async start(input: StartOpenCodeAuthInput): Promise<void> {
    this.stop(input.key, '新的 OpenCode 登录流程已启动，已替换旧流程。');
    const env: NodeJS.ProcessEnv = {
      ...input.baseEnv,
      HOME: path.resolve(input.cliHomeDir),
      XDG_CONFIG_HOME: path.join(path.resolve(input.cliHomeDir), '.config'),
      XDG_CACHE_HOME: path.join(path.resolve(input.cliHomeDir), '.cache'),
      XDG_DATA_HOME: path.join(path.resolve(input.cliHomeDir), '.local', 'share'),
      TERM: input.baseEnv.TERM || 'xterm-256color',
      FORCE_COLOR: '0',
    };

    const command = `${shellEscape(input.opencodeBin)} auth login ${shellEscape(input.provider)}`;
    const child = spawn('script', ['-qfec', command, '/dev/null'], {
      cwd: input.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.sessions.set(input.key, {
      key: input.key,
      provider: input.provider,
      child,
    });

    await input.onOutput([
      `已启动 OpenCode 内置登录：${input.provider}`,
      '接下来请直接在聊天里按提示回复内容；如需中止，发送 /cancel。',
    ].join('\n'));

    const forward = (raw: string) => {
      const text = sanitizeTerminalText(raw);
      if (!text.trim()) {
        return;
      }
      void input.onOutput(text).catch((error) => {
        log.warn('OpenCode 登录输出转发失败', {
          provider: input.provider,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    child.stdout.on('data', (chunk: Buffer) => {
      forward(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      forward(chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      this.sessions.delete(input.key);
      void input.onExit({
        ok: false,
        provider: input.provider,
        message: `OpenCode 登录进程启动失败：${error.message}`,
      });
    });
    child.on('close', (code) => {
      this.sessions.delete(input.key);
      void input.onExit({
        ok: code === 0,
        provider: input.provider,
        message: code === 0
          ? `OpenCode ${input.provider} 登录完成。`
          : `OpenCode ${input.provider} 登录失败，退出码：${code ?? 'unknown'}`,
      });
    });
  }

  async sendInput(key: string, text: string): Promise<boolean> {
    const session = this.sessions.get(key);
    if (!session) {
      return false;
    }
    session.child.stdin.write(`${text}\n`);
    return true;
  }

  stop(key: string, reason?: string): boolean {
    const session = this.sessions.get(key);
    if (!session) {
      return false;
    }
    this.sessions.delete(key);
    session.child.kill('SIGTERM');
    if (reason) {
      log.info('OpenCode 登录流程已终止', { key, provider: session.provider, reason });
    }
    return true;
  }
}

export function buildOpenCodeAuthSessionKey(channel: Channel, userId: string, agentId: string): string {
  return `${channel}:${userId}:${agentId}`;
}

function sanitizeTerminalText(text: string): string {
  const stripped = stripAnsi(text)
    .replace(/\r/g, '\n')
    .replace(/\u0007/g, '')
    .replace(/\u001b\[\?2004[hl]/g, '')
    .replace(/\n{3,}/g, '\n\n');
  return stripped.trim();
}

function stripAnsi(text: string): string {
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
