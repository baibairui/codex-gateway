import { describe, expect, it, vi, afterEach } from 'vitest';

import { FeishuOAuthService } from '../src/services/feishu-oauth-service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FeishuOAuthService', () => {
  it('builds auth url with state and redirect uri', () => {
    const service = new FeishuOAuthService({
      appId: 'cli_app_1',
      appSecret: 'secret_1',
      redirectUri: 'https://gateway.example.com/feishu/oauth/callback',
    });

    const url = new URL(service.buildAuthUrl({ state: 'state_1' }));

    expect(url.origin).toBe('https://accounts.feishu.cn');
    expect(url.pathname).toBe('/open-apis/authen/v1/authorize');
    expect(url.searchParams.get('app_id')).toBe('cli_app_1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://gateway.example.com/feishu/oauth/callback');
    expect(url.searchParams.get('state')).toBe('state_1');
  });

  it('exchanges code and refresh token, then reads authorized user info', async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/authen/v2/oauth/token')) {
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        if (body.grant_type === 'authorization_code') {
          expect(body.code).toBe('code_1');
          return new Response(JSON.stringify({
            code: 0,
            data: {
              access_token: 'access_1',
              refresh_token: 'refresh_1',
              expires_in: 7200,
            },
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        expect(body.grant_type).toBe('refresh_token');
        expect(body.refresh_token).toBe('refresh_1');
        return new Response(JSON.stringify({
          code: 0,
          data: {
            access_token: 'access_2',
            refresh_token: 'refresh_2',
            expires_in: 7200,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (input.endsWith('/authen/v1/user_info')) {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer access_2',
        });
        return new Response(JSON.stringify({
          code: 0,
          data: {
            open_id: 'ou_1',
            user_id: 'user_1',
            name: 'Alice',
            en_name: 'Alice',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      throw new Error(`unexpected fetch: ${input}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const service = new FeishuOAuthService({
      appId: 'cli_app_1',
      appSecret: 'secret_1',
      redirectUri: 'https://gateway.example.com/feishu/oauth/callback',
    });

    await expect(service.exchangeCode('code_1')).resolves.toEqual({
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      expiresIn: 7200,
    });
    await expect(service.refreshUserToken('refresh_1')).resolves.toEqual({
      accessToken: 'access_2',
      refreshToken: 'refresh_2',
      expiresIn: 7200,
    });
    await expect(service.getAuthorizedUser('access_2')).resolves.toEqual({
      openId: 'ou_1',
      userId: 'user_1',
      name: 'Alice',
      enName: 'Alice',
    });
  });
});
