import fs from 'node:fs';
import path from 'node:path';
import { hasCliHomeAuth, hasCliHomeConfig, type CliProvider } from './cli-provider.js';

export type CodexWorkdirIsolationMode = 'off' | 'bwrap';

export interface CodexSpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface BuildCodexSpawnSpecInput {
  provider?: CliProvider;
  codexBin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  isolationMode: CodexWorkdirIsolationMode;
  codexHomeDir?: string;
}

const DEFAULT_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const RUNTIME_HOME_DIR = '.codex-runtime/home';
const RUNTIME_HOME_MOUNT_DIR = '/workspace/.codex-runtime/home';
const RUNTIME_GATEWAY_ROOT_MOUNT_DIR = '/workspace/.codex-runtime/gateway-root';
const CODEx_SYNC_FILES = ['auth.json', 'config.toml', 'models_cache.json'] as const;
const OPENCODE_SYNC_PATHS = [
  ['.config', 'opencode', 'opencode.json'],
  ['.local', 'share', 'opencode', 'auth.json'],
] as const;
const DEFAULT_HOME_READONLY_PATHS = ['.gitconfig', '.ssh/config', '.ssh/known_hosts'] as const;
const SSH_CONFIG_RELATIVE_PATH = '.ssh/config';
const EXTRA_READS_ENV_NAME = 'CODEX_WORKDIR_ISOLATION_EXTRA_READS';

export function buildCodexSpawnSpec(input: BuildCodexSpawnSpecInput): CodexSpawnSpec {
  const hostHomeDir = resolveHostHomeDir(input.env);
  const provider = input.provider ?? 'codex';
  const hostEnv = buildHostCodexEnv(input.env, provider, input.codexHomeDir);
  const gatewayRootDir = resolveGatewayRootDir(hostEnv);
  if (input.isolationMode === 'off') {
    return {
      command: input.codexBin,
      args: input.args,
      cwd: input.cwd,
      env: hostEnv,
    };
  }

  const workspaceDir = path.resolve(input.cwd);
  const runtimeHomeDir = path.join(workspaceDir, RUNTIME_HOME_DIR);
  syncCodexRuntimeHome(input.codexHomeDir, runtimeHomeDir);

  return {
    command: 'bwrap',
    args: buildBubblewrapArgs(
      provider,
      input.codexBin,
      input.args,
      workspaceDir,
      runtimeHomeDir,
      hostHomeDir,
      gatewayRootDir,
      input.env[EXTRA_READS_ENV_NAME],
    ),
    cwd: workspaceDir,
    env: buildIsolatedEnv(hostEnv, runtimeHomeDir, gatewayRootDir, provider),
  };
}

function buildBubblewrapArgs(
  provider: CliProvider,
  codexBin: string,
  args: string[],
  workspaceDir: string,
  runtimeHomeDir: string,
  hostHomeDir: string | undefined,
  gatewayRootDir: string | undefined,
  extraReadsRaw: string | undefined,
): string[] {
  const sandboxArgs = normalizeArgsForWorkspace(args, workspaceDir);
  const readonlyMounts = collectReadonlyMounts(runtimeHomeDir, hostHomeDir, extraReadsRaw);
  const result = [
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--share-net',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
  ];

  appendIfExists(result, ['--ro-bind', '/usr', '/usr']);
  appendIfExists(result, ['--ro-bind', '/bin', '/bin']);
  appendIfExists(result, ['--ro-bind', '/lib', '/lib']);
  appendIfExists(result, ['--ro-bind', '/lib64', '/lib64']);
  appendIfExists(result, ['--ro-bind', '/etc', '/etc']);
  appendAbsoluteBinaryMounts(result, codexBin);

  result.push(
    '--bind',
    workspaceDir,
    '/workspace',
    '--bind',
    runtimeHomeDir,
    RUNTIME_HOME_MOUNT_DIR,
  );

  for (const mount of readonlyMounts) {
    result.push('--ro-bind', mount.source, mount.sandboxTarget);
  }
  appendGatewayNodeModulesMount(result, gatewayRootDir);

  const xdgDataEnv = provider === 'opencode'
    ? ['--setenv', 'XDG_DATA_HOME', '/workspace/.codex-runtime/home/.local/share'] as const
    : [];

  result.push(
    '--chdir',
    '/workspace',
    '--setenv',
    'HOME',
    '/workspace/.codex-runtime/home',
    '--setenv',
    'CODEX_HOME',
    '/workspace/.codex-runtime/home',
    '--setenv',
    'XDG_CONFIG_HOME',
    '/workspace/.codex-runtime/home/.config',
    '--setenv',
    'XDG_CACHE_HOME',
    '/workspace/.codex-runtime/home/.cache',
    ...xdgDataEnv,
    '--setenv',
    'TMPDIR',
    '/tmp',
    '--setenv',
    'PATH',
    DEFAULT_PATH,
    codexBin,
    ...sandboxArgs,
  );

  return result;
}

