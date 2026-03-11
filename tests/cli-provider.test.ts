import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  readCliHomeDefaultModel,
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
    expect(result.configPath).toBe(configPath);
    expect(fs.readFileSync(configPath, 'utf8')).toContain('"baseURL": "https://api.openai.com/v1"');
    expect(fs.readFileSync(configPath, 'utf8')).toContain('"model": "gateway/gpt-5"');
    expect(readCliHomeDefaultModel('opencode', cliHomeDir)).toBe('gateway/gpt-5');
  });
});
