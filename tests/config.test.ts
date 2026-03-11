import { describe, expect, it, vi } from 'vitest';

const CONFIG_ENV_KEYS = [
  'PORT',
  'WECOM_ENABLED',
  'WEWORK_CORP_ID',
  'WEWORK_SECRET',
  'WEWORK_AGENT_ID',
  'WEWORK_TOKEN',
  'WEWORK_ENCODING_AES_KEY',
  'CONFIRM_TTL_SECONDS',
  'COMMAND_TIMEOUT_MS',
  'COMMAND_TIMEOUT_MIN_MS',
  'COMMAND_TIMEOUT_MAX_MS',
  'COMMAND_TIMEOUT_PER_CHAR_MS',
  'API_TIMEOUT_MS',
  'API_RETRY_ON_TIMEOUT',
  'FEISHU_ENABLED',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_VERIFICATION_TOKEN',
  'FEISHU_LONG_CONNECTION',
  'FEISHU_GROUP_REQUIRE_MENTION',
  'FEISHU_API_TIMEOUT_MS',
  'FEISHU_STARTUP_HELP_ENABLED',
  'FEISHU_STARTUP_HELP_ADMIN_OPEN_ID',
  'DEDUP_WINDOW_SECONDS',
  'RATE_LIMIT_MAX_MESSAGES',
  'RATE_LIMIT_WINDOW_SECONDS',
  'ALLOW_FROM',
  'CODEX_PROVIDER',
  'CODEX_BIN',
  'OPENCODE_BIN',
  'CODEX_MODEL',
  'CODEX_SEARCH',
  'CODEX_WORKDIR',
  'GATEWAY_ROOT_DIR',
  'CODEX_AGENTS_DIR',
  'CODEX_SANDBOX',
  'CODEX_WORKDIR_ISOLATION',
  'BROWSER_AUTOMATION_ENABLED',
  'BROWSER_PROFILE_DIR',
  'BROWSER_MCP_ENABLED',
  'BROWSER_MCP_URL',
  'BROWSER_MCP_PROFILE_DIR',
  'BROWSER_MCP_PORT',
  'RUNNER_ENABLED',
  'MEMORY_STEWARD_ENABLED',
  'MEMORY_STEWARD_INTERVAL_HOURS',
] as const;

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
  const original = new Map<string, string | undefined>();
  for (const key of CONFIG_ENV_KEYS) {
    original.set(key, process.env[key]);
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    vi.resetModules();
    vi.doMock('dotenv', () => ({
      default: {
        config: vi.fn(() => ({ parsed: {} })),
      },
    }));
    const mod = await import('../src/config.ts');
    return mod.config;
  } finally {
    vi.doUnmock('dotenv');
    vi.resetModules();
    for (const key of CONFIG_ENV_KEYS) {
      const value = original.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('config browser automation defaults', () => {
  it('enables browser automation by default when not explicitly disabled', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      BROWSER_AUTOMATION_ENABLED: undefined,
      BROWSER_MCP_ENABLED: undefined,
    });

    expect(config.browserAutomationEnabled).toBe(true);
  });

  it('reads the new browser profile dir env', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      BROWSER_PROFILE_DIR: '/tmp/browser-profile',
    });

    expect(config.browserProfileDir).toBe('/tmp/browser-profile');
  });

  it('falls back to legacy browser profile dir env for compatibility', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      BROWSER_PROFILE_DIR: undefined,
      BROWSER_MCP_PROFILE_DIR: '/tmp/legacy-browser-profile',
    });

    expect(config.browserProfileDir).toBe('/tmp/legacy-browser-profile');
  });

  it('allows explicitly disabling browser automation', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      BROWSER_AUTOMATION_ENABLED: 'false',
    });

    expect(config.browserAutomationEnabled).toBe(false);
  });

  it('falls back to legacy browser mcp flag for compatibility', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      BROWSER_AUTOMATION_ENABLED: undefined,
      BROWSER_MCP_ENABLED: 'false',
    });

    expect(config.browserAutomationEnabled).toBe(false);
  });
});

describe('config cli provider', () => {
  it('defaults to codex', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_BIN: 'codex',
    });

    expect(config.codexProvider).toBe('codex');
  });

  it('infers opencode from the configured binary', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_BIN: '/usr/local/bin/opencode',
    });

    expect(config.codexProvider).toBe('opencode');
  });
});

describe('config workdir isolation', () => {
  it('defaults to off', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'none',
      CODEX_WORKDIR_ISOLATION: undefined,
    });

    expect(config.codexWorkdirIsolation).toBe('off');
  });

  it('reads bwrap isolation mode', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'none',
      CODEX_WORKDIR_ISOLATION: 'bwrap',
    });

    expect(config.codexWorkdirIsolation).toBe('bwrap');
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

  it('reads feishu startup help config', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      FEISHU_STARTUP_HELP_ENABLED: 'true',
      FEISHU_STARTUP_HELP_ADMIN_OPEN_ID: 'ou_admin',
    });

    expect(config.feishuStartupHelpEnabled).toBe(true);
    expect(config.feishuStartupHelpAdminOpenId).toBe('ou_admin');
  });

  it('shows actionable feishu env error when credentials are missing', async () => {
    await expect(loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'true',
      FEISHU_APP_ID: undefined,
      FEISHU_APP_SECRET: undefined,
      CODEX_SANDBOX: 'full-auto',
    })).rejects.toThrow(/codexclaw setup|codexclaw doctor/);
  });
});
