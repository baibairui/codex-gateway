import { describe, expect, it, vi } from 'vitest';

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    original.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    vi.resetModules();
    const mod = await import('../src/config.ts');
    return mod.config;
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('config browser mcp defaults', () => {
  it('enables browser mcp by default when not explicitly disabled', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      BROWSER_MCP_ENABLED: undefined,
    });

    expect(config.browserMcpEnabled).toBe(true);
  });

  it('allows explicitly disabling browser mcp', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      BROWSER_MCP_ENABLED: 'false',
    });

    expect(config.browserMcpEnabled).toBe(false);
  });
});

describe('config feishu mention trigger', () => {
  it('requires @ mention in feishu groups by default', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      FEISHU_GROUP_REQUIRE_MENTION: undefined,
    });

    expect(config.feishuGroupRequireMention).toBe(true);
  });

  it('allows disabling feishu group mention trigger explicitly', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      FEISHU_GROUP_REQUIRE_MENTION: 'false',
    });

    expect(config.feishuGroupRequireMention).toBe(false);
  });
});
