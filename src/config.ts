import dotenv from 'dotenv';
import { resolveCliProvider, resolveOpenCodeBin } from './services/cli-provider.js';

dotenv.config();

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`invalid number env: ${name}`);
  }
  return value;
}

function optionalNumberUndefined(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`invalid number env: ${name}`);
  }
  return value;
}

function optionalString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  return raw.trim();
}

function optionalStringUndefined(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  return value ? value : undefined;
}

function optionalStringUndefinedRaw(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, '');
}

function optionalBoolean(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`invalid boolean env: ${name}`);
}

function codexSandboxMode(): 'full-auto' | 'none' {
  const value = process.env.CODEX_SANDBOX ?? 'full-auto';
  if (value === 'full-auto' || value === 'none') {
    return value;
  }
  throw new Error(`invalid CODEX_SANDBOX: ${value}`);
}

function codexWorkdirIsolationMode(): 'off' | 'bwrap' {
  const value = process.env.CODEX_WORKDIR_ISOLATION ?? 'off';
  if (value === 'off' || value === 'bwrap') {
    return value;
  }
  throw new Error(`invalid CODEX_WORKDIR_ISOLATION: ${value}`);
}

export const config = {
  port: optionalNumber('PORT', 3000),
  wecomEnabled: process.env.WECOM_ENABLED !== 'false',
  corpId: optionalStringUndefined('WEWORK_CORP_ID'),
  corpSecret: optionalStringUndefined('WEWORK_SECRET'),
  agentId: optionalNumberUndefined('WEWORK_AGENT_ID'),
  token: optionalStringUndefined('WEWORK_TOKEN'),
  encodingAesKey: optionalStringUndefined('WEWORK_ENCODING_AES_KEY'),
  confirmTtlSeconds: optionalNumber('CONFIRM_TTL_SECONDS', 120),
  commandTimeoutMs: optionalNumberUndefined('COMMAND_TIMEOUT_MS'),
  commandTimeoutMinMs: optionalNumber('COMMAND_TIMEOUT_MIN_MS', 180_000),
  commandTimeoutMaxMs: optionalNumber('COMMAND_TIMEOUT_MAX_MS', 900_000),
  commandTimeoutPerCharMs: optionalNumber('COMMAND_TIMEOUT_PER_CHAR_MS', 80),
  apiTimeoutMs: optionalNumber('API_TIMEOUT_MS', 15_000),
  apiRetryOnTimeout: process.env.API_RETRY_ON_TIMEOUT === 'true',
  feishuEnabled: process.env.FEISHU_ENABLED === 'true',
  feishuAppId: optionalStringUndefined('FEISHU_APP_ID'),
  feishuAppSecret: optionalStringUndefined('FEISHU_APP_SECRET'),
  feishuDocBaseUrl: optionalStringUndefined('FEISHU_DOC_BASE_URL'),
  feishuVerificationToken: optionalStringUndefined('FEISHU_VERIFICATION_TOKEN'),
  feishuLongConnection: process.env.FEISHU_LONG_CONNECTION === 'true',
  feishuGroupRequireMention: process.env.FEISHU_GROUP_REQUIRE_MENTION !== 'false',
  feishuApiTimeoutMs: optionalNumber('FEISHU_API_TIMEOUT_MS', 15_000),
  feishuStartupHelpEnabled: process.env.FEISHU_STARTUP_HELP_ENABLED === 'true',
  feishuStartupHelpAdminOpenId: optionalStringUndefined('FEISHU_STARTUP_HELP_ADMIN_OPEN_ID'),
  dedupWindowSeconds: optionalNumber('DEDUP_WINDOW_SECONDS', 60),
  rateLimitMaxMessages: optionalNumber('RATE_LIMIT_MAX_MESSAGES', 20),
  rateLimitWindowSeconds: optionalNumber('RATE_LIMIT_WINDOW_SECONDS', 60),
  allowFrom: optionalString('ALLOW_FROM', '*'),
  codexProvider: resolveCliProvider(process.env.CODEX_PROVIDER, process.env.CODEX_BIN),
  codexBin: process.env.CODEX_BIN ?? 'codex',
  opencodeBin: resolveOpenCodeBin(process.env.OPENCODE_BIN),
  codexModel: optionalStringUndefined('CODEX_MODEL'),
  codexSearch: process.env.CODEX_SEARCH === 'true',
  codexWorkdir: process.env.CODEX_WORKDIR ?? process.cwd(),
  gatewayRootDir: optionalStringUndefinedRaw('GATEWAY_ROOT_DIR'),
  codexAgentsDir: optionalStringUndefined('CODEX_AGENTS_DIR'),
  /** 'full-auto' (默认，有沙箱) 或 'none' (跳过沙箱，适合服务器) */
  codexSandbox: codexSandboxMode(),
  codexWorkdirIsolation: codexWorkdirIsolationMode(),
  browserAutomationEnabled: optionalBoolean('BROWSER_AUTOMATION_ENABLED')
    ?? (process.env.BROWSER_MCP_ENABLED !== 'false'),
  browserProfileDir: optionalStringUndefined('BROWSER_PROFILE_DIR')
    ?? optionalStringUndefined('BROWSER_MCP_PROFILE_DIR'),
  runnerEnabled: process.env.RUNNER_ENABLED !== 'false',
  memoryStewardEnabled: process.env.MEMORY_STEWARD_ENABLED !== 'false',
  memoryStewardIntervalHours: optionalNumber('MEMORY_STEWARD_INTERVAL_HOURS', 1),
};

if (config.feishuEnabled) {
  if (!config.feishuAppId || !config.feishuAppSecret) {
    throw new Error(
      '飞书配置不完整：启用 FEISHU_ENABLED=true 时必须配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。' +
      ' 可先执行 codexclaw setup 或 codexclaw doctor 进行安装自检。',
    );
  }
}

if (config.wecomEnabled) {
  if (!config.corpId || !config.corpSecret || config.agentId === undefined || !config.token || !config.encodingAesKey) {
    throw new Error(
      'missing required env for WeCom: WEWORK_CORP_ID / WEWORK_SECRET / WEWORK_AGENT_ID / WEWORK_TOKEN / WEWORK_ENCODING_AES_KEY',
    );
  }
}
