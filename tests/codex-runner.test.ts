import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCodexArgs, buildCodexChildEnv, buildCodexReviewArgs, parseCodexJsonl, summarizeCodexItem } from '../src/services/codex-runner.js';
import { buildCodexSpawnSpec } from '../src/services/codex-bwrap.js';

describe('parseCodexJsonl', () => {
  it('parses thread id and latest agent message', () => {
    const raw = [
      JSON.stringify({ type: 'thread.started', thread_id: 't_123' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'second' } }),
    ].join('\n');

    const result = parseCodexJsonl(raw);
    expect(result.threadId).toBe('t_123');
    expect(result.answer).toBe('second');
  });

  it('ignores invalid lines and falls back when no answer', () => {
    const raw = '{not-json}\n' + JSON.stringify({ type: 'thread.started', thread_id: 't_456' });
    const result = parseCodexJsonl(raw);

    expect(result.threadId).toBe('t_456');
    expect(result.answer).toContain('未返回可解析内容');
  });
});

describe('summarizeCodexItem', () => {
  it('keeps key mcp tool call fields for logging', () => {
    expect(summarizeCodexItem({
      type: 'mcp_tool_call',
      server: 'tool_bridge',
      tool_name: 'navigate',
      arguments: { url: 'https://example.com' },
    })).toEqual({
      type: 'mcp_tool_call',
      server: 'tool_bridge',
      toolName: 'navigate',
      argumentsPreview: '{"url":"https://example.com"}',
    });
  });

  it('returns undefined for missing items', () => {
    expect(summarizeCodexItem(undefined)).toBeUndefined();
  });
});

describe('buildCodexArgs', () => {
  it('includes --model when model is provided', () => {
    const args = buildCodexArgs(
      { prompt: 'hello', model: 'gpt-5-codex', workdir: '/tmp/agent-a' },
      'full-auto',
    );
    expect(args).toEqual([
      '--cd',
      '/tmp/agent-a',
      'exec',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      '--model',
      'gpt-5-codex',
      'hello',
    ]);
  });

  it('builds resume args without --model when model is empty', () => {
    const args = buildCodexArgs(
      { prompt: 'hello', threadId: 'thread_123', workdir: '/tmp/agent-a' },
      'none',
    );
    expect(args).toEqual([
      '--cd',
      '/tmp/agent-a',
      'exec',
      'resume',
      'thread_123',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      'hello',
    ]);
  });

  it('puts --search before exec when enabled', () => {
    const args = buildCodexArgs(
      { prompt: 'hello', model: 'gpt-5.4', search: true, workdir: '/tmp/agent-b' },
      'full-auto',
    );
    expect(args).toEqual([
      '--search',
      '--cd',
      '/tmp/agent-b',
      'exec',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      '--model',
      'gpt-5.4',
      'hello',
    ]);
  });

  it('does not modify args when reminder skill context is provided', () => {
    const args = buildCodexArgs(
      {
        prompt: 'remind me later',
        workdir: '/tmp/agent-d',
        reminderToolContext: {
          dbPath: '/tmp/reminders.db',
          channel: 'wecom',
          userId: 'u1',
          agentId: 'assistant',
        },
      },
      'full-auto',
    );

    expect(args).toEqual([
      '--cd',
      '/tmp/agent-d',
      'exec',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      'remind me later',
    ]);
  });
});

describe('buildCodexReviewArgs', () => {
  it('builds uncommitted review args', () => {
    const args = buildCodexReviewArgs(
      { mode: 'uncommitted', model: 'gpt-5.4', search: true, workdir: '/tmp/agent-b' },
      'full-auto',
    );
    expect(args).toEqual([
      '--search',
      '--cd',
      '/tmp/agent-b',
      'exec',
      'review',
      '--json',
      '--full-auto',
      '--skip-git-repo-check',
      '--uncommitted',
      '--model',
      'gpt-5.4',
    ]);
  });

  it('builds base review args with prompt', () => {
    const args = buildCodexReviewArgs(
      { mode: 'base', target: 'main', prompt: 'focus on regressions', workdir: '/tmp/agent-c' },
      'none',
    );
    expect(args).toEqual([
      '--cd',
      '/tmp/agent-c',
      'exec',
      'review',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--base',
      'main',
      'focus on regressions',
    ]);
  });

});

