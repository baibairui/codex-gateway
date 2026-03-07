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

describe('config playwright mcp defaults', () => {
  it('enables playwright mcp by default when not explicitly disabled', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      PLAYWRIGHT_MCP_ENABLED: undefined,
    });

    expect(config.playwrightMcpEnabled).toBe(true);
  });

  it('allows explicitly disabling playwright mcp', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      PLAYWRIGHT_MCP_ENABLED: 'false',
    });

    expect(config.playwrightMcpEnabled).toBe(false);
  });
});
