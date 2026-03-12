import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../src/services/cli-provider.js', () => ({
  isExecutableAvailable: vi.fn(() => true),
}));

import { spawn } from 'node:child_process';
import { OpenCodeAuthFlowManager, buildOpenCodeAuthCommand } from '../src/services/opencode-auth-flow.js';

function createMockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn();
  return child;
}

async function flushStreamEvents(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('buildOpenCodeAuthCommand', () => {
  it('passes provider with the explicit --provider flag', () => {
    expect(buildOpenCodeAuthCommand('/root/.opencode/bin/opencode', 'openai')).toBe(
      "/root/.opencode/bin/opencode auth login --provider openai --method 'ChatGPT Pro/Plus (browser)'",
    );
  });

  it('does not force a login method for providers without a pinned browser label', () => {
    expect(buildOpenCodeAuthCommand('/root/.opencode/bin/opencode', 'anthropic')).toBe(
      "/root/.opencode/bin/opencode auth login --provider anthropic --method 'Claude Pro/Max'",
    );
  });

  it('does not force a login method for api-key-only providers', () => {
    expect(buildOpenCodeAuthCommand('/root/.opencode/bin/opencode', 'openrouter')).toBe(
      '/root/.opencode/bin/opencode auth login --provider openrouter',
    );
  });
});

describe('OpenCodeAuthFlowManager', () => {
  it('buffers split ansi escape prefixes until the sequence is complete', async () => {
    const child = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const onOutput = vi.fn(async () => undefined);
    const onExit = vi.fn(async () => undefined);
    const manager = new OpenCodeAuthFlowManager();

    await manager.start({
      key: 'feishu:user:agent',
      provider: 'openai',
      opencodeBin: '/usr/local/bin/opencode',
      cliHomeDir: '/tmp/opencode-home',
      cwd: '/tmp/workspace',
      baseEnv: {},
      onOutput,
      onExit,
    });

    child.stdout.write('\u001b[');
    await flushStreamEvents();
    expect(onOutput).not.toHaveBeenCalled();

    child.stdout.write('90m│\u001b[39m \u001b[36m◆\u001b[39m Login method');
    await flushStreamEvents();

    expect(onOutput).toHaveBeenCalledTimes(1);
    expect(onOutput).toHaveBeenLastCalledWith('│ ◆ Login method');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('emits an oauth url event instead of guidance text', async () => {
    const child = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const onOutput = vi.fn(async () => undefined);
    const onExit = vi.fn(async () => undefined);
    const onEvent = vi.fn(async () => undefined);
    const manager = new OpenCodeAuthFlowManager();

    await manager.start({
      key: 'feishu:user:agent',
      provider: 'openai',
      opencodeBin: '/usr/local/bin/opencode',
      cliHomeDir: '/tmp/opencode-home',
      cwd: '/tmp/workspace',
      baseEnv: {},
      onOutput,
      onEvent,
      onExit,
    });

    child.stdout.write('Open this URL to continue: https://auth.example.com/oauth/start');
    await flushStreamEvents();

    expect(onEvent).toHaveBeenCalledWith({
      type: 'oauth_url',
      provider: 'openai',
      url: 'https://auth.example.com/oauth/start',
    });
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('auto-confirms safe prompts without asking the user to reply in chat', async () => {
    const child = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const stdinWrites: string[] = [];
    child.stdin.on('data', (chunk) => {
      stdinWrites.push(chunk.toString('utf8'));
    });
    const onOutput = vi.fn(async () => undefined);
    const onExit = vi.fn(async () => undefined);
    const onEvent = vi.fn(async () => undefined);
    const manager = new OpenCodeAuthFlowManager();

    await manager.start({
      key: 'feishu:user:agent',
      provider: 'openai',
      opencodeBin: '/usr/local/bin/opencode',
      cliHomeDir: '/tmp/opencode-home',
      cwd: '/tmp/workspace',
      baseEnv: {},
      onOutput,
      onEvent,
      onExit,
    });

    child.stdout.write('Login method\nPress Enter to open your browser');
    await flushStreamEvents();

    expect(stdinWrites).toEqual(['\n']);
    expect(onEvent).toHaveBeenCalledWith({
      type: 'auto_confirmed',
      provider: 'openai',
      prompt: 'Login method\nPress Enter to open your browser',
    });
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('emits a fallback input event when the prompt requires real user input', async () => {
    const child = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(child as never);
    const onOutput = vi.fn(async () => undefined);
    const onExit = vi.fn(async () => undefined);
    const onEvent = vi.fn(async () => undefined);
    const manager = new OpenCodeAuthFlowManager();

    await manager.start({
      key: 'feishu:user:agent',
      provider: 'openai',
      opencodeBin: '/usr/local/bin/opencode',
      cliHomeDir: '/tmp/opencode-home',
      cwd: '/tmp/workspace',
      baseEnv: {},
      onOutput,
      onEvent,
      onExit,
    });

    child.stdout.write('Enter the one-time code from your authenticator app');
    await flushStreamEvents();

    expect(onEvent).toHaveBeenCalledWith({
      type: 'input_required',
      provider: 'openai',
      prompt: 'Enter the one-time code from your authenticator app',
    });
    expect(onOutput).not.toHaveBeenCalled();
  });
});
