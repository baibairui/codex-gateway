#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const cwd = process.cwd();
const envPath = path.join(cwd, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

function asBool(value, defaultValue) {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true';
}

function missingIfEmpty(name) {
  const value = process.env[name];
  return value === undefined || String(value).trim() === '';
}

function commandExists(command) {
  const result = spawnSync('bash', ['-lc', `command -v ${command}`], {
    stdio: 'pipe',
  });
  return result.status === 0;
}

const issues = [];
const warnings = [];
const missingKeys = [];
const nextSteps = [];

const wecomEnabled = asBool(process.env.WECOM_ENABLED, true);
const feishuEnabled = asBool(process.env.FEISHU_ENABLED, false);
const feishuLongConnection = asBool(process.env.FEISHU_LONG_CONNECTION, false);
const runnerEnabled = asBool(process.env.RUNNER_ENABLED, true);
const feishuDocBaseUrl = process.env.FEISHU_DOC_BASE_URL?.trim() || '';
const feishuGroupRequireMention = asBool(process.env.FEISHU_GROUP_REQUIRE_MENTION, true);
const feishuStartupHelpEnabled = asBool(process.env.FEISHU_STARTUP_HELP_ENABLED, false);
const feishuStartupHelpAdminOpenId = process.env.FEISHU_STARTUP_HELP_ADMIN_OPEN_ID?.trim() || '';

if (missingIfEmpty('PORT')) {
  warnings.push('PORT 未配置，将使用默认值 3000。');
}

if (runnerEnabled && missingIfEmpty('CODEX_WORKDIR')) {
  warnings.push('CODEX_WORKDIR 未配置，将使用当前目录。建议配置为你的项目绝对路径。');
  nextSteps.push('补充 CODEX_WORKDIR，确保 Codex 默认在正确项目目录运行。');
}

if (!missingIfEmpty('BROWSER_MCP_URL')) {
  warnings.push('BROWSER_MCP_URL 已废弃且会被忽略；gateway 现在只允许使用内置浏览器 MCP。');
}

if (!commandExists(process.env.CODEX_BIN || 'codex')) {
  issues.push(`未找到 Codex 可执行文件：${process.env.CODEX_BIN || 'codex'}。`);
  nextSteps.push('先确认本机已安装并可执行 codex，或把 CODEX_BIN 改成正确命令。');
}

if (wecomEnabled) {
  const required = [
    'WEWORK_CORP_ID',
    'WEWORK_SECRET',
    'WEWORK_AGENT_ID',
    'WEWORK_TOKEN',
    'WEWORK_ENCODING_AES_KEY',
  ];
  for (const key of required) {
    if (missingIfEmpty(key)) {
      issues.push(`WECOM_ENABLED=true 时缺少 ${key}。`);
      missingKeys.push(key);
    }
  }
}

if (feishuEnabled) {
  const required = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'];
  for (const key of required) {
    if (missingIfEmpty(key)) {
      issues.push(`FEISHU_ENABLED=true 时缺少 ${key}。`);
      missingKeys.push(key);
    }
  }
  if (!feishuLongConnection && missingIfEmpty('FEISHU_VERIFICATION_TOKEN')) {
    warnings.push('当前是飞书 webhook 模式，建议配置 FEISHU_VERIFICATION_TOKEN。');
    nextSteps.push('如果继续使用 webhook 模式，请补齐 FEISHU_VERIFICATION_TOKEN 并确认公网回调地址可访问。');
  }
  if (!feishuDocBaseUrl) {
    warnings.push('未配置 FEISHU_DOC_BASE_URL，后续创建飞书 DocX 时将无法直接返回可访问文档链接。');
    nextSteps.push('如需直接回传飞书文档链接，请补充 FEISHU_DOC_BASE_URL。');
  }
  if (feishuStartupHelpEnabled && !feishuStartupHelpAdminOpenId) {
    warnings.push('FEISHU_STARTUP_HELP_ENABLED=true 但缺少 FEISHU_STARTUP_HELP_ADMIN_OPEN_ID，启动后不会给管理员推送 help。');
    nextSteps.push('如需启动后给管理员推送 help，请补充 FEISHU_STARTUP_HELP_ADMIN_OPEN_ID。');
  }
  nextSteps.push(
    feishuLongConnection
      ? '启动服务后，观察日志或 /healthz，确认飞书当前为 long-connection 模式。'
      : '启动服务后，确认 /feishu/callback 可被飞书访问并通过 url_verification。',
  );
}

if (feishuLongConnection && !feishuEnabled) {
  warnings.push('FEISHU_LONG_CONNECTION=true 但 FEISHU_ENABLED=false，长连接不会启动。');
  nextSteps.push('如果要启用飞书长连接，请同时设置 FEISHU_ENABLED=true。');
}

if (issues.length === 0) {
  console.log('✅ 启动配置检查通过。');
} else {
  console.log('❌ 启动配置检查失败：');
}

if (issues.length > 0) {
  console.log('\n阻塞项：');
  for (const issue of issues) {
    console.log(`- ${issue}`);
  }
  const uniqueMissingKeys = [...new Set(missingKeys)];
  if (uniqueMissingKeys.length > 0) {
    console.log('\n建议补充到 .env：');
    for (const key of uniqueMissingKeys) {
      console.log(`${key}=<please_set>`);
    }
  }
}

console.log('\n当前模式：');
console.log(`- WECOM_ENABLED=${wecomEnabled}`);
console.log(`- FEISHU_ENABLED=${feishuEnabled}`);
console.log(`- FEISHU_LONG_CONNECTION=${feishuLongConnection}`);
console.log(`- RUNNER_ENABLED=${runnerEnabled}`);

console.log('\n飞书安装检查：');
if (!feishuEnabled) {
  console.log('- 状态：未启用飞书（FEISHU_ENABLED=false）');
  nextSteps.push('如需接入飞书，先执行 codexclaw setup 并启用 FEISHU_ENABLED=true。');
} else {
  console.log(`- 接入模式：${feishuLongConnection ? '长连接（不需要公网回调地址）' : 'webhook（需要公网回调地址）'}`);
  console.log(`- App 凭据：${missingIfEmpty('FEISHU_APP_ID') || missingIfEmpty('FEISHU_APP_SECRET') ? '缺失' : '已配置'}`);
  console.log(`- 群聊触发：${feishuGroupRequireMention ? '要求 @ 机器人' : '群内任意消息都触发'}`);
  console.log(`- DocX 链接域名：${feishuDocBaseUrl || '(未配置 FEISHU_DOC_BASE_URL)'}`);
  console.log(`- 启动 help 推送：${feishuStartupHelpEnabled ? '已开启' : '未开启'}`);
  if (feishuStartupHelpEnabled) {
    console.log(`- help 推送管理员：${feishuStartupHelpAdminOpenId || '(未配置 FEISHU_STARTUP_HELP_ADMIN_OPEN_ID)'}`);
  }
  if (feishuLongConnection) {
    console.log('- 下一步：确认飞书事件订阅已开启长连接，启动服务后观察日志中的飞书连接状态。');
  } else {
    console.log('- 下一步：确认飞书事件订阅回调地址可被公网访问，并校验 FEISHU_VERIFICATION_TOKEN。');
  }
}

if (feishuEnabled) {
  console.log('\n验收标准：');
  console.log(`- \`codexclaw doctor\` 没有飞书阻塞项。`);
  console.log(`- 服务启动后，\`/healthz\` 中飞书模式显示为 ${feishuLongConnection ? 'long-connection' : 'webhook'}。`);
  console.log(`- 在飞书私聊机器人发送一条消息，能收到正常回复。`);
  if (!feishuGroupRequireMention) {
    console.log('- 群聊当前配置为“不要求 @ 机器人”，上线前请确认这符合你的预期。');
  }

  console.log('\n飞书安装验收清单：');
  console.log('- 1. 执行 `codexclaw doctor`，确认没有飞书阻塞项。');
  console.log('- 2. 执行 `codexclaw up` 或 `codexclaw start`，确认启动日志打印了“飞书运行状态摘要”。');
  console.log(`- 3. 访问 \`/healthz\`，确认飞书模式显示为 ${feishuLongConnection ? 'long-connection' : 'webhook'}。`);
  console.log('- 4. 在飞书私聊机器人发送一条消息，确认能收到正常回复。');
  if (feishuGroupRequireMention) {
    console.log('- 5. 在飞书群聊中使用 @ 机器人 发送一条消息，确认群聊触发策略符合预期。');
  } else {
    console.log('- 5. 如需启用群聊，先确认当前配置为“不要求 @ 机器人”，再发送一条群消息验证是否符合预期。');
  }
}

if (warnings.length > 0) {
  console.log('\n建议项：');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

if (nextSteps.length > 0) {
  console.log('\n下一步：');
  for (const step of [...new Set(nextSteps)]) {
    console.log(`- ${step}`);
  }
}

if (issues.length > 0) {
  process.exit(1);
}
