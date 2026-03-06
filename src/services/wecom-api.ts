import { createLogger } from '../utils/logger.js';

const log = createLogger('WeComApi');

interface WeComApiOptions {
  corpId: string;
  secret: string;
  agentId: number;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

export class WeComApi {
  private readonly corpId: string;
  private readonly secret: string;
  private readonly agentId: number;
  private tokenCache?: TokenCache;

  constructor(options: WeComApiOptions) {
    this.corpId = options.corpId;
    this.secret = options.secret;
    this.agentId = options.agentId;
    log.debug('WeComApi 构造完成', {
      corpId: this.corpId,
      agentId: this.agentId,
    });
  }

  async sendText(toUser: string, content: string): Promise<void> {
    log.info('发送文本消息', {
      toUser,
      contentLength: content.length,
      contentPreview: content.substring(0, 200),
    });

    const accessToken = await this.getAccessToken();
    log.debug('sendText 获取 accessToken 成功');

    const requestBody = {
      touser: toUser,
      msgtype: 'text',
      agentid: this.agentId,
      text: {
        content,
      },
      safe: 0,
    };

    const startTime = Date.now();
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const body = (await response.json()) as { errcode?: number; errmsg?: string };
    const elapsed = Date.now() - startTime;

    if (!response.ok || body.errcode !== 0) {
      log.error('发送文本消息失败', {
        toUser,
        httpStatus: response.status,
        errcode: body.errcode,
        errmsg: body.errmsg,
        elapsedMs: elapsed,
      });
      throw new Error(`wecom send failed: ${response.status} ${body.errcode ?? 'unknown'} ${body.errmsg ?? 'unknown'}`);
    }

    log.info('发送文本消息成功', {
      toUser,
      elapsedMs: elapsed,
    });
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && now < this.tokenCache.expiresAt) {
      const remainingMs = this.tokenCache.expiresAt - now;
      log.debug('使用缓存的 accessToken', {
        remainingMs,
        remainingMin: Math.round(remainingMs / 60000),
      });
      return this.tokenCache.value;
    }

    log.info('accessToken 已过期或不存在，重新获取...');
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.secret}`;

    const startTime = Date.now();
    const response = await fetch(url);
    const body = (await response.json()) as {
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    };
    const elapsed = Date.now() - startTime;

    if (!response.ok || body.errcode !== 0 || !body.access_token || !body.expires_in) {
      log.error('获取 accessToken 失败', {
        httpStatus: response.status,
        errcode: body.errcode,
        errmsg: body.errmsg,
        elapsedMs: elapsed,
      });
      throw new Error(`wecom gettoken failed: ${response.status} ${body.errcode ?? 'unknown'} ${body.errmsg ?? 'unknown'}`);
    }

    this.tokenCache = {
      value: body.access_token,
      expiresAt: now + Math.max(0, body.expires_in - 60) * 1000,
    };

    log.info('获取 accessToken 成功', {
      expiresInSeconds: body.expires_in,
      elapsedMs: elapsed,
    });

    return this.tokenCache.value;
  }
}
