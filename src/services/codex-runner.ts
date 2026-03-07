import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CodexRunner');

export interface CodexRunInput {
  prompt: string;
  threadId?: string;
  model?: string;
  search?: boolean;
  workdir?: string;
  reminderToolContext?: {
    dbPath: string;
    channel: 'wecom' | 'feishu';
    userId: string;
    agentId: string;
  };
  /** 每产出一条 agent_message 就回调一次 */
  onMessage?: (text: string) => void;
}

export interface CodexRunResult {
  threadId: string;
  rawOutput: string;
}

export interface CodexReviewInput {
  mode: 'uncommitted' | 'base' | 'commit';
  target?: string;
  prompt?: string;
  model?: string;
  search?: boolean;
  workdir?: string;
  onMessage?: (text: string) => void;
}

export interface CodexLoginInput {
  onMessage?: (text: string) => void;
}

export interface ParsedCodexOutput {
  threadId?: string;
  answer: string;
}

interface CodexRunnerOptions {
  codexBin?: string;
  workdir?: string;
  timeoutMs?: number;
  timeoutMinMs?: number;
  timeoutMaxMs?: number;
  timeoutPerCharMs?: number;
  playwrightMcpSessionDir?: string;
  /** 'full-auto' (沙箱) 或 'none' (无沙箱) */
  sandbox?: 'full-auto' | 'none';
}

const DEFAULT_TIMEOUT_MIN_MS = 180_000;
const DEFAULT_TIMEOUT_MAX_MS = 900_000;
const DEFAULT_TIMEOUT_PER_CHAR_MS = 80;

export function parseCodexJsonl(raw: string): ParsedCodexOutput {
  let threadId: string | undefined;
  let answer = '';

  for (const event of iterateCodexEvents(raw)) {
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id;
    }

    if (event.type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        answer = item.text;
      }
    }
  }

  return {
    threadId,
    answer: answer || '（Codex 未返回可解析内容）',
  };
}

function* iterateCodexEvents(raw: string): Generator<Record<string, unknown>> {
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      yield JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
}

export class CodexRunner {
  private readonly codexBin: string;
  private readonly workdir: string;
  private readonly timeoutMs?: number;
  private readonly timeoutMinMs: number;
  private readonly timeoutMaxMs: number;
  private readonly timeoutPerCharMs: number;
  private readonly playwrightMcpSessionDir?: string;
  private readonly sandbox: 'full-auto' | 'none';

  constructor(options: CodexRunnerOptions = {}) {
    this.codexBin = options.codexBin ?? 'codex';
    this.workdir = options.workdir ?? process.cwd();
    this.timeoutMs = options.timeoutMs;
    this.timeoutMinMs = options.timeoutMinMs ?? DEFAULT_TIMEOUT_MIN_MS;
    this.timeoutMaxMs = options.timeoutMaxMs ?? DEFAULT_TIMEOUT_MAX_MS;
    this.timeoutPerCharMs = options.timeoutPerCharMs ?? DEFAULT_TIMEOUT_PER_CHAR_MS;
    this.playwrightMcpSessionDir = options.playwrightMcpSessionDir?.trim() || undefined;
    this.sandbox = options.sandbox ?? 'full-auto';
    log.debug('CodexRunner 构造完成', {
      codexBin: this.codexBin,
      workdir: this.workdir,
      timeoutMs: this.timeoutMs ?? '(adaptive)',
      timeoutMinMs: this.timeoutMinMs,
      timeoutMaxMs: this.timeoutMaxMs,
      timeoutPerCharMs: this.timeoutPerCharMs,
      playwrightMcpSessionDir: this.playwrightMcpSessionDir ?? '(disabled)',
      sandbox: this.sandbox,
    });
  }

  run(input: CodexRunInput): Promise<CodexRunResult> {
    const args = buildCodexArgs(input, this.sandbox, this.playwrightMcpSessionDir);
    return this.runJsonl({
      args,
      prompt: input.prompt,
      workdir: input.workdir,
      onMessage: input.onMessage,
      initialThreadId: input.threadId,
      requireThreadId: true,
      logMeta: {
        mode: 'exec',
        isResume: !!input.threadId,
        threadId: maskThreadId(input.threadId),
      },
    }).then((result) => {
      if (!result.threadId) {
        throw new Error('thread id not found in codex output');
      }
      return {
        threadId: result.threadId,
        rawOutput: result.rawOutput,
      };
    });
  }

  review(input: CodexReviewInput): Promise<{ rawOutput: string }> {
    const args = buildCodexReviewArgs(input, this.sandbox, this.playwrightMcpSessionDir);
    const timeoutHint = input.prompt ?? input.target ?? input.mode;
    return this.runJsonl({
      args,
      prompt: timeoutHint,
      workdir: input.workdir,
      onMessage: input.onMessage,
      requireThreadId: false,
      logMeta: {
        mode: 'review',
        reviewMode: input.mode,
        reviewTarget: input.target ?? '(none)',
      },
    }).then((result) => ({ rawOutput: result.rawOutput }));
  }

