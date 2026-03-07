import fs from 'node:fs';
import path from 'node:path';

import { createLogger } from '../utils/logger.js';

const log = createLogger('FeishuApi');

interface FeishuApiOptions {
  appId: string;
  appSecret: string;
  timeoutMs?: number;
  retryOnTimeout?: boolean;
  imageCacheDir?: string;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

export interface FeishuOutgoingMessage {
  msgType: string;
  content: Record<string, unknown> | string;
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
  private readonly retryOnTimeout: boolean;
  private readonly imageCacheDir: string;
  private tokenCache?: TokenCache;
  private tokenInFlight?: Promise<string>;

  constructor(options: FeishuApiOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retryOnTimeout = options.retryOnTimeout ?? false;
    this.imageCacheDir = options.imageCacheDir ?? path.resolve(process.cwd(), '.data', 'feishu-images');
    fs.mkdirSync(this.imageCacheDir, { recursive: true });
    log.debug('FeishuApi 构造完成', {
      appId: this.appId,
      timeoutMs: this.timeoutMs,
      retryOnTimeout: this.retryOnTimeout,
      imageCacheDir: this.imageCacheDir,
    });
  }

  async sendText(openId: string, content: string): Promise<void> {
    const chunks = splitFeishuTextByUtf8Bytes(content);
    for (const chunk of chunks) {
      await this.sendSingleMessage(openId, {
        msgType: 'text',
        content: { text: chunk },
      });
    }
  }

  async sendMessage(openId: string, message: FeishuOutgoingMessage): Promise<void> {
    const msgType = message.msgType.trim();
    if (!msgType) {
      throw new Error('feishu send failed: msgType is required');
    }

    if (msgType === 'text') {
      const textContent = extractTextContent(message.content);
      const chunks = splitFeishuTextByUtf8Bytes(textContent);
      for (const chunk of chunks) {
        await this.sendSingleMessage(openId, {
          msgType: 'text',
          content: { text: chunk },
        });
      }
      return;
    }

    await this.sendSingleMessage(openId, message);
  }

  async downloadImage(imageKey: string): Promise<string> {
    const key = imageKey.trim();
    if (!key) {
      throw new Error('feishu image download failed: imageKey is required');
    }
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const token = await this.getTenantAccessToken();
        const response = await this.fetchWithTimeout(
          `https://open.feishu.cn/open-apis/im/v1/images/${encodeURIComponent(key)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        if (!response.ok) {
          const text = await response.text();
          if (response.status === 401 || response.status === 403) {
            this.tokenCache = undefined;
          }
          throw new Error(`feishu image download failed: ${response.status} ${clipText(text, 200)}`);
        }
        return await writeFeishuBinaryToFile(this.imageCacheDir, key, response, 'image');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error('feishu image download failed: unknown');
  }

  async downloadFile(fileKey: string): Promise<string> {
    const key = fileKey.trim();
    if (!key) {
      throw new Error('feishu file download failed: fileKey is required');
    }
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const token = await this.getTenantAccessToken();
        const response = await this.fetchWithTimeout(
          `https://open.feishu.cn/open-apis/im/v1/files/${encodeURIComponent(key)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        if (!response.ok) {
          const text = await response.text();
          if (response.status === 401 || response.status === 403) {
            this.tokenCache = undefined;
          }
          throw new Error(`feishu file download failed: ${response.status} ${clipText(text, 200)}`);
        }
        return await writeFeishuBinaryToFile(this.imageCacheDir, key, response, 'file');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error('feishu file download failed: unknown');
  }

  async downloadMessageResource(input: {
    messageId: string;
    fileKey: string;
    type: 'image' | 'file' | 'audio' | 'media' | 'sticker';
  }): Promise<string> {
    const messageId = input.messageId.trim();
    const fileKey = input.fileKey.trim();
    if (!messageId || !fileKey) {
      throw new Error('feishu message resource download failed: messageId and fileKey are required');
    }
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const token = await this.getTenantAccessToken();
        const url = new URL(
          `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}`,
        );
        url.searchParams.set('type', input.type);
        const response = await this.fetchWithTimeout(url.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          const text = await response.text();
          if (response.status === 401 || response.status === 403) {
            this.tokenCache = undefined;
          }
          throw new Error(`feishu message resource download failed: ${response.status} ${clipText(text, 200)}`);
        }
        return await writeFeishuBinaryToFile(this.imageCacheDir, fileKey, response, input.type);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw lastError ?? new Error('feishu message resource download failed: unknown');
  }

  private async sendSingleMessage(openId: string, message: FeishuOutgoingMessage): Promise<void> {
    const content = resolveFeishuContentPayload(message.msgType, message.content);
    const requestBody = {
      receive_id: openId,
      msg_type: message.msgType,
      content,
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
        if (isAbortError(lastError) && !this.retryOnTimeout) {
          throw lastError;
        }
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

function isAbortError(error: Error): boolean {
  return error.name === 'AbortError';
}

function extractTextContent(content: FeishuOutgoingMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  const text = content.text;
  return typeof text === 'string' ? text : '';
}

function resolveFeishuContentPayload(msgType: string, content: FeishuOutgoingMessage['content']): string {
  if (typeof content === 'string') {
    if (msgType === 'text') {
      return JSON.stringify({ text: content });
    }
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return content;
    }
    return JSON.stringify(resolveSimpleContent(msgType, content));
  }
  return JSON.stringify(content);
}

function resolveSimpleContent(msgType: string, value: string): Record<string, string> {
  if (msgType === 'image') {
    return { image_key: value };
  }
  if (msgType === 'file' || msgType === 'audio' || msgType === 'sticker') {
    return { file_key: value };
  }
  if (msgType === 'share_chat') {
    return { chat_id: value };
  }
  if (msgType === 'share_user') {
    return { user_id: value };
  }
  if (msgType === 'media') {
    return { file_key: value };
  }
  return { text: value };
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'image';
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function resolveImageExtension(contentType: string): string {
  if (contentType.includes('image/png')) {
    return 'png';
  }
  if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) {
    return 'jpg';
  }
  if (contentType.includes('image/webp')) {
    return 'webp';
  }
  if (contentType.includes('image/gif')) {
    return 'gif';
  }
  return 'bin';
}

function resolveGenericExtension(contentType: string): string {
  if (contentType.includes('image/')) {
    return resolveImageExtension(contentType);
  }
  if (contentType.includes('audio/mpeg')) {
    return 'mp3';
  }
  if (contentType.includes('audio/wav')) {
    return 'wav';
  }
  if (contentType.includes('audio/ogg')) {
    return 'ogg';
  }
  if (contentType.includes('video/mp4')) {
    return 'mp4';
  }
  if (contentType.includes('application/pdf')) {
    return 'pdf';
  }
  if (contentType.includes('text/plain')) {
    return 'txt';
  }
  return 'bin';
}

async function writeFeishuBinaryToFile(
  dir: string,
  key: string,
  response: Response,
  fallbackPrefix: string,
): Promise<string> {
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const ext = resolveGenericExtension(contentType);
  const bytes = Buffer.from(await response.arrayBuffer());
  const filePath = path.join(dir, `${Date.now()}-${fallbackPrefix}-${sanitizeKey(key)}.${ext}`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}
