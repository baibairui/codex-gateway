import { describe, expect, it } from 'vitest';

import { isFeishuUpdateMessageType, normalizeFeishuStructuredMessage } from '../src/utils/feishu-outgoing.js';

describe('normalizeFeishuStructuredMessage', () => {
  it('rewrites markdown messages as interactive cards for Feishu rendering', () => {
    expect(normalizeFeishuStructuredMessage('markdown', '# 标题\n- 列表')).toEqual({
      msgType: 'interactive',
      content: {
        schema: '2.0',
        config: {
          wide_screen_mode: true,
        },
        body: {
          elements: [
            {
              tag: 'markdown',
              content: '# 标题\n- 列表',
            },
          ],
        },
      },
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
  it('does not treat raw markdown as a direct update type', () => {
    expect(isFeishuUpdateMessageType('markdown')).toBe(false);
  });

  it('still rejects unsupported update types', () => {
    expect(isFeishuUpdateMessageType('image')).toBe(false);
  });
});
