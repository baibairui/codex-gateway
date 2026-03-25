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
  'GATEWAY_PUBLIC_BASE_URL',
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
  'SPEECH_ENABLED',
  'SPEECH_MODE',
  'SPEECH_STT_PROVIDER',
  'SPEECH_STT_BASE_URL',
  'SPEECH_STT_API_KEY_ENV',
  'SPEECH_STT_MODEL',
  'SPEECH_AUDIO_MAX_SIZE_MB',
  'SPEECH_AUDIO_MAX_DURATION_SEC',
  'SPEECH_AUDIO_ALLOWED_MIME_TYPES',
  'SPEECH_PROMPT_INCLUDE_TRANSCRIPT_META',
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

describe('config gateway public base url', () => {
  it('normalizes the optional public base url for long connection oauth callbacks', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      GATEWAY_PUBLIC_BASE_URL: 'https://gateway.example.com///',
    });

    expect(config.gatewayPublicBaseUrl).toBe('https://gateway.example.com');
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
    })).rejects.toThrow(/agentclaw setup|agentclaw doctor/);
  });
});

describe('config speech defaults', () => {
  it('provides stage-1 speech defaults', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
    });

    expect(config.speech).toEqual({
      enabled: false,
      mode: 'transcribe_and_reply',
      stt: {
        provider: 'openai-compatible',
        baseUrl: undefined,
        apiKeyEnv: 'OPENAI_API_KEY',
        model: 'gpt-4o-mini-transcribe',
      },
      audio: {
        maxSizeMb: 25,
        maxDurationSec: 300,
        allowedMimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm'],
      },
      prompt: {
        includeTranscriptMeta: true,
      },
    });
  });

  it('reads speech env overrides', async () => {
    const config = await loadConfigWithEnv({
      WECOM_ENABLED: 'false',
      FEISHU_ENABLED: 'false',
      CODEX_SANDBOX: 'full-auto',
      SPEECH_ENABLED: 'true',
      SPEECH_MODE: 'transcribe_only',
      SPEECH_STT_PROVIDER: 'custom-provider',
      SPEECH_STT_BASE_URL: 'https://speech.example.com/v1',
      SPEECH_STT_API_KEY_ENV: 'SPEECH_API_KEY',
      SPEECH_STT_MODEL: 'sensevoice-small',
      SPEECH_AUDIO_MAX_SIZE_MB: '12',
      SPEECH_AUDIO_MAX_DURATION_SEC: '90',
      SPEECH_AUDIO_ALLOWED_MIME_TYPES: 'audio/ogg, audio/webm',
      SPEECH_PROMPT_INCLUDE_TRANSCRIPT_META: 'false',
    });

    expect(config.speech).toEqual({
      enabled: true,
      mode: 'transcribe_only',
      stt: {
        provider: 'custom-provider',
        baseUrl: 'https://speech.example.com/v1',
        apiKeyEnv: 'SPEECH_API_KEY',
        model: 'sensevoice-small',
      },
      audio: {
        maxSizeMb: 12,
        maxDurationSec: 90,
        allowedMimeTypes: ['audio/ogg', 'audio/webm'],
      },
      prompt: {
        includeTranscriptMeta: false,
      },
    });
  });
});
