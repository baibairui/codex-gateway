import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeCodexApiLoginConfig } from '../src/services/codex-config-writer.js';

describe('writeCodexApiLoginConfig', () => {
  it('writes project-local codex config and auth files', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-api-login-'));

    const result = await writeCodexApiLoginConfig({
      rootDir,
      baseUrl: 'https://codex.ai02.cn',
      apiKey: 'sk-example-secret',
      model: 'gpt-5.3-codex',
    });

    const configPath = path.join(rootDir, '.codex', 'config.toml');
    const authPath = path.join(rootDir, '.codex', 'auth.json');
    expect(fs.readFileSync(configPath, 'utf8')).toContain('base_url = "https://codex.ai02.cn"');
    expect(fs.readFileSync(configPath, 'utf8')).toContain('model = "gpt-5.3-codex"');
    expect(fs.readFileSync(authPath, 'utf8')).toBe('{"OPENAI_API_KEY":"sk-example-secret"}\n');
    expect(result.baseUrl).toBe('https://codex.ai02.cn');
    expect(result.maskedApiKey).toBe('sk-**********cret');
  });

  it('rejects invalid base url', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-api-login-invalid-'));

    await expect(writeCodexApiLoginConfig({
      rootDir,
      baseUrl: 'not-a-url',
      apiKey: 'sk-example-secret',
      model: 'gpt-5.3-codex',
    })).rejects.toThrow('invalid base_url');
  });
});
