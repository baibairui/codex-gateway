function asBool(value, defaultValue = false) {
  if (value === undefined) {
    return defaultValue;
  }
  return String(value).trim().toLowerCase() === 'true';
}

export function buildStartupFailureHints(env = process.env) {
  const lines = [
    '请先补齐 .env 中缺失项，再重新执行启动命令。',
    '可以先执行 codexclaw doctor 查看阻塞项，再执行 codexclaw setup 逐项补齐配置。',
  ];

  if (!asBool(env.FEISHU_ENABLED, false)) {
    return lines;
  }

  lines.push('飞书专项提示：');
  lines.push('- 检查 FEISHU_APP_ID / FEISHU_APP_SECRET 是否已配置。');
  if (asBool(env.FEISHU_LONG_CONNECTION, false)) {
    lines.push('- 当前是飞书长连接模式，确认飞书事件订阅已启用长连接。');
  } else {
    lines.push('- 当前是飞书 webhook 模式，确认 FEISHU_VERIFICATION_TOKEN 和公网回调地址可用。');
  }
  lines.push('- 启动后可通过启动日志和 /healthz 验证飞书模式与触发策略。');
  return lines;
}
