import { describe, expect, it } from 'vitest';

import { normalizeFeishuIncomingMessage, normalizeWeComIncomingMessage } from '../src/utils/message-normalizer.js';

describe('normalizeFeishuIncomingMessage', () => {
  it('parses text messages', () => {
    const content = normalizeFeishuIncomingMessage('text', JSON.stringify({ text: '你好' }));
    expect(content).toBe('你好');
  });

  it('parses image messages', () => {
    const content = normalizeFeishuIncomingMessage('image', JSON.stringify({ image_key: 'img_123' }));
    expect(content).toBe('[飞书图片] image_key=img_123');
  });

  it('parses post messages', () => {
    const content = normalizeFeishuIncomingMessage(
      'post',
      JSON.stringify({
        zh_cn: {
          title: '日报',
          content: [[{ tag: 'text', text: '今天完成 A' }, { tag: 'img', image_key: 'img_1' }]],
        },
      }),
    );
    expect(content).toContain('[飞书富文本]');
    expect(content).toContain('日报');
    expect(content).toContain('今天完成 A');
    expect(content).toContain('[图片]');
  });

  it('parses interactive card messages', () => {
    const content = normalizeFeishuIncomingMessage(
      'interactive',
      JSON.stringify({
        header: {
          title: { content: '报警卡片' },
        },
      }),
    );
    expect(content).toBe('[飞书卡片] 报警卡片');
  });

  it('parses share chat and share user messages', () => {
    const shareChat = normalizeFeishuIncomingMessage('share_chat', JSON.stringify({ chat_id: 'oc_123' }));
    const shareUser = normalizeFeishuIncomingMessage('share_user', JSON.stringify({ user_id: 'ou_123' }));
    expect(shareChat).toBe('[飞书分享群名片] chat_id=oc_123');
    expect(shareUser).toBe('[飞书分享个人名片] user_id=ou_123');
  });
});

describe('normalizeWeComIncomingMessage', () => {
  it('parses image messages', () => {
    const content = normalizeWeComIncomingMessage({
      toUserName: 'agent',
      fromUserName: 'u1',
      msgType: 'image',
      content: '',
      mediaId: 'media_1',
      picUrl: 'https://example.com/pic.jpg',
    });
    expect(content).toBe('[企微图片] media_id=media_1 pic_url=https://example.com/pic.jpg');
  });

  it('parses location messages', () => {
    const content = normalizeWeComIncomingMessage({
      toUserName: 'agent',
      fromUserName: 'u1',
      msgType: 'location',
      content: '',
      label: '上海市',
      locationX: '31.23',
      locationY: '121.47',
    });
    expect(content).toBe('[企微位置] label=上海市 x=31.23 y=121.47');
  });
});
