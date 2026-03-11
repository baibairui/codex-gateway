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

  if (typeof content === 'string') {
    return { msgType, content };
  }

  const markdownText = typeof content.content === 'string'
    ? content.content
    : (typeof content.text === 'string' ? content.text : '');

  return {
    msgType,
    content: markdownText,
  };
}

export function isFeishuUpdateMessageType(msgType: string): msgType is 'text' | 'markdown' | 'post' | 'interactive' {
  return msgType === 'text' || msgType === 'markdown' || msgType === 'post' || msgType === 'interactive';
}
