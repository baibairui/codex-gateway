import { afterEach, describe, expect, it, vi } from 'vitest';

import { WeComApi } from '../src/services/wecom-api.js';

describe('WeComApi token cache', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('uses a single in-flight gettoken request for concurrent sends', async () => {
    let getTokenCalls = 0;
    let sendCalls = 0;

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/cgi-bin/gettoken')) {
        getTokenCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response(
          JSON.stringify({
            errcode: 0,
            access_token: 'token-1',
            expires_in: 7200,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/cgi-bin/message/send')) {
        sendCalls += 1;
        return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const api = new WeComApi({
      corpId: 'corp-id',
      secret: 'secret',
      agentId: 1000002,
      timeoutMs: 2000,
    });

    await Promise.all([
      api.sendText('alice', 'hello'),
      api.sendText('bob', 'world'),
    ]);

    expect(getTokenCalls).toBe(1);
    expect(sendCalls).toBe(2);
  });
});
