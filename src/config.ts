import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env: ${name}`);
  }

  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  corpId: required('WEWORK_CORP_ID'),
  corpSecret: required('WEWORK_SECRET'),
  agentId: Number(required('WEWORK_AGENT_ID')),
  token: required('WEWORK_TOKEN'),
  encodingAesKey: required('WEWORK_ENCODING_AES_KEY'),
  confirmTtlSeconds: Number(process.env.CONFIRM_TTL_SECONDS ?? 120),
  commandTimeoutMs: Number(process.env.COMMAND_TIMEOUT_MS ?? 180_000),
  codexBin: process.env.CODEX_BIN ?? 'codex',
  codexWorkdir: process.env.CODEX_WORKDIR ?? process.cwd(),
  /** 'full-auto' (默认，有沙箱) 或 'none' (跳过沙箱，适合服务器) */
  codexSandbox: (process.env.CODEX_SANDBOX ?? 'full-auto') as 'full-auto' | 'none',
  runnerEnabled: process.env.RUNNER_ENABLED !== 'false',
};
