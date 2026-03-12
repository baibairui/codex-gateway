const FEISHU_AUTH_BASE = 'https://accounts.feishu.cn/open-apis';

export interface FeishuOAuthServiceOptions {
  appId: string;
  appSecret: string;
  redirectUri: string;
  authBaseUrl?: string;
}

export interface FeishuUserTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface FeishuAuthorizedUser {
  openId: string;
  userId: string;
  name?: string;
  enName?: string;
}

export class FeishuOAuthService {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;
  private readonly authBaseUrl: string;

  constructor(options: FeishuOAuthServiceOptions) {
    this.appId = options.appId.trim();
    this.appSecret = options.appSecret.trim();
    this.redirectUri = options.redirectUri.trim();
    this.authBaseUrl = (options.authBaseUrl ?? FEISHU_AUTH_BASE).replace(/\/+$/, '');
  }

  buildAuthUrl(input: { state: string }): string {
    const url = new URL(`${this.authBaseUrl}/authen/v1/authorize`);
    url.searchParams.set('app_id', this.appId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<FeishuUserTokenPayload> {
    return this.exchangeToken({
      grant_type: 'authorization_code',
      code: code.trim(),
    });
  }

  async refreshUserToken(refreshToken: string): Promise<FeishuUserTokenPayload> {
    return this.exchangeToken({
      grant_type: 'refresh_token',
      refresh_token: refreshToken.trim(),
    });
  }

  async getAuthorizedUser(accessToken: string): Promise<FeishuAuthorizedUser> {
    const payload = await requestJson(`${this.authBaseUrl}/authen/v1/user_info`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
      },
    });
    const data = asObject(payload.data);
    return {
      openId: stringField(data?.open_id),
      userId: stringField(data?.user_id),
      name: optionalStringField(data?.name),
      enName: optionalStringField(data?.en_name),
    };
  }

  private async exchangeToken(body: Record<string, string>): Promise<FeishuUserTokenPayload> {
    const payload = await requestJson(`${this.authBaseUrl}/authen/v2/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        client_id: this.appId,
        client_secret: this.appSecret,
        redirect_uri: this.redirectUri,
        ...body,
      }),
    });
    const data = asObject(payload.data);
    return {
      accessToken: stringField(data?.access_token),
      refreshToken: stringField(data?.refresh_token),
      expiresIn: numberField(data?.expires_in),
    };
  }
}

async function requestJson(input: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(input, init);
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(`feishu oauth failed: ${String(payload.code ?? response.status)} ${String(payload.msg ?? 'unknown error')}`);
  }
  return payload;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('feishu oauth failed: missing required string field');
  }
  return value.trim();
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error('feishu oauth failed: missing required number field');
  }
  return normalized;
}
