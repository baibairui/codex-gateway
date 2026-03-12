import { describe, expect, it } from 'vitest';

import { normalizeFeishuIncomingMessage, normalizeWeComIncomingMessage } from '../src/utils/message-normalizer.js';

describe('normalizeFeishuIncomingMessage', () => {
  it('parses text messages', () => {
    const content = normalizeFeishuIncomingMessage('text', JSON.stringify({ text: '你好' }));
    expect(content).toBe('你好');
  });

  it('prefers text_without_at_bot for text messages', () => {
    const content = normalizeFeishuIncomingMessage('text', JSON.stringify({
      text: '@机器人 帮我总结',
      text_without_at_bot: '帮我总结',
    }));
    expect(content).toBe('帮我总结');
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
    expect(content).toContain('[飞书消息元数据]');
    expect(content).toContain('feishu_message_type=post');
  });

  it('parses interactive card messages', () => {
    const content = normalizeFeishuIncomingMessage(
      'interactive',
      JSON.stringify({
        header: {
          title: { content: '报警卡片' },
        },
        template_id: 'ctp_xxx',
        callback_id: 'cb_alarm',
      }),
    );
    expect(content).toContain('[飞书卡片] 报警卡片');
    expect(content).toContain('[飞书消息元数据]');
    expect(content).toContain('feishu_message_type=interactive');
    expect(content).toContain('feishu_template_id=ctp_xxx');
    expect(content).toContain('feishu_callback_id=cb_alarm');
  });

  it('parses share chat and share user messages', () => {
    const shareChat = normalizeFeishuIncomingMessage('share_chat', JSON.stringify({
      chat_id: 'oc_123',
      chat_name: '项目讨论组',
    }));
    const shareUser = normalizeFeishuIncomingMessage('share_user', JSON.stringify({
      user_id: 'ou_123',
      open_id: 'ou_open_123',
      name: '白瑞',
      tenant_key: 'tenant_x',
    }));
    expect(shareChat).toContain('[飞书分享群名片] chat_id=oc_123 chat_name=项目讨论组');
    expect(shareChat).toContain('feishu_message_type=share_chat');
    expect(shareChat).toContain('feishu_chat_id=oc_123');
    expect(shareChat).toContain('feishu_chat_name=项目讨论组');
    expect(shareUser).toContain('[飞书分享个人名片] user_id=ou_123 open_id=ou_open_123 name=白瑞 tenant_key=tenant_x');
    expect(shareUser).toContain('feishu_message_type=share_user');
    expect(shareUser).toContain('feishu_user_id=ou_123');
    expect(shareUser).toContain('feishu_open_id=ou_open_123');
    expect(shareUser).toContain('feishu_name=白瑞');
    expect(shareUser).toContain('feishu_tenant_key=tenant_x');
  });

  it('preserves stable metadata for file, audio, media and sticker messages', () => {
    const file = normalizeFeishuIncomingMessage('file', JSON.stringify({
      file_key: 'file_1',
      file_name: 'spec.pdf',
      file_size: '2048',
    }));
    const audio = normalizeFeishuIncomingMessage('audio', JSON.stringify({
      file_key: 'audio_1',
      duration: '3200',
      file_name: 'voice.opus',
      mime_type: 'audio/ogg',
      file_size: '1024',
    }));
    const media = normalizeFeishuIncomingMessage('media', JSON.stringify({
      file_key: 'media_1',
      image_key: 'img_1',
      file_name: 'video.mp4',
      duration: '8800',
      file_size: '4096',
      mime_type: 'video/mp4',
    }));
    const sticker = normalizeFeishuIncomingMessage('sticker', JSON.stringify({
      file_key: 'stk_1',
      file_name: 'happy.webp',
    }));

    expect(file).toBe('[飞书文件] file_key=file_1 file_name=spec.pdf file_size=2048');
    expect(audio).toBe('[飞书语音] file_key=audio_1 duration=3200 file_name=voice.opus mime_type=audio/ogg file_size=1024');
    expect(media).toBe('[飞书媒体] file_key=media_1 image_key=img_1 file_name=video.mp4 duration=8800 file_size=4096 mime_type=video/mp4');
    expect(sticker).toBe('[飞书表情] file_key=stk_1 file_name=happy.webp');
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
