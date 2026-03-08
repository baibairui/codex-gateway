import { describe, expect, it } from 'vitest';

import { isGatewayMessageTypeSupported, parseGatewayStructuredMessage } from '../src/utils/gateway-message.js';

describe('parseGatewayStructuredMessage', () => {
  it('parses plain json gateway message', () => {
    const input = '{"__gateway_message__":true,"msg_type":"text","content":{"text":"hello"}}';
    const parsed = parseGatewayStructuredMessage(input);
    expect(parsed).toEqual({
      __gateway_message__: true,
      msg_type: 'text',
      content: { text: 'hello' },
    });
  });

  it('parses fenced json gateway message', () => {
    const input = '```json\n{"__gateway_message__":true,"msg_type":"POST","content":"hello"}\n```';
    const parsed = parseGatewayStructuredMessage(input);
    expect(parsed).toEqual({
      __gateway_message__: true,
      msg_type: 'post',
      content: 'hello',
    });
  });

  it('returns undefined for invalid gateway payload', () => {
    const input = '{"__gateway_message__":true,"msg_type":"text","content":[1,2]}';
    const parsed = parseGatewayStructuredMessage(input);
    expect(parsed).toBeUndefined();
  });
});

describe('isGatewayMessageTypeSupported', () => {
  it('checks feishu supported message types', () => {
    expect(isGatewayMessageTypeSupported('feishu', 'interactive')).toBe(true);
    expect(isGatewayMessageTypeSupported('feishu', 'markdown')).toBe(true);
  });

  it('checks wecom supported message types', () => {
    expect(isGatewayMessageTypeSupported('wecom', 'markdown')).toBe(true);
    expect(isGatewayMessageTypeSupported('wecom', 'interactive')).toBe(false);
  });
});
