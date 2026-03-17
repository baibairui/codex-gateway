import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  readCliHomeDefaultModel,
  resolveCodexBin,
  resolveOpenCodeBin,
  resolveCliProvider,
  writeCliApiLoginConfig,
} from '../src/services/cli-provider.js';

describe('resolveCliProvider', () => {
  it('prefers explicit provider env', () => {
    expect(resolveCliProvider('opencode', 'codex')).toBe('opencode');
  });

  it('infers opencode from bin name', () => {
    expect(resolveCliProvider(undefined, '/usr/local/bin/opencode')).toBe('opencode');
  });
});

describe('resolveOpenCodeBin', () => {
  it('prefers the official opencode install path under the user home', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-bin-home-'));
    const opencodeBin = path.join(homeDir, '.opencode', 'bin', 'opencode');
    fs.mkdirSync(path.dirname(opencodeBin), { recursive: true });
    fs.writeFileSync(opencodeBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    expect(resolveOpenCodeBin(undefined, homeDir)).toBe(opencodeBin);
  });
});

describe('resolveCodexBin', () => {
  it('falls back to the newest nvm-installed codex binary when PATH does not include it', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bin-home-'));
    const olderBin = path.join(homeDir, '.nvm', 'versions', 'node', 'v20.19.0', 'bin', 'codex');
    const newerBin = path.join(homeDir, '.nvm', 'versions', 'node', 'v22.16.0', 'bin', 'codex');

    fs.mkdirSync(path.dirname(olderBin), { recursive: true });
    fs.mkdirSync(path.dirname(newerBin), { recursive: true });
    fs.writeFileSync(olderBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(newerBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    expect(resolveCodexBin('codex', '/usr/bin:/bin', homeDir)).toBe(newerBin);
  });
});

describe('writeCliApiLoginConfig', () => {
  it('writes opencode config into XDG-style home layout', async () => {
    const cliHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-home-'));
    const result = await writeCliApiLoginConfig({
      provider: 'opencode',
      cliHomeDir,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-opencode-secret',
      model: 'gpt-5',
    });

    const configPath = path.join(cliHomeDir, '.config', 'opencode', 'opencode.json');
    const configText = fs.readFileSync(configPath, 'utf8');
    expect(result.configPath).toBe(configPath);
    expect(configText).toContain('"baseURL": "https://api.openai.com/v1"');
    expect(configText).toContain('"model": "gateway/gpt-5"');
    expect(configText).toContain('"models": {');
    expect(configText).toContain('"gpt-5": {}');
    expect(readCliHomeDefaultModel('opencode', cliHomeDir)).toBe('gateway/gpt-5');
  });

  it('writes opencode reasoning effort into model options when provided', async () => {
    const cliHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-home-reasoning-'));
    const result = await writeCliApiLoginConfig({
      provider: 'opencode',
      cliHomeDir,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-opencode-secret',
      model: 'gpt-5',
      reasoningEffort: 'high',
    });

    const configPath = path.join(cliHomeDir, '.config', 'opencode', 'opencode.json');
    const configText = fs.readFileSync(configPath, 'utf8');
    expect(configText).toContain('"reasoningEffort": "high"');
    expect(result.reasoningEffort).toBe('high');
  });
});