function buildHostCodexEnv(
  env: NodeJS.ProcessEnv,
  provider: CliProvider,
  codexHomeDir?: string,
): NodeJS.ProcessEnv {
  if (!codexHomeDir) {
    return { ...env };
  }
  const resolvedHome = path.resolve(codexHomeDir);
  fs.mkdirSync(resolvedHome, { recursive: true });
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    CODEX_HOME: resolvedHome,
  };
  applyCliHomeOverrides(nextEnv, provider, resolvedHome);
  if (hasCliHomeConfig(provider, resolvedHome)) {
    delete nextEnv.OPENAI_BASE_URL;
    delete nextEnv.CHATGPT_BASE_URL;
  }
  if (hasCliHomeAuth(provider, resolvedHome)) {
    delete nextEnv.OPENAI_API_KEY;
    delete nextEnv.CHATGPT_API_KEY;
  }
  return nextEnv;
}

function buildIsolatedEnv(
  env: NodeJS.ProcessEnv,
  runtimeHomeDir: string,
  gatewayRootDir: string | undefined,
  provider: CliProvider,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    PATH: env.PATH || DEFAULT_PATH,
    HOME: runtimeHomeDir,
    CODEX_HOME: runtimeHomeDir,
    XDG_CONFIG_HOME: path.join(runtimeHomeDir, '.config'),
    XDG_CACHE_HOME: path.join(runtimeHomeDir, '.cache'),
    TMPDIR: '/tmp',
    USER: env.USER || 'root',
    LOGNAME: env.LOGNAME || env.USER || 'root',
    LANG: env.LANG || 'C.UTF-8',
    LC_ALL: env.LC_ALL || 'C.UTF-8',
    TERM: env.TERM || 'xterm-256color',
    NODE_PATH: resolveGatewayNodeModules(gatewayRootDir),
    HTTPS_PROXY: env.HTTPS_PROXY,
    HTTP_PROXY: env.HTTP_PROXY,
    ALL_PROXY: env.ALL_PROXY,
    NO_PROXY: env.NO_PROXY,
    no_proxy: env.no_proxy,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_BASE_URL: env.OPENAI_BASE_URL,
    OPENAI_ORG_ID: env.OPENAI_ORG_ID,
    OPENAI_PROJECT_ID: env.OPENAI_PROJECT_ID,
    CHATGPT_BASE_URL: env.CHATGPT_BASE_URL,
    CHATGPT_API_KEY: env.CHATGPT_API_KEY,
    CODEX_DISABLE_WRITES_OUTSIDE_CWD: 'true',
  };

  if (provider === 'opencode') {
    nextEnv.XDG_DATA_HOME = path.join(runtimeHomeDir, '.local', 'share');
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (key.startsWith('FEISHU_') || key.startsWith('GATEWAY_')) {
      nextEnv[key] = value;
    }
  }

  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) {
      delete nextEnv[key];
    }
  }
  return nextEnv;
}

function applyCliHomeOverrides(
  env: NodeJS.ProcessEnv,
  provider: CliProvider,
  resolvedHome: string,
): void {
  if (provider !== 'opencode') {
    return;
  }
  const configHome = path.join(resolvedHome, '.config');
  const cacheHome = path.join(resolvedHome, '.cache');
  const dataHome = path.join(resolvedHome, '.local', 'share');
  fs.mkdirSync(configHome, { recursive: true });
  fs.mkdirSync(cacheHome, { recursive: true });
  fs.mkdirSync(dataHome, { recursive: true });
  env.HOME = resolvedHome;
  env.XDG_CONFIG_HOME = configHome;
  env.XDG_CACHE_HOME = cacheHome;
  env.XDG_DATA_HOME = dataHome;
}

