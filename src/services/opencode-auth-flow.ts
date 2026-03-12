import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isExecutableAvailable } from './cli-provider.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OpenCodeAuthFlow');

type Channel = 'wecom' | 'feishu';

interface OpenCodeAuthSession {
  key: string;
  provider: string;
  child: ChildProcessWithoutNullStreams;
  announcedUrl: boolean;
  announcedInputFallback: boolean;
  awaitingUserInput: boolean;
  autoConfirmedPrompt: boolean;
  authFingerprintBefore?: string;
  pendingTerminalFragment: string;
}

export type OpenCodeAuthEvent =
  | { type: 'oauth_url'; provider: string; url: string }
  | { type: 'auto_confirmed'; provider: string; prompt: string }
  | { type: 'input_required'; provider: string; prompt: string };

interface StartOpenCodeAuthInput {
  key: string;
  provider: string;
  opencodeBin: string;
  cliHomeDir: string;
  cwd: string;
  baseEnv: NodeJS.ProcessEnv;
  onOutput?: (text: string) => Promise<void>;
  onEvent?: (event: OpenCodeAuthEvent) => Promise<void>;
  onExit: (result: { ok: boolean; provider: string; message: string }) => Promise<void>;
}

export class OpenCodeAuthFlowManager {
  private readonly sessions = new Map<string, OpenCodeAuthSession>();

  has(key: string): boolean {
    return this.sessions.has(key);
  }

