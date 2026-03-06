import { createLogger } from '../utils/logger.js';

const log = createLogger('FeishuApi');

interface FeishuApiOptions {
  appId: string;
  appSecret: string;
  timeoutMs?: number;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

const DEFAULT_TEXT_CHUNK_BYTES = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function utf8Bytes(input: string): number {
  return Buffer.byteLength(input, 'utf8');
}

export function splitFeishuTextByUtf8Bytes(content: string, maxBytes = DEFAULT_TEXT_CHUNK_BYTES): string[] {
  if (!content) {
    return [''];
  }
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const ch of content) {
    const bytes = utf8Bytes(ch);
    if (currentBytes + bytes > maxBytes && current) {
      chunks.push(current);
      current = ch;
      currentBytes = bytes;
      continue;
    }
    current += ch;
    currentBytes += bytes;
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export class FeishuApi {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly timeoutMs: number;
  private tokenCache?: TokenCache;
  private tokenInFlight?: Promise<string>;

  constructor(options: FeishuApiOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    log.debug('FeishuApi 构造完成', {
      appId: this.appId,
      timeoutMs: this.timeoutMs,
    });
  }

  async sendText(openId: string, content: string): Promise<void> {
    const chunks = splitFeishuTextByUtf8Bytes(content);
    for (const chunk of chunks) {
      await this.sendSingleText(openId, chunk);
    }
  }

  private async sendSingleText(openId: string, content: string): Promise<void> {
    const requestBody = {
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    };

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const token = await this.getTenantAccessToken();
        const response = await this.fetchWithTimeout(
          'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'content-type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(requestBody),
          },
        );

        const body = (await response.json()) as { code?: number; msg?: string };
        if (response.ok && body.code === 0) {
          return;
        }

        if (body.code === 99991663) {
          this.tokenCache = undefined;
        }
        lastError = new Error(`feishu send failed: ${response.status} ${body.code ?? 'unknown'} ${body.msg ?? 'unknown'}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < 3) {
        await sleep(200 * attempt);
      }
    }

    throw lastError ?? new Error('feishu send failed: unknown');
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && now < this.tokenCache.expiresAt) {
      return this.tokenCache.value;
    }

    if (this.tokenInFlight) {
      return this.tokenInFlight;
    }

    this.tokenInFlight = this.fetchTenantAccessToken();
    try {
      return await this.tokenInFlight;
    } finally {
      this.tokenInFlight = undefined;
    }
  }

  private async fetchTenantAccessToken(): Promise<string> {
    const now = Date.now();
    const response = await this.fetchWithTimeout(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );

    const body = (await response.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (!response.ok || body.code !== 0 || !body.tenant_access_token || !body.expire) {
      throw new Error(`feishu token failed: ${response.status} ${body.code ?? 'unknown'} ${body.msg ?? 'unknown'}`);
    }

    this.tokenCache = {
      value: body.tenant_access_token,
      expiresAt: now + Math.max(0, body.expire - 60) * 1000,
    };
    return this.tokenCache.value;
  }

  private async fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