function resolveGatewayRootDir(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.GATEWAY_ROOT_DIR?.trim();
  if (!configured) {
    return undefined;
  }
  const resolved = path.resolve(configured);
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? resolved
    : undefined;
}

function resolveGatewayNodeModules(gatewayRootDir: string | undefined): string | undefined {
  if (!gatewayRootDir) {
    return undefined;
  }
  const nodeModulesDir = path.join(gatewayRootDir, 'node_modules');
  return fs.existsSync(nodeModulesDir) && fs.statSync(nodeModulesDir).isDirectory()
    ? `${RUNTIME_GATEWAY_ROOT_MOUNT_DIR}/node_modules`
    : undefined;
}

function appendGatewayNodeModulesMount(result: string[], gatewayRootDir: string | undefined): void {
  if (!gatewayRootDir) {
    return;
  }
  const nodeModulesDir = path.join(gatewayRootDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir) || !fs.statSync(nodeModulesDir).isDirectory()) {
    return;
  }
  result.push(
    '--ro-bind',
    nodeModulesDir,
    `${RUNTIME_GATEWAY_ROOT_MOUNT_DIR}/node_modules`,
  );
}

function appendAbsoluteBinaryMounts(result: string[], codexBin: string): void {
  if (!path.isAbsolute(codexBin) || !fs.existsSync(codexBin)) {
    return;
  }

  const mounts = new Set<string>([path.resolve(codexBin)]);
  try {
    const realBin = fs.realpathSync(codexBin);
    mounts.add(realBin);
  } catch {
    // Keep the original path only when realpath resolution fails.
  }

  const createdDirs = new Set<string>();
  for (const source of mounts) {
    ensureSandboxDirTree(result, createdDirs, path.dirname(source));
    result.push('--ro-bind', source, source);
  }
}

function ensureSandboxDirTree(result: string[], createdDirs: Set<string>, dirPath: string): void {
  const resolved = path.resolve(dirPath);
  const segments = resolved.split(path.sep).filter(Boolean);
  let current = '';
  if (resolved.startsWith(path.sep)) {
    current = path.sep;
  }

  for (const segment of segments) {
    current = current === path.sep ? path.join(current, segment) : path.join(current, segment);
    if (createdDirs.has(current)) {
      continue;
    }
    result.push('--dir', current);
    createdDirs.add(current);
  }
}

function syncCodexRuntimeHome(sourceDir: string | undefined, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, '.config'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, '.cache'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, '.local', 'share'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'shell_snapshots'), { recursive: true });

  if (!sourceDir) {
    return;
  }

  for (const fileName of CODEx_SYNC_FILES) {
    const sourceFile = path.join(sourceDir, fileName);
    const targetFile = path.join(targetDir, fileName);
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
      fs.rmSync(targetFile, { force: true });
      continue;
    }
    fs.copyFileSync(sourceFile, targetFile);
  }

  for (const relativeParts of OPENCODE_SYNC_PATHS) {
    const sourceFile = path.join(sourceDir, ...relativeParts);
    const targetFile = path.join(targetDir, ...relativeParts);
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
      fs.rmSync(targetFile, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
  }
}

function collectReadonlyMounts(
  runtimeHomeDir: string,
  hostHomeDir: string | undefined,
  extraReadsRaw: string | undefined,
): Array<{ source: string; hostTarget: string; sandboxTarget: string }> {
  if (!hostHomeDir) {
    return [];
  }

  const mounts = new Map<string, { source: string; hostTarget: string; sandboxTarget: string }>();
  for (const relativePath of DEFAULT_HOME_READONLY_PATHS) {
    const source = path.join(hostHomeDir, relativePath);
    appendReadonlyMount(
      mounts,
      source,
      path.join(runtimeHomeDir, relativePath),
      path.posix.join(RUNTIME_HOME_MOUNT_DIR, relativePath.split(path.sep).join('/')),
    );
  }

  for (const identityPath of resolveSshIdentityFiles(hostHomeDir)) {
    const target = resolveRuntimeTargetForHostPath(runtimeHomeDir, hostHomeDir, identityPath);
    if (!target) {
      continue;
    }
    const relativeTarget = path.relative(runtimeHomeDir, target);
    appendReadonlyMount(
      mounts,
      identityPath,
      target,
      path.posix.join(RUNTIME_HOME_MOUNT_DIR, relativeTarget.split(path.sep).join('/')),
    );
  }

  for (const rawPath of parseExtraReadPaths(extraReadsRaw)) {
    const source = expandHomePath(rawPath, hostHomeDir);
    const target = resolveRuntimeTargetForHostPath(runtimeHomeDir, hostHomeDir, source);
    if (!target) {
      continue;
    }
    const relativeTarget = path.relative(runtimeHomeDir, target);
    appendReadonlyMount(
      mounts,
      source,
      target,
      path.posix.join(RUNTIME_HOME_MOUNT_DIR, relativeTarget.split(path.sep).join('/')),
    );
  }

  return Array.from(mounts.values());
}

