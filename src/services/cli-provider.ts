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
  reasoningEffort?: string;
}

export interface CliApiLoginWriteResult {
  configPath: string;
  authPath?: string;
  baseUrl: string;
  model: string;
  maskedApiKey: string;
  reasoningEffort?: string;
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
  return resolveManagedCliBin(explicitBin, 'opencode', process.env.PATH, homeDir, [
    '.local/bin',
    '.opencode/bin',
  ]);
}

export function resolveCodexBin(
  explicitBin: string | undefined,
  envPath = process.env.PATH,
  homeDir = process.env.HOME,
): string {
  const extraDirs: string[] = [
    '.local/bin',
    '.npm-global/bin',
    '.volta/bin',
    ...resolveVersionedBinDirs(homeDir, ['.nvm', 'versions', 'node']),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/Applications/Codex.app/Contents/Resources',
  ];
  return resolveManagedCliBin(explicitBin, 'codex', envPath, homeDir, extraDirs);
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
  const reasoningEffort = normalizeReasoningEffort(input.reasoningEffort);
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
          models: {
            [rawModel]: reasoningEffort
              ? {
                  options: {
                    reasoningEffort,
                  },
                }
              : {},
          },
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
      reasoningEffort,
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

function normalizeReasoningEffort(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.toLowerCase();
  const allowed = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  if (!allowed.has(normalized)) {
    throw new Error('invalid reasoning_effort');
  }
  return normalized;
}

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveManagedCliBin(
  explicitBin: string | undefined,
  defaultBin: string,
  envPath: string | undefined,
  homeDir: string | undefined,
  extraCandidateDirs: string[],
): string {
  const requested = explicitBin?.trim() || defaultBin;
  if (requested.includes('/')) {
    return isExecutableFile(requested) ? path.resolve(requested) : requested;
  }

  const fromPath = resolveExecutableOnPath(requested, envPath);
  if (fromPath) {
    return fromPath;
  }

  const homeRoot = homeDir?.trim() ? path.resolve(homeDir.trim()) : undefined;
  for (const dir of extraCandidateDirs) {
    const candidateDir = path.isAbsolute(dir)
      ? dir
      : (homeRoot ? path.join(homeRoot, dir) : undefined);
    if (!candidateDir) {
      continue;
    }
    const candidate = path.join(candidateDir, requested);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return requested;
}

function resolveExecutableOnPath(bin: string, envPath: string | undefined): string | undefined {
  for (const dir of (envPath ?? '').split(path.delimiter)) {
    const candidateDir = dir.trim();
    if (!candidateDir) {
      continue;
    }
    const candidate = path.join(candidateDir, bin);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveVersionedBinDirs(homeDir: string | undefined, relativeRootParts: string[]): string[] {
  const homeRoot = homeDir?.trim() ? path.resolve(homeDir.trim()) : undefined;
  if (!homeRoot) {
    return [];
  }
  const versionsRoot = path.join(homeRoot, ...relativeRootParts);
  try {
    return fs.readdirSync(versionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((entry) => path.join(versionsRoot, entry, 'bin'));
  } catch {
    return [];
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
