import { describe, expect, it } from 'vitest';

import { isFeishuUpdateMessageType, normalizeFeishuStructuredMessage } from '../src/utils/feishu-outgoing.js';

describe('normalizeFeishuStructuredMessage', () => {
  it('keeps native markdown messages instead of rewriting them as interactive cards', () => {
    expect(normalizeFeishuStructuredMessage('markdown', '# 标题\n- 列表')).toEqual({
      msgType: 'markdown',
      content: '# 标题\n- 列表',
    });
  });

  it('preserves non-markdown message types', () => {
    expect(normalizeFeishuStructuredMessage('post', 'hello')).toEqual({
      msgType: 'post',
      content: 'hello',
    });
  });
});

describe('isFeishuUpdateMessageType', () => {
  it('allows markdown updates', () => {
    expect(isFeishuUpdateMessageType('markdown')).toBe(true);
  });

  it('still rejects unsupported update types', () => {
    expect(isFeishuUpdateMessageType('image')).toBe(false);
  });
});
