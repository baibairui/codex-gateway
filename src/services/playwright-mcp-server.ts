import fs from 'node:fs';
import net from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createLogger } from '../utils/logger.js';

const log = createLogger('PlaywrightMcpServer');
const STARTUP_TIMEOUT_MS = 15_000;
const CONNECT_RETRY_MS = 100;
const STARTUP_BANNER_PREFIX = 'Listening on http';
const STARTUP_BANNER_CONFIG_MARKER = 'Put this in your client config:';
const STARTUP_BANNER_END_MARKER =
  'For legacy SSE transport support, you can use the /sse endpoint instead.';

export interface PlaywrightMcpRuntime {
  url: string;
  port: number;
  profileDir: string;
  outputDir: string;
  shouldAutoStart: boolean;
}

export interface ResolvePlaywrightMcpRuntimeInput {
  enabled: boolean;
  url?: string;
  port: number;
  profileDir: string;
  outputDir: string;
}

export interface PlaywrightMcpStderrClassification {
  level: 'warn';
  text: string;
}

export function resolvePlaywrightMcpRuntime(
  input: ResolvePlaywrightMcpRuntimeInput,
): PlaywrightMcpRuntime | undefined {
  if (!input.enabled) {
    return undefined;
  }

  const url = input.url?.trim() || `http://localhost:${input.port}/mcp`;
  return {
    url,
    port: input.port,
    profileDir: input.profileDir,
    outputDir: input.outputDir,
    shouldAutoStart: !input.url?.trim(),
  };
}

export function buildLocalPlaywrightMcpArgs(input: {
  port: number;
  profileDir: string;
  outputDir: string;
}): string[] {
  return [
    resolvePlaywrightMcpCliPath(),
    '--host',
    '127.0.0.1',
    '--port',
    String(input.port),
    '--save-session',
    '--user-data-dir',
    input.profileDir,
    '--output-dir',
    input.outputDir,
  ];
}

export async function startPlaywrightMcpServer(
  runtime: PlaywrightMcpRuntime | undefined,
): Promise<void> {
  if (!runtime?.shouldAutoStart) {
    return;
  }

  fs.mkdirSync(runtime.profileDir, { recursive: true });
  fs.mkdirSync(runtime.outputDir, { recursive: true });

  const args = buildLocalPlaywrightMcpArgs(runtime);
  const proc = spawn('node', args, {
    cwd: process.cwd(),
    env: process.env,
  });

  log.info('Playwright MCP 常驻服务启动中', {
    pid: proc.pid,
    url: runtime.url,
    profileDir: runtime.profileDir,
    outputDir: runtime.outputDir,
    command: `node ${args.join(' ')}`,
  });

  let stderrBuffer = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    log.debug('Playwright MCP stdout', { text: chunk.toString('utf8').substring(0, 300) });
  });
  proc.stderr.on('data', (chunk: Buffer) => {
    const drained = drainPlaywrightMcpStderrBuffer(`${stderrBuffer}${chunk.toString('utf8')}`);
    stderrBuffer = drained.remaining;
    if (drained.entry) {
      log.warn('Playwright MCP stderr', { text: drained.entry.text.substring(0, 300) });
    }
  });
  proc.on('exit', (code, signal) => {
    const drained = drainPlaywrightMcpStderrBuffer(stderrBuffer, true);
    stderrBuffer = drained.remaining;
    if (drained.entry) {
      log.warn('Playwright MCP stderr', { text: drained.entry.text.substring(0, 300) });
    }
    log.warn('Playwright MCP 进程退出', { code, signal });
  });

  registerCleanup(proc);
  await waitForPortReady(runtime.port, proc);

  log.info('Playwright MCP 常驻服务已就绪', {
    pid: proc.pid,
    url: runtime.url,
  });
}

export function classifyPlaywrightMcpStderrText(
  rawText: string,
): PlaywrightMcpStderrClassification | undefined {
  const text = rawText.trim();
  if (!text || isStartupBanner(text)) {
    return undefined;
  }
  return {
    level: 'warn',
    text,
  };
}

export function drainPlaywrightMcpStderrBuffer(
  buffer: string,
  flushAll = false,
): {
  remaining: string;
  entry?: PlaywrightMcpStderrClassification;
} {
  const text = buffer.trim();
  if (!text) {
    return { remaining: '' };
  }
  if (!flushAll && shouldWaitForMoreStderr(buffer, text)) {
    return { remaining: buffer };
  }
  return {
    remaining: '',
    entry: classifyPlaywrightMcpStderrText(buffer),
  };
}

function resolvePlaywrightMcpCliPath(): string {
  return fileURLToPath(new URL('../../node_modules/@playwright/mcp/cli.js', import.meta.url));
}

function registerCleanup(proc: ChildProcessWithoutNullStreams): void {
  const cleanup = () => {
    if (!proc.killed && proc.exitCode === null) {
      proc.kill('SIGTERM');
    }
  };
  process.once('exit', cleanup);
}

async function waitForPortReady(
  port: number,
  proc: ChildProcessWithoutNullStreams,
  timeoutMs = STARTUP_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`playwright mcp exited before ready with code ${proc.exitCode}`);
    }
    if (proc.signalCode !== null) {
      throw new Error(`playwright mcp exited before ready with signal ${proc.signalCode}`);
    }
    if (await canConnect(port)) {
      return;
    }
    await delay(CONNECT_RETRY_MS);
  }

  throw new Error(`playwright mcp did not become ready within ${timeoutMs}ms`);
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(CONNECT_RETRY_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isStartupBanner(text: string): boolean {
  return (
    text.startsWith(STARTUP_BANNER_PREFIX) &&
    text.includes(STARTUP_BANNER_CONFIG_MARKER) &&
    text.includes(STARTUP_BANNER_END_MARKER) &&
    text.includes('/mcp')
  );
}

function shouldWaitForMoreStderr(buffer: string, text: string): boolean {
  if (text.startsWith(STARTUP_BANNER_PREFIX) && !text.includes(STARTUP_BANNER_END_MARKER)) {
    return true;
  }
  return !buffer.includes('\n');
}
