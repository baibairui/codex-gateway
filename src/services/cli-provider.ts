import fs from 'node:fs';
import path from 'node:path';

export type CliProvider = 'codex' | 'opencode';

export interface CliProviderSpec {
  id: CliProvider;
  label: string;
  defaultModel: string;
  defaultBaseUrl: string;
  supportsDeviceAuth: boolean;
}

export interface CliApiLoginWriteInput {
  provider: CliProvider;
  cliHomeDir: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export interface CliApiLoginWriteResult {
  configPath: string;
  authPath?: string;
  baseUrl: string;
  model: string;
  maskedApiKey: string;
}

const PROVIDERS: Record<CliProvider, CliProviderSpec> = {
  codex: {
    id: 'codex',
    label: 'Codex',
    defaultModel: 'gpt-5.3-codex',
    defaultBaseUrl: 'https://codex.ai02.cn',
    supportsDeviceAuth: true,
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    defaultModel: 'gpt-5',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsDeviceAuth: false,
  },
};

export function getCliProviderSpec(provider: CliProvider): CliProviderSpec {
  return PROVIDERS[provider];
}

export function resolveCliProvider(explicitProvider: string | undefined, bin: string | undefined): CliProvider {
  const explicit = explicitProvider?.trim().toLowerCase();
  if (explicit === 'codex' || explicit === 'opencode') {
    return explicit;
  }
  const normalizedBin = path.basename((bin ?? 'codex').trim()).toLowerCase();
  if (normalizedBin.includes('opencode')) {
    return 'opencode';
  }
  return 'codex';
}

export function runnerHomeDirName(provider: CliProvider): string {
  return provider === 'opencode' ? 'opencode-home' : 'codex-home';
}

export function resolveOpenCodeBin(explicitBin: string | undefined, homeDir = process.env.HOME): string {
  const explicit = explicitBin?.trim();
  if (explicit) {
    return explicit;
  }
  if (homeDir?.trim()) {
    const localBin = path.join(path.resolve(homeDir.trim()), '.local', 'bin', 'opencode');
    if (isExecutableFile(localBin)) {
      return localBin;
    }
  }
  return 'opencode';
}

export function isExecutableAvailable(bin: string, envPath = process.env.PATH): boolean {
  const trimmed = bin.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes('/')) {
    return isExecutableFile(trimmed);
  }
  for (const dir of (envPath ?? '').split(path.delimiter)) {
    const candidateDir = dir.trim();
    if (!candidateDir) {
      continue;
    }
    if (isExecutableFile(path.join(candidateDir, trimmed))) {
      return true;
    }
  }
  return false;
}

export function readCliHomeDefaultModel(provider: CliProvider, cliHomeDir: string | undefined): string | undefined {
  if (!cliHomeDir) {
    return undefined;
  }
  if (provider === 'opencode') {
    const configPath = path.join(path.resolve(cliHomeDir), '.config', 'opencode', 'opencode.json');
    if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      const model = typeof parsed.model === 'string' ? parsed.model.trim() : '';
      return model || undefined;
    } catch {
      return undefined;
    }
  }
  const configPath = path.join(path.resolve(cliHomeDir), 'config.toml');
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
    return undefined;
  }
  const configText = fs.readFileSync(configPath, 'utf8');
  for (const rawLine of configText.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('model')) {
      continue;
    }
    const match = line.match(/^model\s*=\s*"([^"]+)"\s*$/);
    if (!match) {
      continue;
    }
    const model = match[1]?.trim();
    if (model) {
      return model;
    }
  }
  return undefined;
}

export function hasCliHomeConfig(provider: CliProvider, cliHomeDir: string | undefined): boolean {
  return resolveCliConfigPath(provider, cliHomeDir) !== undefined;
}

export function hasCliHomeAuth(provider: CliProvider, cliHomeDir: string | undefined): boolean {
  return resolveCliAuthPath(provider, cliHomeDir) !== undefined;
}

export async function writeCliApiLoginConfig(input: CliApiLoginWriteInput): Promise<CliApiLoginWriteResult> {
  const providerSpec = getCliProviderSpec(input.provider);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = normalizeApiKey(input.apiKey);
  const rawModel = normalizeModel(input.model ?? providerSpec.defaultModel);
  const cliHomeDir = path.resolve(input.cliHomeDir);
  fs.mkdirSync(cliHomeDir, { recursive: true });

  if (input.provider === 'opencode') {
    const configPath = path.join(cliHomeDir, '.config', 'opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const model = normalizeOpenCodeModel(rawModel);
    const config = {
      $schema: 'https://opencode.ai/config.json',
      provider: {
        gateway: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Gateway',
          options: {
            baseURL: baseUrl,
            apiKey,
          },
        },
      },
      model,
    };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const authPath = path.join(cliHomeDir, '.local', 'share', 'opencode', 'auth.json');
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, `${JSON.stringify({ providers: ['gateway'] })}\n`, 'utf8');
    return {
      configPath,
      authPath,
      baseUrl,
      model,
      maskedApiKey: maskApiKey(apiKey),
    };
  }

  const configPath = path.join(cliHomeDir, 'config.toml');
  const authPath = path.join(cliHomeDir, 'auth.json');
  fs.writeFileSync(configPath, renderCodexConfigToml({ model: rawModel, baseUrl }), 'utf8');
  fs.writeFileSync(authPath, `${JSON.stringify({ OPENAI_API_KEY: apiKey })}\n`, 'utf8');
  return {
    configPath,
    authPath,
    baseUrl,
    model: rawModel,
    maskedApiKey: maskApiKey(apiKey),
  };
}

function resolveCliConfigPath(provider: CliProvider, cliHomeDir: string | undefined): string | undefined {
  if (!cliHomeDir) {
    return undefined;
  }
  const resolvedHome = path.resolve(cliHomeDir);
  const filePath = provider === 'opencode'
    ? path.join(resolvedHome, '.config', 'opencode', 'opencode.json')
    : path.join(resolvedHome, 'config.toml');
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : undefined;
}

function resolveCliAuthPath(provider: CliProvider, cliHomeDir: string | undefined): string | undefined {
  if (!cliHomeDir) {
    return undefined;
  }
  const resolvedHome = path.resolve(cliHomeDir);
  const filePath = provider === 'opencode'
    ? path.join(resolvedHome, '.local', 'share', 'opencode', 'auth.json')
    : path.join(resolvedHome, 'auth.json');
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : undefined;
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

function normalizeModel(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('invalid model');
  }
  return trimmed;
}

function normalizeOpenCodeModel(input: string): string {
  const trimmed = normalizeModel(input);
  if (trimmed.includes('/')) {
    return trimmed;
  }
  return `gateway/${trimmed}`;
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function maskApiKey(value: string): string {
  if (value.length <= 7) {
    return `${value.slice(0, 3)}***`;
  }
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(4, value.length - 7))}${value.slice(-4)}`;
}

function renderCodexConfigToml(input: { model: string; baseUrl: string }): string {
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
