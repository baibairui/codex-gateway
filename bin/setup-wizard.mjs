#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import dotenv from 'dotenv';

const cwd = process.cwd();
const envPath = path.join(cwd, '.env');
const examplePath = path.join(cwd, '.env.example');

const existingEnv = fs.existsSync(envPath)
  ? dotenv.parse(fs.readFileSync(envPath, 'utf8'))
  : {};
const envLines = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  : [];

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function paint(color, text) {
  return `${color}${text}${c.reset}`;
}

function normalizeBoolean(value, fallback = 'false') {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' ? 'true' : 'false';
}

function getDefault(key, fallback = '') {
  if (existingEnv[key] !== undefined && String(existingEnv[key]).trim() !== '') {
    return String(existingEnv[key]).trim();
  }
  return fallback;
}

function printFeishuNextSteps(values) {
  if (values.FEISHU_ENABLED !== 'true') {
    return;
  }
  const longConnection = values.FEISHU_LONG_CONNECTION === 'true';
  const requireMention = values.FEISHU_GROUP_REQUIRE_MENTION !== 'false';
  const docBaseUrl = String(values.FEISHU_DOC_BASE_URL ?? '').trim();

  console.log(`\n${paint(c.bold, '飞书下一步清单')}`);
  console.log(`- 接入模式：${longConnection ? '长连接（不需要公网回调地址）' : 'webhook（需要公网回调地址）'}`);
  console.log(`- 群聊触发：${requireMention ? '要求 @ 机器人' : '群内任意消息都触发'}`);
  console.log(`- DocX 链接域名：${docBaseUrl || '(未配置，可后续补充 FEISHU_DOC_BASE_URL)'}`);
  if (longConnection) {
    console.log('- 去飞书开放平台确认事件订阅已启用长连接，并检查机器人权限范围。');
  } else {
    console.log('- 去飞书开放平台配置可公网访问的 webhook 回调地址，并校验 Verification Token。');
  }
  console.log('- 执行 codexclaw doctor，确认当前模式、缺失配置和下一步提示。');
  console.log('- 执行 codexclaw up，启动后用 /healthz 或启动日志确认飞书状态。');
}

function setEnvValue(key, value) {
  const line = `${key}=${value}`;
  const index = envLines.findIndex((item) => item.startsWith(`${key}=`));
  if (index >= 0) {
    envLines[index] = line;
    return;
  }
  envLines.push(line);
}

