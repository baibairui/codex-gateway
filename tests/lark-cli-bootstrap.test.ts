import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureLarkCliReady } from '../src/services/lark-cli-bootstrap.js';

const originalEnv = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
};

function writeExecutable(filePath: string, content = '#!/bin/sh\nexit 0\n'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function writeSkill(rootDir: string, skillName: string): void {
  const skillDir = path.join(rootDir, '.codex', 'skills', skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${skillName}\n`, 'utf8');
}

describe('ensureLarkCliReady', () => {
  afterEach(() => {
    process.env.HOME = originalEnv.HOME;
    process.env.PATH = originalEnv.PATH;
  });

  it('syncs lark-cli config into the runtime home', async () => {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lark-cli-bootstrap-'));
    const hostHomeDir = path.join(sandboxDir, 'host-home');
    const gatewayRootDir = path.join(sandboxDir, 'gateway');
    const codexHomeDir = path.join(gatewayRootDir, '.data', 'codex-home');
    const runtimeLarkCliDir = path.join(gatewayRootDir, '.codex-runtime', 'home', '.lark-cli');
    const runtimeLarkCliDataDir = path.join(gatewayRootDir, '.codex-runtime', 'home', '.local', 'share', 'lark-cli');
    const codexLarkCliDir = path.join(codexHomeDir, '.lark-cli');
    const codexLarkCliDataDir = path.join(codexHomeDir, '.local', 'share', 'lark-cli');
    const fakeBinDir = path.join(sandboxDir, 'bin');

    writeExecutable(path.join(fakeBinDir, 'lark-cli'));
    for (const skillName of ['lark-shared', 'lark-doc', 'lark-calendar', 'lark-task', 'lark-wiki']) {
      writeSkill(hostHomeDir, skillName);
    }

    fs.mkdirSync(codexLarkCliDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexLarkCliDir, 'config.json'),
      JSON.stringify({
        apps: [
          {
            appId: 'cli_test',
            users: [{ name: 'demo-user' }],
          },
        ],
      }),
      'utf8',
    );
    fs.mkdirSync(codexLarkCliDataDir, { recursive: true });
    fs.writeFileSync(path.join(codexLarkCliDataDir, 'master.key'), 'master-key', 'utf8');
    fs.writeFileSync(path.join(codexLarkCliDataDir, 'appsecret_cli_test.enc'), 'encrypted-app-secret', 'utf8');

    process.env.HOME = hostHomeDir;
    process.env.PATH = `${fakeBinDir}${path.delimiter}${originalEnv.PATH ?? ''}`;

    await ensureLarkCliReady({
      gatewayRootDir,
      codexHomeDir,
    });

    expect(fs.readFileSync(path.join(runtimeLarkCliDir, 'config.json'), 'utf8')).toContain('demo-user');
    expect(fs.readFileSync(path.join(runtimeLarkCliDataDir, 'master.key'), 'utf8')).toBe('master-key');
    expect(fs.readFileSync(path.join(runtimeLarkCliDataDir, 'appsecret_cli_test.enc'), 'utf8')).toBe('encrypted-app-secret');
  });
});