  isAwaitingInput(key: string): boolean {
    return this.sessions.get(key)?.awaitingUserInput === true;
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

    const command = buildOpenCodeAuthCommand(input.opencodeBin, input.provider);
    if (!isExecutableAvailable(input.opencodeBin, env.PATH)) {
      await input.onExit({
        ok: false,
        provider: input.provider,
        message: '当前实例尚未安装 OpenCode，暂时无法使用该登录方式。',
      });
      return;
    }
    const child = spawn('script', ['-qfec', command, '/dev/null'], {
      cwd: input.cwd,
      detached: true,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.sessions.set(input.key, {
      key: input.key,
      provider: input.provider,
      child,
      announcedUrl: false,
      announcedInputFallback: false,
      awaitingUserInput: false,
      autoConfirmedPrompt: false,
      authFingerprintBefore: readAuthFingerprint(input.cliHomeDir),
      pendingTerminalFragment: '',
    });

    const forward = (raw: string) => {
      const session = this.sessions.get(input.key);
      const combined = `${session?.pendingTerminalFragment ?? ''}${raw}`;
      const pendingTerminalFragment = extractTrailingTerminalFragment(combined);
      if (session) {
        session.pendingTerminalFragment = pendingTerminalFragment;
      }
      const completeText = pendingTerminalFragment
        ? combined.slice(0, -pendingTerminalFragment.length)
        : combined;
      const text = sanitizeTerminalText(completeText);
      if (!text.trim()) {
        return;
      }
      if (session) {
        const urls = extractUrls(text);
        if (urls.length > 0 && !session.announcedUrl) {
          session.announcedUrl = true;
          session.awaitingUserInput = false;
          void input.onEvent?.({
            type: 'oauth_url',
            provider: input.provider,
            url: urls[0]!,
          }).catch((error) => {
            log.warn('OpenCode OAuth 事件发送失败', {
              provider: input.provider,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          return;
        } else if (!session.autoConfirmedPrompt && shouldAutoConfirmPrompt(text)) {
          session.autoConfirmedPrompt = true;
          session.awaitingUserInput = false;
          session.child.stdin.write('\n');
          void input.onEvent?.({
            type: 'auto_confirmed',
            provider: input.provider,
            prompt: text,
          }).catch((error) => {
            log.warn('OpenCode 自动确认事件发送失败', {
              provider: input.provider,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          return;
        } else if (!session.announcedUrl && needsChatInput(text) && !session.announcedInputFallback) {
          session.announcedInputFallback = true;
          session.awaitingUserInput = true;
          void input.onEvent?.({
            type: 'input_required',
            provider: input.provider,
            prompt: text,
          }).catch((error) => {
            log.warn('OpenCode 输入事件发送失败', {
              provider: input.provider,
              error: error instanceof Error ? error.message : String(error),
            });
          });
          return;
        }
      }
      if (!input.onOutput) {
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
        message: `登录流程启动失败：${error.message}`,
      });
    });
    child.on('close', (code) => {
      const session = this.sessions.get(input.key);
      this.sessions.delete(input.key);
      const authChanged = didAuthStateChange(input.cliHomeDir, session?.authFingerprintBefore);
      const normalizedOutput = code === 127
        ? '当前实例尚未安装 OpenCode，暂时无法使用该登录方式。'
        : undefined;
      void input.onExit({
        ok: code === 0 && authChanged,
        provider: input.provider,
        message: code === 0
          ? (authChanged
            ? `${toProviderLabel(input.provider)} 登录完成。`
            : `${toProviderLabel(input.provider)} 登录未完成，请完成浏览器授权后重试。`)
          : (normalizedOutput ?? `${toProviderLabel(input.provider)} 登录失败，请稍后重试。`),
      });
    });
  }

  async sendInput(key: string, text: string): Promise<boolean> {
    const session = this.sessions.get(key);
    if (!session || !session.awaitingUserInput) {
      return false;
    }
    session.awaitingUserInput = false;
    session.child.stdin.write(`${text}\n`);
    return true;
  }

  stop(key: string, reason?: string): boolean {
    const session = this.sessions.get(key);
    if (!session) {
      return false;
    }
    this.sessions.delete(key);
    terminateProcessGroup(session.child, 'SIGTERM');
    if (reason) {
      log.info('OpenCode 登录流程已终止', { key, provider: session.provider, reason });
    }
    return true;
  }
}

export function buildOpenCodeAuthSessionKey(channel: Channel, userId: string, agentId: string): string {
  return `${channel}:${userId}:${agentId}`;
}

export function buildOpenCodeAuthCommand(opencodeBin: string, provider: string): string {
  const method = resolveOpenCodeLoginMethod(provider);
  return `${shellEscape(opencodeBin)} auth login --provider ${shellEscape(provider)}${method ? ` --method ${shellEscape(method)}` : ''}`;
}

function sanitizeTerminalText(text: string): string {
  const stripped = stripAnsi(text)
    .replace(/\r/g, '\n')
    .replace(/\u0007/g, '')
    .replace(/\u001b\[\?2004[hl]/g, '')
    .replace(/\n{3,}/g, '\n\n');
  return stripped.trim();
}

function extractTrailingTerminalFragment(text: string): string {
  if (!text) {
    return '';
  }
  const escapeIndex = Math.max(text.lastIndexOf('\u001b'), text.lastIndexOf('\u009b'));
  if (escapeIndex < 0) {
    return '';
  }
  const fragment = text.slice(escapeIndex);
  return isIncompleteAnsiFragment(fragment) ? fragment : '';
}

function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(/https?:\/\/[^\s)<>"']+/g) ?? []));
}

function needsChatInput(text: string): boolean {
  return /(\?\s*$|enter\b|press\b|select\b|choose\b|continue\b|confirm\b|input\b|code\b)/im.test(text);
}

function shouldAutoConfirmPrompt(text: string): boolean {
  return /(press enter|press return|continue\b|confirm\b|open your browser|use your browser)/im.test(text)
    && !/(api key|api url|base url|one-time code|verification code|authenticator|paste|token|secret|password)/im.test(text);
}

function resolveOpenCodeLoginMethod(provider: string): string | undefined {
  if (provider === 'openai') {
    return 'ChatGPT Pro/Plus (browser)';
  }
  if (provider === 'anthropic') {
    return 'Claude Pro/Max';
  }
  return undefined;
}

function readAuthFingerprint(cliHomeDir: string): string | undefined {
  const authPath = path.join(path.resolve(cliHomeDir), '.local', 'share', 'opencode', 'auth.json');
  try {
    const stat = fs.statSync(authPath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return undefined;
  }
}

function didAuthStateChange(cliHomeDir: string, previous?: string): boolean {
  return readAuthFingerprint(cliHomeDir) !== previous;
}

function terminateProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (typeof child.pid === 'number' && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to direct child kill if the process group is already gone.
    }
  }
  child.kill(signal);
}

function toProviderLabel(provider: string): string {
  if (provider === 'opencode') {
    return 'OpenCode';
  }
  return provider.slice(0, 1).toUpperCase() + provider.slice(1);
}

function stripAnsi(text: string): string {
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function isIncompleteAnsiFragment(fragment: string): boolean {
  if (!fragment) {
    return false;
  }
  if (fragment === '\u001b') {
    return true;
  }
  if (fragment.startsWith('\u001b[')) {
    return !/^\u001b\[[0-?]*[ -/]*[@-~]/.test(fragment);
  }
  if (fragment.startsWith('\u009b')) {
    return !/^\u009b[0-?]*[ -/]*[@-~]/.test(fragment);
  }
  return false;
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
