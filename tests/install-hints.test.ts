import { describe, expect, it } from 'vitest';

import { buildStartupFailureHints } from '../bin/lib/install-hints.mjs';

describe('buildStartupFailureHints', () => {
  it('returns generic hints when feishu is disabled', () => {
    expect(buildStartupFailureHints({
      FEISHU_ENABLED: 'false',
    })).toEqual([
      '请先补齐 .env 中缺失项，再重新执行启动命令。',
      '可以先执行 codexclaw doctor 查看阻塞项，再执行 codexclaw setup 逐项补齐配置。',
    ]);
  });

  it('returns long-connection specific feishu hints', () => {
    expect(buildStartupFailureHints({
      FEISHU_ENABLED: 'true',
      FEISHU_LONG_CONNECTION: 'true',
    })).toContain('- 当前是飞书长连接模式，确认飞书事件订阅已启用长连接。');
  });

  it('returns webhook specific feishu hints', () => {
    expect(buildStartupFailureHints({
      FEISHU_ENABLED: 'true',
      FEISHU_LONG_CONNECTION: 'false',
    })).toContain('- 当前是飞书 webhook 模式，确认 FEISHU_VERIFICATION_TOKEN 和公网回调地址可用。');
  });
});