  login(input: CodexLoginInput): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['login', '--device-auth'];
      log.info('Codex 登录进程启动', { bin: this.codexBin, args });

      const child = spawn(this.codexBin, args, {
        cwd: this.workdir,
        env: process.env,
      });

      // 登录阶段最长等待 15 分钟
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('codex login timeout after 15 minutes'));
      }, 15 * 60 * 1000);

      let stdoutBuf = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdoutBuf += text;
        const sendText = stripAnsi(text).trim();
        if (sendText && input.onMessage) {
          input.onMessage(sendText);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        log.warn('Codex login stderr', { text: chunk.toString('utf8').substring(0, 500) });
      });

      child.on('error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`codex login exited with code ${code}`));
          return;
        }
        resolve();
      });
    });
  }

  private runJsonl(options: {
    args: string[];
    prompt: string;
    workdir?: string;
    onMessage?: (text: string) => void;
    initialThreadId?: string;
    requireThreadId: boolean;
    logMeta?: Record<string, unknown>;
  }): Promise<{ rawOutput: string; threadId?: string }> {
    log.info('Codex 子进程启动', {
      bin: this.codexBin,
      args: redactArgsForLog(options.args),
      cwd: options.workdir ?? this.workdir,
      timeoutMode: this.timeoutMs ? 'fixed' : 'adaptive',
      ...options.logMeta,
    });

    const effectiveTimeoutMs = this.resolveTimeoutMs(options.prompt);
    log.debug('Codex 子进程超时阈值已计算', {
      promptLength: options.prompt.length,
      effectiveTimeoutMs,
    });

    return new Promise<{ rawOutput: string; threadId?: string }>((resolve, reject) => {
      const child = spawn(this.codexBin, options.args, {
        cwd: options.workdir ?? this.workdir,
        env: process.env,
      });

      log.debug('Codex 子进程已 spawn', { pid: child.pid });

      let stdout = '';
      let stderr = '';
      let settled = false;
      let lineBuf = '';
      let eventCount = 0;
      let observedThreadId = options.initialThreadId;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGKILL');
        log.error('Codex 子进程超时，已 SIGKILL', {
          pid: child.pid,
          timeoutMs: effectiveTimeoutMs,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          eventCount,
        });
        reject(new Error(`codex timeout after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stdout += text;

        lineBuf += text;
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          handleCodexLine(
            line,
            options.onMessage,
            () => {
              eventCount++;
            },
            (threadId) => {
              observedThreadId = threadId;
            },
          );
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stderr += text;
        log.warn('Codex stderr 输出', { text: text.substring(0, 500) });
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        log.error('Codex 子进程 error 事件', error);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        log.info('Codex 子进程退出', {
          pid: child.pid,
          exitCode: code,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          eventCount,
        });

        if (code !== 0) {
          log.error('Codex 子进程异常退出', {
            exitCode: code,
            stderr: stderr.substring(0, 500),
            stdout: stdout.substring(0, 200),
          });
          reject(new Error(`codex exited with code ${code}: ${stderr || stdout}`));
          return;
        }

        const tail = lineBuf.trim();
        if (tail) {
          handleCodexLine(
            tail,
            options.onMessage,
            () => {
              eventCount++;
            },
            (threadId) => {
              observedThreadId = threadId;
            },
          );
        }

        let threadId = observedThreadId;
        if (!threadId) {
          threadId = parseCodexJsonl(stdout).threadId;
        }
        if (options.requireThreadId && !threadId) {
          log.error('Codex 输出中未找到 threadId', {
            stdoutPreview: stdout.substring(0, 500),
          });
          reject(new Error('thread id not found in codex output'));
          return;
        }

        log.info('Codex 执行成功', {
          threadId,
          rawOutputLength: stdout.length,
        });

        resolve({
          threadId,
          rawOutput: stdout,
        });
      });
    });
  }

  private resolveTimeoutMs(prompt: string): number {
    if (typeof this.timeoutMs === 'number' && Number.isFinite(this.timeoutMs) && this.timeoutMs > 0) {
      return this.timeoutMs;
    }
    const min = Math.max(1, this.timeoutMinMs);
    const max = Math.max(min, this.timeoutMaxMs);
    const byPrompt = min + Math.max(0, prompt.length) * Math.max(0, this.timeoutPerCharMs);
    return Math.min(max, byPrompt);
  }
}

export function buildCodexArgs(
  input: Pick<CodexRunInput, 'prompt' | 'threadId' | 'model' | 'search' | 'workdir' | 'reminderToolContext'>,
  sandbox: 'full-auto' | 'none',
  playwrightMcpSessionDir?: string,
): string[] {
  const sandboxFlag = sandbox === 'none'
    ? '--dangerously-bypass-approvals-and-sandbox'
    : '--full-auto';

  const args: string[] = input.threadId
    ? ['exec', 'resume', input.threadId, '--json', sandboxFlag, '--skip-git-repo-check']
    : ['exec', '--json', sandboxFlag, '--skip-git-repo-check'];

  if (input.model) {
    args.push('--model', input.model);
  }
  if (input.workdir?.trim()) {
    args.unshift(input.workdir.trim());
    args.unshift('--cd');
  }
  if (input.search) {
    args.unshift('--search');
  }
  if (input.reminderToolContext) {
    args.unshift(...buildReminderMcpConfigArgs(input.reminderToolContext));
  }
  if (playwrightMcpSessionDir?.trim()) {
    args.unshift(...buildPlaywrightMcpConfigArgs(playwrightMcpSessionDir.trim()));
  }
  args.push(input.prompt);
  return args;
}

export function buildCodexReviewArgs(
  input: Pick<CodexReviewInput, 'mode' | 'target' | 'prompt' | 'model' | 'search' | 'workdir'>,
  sandbox: 'full-auto' | 'none',
  playwrightMcpSessionDir?: string,
): string[] {
  const sandboxFlag = sandbox === 'none'
    ? '--dangerously-bypass-approvals-and-sandbox'
    : '--full-auto';

  const args: string[] = ['exec', 'review', '--json', sandboxFlag, '--skip-git-repo-check'];
  if (input.mode === 'uncommitted') {
    args.push('--uncommitted');
  } else if (input.mode === 'base' && input.target) {
    args.push('--base', input.target);
  } else if (input.mode === 'commit' && input.target) {
    args.push('--commit', input.target);
  }
  if (input.model) {
    args.push('--model', input.model);
  }
  if (input.workdir?.trim()) {
    args.unshift(input.workdir.trim());
    args.unshift('--cd');
  }
  if (input.search) {
    args.unshift('--search');
  }
  if (playwrightMcpSessionDir?.trim()) {
    args.unshift(...buildPlaywrightMcpConfigArgs(playwrightMcpSessionDir.trim()));
  }
  if (input.prompt) {
    args.push(input.prompt);
  }
  return args;
}

function buildPlaywrightMcpConfigArgs(playwrightMcpSessionDir: string): string[] {
  const cliPath = resolvePlaywrightMcpCliPath();
  return [
    '-c',
    'mcp_servers.playwright.command="node"',
    '-c',
    `mcp_servers.playwright.args=${tomlStringArray([
      cliPath,
      '--save-session',
      '--user-data-dir',
      playwrightMcpSessionDir,
      '--output-dir',
      playwrightMcpSessionDir,
    ])}`,
  ];
}

function resolvePlaywrightMcpCliPath(): string {
  return path.resolve(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js');
}

function buildReminderMcpConfigArgs(context: NonNullable<CodexRunInput['reminderToolContext']>): string[] {
  const serverPath = resolveReminderMcpServerPath();
  return [
    '-c',
    'mcp_servers.gateway_reminder.command="node"',
    '-c',
    `mcp_servers.gateway_reminder.args=${tomlStringArray([serverPath])}`,
    '-c',
    `mcp_servers.gateway_reminder.env.REMINDER_DB_PATH=${tomlString(context.dbPath)}`,
    '-c',
    `mcp_servers.gateway_reminder.env.REMINDER_CHANNEL=${tomlString(context.channel)}`,
    '-c',
    `mcp_servers.gateway_reminder.env.REMINDER_USER_ID=${tomlString(context.userId)}`,
    '-c',
    `mcp_servers.gateway_reminder.env.REMINDER_AGENT_ID=${tomlString(context.agentId)}`,
  ];
}

function resolveReminderMcpServerPath(): string {
  return fileURLToPath(new URL('../../bin/reminder-mcp-server.mjs', import.meta.url));
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => tomlString(value)).join(',')}]`;
}

function redactArgsForLog(args: string[]): string[] {
  if (args.length === 0) {
    return [];
  }
  const output = [...args];
  output[output.length - 1] = '<prompt omitted>';
  for (let i = 0; i < output.length; i++) {
    if (output[i] === 'resume' && i + 1 < output.length) {
      output[i + 1] = maskThreadId(output[i + 1]);
    }
  }
  return output;
}

function maskThreadId(threadId?: string): string {
  if (!threadId) {
    return '(新)';
  }
  if (threadId.length <= 8) {
    return '****';
  }
  return `${threadId.slice(0, 4)}...${threadId.slice(-4)}`;
}

function handleCodexLine(
  line: string,
  onMessage: CodexRunInput['onMessage'],
  onEvent: () => void,
  onThreadStarted?: (threadId: string) => void,
): void {
  try {
    const event = JSON.parse(line) as Record<string, unknown>;
    onEvent();
    log.debug('Codex 事件', {
      type: event.type,
      itemType: (event.item as Record<string, unknown> | undefined)?.type,
    });

    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      onThreadStarted?.(event.thread_id);
      log.info('Codex thread.started', { threadId: event.thread_id });
    }

    if (event.type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type === 'agent_message' && typeof item.text === 'string' && onMessage) {
        log.info('Codex item.completed agent_message', {
          textLength: item.text.length,
          textPreview: item.text.substring(0, 200),
        });
        onMessage(item.text);
      }
    }
  } catch {
    log.debug('Codex stdout 非 JSON 行', { line: line.substring(0, 100) });
  }
}

/** 移除终端输出中的 ANSI 控制（颜色）字符 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}
