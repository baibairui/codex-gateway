import type { WeComIncomingMessage } from './wecom-xml.js';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonObject;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstNonEmpty(values: Array<unknown>): string {
  for (const value of values) {
    const str = asString(value);
    if (str) {
      return str;
    }
  }
  return '';
}

function summarizeKVs(parts: Array<[string, unknown]>): string {
  return parts
    .map(([key, value]) => {
      const str = asString(value);
      return str ? `${key}=${str}` : '';
    })
    .filter(Boolean)
    .join(' ');
}

function appendMetadataBlock(content: string, lines: string[]): string {
  const normalized = lines.map((line) => line.trim()).filter(Boolean);
  if (!normalized.length) {
    return content;
  }
  return `${content}\n[飞书消息元数据]\n${normalized.join('\n')}`;
}

function parseFeishuPostContent(raw: JsonObject): string {
  const locales = Object.values(raw).map(asObject).filter((item): item is JsonObject => !!item);
  if (!locales.length) {
    return '';
  }

  const locale = locales[0];
  const title = asString(locale.title);
  const content = Array.isArray(locale.content) ? locale.content : [];
  const lines: string[] = [];

  for (const row of content) {
    if (!Array.isArray(row)) {
      continue;
    }
    const segments: string[] = [];
    for (const element of row) {
      const obj = asObject(element);
      if (!obj) {
        continue;
      }
      const tag = asString(obj.tag);
      if (tag === 'text') {
        const text = asString(obj.text);
        if (text) {
          segments.push(text);
        }
        continue;
      }
      if (tag === 'a') {
        const text = firstNonEmpty([obj.text, obj.href]);
        if (text) {
          segments.push(text);
        }
        continue;
      }
      if (tag === 'at') {
        const mention = firstNonEmpty([obj.user_name, obj.user_id]);
        if (mention) {
          segments.push(`@${mention}`);
        }
        continue;
      }
      if (tag === 'img') {
        segments.push('[图片]');
        continue;
      }
      if (tag === 'media') {
        segments.push('[媒体]');
        continue;
      }
      if (tag) {
        segments.push(`[${tag}]`);
      }
    }
    const line = segments.join('').trim();
    if (line) {
      lines.push(line);
    }
  }

  return [title, ...lines].filter(Boolean).join('\n').trim();
}

function parseFeishuInteractiveCard(raw: JsonObject): string {
  const header = asObject(raw.header);
  const headerTitle = asObject(header?.title);
  const title = firstNonEmpty([
    headerTitle?.content,
    raw.title,
  ]);
  const kv = summarizeKVs([
    ['template_id', raw.template_id],
    ['callback_id', raw.callback_id],
  ]);
  const plain = title || '收到互动卡片';
  return appendMetadataBlock(
    `[飞书卡片] ${plain}`,
    [
      'feishu_message_type=interactive',
      raw.template_id ? `feishu_template_id=${asString(raw.template_id)}` : '',
      raw.callback_id ? `feishu_callback_id=${asString(raw.callback_id)}` : '',
      kv ? `feishu_summary=${kv.replace(/\s+/g, ';')}` : '',
    ],
  );
}

function parseFeishuShareChat(raw: JsonObject): string {
  const kv = summarizeKVs([
    ['chat_id', raw.chat_id],
    ['chat_name', raw.chat_name],
  ]);
  if (!kv) {
    return '';
  }
  return appendMetadataBlock(
    `[飞书分享群名片] ${kv}`,
    [
      'feishu_message_type=share_chat',
      raw.chat_id ? `feishu_chat_id=${asString(raw.chat_id)}` : '',
      raw.chat_name ? `feishu_chat_name=${asString(raw.chat_name)}` : '',
    ],
  );
}

function parseFeishuShareUser(raw: JsonObject): string {
  const kv = summarizeKVs([
    ['user_id', raw.user_id],
    ['open_id', raw.open_id],
    ['name', raw.name],
    ['display_name', raw.display_name],
    ['tenant_key', raw.tenant_key],
  ]);
  if (!kv) {
    return '';
  }
  return appendMetadataBlock(
    `[飞书分享个人名片] ${kv}`,
    [
      'feishu_message_type=share_user',
      raw.user_id ? `feishu_user_id=${asString(raw.user_id)}` : '',
      raw.open_id ? `feishu_open_id=${asString(raw.open_id)}` : '',
      raw.name ? `feishu_name=${asString(raw.name)}` : '',
      raw.display_name ? `feishu_display_name=${asString(raw.display_name)}` : '',
      raw.tenant_key ? `feishu_tenant_key=${asString(raw.tenant_key)}` : '',
    ],
  );
}

