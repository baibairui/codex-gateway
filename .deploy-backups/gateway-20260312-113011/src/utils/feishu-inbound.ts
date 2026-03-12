function extractKvMap(content: string): Map<string, string> {
  const kvs = new Map<string, string>();
  for (const match of content.matchAll(/\b([a-zA-Z0-9_]+)=([^\s]+)/g)) {
    const key = match[1]?.trim();
    const value = match[2]?.trim();
    if (key && value) {
      kvs.set(key, value);
    }
  }
  return kvs;
}

export function extractFeishuBinaryRef(content: string): {
  kind: 'image' | 'file' | 'audio' | 'media' | 'sticker';
  key: string;
  messageId?: string;
} | undefined {
  const kvs = extractKvMap(content);
  const messageId = kvs.get('message_id');

  if (content.startsWith('[飞书图片]')) {
    const key = kvs.get('image_key');
    return key ? { kind: 'image', key, messageId } : undefined;
  }
  if (content.startsWith('[飞书文件]')) {
    const key = kvs.get('file_key');
    return key ? { kind: 'file', key, messageId } : undefined;
  }
  if (content.startsWith('[飞书语音]')) {
    const key = kvs.get('file_key');
    return key ? { kind: 'audio', key, messageId } : undefined;
  }
  if (content.startsWith('[飞书媒体]')) {
    const key = kvs.get('file_key');
    return key ? { kind: 'media', key, messageId } : undefined;
  }
  if (content.startsWith('[飞书表情]')) {
    const key = kvs.get('file_key');
    return key ? { kind: 'sticker', key, messageId } : undefined;
  }
  return undefined;
}

export function appendFeishuAttachmentMetadata(
  content: string,
  input: {
    kind: 'image' | 'file' | 'audio' | 'media' | 'sticker';
    localPath?: string;
  },
): string {
  const kvs = extractKvMap(content);
  const lines = [
    'feishu_attachment_kind=' + input.kind,
    kvs.get('message_id') ? `feishu_message_id=${kvs.get('message_id')}` : '',
    kvs.get('file_key') ? `feishu_file_key=${kvs.get('file_key')}` : '',
    kvs.get('image_key') ? `feishu_image_key=${kvs.get('image_key')}` : '',
    kvs.get('file_name') ? `feishu_file_name=${kvs.get('file_name')}` : '',
    kvs.get('file_size') ? `feishu_file_size=${kvs.get('file_size')}` : '',
    kvs.get('duration') ? `feishu_duration=${kvs.get('duration')}` : '',
    kvs.get('mime_type') ? `feishu_mime_type=${kvs.get('mime_type')}` : '',
    input.localPath ? `local_${input.kind}_path=${input.localPath}` : '',
  ].filter(Boolean);

  if (lines.length === 0) {
    return content;
  }
  return `${content}\n[飞书附件元数据]\n${lines.join('\n')}`;
}
