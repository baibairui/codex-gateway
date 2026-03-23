export function normalizeFeishuStructuredMessage(
  msgType: string,
  content: Record<string, unknown> | string,
): {
  msgType: string;
  content: Record<string, unknown> | string;
} {
  if (msgType !== 'markdown') {
    return { msgType, content };
  }
  const markdownText = typeof content === 'string'
    ? content
    : (typeof content.content === 'string'
      ? content.content
      : (typeof content.text === 'string' ? content.text : ''));
  const normalized = markdownText.trim();
  return {
    msgType: 'markdown',
    content: normalized || '(empty markdown)',
  };
}

export function isFeishuUpdateMessageType(msgType: string): msgType is 'text' | 'post' {
  return msgType === 'text' || msgType === 'post';
}