function appendReadonlyMount(
  mounts: Map<string, { source: string; hostTarget: string; sandboxTarget: string }>,
  source: string,
  hostTarget: string,
  sandboxTarget: string,
): void {
  if (!fs.existsSync(source)) {
    return;
  }
  ensureMountTargetExists(source, hostTarget);
  mounts.set(sandboxTarget, { source, hostTarget, sandboxTarget });
}

function ensureMountTargetExists(source: string, target: string): void {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, '', 'utf8');
  }
}

function parseExtraReadPaths(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandHomePath(rawPath: string, hostHomeDir: string): string {
  if (rawPath === '~') {
    return hostHomeDir;
  }
  if (rawPath.startsWith('~/')) {
    return path.join(hostHomeDir, rawPath.slice(2));
  }
  return path.resolve(rawPath);
}

function resolveRuntimeTargetForHostPath(
  runtimeHomeDir: string,
  hostHomeDir: string,
  sourcePath: string,
): string | undefined {
  const relativePath = path.relative(hostHomeDir, sourcePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return path.join(runtimeHomeDir, relativePath);
}

function resolveHostHomeDir(env: NodeJS.ProcessEnv): string | undefined {
  const home = env.HOME?.trim();
  if (home) {
    return path.resolve(home);
  }
  return undefined;
}

function resolveSshIdentityFiles(hostHomeDir: string): string[] {
  const configPath = path.join(hostHomeDir, SSH_CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) {
    return [];
  }

  const results = new Set<string>();
  const content = fs.readFileSync(configPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = line.match(/^IdentityFile\s+(.+)$/i);
    if (!match) {
      continue;
    }
    const sourcePath = normalizeSshIdentityPath(match[1] ?? '', hostHomeDir);
    if (!sourcePath) {
      continue;
    }
    results.add(sourcePath);
    const publicKeyPath = `${sourcePath}.pub`;
    if (fs.existsSync(publicKeyPath) && fs.statSync(publicKeyPath).isFile()) {
      results.add(publicKeyPath);
    }
  }
  return Array.from(results);
}

function normalizeSshIdentityPath(rawValue: string, hostHomeDir: string): string | undefined {
  const strippedComment = rawValue.replace(/\s+#.*$/, '').trim();
  if (!strippedComment) {
    return undefined;
  }
  const unquoted = strippedComment.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
  if (!unquoted) {
    return undefined;
  }
  if (unquoted === '~' || unquoted.startsWith('~/')) {
    return expandHomePath(unquoted, hostHomeDir);
  }
  if (unquoted.startsWith('%d/')) {
    return path.join(hostHomeDir, unquoted.slice(3));
  }
  if (path.isAbsolute(unquoted)) {
    return path.resolve(unquoted);
  }
  return path.join(hostHomeDir, '.ssh', unquoted);
}

function normalizeArgsForWorkspace(args: string[], workspaceDir: string): string[] {
  const output = [...args];
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  for (let i = 0; i < output.length - 1; i += 1) {
    if (output[i] === '--cd') {
      const requestedDir = path.resolve(output[i + 1]);
      const relativePath = path.relative(resolvedWorkspaceDir, requestedDir);
      if (relativePath === '') {
        output[i + 1] = '/workspace';
        continue;
      }
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        output[i + 1] = path.posix.join('/workspace', relativePath.split(path.sep).join('/'));
      }
    }
  }
  return output;
}

function appendIfExists(target: string[], args: [string, string, string]): void {
  if (fs.existsSync(args[1])) {
    target.push(...args);
  }
}
