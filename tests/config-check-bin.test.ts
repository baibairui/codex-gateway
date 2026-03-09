import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const configCheckPath = new URL('../bin/config-check.mjs', import.meta.url);
const codexclawPath = new URL('../bin/codexclaw.mjs', import.meta.url);

describe('config-check bin', () => {
  it('prints feishu long connection status and next step', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-check-'));
    fs.writeFileSync(path.join(dir, '.env'), [
      'WECOM_ENABLED=false',
      'FEISHU_ENABLED=true',
      'FEISHU_APP_ID=cli_xxx',
      'FEISHU_APP_SECRET=sec_xxx',
      'FEISHU_LONG_CONNECTION=true',
      'FEISHU_GROUP_REQUIRE_MENTION=true',
      'FEISHU_DOC_BASE_URL=https://tenant.feishu.cn/docx',
      'RUNNER_ENABLED=false',
      'CODEX_BIN=node',
    ].join('\n'));

    const result = spawnSync('node', [configCheckPath.pathname], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        FEISHU_APP_ID: 'cli_xxx',
        FEISHU_APP_SECRET: 'sec_xxx',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('飞书安装检查');
    expect(result.stdout).toContain('接入模式：长连接（不需要公网回调地址）');
    expect(result.stdout).toContain('验收标准：');
    expect(result.stdout).toContain('飞书安装验收清单：');
    expect(result.stdout).toContain('确认启动日志打印了“飞书运行状态摘要”');
    expect(result.stdout).toContain('/healthz');
    expect(result.stdout).toContain('下一步：确认飞书事件订阅已开启长连接');
    expect(result.stdout).toContain('下一步：');
  });

  it('groups blocking items and env hints when feishu credentials are missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-check-'));
    fs.writeFileSync(path.join(dir, '.env'), [
      'WECOM_ENABLED=false',
      'FEISHU_ENABLED=true',
      'FEISHU_LONG_CONNECTION=true',
      'RUNNER_ENABLED=false',
      'CODEX_BIN=node',
    ].join('\n'));

    const result = spawnSync('node', [configCheckPath.pathname], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        FEISHU_APP_ID: '',
        FEISHU_APP_SECRET: '',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('阻塞项：');
    expect(result.stdout).toContain('FEISHU_ENABLED=true 时缺少 FEISHU_APP_ID');
    expect(result.stdout).toContain('建议补充到 .env：');
    expect(result.stdout).toContain('FEISHU_APP_ID=<please_set>');
  });

  it('shows doctor in codexclaw help', () => {
    const result = spawnSync('node', [codexclawPath.pathname, 'help'], {
      cwd: path.resolve(path.dirname(codexclawPath.pathname), '..'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('doctor');
    expect(result.stdout).toContain('安装自检');
  });
});