function escapeValue(value) {
  const text = String(value ?? '');
  if (text === '') {
    return '';
  }
  if (/[\s#"'`]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

async function askLine(rl, { key, label, defaultValue, required = false }) {
  while (true) {
    const suffix = defaultValue !== '' ? ` [默认: ${defaultValue}]` : '';
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    const finalValue = answer === '' ? defaultValue : answer;
    if (required && finalValue === '') {
      console.log(`- ${key} 不能为空，请重新输入。`);
      continue;
    }
    return finalValue;
  }
}

async function askBoolean(rl, { label, defaultValue }) {
  while (true) {
    const answer = (await rl.question(`${label} (y/n) [默认: ${defaultValue ? 'y' : 'n'}]: `))
      .trim()
      .toLowerCase();
    if (answer === '') {
      return defaultValue;
    }
    if (['y', 'yes', 'true', '1'].includes(answer)) {
      return true;
    }
    if (['n', 'no', 'false', '0'].includes(answer)) {
      return false;
    }
    console.log(paint(c.yellow, '请输入 y 或 n。'));
  }
}

async function askChoice(rl, { label, options, defaultIndex }) {
  while (true) {
    console.log(`\n${paint(c.cyan, label)}`);
    options.forEach((item, index) => {
      const mark = index === defaultIndex ? paint(c.green, ' (默认)') : '';
      console.log(`  ${index + 1}) ${item.label}${mark}`);
    });
    const answer = (await rl.question(`请选择 [1-${options.length}] (默认 ${defaultIndex + 1}): `)).trim();
    if (answer === '') {
      return options[defaultIndex].value;
    }
    const selected = Number(answer);
    if (!Number.isNaN(selected) && selected >= 1 && selected <= options.length) {
      return options[selected - 1].value;
    }
    console.log(paint(c.yellow, `请输入 1-${options.length} 之间的数字。`));
  }
}

async function main() {
  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    envLines.push(...fs.readFileSync(envPath, 'utf8').split(/\r?\n/));
    console.log(paint(c.green, '已从 .env.example 初始化 .env'));
  }

  const rl = createInterface({ input, output });
  console.log(paint(c.bold, '\n=== codexclaw 配置向导（逐行）==='));
  console.log(paint(c.dim, '直接回车可使用默认值。'));

  const values = {};
  console.log(`\n${paint(c.cyan, 'Step 1/4: 基础配置')}`);
  values.PORT = await askLine(rl, {
    key: 'PORT',
    label: '服务端口 PORT',
    defaultValue: getDefault('PORT', '3000'),
    required: true,
  });
  values.CODEX_BIN = await askLine(rl, {
    key: 'CODEX_BIN',
    label: 'Codex 可执行命令 CODEX_BIN',
    defaultValue: getDefault('CODEX_BIN', 'codex'),
    required: true,
  });
  values.CODEX_WORKDIR = await askLine(rl, {
    key: 'CODEX_WORKDIR',
    label: '默认工作目录 CODEX_WORKDIR（绝对路径）',
    defaultValue: getDefault('CODEX_WORKDIR', cwd),
    required: true,
  });
  values.CODEX_SANDBOX = await askLine(rl, {
    key: 'CODEX_SANDBOX',
    label: '沙箱模式 CODEX_SANDBOX（full-auto/none）',
    defaultValue: getDefault('CODEX_SANDBOX', 'full-auto'),
    required: true,
  });

  values.RUNNER_ENABLED = String(
    await askBoolean(rl, {
      label: '是否启用 RUNNER_ENABLED',
      defaultValue: normalizeBoolean(getDefault('RUNNER_ENABLED', 'true'), 'true') === 'true',
    }),
  );
  values.CODEX_SEARCH = String(
    await askBoolean(rl, {
      label: '是否默认开启联网搜索 CODEX_SEARCH',
      defaultValue: normalizeBoolean(getDefault('CODEX_SEARCH', 'false'), 'false') === 'true',
    }),
  );

  const defaultPlatform = (() => {
    const wecom = normalizeBoolean(getDefault('WECOM_ENABLED', 'true'), 'true') === 'true';
    const feishu = normalizeBoolean(getDefault('FEISHU_ENABLED', 'false'), 'false') === 'true';
    if (wecom && feishu) {
      return 2;
    }
    if (feishu) {
      return 1;
    }
    return 0;
  })();

  const platform = await askChoice(rl, {
    label: 'Step 2/4: 请选择要启用的平台',
    options: [
      { label: '仅企业微信', value: 'wecom' },
      { label: '仅飞书', value: 'feishu' },
      { label: '企业微信 + 飞书', value: 'both' },
    ],
    defaultIndex: defaultPlatform,
  });

  const wecomEnabled = platform === 'wecom' || platform === 'both';
  const feishuEnabled = platform === 'feishu' || platform === 'both';

  values.WECOM_ENABLED = String(wecomEnabled);
  if (wecomEnabled) {
    console.log(`\n${paint(c.cyan, 'Step 3/4: 企业微信配置')}`);
    values.WEWORK_CORP_ID = await askLine(rl, {
      key: 'WEWORK_CORP_ID',
      label: '企业微信 WEWORK_CORP_ID',
      defaultValue: getDefault('WEWORK_CORP_ID', ''),
      required: true,
    });
    values.WEWORK_SECRET = await askLine(rl, {
      key: 'WEWORK_SECRET',
      label: '企业微信 WEWORK_SECRET',
      defaultValue: getDefault('WEWORK_SECRET', ''),
      required: true,
    });
    values.WEWORK_AGENT_ID = await askLine(rl, {
      key: 'WEWORK_AGENT_ID',
      label: '企业微信 WEWORK_AGENT_ID',
      defaultValue: getDefault('WEWORK_AGENT_ID', ''),
      required: true,
    });
    values.WEWORK_TOKEN = await askLine(rl, {
      key: 'WEWORK_TOKEN',
      label: '企业微信回调 WEWORK_TOKEN',
      defaultValue: getDefault('WEWORK_TOKEN', ''),
      required: true,
    });
    values.WEWORK_ENCODING_AES_KEY = await askLine(rl, {
      key: 'WEWORK_ENCODING_AES_KEY',
      label: '企业微信回调 WEWORK_ENCODING_AES_KEY',
      defaultValue: getDefault('WEWORK_ENCODING_AES_KEY', ''),
      required: true,
    });
  }

  values.FEISHU_ENABLED = String(feishuEnabled);
  if (feishuEnabled) {
    console.log(`\n${paint(c.cyan, 'Step 4/4: 飞书配置')}`);
    values.FEISHU_APP_ID = await askLine(rl, {
      key: 'FEISHU_APP_ID',
      label: '飞书 FEISHU_APP_ID',
      defaultValue: getDefault('FEISHU_APP_ID', ''),
      required: true,
    });
    values.FEISHU_APP_SECRET = await askLine(rl, {
      key: 'FEISHU_APP_SECRET',
      label: '飞书 FEISHU_APP_SECRET',
      defaultValue: getDefault('FEISHU_APP_SECRET', ''),
      required: true,
    });
    const longConnection = await askBoolean(rl, {
      label: '是否启用飞书长连接 FEISHU_LONG_CONNECTION',
      defaultValue:
        normalizeBoolean(getDefault('FEISHU_LONG_CONNECTION', 'true'), 'true') === 'true',
    });
    values.FEISHU_LONG_CONNECTION = String(longConnection);
    if (!longConnection) {
      values.FEISHU_VERIFICATION_TOKEN = await askLine(rl, {
        key: 'FEISHU_VERIFICATION_TOKEN',
        label: '飞书 webhook 校验 FEISHU_VERIFICATION_TOKEN',
        defaultValue: getDefault('FEISHU_VERIFICATION_TOKEN', ''),
        required: true,
      });
    }
    values.FEISHU_GROUP_REQUIRE_MENTION = String(
      await askBoolean(rl, {
        label: '群聊是否默认要求 @ 机器人 FEISHU_GROUP_REQUIRE_MENTION',
        defaultValue:
          normalizeBoolean(getDefault('FEISHU_GROUP_REQUIRE_MENTION', 'true'), 'true') === 'true',
      }),
    );
    values.FEISHU_DOC_BASE_URL = await askLine(rl, {
      key: 'FEISHU_DOC_BASE_URL',
      label: '飞书文档访问域名 FEISHU_DOC_BASE_URL（可选）',
      defaultValue: getDefault('FEISHU_DOC_BASE_URL', ''),
      required: false,
    });
  }

  rl.close();

  for (const [key, value] of Object.entries(values)) {
    setEnvValue(key, escapeValue(value));
  }

  fs.writeFileSync(envPath, `${envLines.join('\n').replace(/\n*$/, '\n')}`, 'utf8');
  console.log(`\n${paint(c.green, '✅ .env 已更新完成。')}`);
  printFeishuNextSteps(values);
  console.log(paint(c.bold, '正在执行配置检查...\n'));

  const checkResult = spawnSync('node', ['./bin/config-check.mjs'], {
    cwd,
    stdio: 'inherit',
  });
  process.exit(checkResult.status ?? 0);
}

main().catch((error) => {
  console.error(paint(c.red, `配置向导执行失败: ${error?.message || error}`));
  process.exit(1);
});