describe('buildCodexChildEnv', () => {
  it('injects reminder and browser skill runtime env vars', () => {
    const env = buildCodexChildEnv(
      { PATH: '/usr/bin', HOME: '/root' },
      {
        reminderToolContext: {
          dbPath: '/tmp/reminders.db',
          channel: 'wecom',
          userId: 'u1',
          agentId: 'assistant',
        },
        browserAutomation: {
          apiBaseUrl: 'http://127.0.0.1:3000/internal/browser',
          internalApiToken: 'token-123',
        },
        gatewayRootDir: '/opt/gateway',
      },
    );

    expect(env.GATEWAY_REMINDER_DB_PATH).toBe('/tmp/reminders.db');
    expect(env.GATEWAY_REMINDER_CHANNEL).toBe('wecom');
    expect(env.GATEWAY_REMINDER_USER_ID).toBe('u1');
    expect(env.GATEWAY_REMINDER_AGENT_ID).toBe('assistant');
    expect(env.GATEWAY_BROWSER_API_BASE).toBe('http://127.0.0.1:3000/internal/browser');
    expect(env.GATEWAY_INTERNAL_API_TOKEN).toBe('token-123');
    expect(env.GATEWAY_ROOT_DIR).toBe('/opt/gateway');
  });
});

describe('buildCodexSpawnSpec', () => {
  it('keeps direct codex spawn when isolation is off', () => {
    const spec = buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['exec', '--json', 'hello'],
      cwd: '/tmp/agent-direct',
      env: { HOME: '/root', PATH: '/usr/bin' },
      isolationMode: 'off',
      codexHomeDir: '/tmp/instance-home',
    });

    expect(spec.command).toBe('/usr/bin/codex');
    expect(spec.args).toEqual(['exec', '--json', 'hello']);
    expect(spec.cwd).toBe('/tmp/agent-direct');
    expect(spec.env.HOME).toBe('/root');
    expect(spec.env.CODEX_HOME).toBe('/tmp/instance-home');
    expect(spec.env.XDG_CONFIG_HOME).toBeUndefined();
    expect(spec.env.XDG_CACHE_HOME).toBeUndefined();
  });

  it('wraps codex in bubblewrap and rewrites --cd to /workspace', () => {
    const workspaceDir = '/tmp/agent-bwrap';
    const spec = buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['--cd', workspaceDir, 'exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: {
        HOME: '/root',
        PATH: '/usr/bin:/bin',
        USER: 'root',
        LOGNAME: 'root',
      },
      isolationMode: 'bwrap',
      codexHomeDir: '/tmp/instance-home-bwrap',
    });

    expect(spec.command).toBe('bwrap');
    expect(spec.cwd).toBe(workspaceDir);
    expect(spec.args).toContain('/workspace');
    expect(spec.args).toContain('--bind');
    expect(spec.args).toContain('/workspace/.codex-runtime/home');
    expect(spec.env.HOME).toBe(`${workspaceDir}/.codex-runtime/home`);
    const cdIndex = spec.args.indexOf('--cd');
    expect(cdIndex).toBeGreaterThan(-1);
    expect(spec.args[cdIndex + 1]).toBe('/workspace');
  });

  it('preserves nested workdir paths inside the mounted workspace', () => {
    const workspaceDir = '/tmp/agent-bwrap-nested';
    const nestedDir = '/tmp/agent-bwrap-nested/sub/task';
    fs.mkdirSync(nestedDir, { recursive: true });

    const spec = buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['--cd', nestedDir, 'exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: { HOME: '/root', PATH: '/usr/bin:/bin' },
      isolationMode: 'bwrap',
      codexHomeDir: '/tmp/instance-home-bwrap-nested',
    });

    const cdIndex = spec.args.indexOf('--cd');
    expect(cdIndex).toBeGreaterThan(-1);
    expect(spec.args[cdIndex + 1]).toBe('/workspace/sub/task');
  });

  it('syncs instance codex auth into workspace runtime home for bwrap runs', () => {
    const instanceHome = '/tmp/instance-home-sync';
    const workspaceDir = '/tmp/agent-bwrap-sync';
    const authFile = `${instanceHome}/auth.json`;
    const configFile = `${instanceHome}/config.toml`;
    const runtimeAuthFile = `${workspaceDir}/.codex-runtime/home/auth.json`;
    const runtimeConfigFile = `${workspaceDir}/.codex-runtime/home/config.toml`;

    fs.mkdirSync(instanceHome, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(authFile, '{"token":"abc"}');
    fs.writeFileSync(configFile, 'model = "gpt-5"');

    buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: { HOME: '/root', PATH: '/usr/bin:/bin' },
      isolationMode: 'bwrap',
      codexHomeDir: instanceHome,
    });

    expect(fs.readFileSync(runtimeAuthFile, 'utf8')).toBe('{"token":"abc"}');
    expect(fs.readFileSync(runtimeConfigFile, 'utf8')).toBe('model = "gpt-5"');
  });

  it('propagates FEISHU env vars into isolated runs', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bwrap-feishu-env-'));
    const hostHome = path.join(tempRoot, 'host-home');
    const instanceHome = path.join(tempRoot, 'instance-home');
    const workspaceDir = path.join(tempRoot, 'workspace');

    fs.mkdirSync(hostHome, { recursive: true });
    fs.mkdirSync(instanceHome, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    const spec = buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: {
        HOME: hostHome,
        PATH: '/usr/bin:/bin',
        FEISHU_ENABLED: 'true',
        FEISHU_APP_ID: 'cli_test',
        FEISHU_APP_SECRET: 'sec_test',
        FEISHU_DOC_BASE_URL: 'https://example.feishu.cn/docx',
      },
      isolationMode: 'bwrap',
      codexHomeDir: instanceHome,
    });

    expect(spec.env.FEISHU_ENABLED).toBe('true');
    expect(spec.env.FEISHU_APP_ID).toBe('cli_test');
    expect(spec.env.FEISHU_APP_SECRET).toBe('sec_test');
    expect(spec.env.FEISHU_DOC_BASE_URL).toBe('https://example.feishu.cn/docx');
  });

  it('propagates GATEWAY env vars into isolated runs', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bwrap-gateway-env-'));
    const hostHome = path.join(tempRoot, 'host-home');
    const instanceHome = path.join(tempRoot, 'instance-home');
    const workspaceDir = path.join(tempRoot, 'workspace');

    fs.mkdirSync(hostHome, { recursive: true });
    fs.mkdirSync(instanceHome, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });

    const spec = buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: {
        HOME: hostHome,
        PATH: '/usr/bin:/bin',
        GATEWAY_BROWSER_API_BASE: 'http://127.0.0.1:3000/internal/browser',
        GATEWAY_INTERNAL_API_TOKEN: 'token-123',
        GATEWAY_REMINDER_DB_PATH: '/tmp/reminders.db',
      },
      isolationMode: 'bwrap',
      codexHomeDir: instanceHome,
    });

    expect(spec.env.GATEWAY_BROWSER_API_BASE).toBe('http://127.0.0.1:3000/internal/browser');
    expect(spec.env.GATEWAY_INTERNAL_API_TOKEN).toBe('token-123');
    expect(spec.env.GATEWAY_REMINDER_DB_PATH).toBe('/tmp/reminders.db');
  });

  it('bridges host git and ssh config into isolated runtime home', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bwrap-host-home-'));
    const hostHome = path.join(tempRoot, 'host-home');
    const instanceHome = path.join(tempRoot, 'instance-home');
    const workspaceDir = path.join(tempRoot, 'workspace');

    fs.mkdirSync(path.join(hostHome, '.ssh'), { recursive: true });
    fs.mkdirSync(instanceHome, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(hostHome, '.gitconfig'), '[safe]\n\tdirectory = /repo\n', 'utf8');
    fs.writeFileSync(path.join(hostHome, '.ssh', 'codex-gateway-deploy'), 'PRIVATE KEY\n', 'utf8');
    fs.writeFileSync(path.join(hostHome, '.ssh', 'config'), 'Host github\n  HostName github.com\n  IdentityFile ~/.ssh/codex-gateway-deploy\n', 'utf8');
    fs.writeFileSync(path.join(hostHome, '.ssh', 'known_hosts'), 'github.com ssh-ed25519 AAAA\n', 'utf8');

    const spec = buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: {
        HOME: hostHome,
        PATH: '/usr/bin:/bin',
      },
      isolationMode: 'bwrap',
      codexHomeDir: instanceHome,
    });

    expect(spec.args).toContain(path.join(hostHome, '.gitconfig'));
    expect(spec.args).toContain('/workspace/.codex-runtime/home/.gitconfig');
    expect(spec.args).toContain(path.join(hostHome, '.ssh', 'config'));
    expect(spec.args).toContain('/workspace/.codex-runtime/home/.ssh/config');
    expect(spec.args).toContain(path.join(hostHome, '.ssh', 'known_hosts'));
    expect(spec.args).toContain('/workspace/.codex-runtime/home/.ssh/known_hosts');
    expect(spec.args).toContain(path.join(hostHome, '.ssh', 'codex-gateway-deploy'));
    expect(spec.args).toContain('/workspace/.codex-runtime/home/.ssh/codex-gateway-deploy');
  });

  it('bridges extra home-relative config paths into isolated runtime home', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bwrap-extra-read-'));
    const hostHome = path.join(tempRoot, 'host-home');
    const workspaceDir = path.join(tempRoot, 'workspace');
    const instanceHome = path.join(tempRoot, 'instance-home');
    const vpnDir = path.join(hostHome, '.config', 'mihomo');

    fs.mkdirSync(vpnDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(instanceHome, { recursive: true });
    fs.writeFileSync(path.join(vpnDir, 'config.yaml'), 'mixed-port: 7890\n', 'utf8');

    const spec = buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: {
        HOME: hostHome,
        PATH: '/usr/bin:/bin',
        CODEX_WORKDIR_ISOLATION_EXTRA_READS: '~/.config/mihomo',
      },
      isolationMode: 'bwrap',
      codexHomeDir: instanceHome,
    });

    expect(spec.args).toContain(vpnDir);
    expect(spec.args).toContain('/workspace/.codex-runtime/home/.config/mihomo');
  });

  it('removes stale runtime auth files when instance codex home no longer has them', () => {
    const instanceHome = '/tmp/instance-home-prune';
    const workspaceDir = '/tmp/agent-bwrap-prune';
    const runtimeAuthFile = `${workspaceDir}/.codex-runtime/home/auth.json`;

    fs.mkdirSync(instanceHome, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(instanceHome, 'auth.json'), '{"token":"abc"}');

    buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: { HOME: '/root', PATH: '/usr/bin:/bin' },
      isolationMode: 'bwrap',
      codexHomeDir: instanceHome,
    });
    expect(fs.existsSync(runtimeAuthFile)).toBe(true);

    fs.rmSync(path.join(instanceHome, 'auth.json'), { force: true });
    buildCodexSpawnSpec({
      codexBin: '/usr/bin/codex',
      args: ['exec', '--json', 'hello'],
      cwd: workspaceDir,
      env: { HOME: '/root', PATH: '/usr/bin:/bin' },
      isolationMode: 'bwrap',
      codexHomeDir: instanceHome,
    });

    expect(fs.existsSync(runtimeAuthFile)).toBe(false);
  });
});
