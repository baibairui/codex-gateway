import { describe, expect, it } from 'vitest';

import { appendFeishuAttachmentMetadata, extractFeishuBinaryRef } from '../src/utils/feishu-inbound.js';

describe('extractFeishuBinaryRef', () => {
  it('extracts binary ref from normalized feishu file content', () => {
    expect(extractFeishuBinaryRef('[飞书文件] file_key=file_1 file_name=a.pdf file_size=20\nmessage_id=om_1')).toEqual({
      kind: 'file',
      key: 'file_1',
      messageId: 'om_1',
    });
  });

  it('returns undefined for non-binary feishu content', () => {
    expect(extractFeishuBinaryRef('普通文本')).toBeUndefined();
  });
});

describe('appendFeishuAttachmentMetadata', () => {
  it('appends stable metadata block for attachments', () => {
    const content = appendFeishuAttachmentMetadata(
      '[飞书语音] file_key=file_1 duration=3200 file_name=voice.opus mime_type=audio/ogg file_size=1024\nmessage_id=om_1',
      {
        kind: 'audio',
        localPath: '/tmp/voice.opus',
      },
    );

    expect(content).toContain('[飞书附件元数据]');
    expect(content).toContain('feishu_attachment_kind=audio');
    expect(content).toContain('feishu_message_id=om_1');
    expect(content).toContain('feishu_file_key=file_1');
    expect(content).toContain('feishu_file_name=voice.opus');
    expect(content).toContain('feishu_file_size=1024');
    expect(content).toContain('feishu_duration=3200');
    expect(content).toContain('feishu_mime_type=audio/ogg');
    expect(content).toContain('local_audio_path=/tmp/voice.opus');
  });
});
