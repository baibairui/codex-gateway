type Channel = 'wecom' | 'feishu';

export interface GatewayStructuredMessage {
  __gateway_message__: true;
  msg_type: string;
  content: Record<string, unknown> | string;
}

const FEISHU_SUPPORTED_TYPES = new Set([
  'text',
  'post',
  'image',
  'file',
  'audio',
  'media',
  'sticker',
  'interactive',
  'share_chat',
  'share_user',
]);

const WECOM_SUPPORTED_TYPES = new Set([
  'text',
  'markdown',
  'image',
  'voice',
  'video',
  'file',
]);

function parseJsonSource(content: string): Record<string, unknown> | undefined {
  const trimmed = content.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : undefined;
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (!fenced?.[1]) {
    return undefined;
  }
  const parsed = JSON.parse(fenced[1]);
  return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : undefined;
}

export function parseGatewayStructuredMessage(content: string): GatewayStructuredMessage | undefined {
  try {
    const parsed = parseJsonSource(content);
    if (!parsed) {
      return undefined;
    }
    if (parsed.__gateway_message__ !== true) {
      return undefined;
    }
    if (typeof parsed.msg_type !== 'string') {
      return undefined;
    }
    const normalizedType = parsed.msg_type.trim().toLowerCase();
    if (!normalizedType) {
      return undefined;
    }
    const payload = parsed.content;
    if (!(typeof payload === 'string' || (payload && typeof payload === 'object' && !Array.isArray(payload)))) {
      return undefined;
    }
    return {
      __gateway_message__: true,
      msg_type: normalizedType,
      content: payload as Record<string, unknown> | string,
    };
  } catch {
    return undefined;
  }
}

export function isGatewayMessageTypeSupported(channel: Channel, msgType: string): boolean {
  const normalized = msgType.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (channel === 'feishu') {
    return FEISHU_SUPPORTED_TYPES.has(normalized);
  }
  return WECOM_SUPPORTED_TYPES.has(normalized);
}

