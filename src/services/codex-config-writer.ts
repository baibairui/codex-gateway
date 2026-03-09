import fs from 'node:fs';
import path from 'node:path';

export interface CodexApiLoginWriteInput {
  codexHomeDir: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export interface CodexApiLoginWriteResult {
  configPath: string;
  authPath: string;
  baseUrl: string;
  model: string;
  maskedApiKey: string;
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('invalid base_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('invalid base_url');
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeApiKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('invalid api_key');
  }
  return trimmed;
}

function normalizeModel(input: string | undefined): string {
  const trimmed = (input ?? 'gpt-5.3-codex').trim();
  if (!trimmed) {
    throw new Error('invalid model');
  }
  return trimmed;
}

function maskApiKey(value: string): string {
  if (value.length <= 7) {
    return `${value.slice(0, 3)}***`;
  }
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(4, value.length - 7))}${value.slice(-4)}`;
}

export function renderCodexConfigToml(input: { model: string; baseUrl: string }): string {
  return [
    `model = "${input.model}"`,
    'model_provider = "codex"',
    '',
    '[model_providers.codex]',
    'name = "codex"',
    `base_url = "${input.baseUrl}"`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    '',
    '[features]',
    'enable_request_compression = false',
    '',
  ].join('\n');
}

export async function writeCodexApiLoginConfig(input: CodexApiLoginWriteInput): Promise<CodexApiLoginWriteResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = normalizeApiKey(input.apiKey);
  const model = normalizeModel(input.model);
  const codexDir = path.resolve(input.codexHomeDir);
  const configPath = path.join(codexDir, 'config.toml');
  const authPath = path.join(codexDir, 'auth.json');

  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(configPath, renderCodexConfigToml({ model, baseUrl }), 'utf8');
  fs.writeFileSync(authPath, `${JSON.stringify({ OPENAI_API_KEY: apiKey })}\n`, 'utf8');

  return {
    configPath,
    authPath,
    baseUrl,
    model,
    maskedApiKey: maskApiKey(apiKey),
  };
}