export function normalizeFeishuIncomingMessage(messageType: string, rawContent: string): string {
  const type = messageType.trim().toLowerCase();
  if (!type || !rawContent.trim()) {
    return '';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return '';
  }

  const obj = asObject(parsed);
  if (!obj) {
    return '';
  }

  if (type === 'text') {
    return firstNonEmpty([obj.text_without_at_bot, obj.text]);
  }
  if (type === 'image') {
    const kv = summarizeKVs([['image_key', obj.image_key]]);
    return kv ? `[飞书图片] ${kv}` : '';
  }
  if (type === 'file') {
    const kv = summarizeKVs([
      ['file_key', obj.file_key],
      ['file_name', obj.file_name],
      ['file_size', obj.file_size],
    ]);
    return kv ? `[飞书文件] ${kv}` : '';
  }
  if (type === 'audio') {
    const kv = summarizeKVs([
      ['file_key', obj.file_key],
      ['duration', obj.duration],
      ['file_name', obj.file_name],
      ['mime_type', obj.mime_type],
      ['file_size', obj.file_size],
    ]);
    return kv ? `[飞书语音] ${kv}` : '';
  }
  if (type === 'media') {
    const kv = summarizeKVs([
      ['file_key', obj.file_key],
      ['image_key', obj.image_key],
      ['file_name', obj.file_name],
      ['duration', obj.duration],
      ['file_size', obj.file_size],
      ['mime_type', obj.mime_type],
    ]);
    return kv ? `[飞书媒体] ${kv}` : '';
  }
  if (type === 'sticker') {
    const kv = summarizeKVs([
      ['file_key', obj.file_key],
      ['file_name', obj.file_name],
    ]);
    return kv ? `[飞书表情] ${kv}` : '';
  }
  if (type === 'post') {
    const content = parseFeishuPostContent(obj);
    return content
      ? appendMetadataBlock(`[飞书富文本]\n${content}`, ['feishu_message_type=post'])
      : '';
  }
  if (type === 'interactive') {
    return parseFeishuInteractiveCard(obj);
  }
  if (type === 'share_chat') {
    return parseFeishuShareChat(obj);
  }
  if (type === 'share_user') {
    return parseFeishuShareUser(obj);
  }

  const fallback = summarizeKVs([
    ['text', obj.text],
    ['text_without_at_bot', obj.text_without_at_bot],
    ['title', obj.title],
    ['file_key', obj.file_key],
    ['image_key', obj.image_key],
  ]);
  return fallback ? `[飞书${type}] ${fallback}` : '';
}

export function normalizeWeComIncomingMessage(message: WeComIncomingMessage): string {
  const type = message.msgType.trim().toLowerCase();
  if (!type) {
    return '';
  }

  if (type === 'text') {
    return message.content.trim();
  }
  if (type === 'image') {
    const kv = summarizeKVs([
      ['media_id', message.mediaId],
      ['pic_url', message.picUrl],
    ]);
    return kv ? `[企微图片] ${kv}` : '';
  }
  if (type === 'voice') {
    const kv = summarizeKVs([['media_id', message.mediaId]]);
    return kv ? `[企微语音] ${kv}` : '';
  }
  if (type === 'video' || type === 'shortvideo') {
    const kv = summarizeKVs([
      ['media_id', message.mediaId],
      ['thumb_media_id', message.thumbMediaId],
    ]);
    return kv ? '[企微视频] ' + kv : '';
  }
  if (type === 'file') {
    const kv = summarizeKVs([['media_id', message.mediaId]]);
    return kv ? `[企微文件] ${kv}` : '';
  }
  if (type === 'location') {
    const kv = summarizeKVs([
      ['label', message.label],
      ['x', message.locationX],
      ['y', message.locationY],
    ]);
    return kv ? `[企微位置] ${kv}` : '';
  }
  if (type === 'link') {
    const kv = summarizeKVs([
      ['title', message.title],
      ['url', message.url],
      ['description', message.description],
    ]);
    return kv ? `[企微链接] ${kv}` : '';
  }

  return message.content.trim();
}
