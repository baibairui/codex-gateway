import { randomBytes } from 'node:crypto';

type WeixinMessageItem = {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
};

export type WeixinInboundMessage = {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  item_list?: WeixinMessageItem[];
  context_token?: string;
};

export function splitWeixinOutboundText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const segments = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments : [normalized];
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

export class WeixinApi {
  constructor(
    private readonly input: {
      baseUrl: string;
      botToken: string;
      timeoutMs: number;
    },
  ) {}

  async getUpdates(cursor: string): Promise<{ msgs: WeixinInboundMessage[]; get_updates_buf?: string }> {
    return this.post('ilink/bot/getupdates', {
      get_updates_buf: cursor,
      base_info: {},
    });
  }

  async getBotQrCode(botType = '3'): Promise<{ qrcode: string; qrcode_img_content: string }> {
    return this.get(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`);
  }

  async getQrCodeStatus(qrcode: string): Promise<{
    status: 'wait' | 'scaned' | 'confirmed' | 'expired';
    bot_token?: string;
    ilink_bot_id?: string;
    ilink_user_id?: string;
    baseurl?: string;
  }> {
    return this.get(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
      'iLink-App-ClientVersion': '1',
    });
  }

  async sendText(toUserId: string, text: string, contextToken: string): Promise<void> {
    await this.post('ilink/bot/sendmessage', {
      msg: {
        from_user_id: '',
        to_user_id: toUserId,
        client_id: `agentclaw-${Date.now()}`,
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: [
          {
            type: 1,
            text_item: { text },
          },
        ],
      },
      base_info: {},
    });
  }

  async post(endpoint: string, body: unknown): Promise<any> {
    const response = await fetch(new URL(endpoint, ensureTrailingSlash(this.input.baseUrl)), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${this.input.botToken}`,
        'X-WECHAT-UIN': randomWechatUin(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.input.timeoutMs),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`weixin api ${response.status}: ${raw}`);
    }
    return raw ? JSON.parse(raw) : {};
  }

  private async get(endpoint: string, headers: Record<string, string> = {}): Promise<any> {
    const response = await fetch(new URL(endpoint, ensureTrailingSlash(this.input.baseUrl)), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(this.input.timeoutMs),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`weixin api ${response.status}: ${raw}`);
    }
    return raw ? JSON.parse(raw) : {};
  }
}
