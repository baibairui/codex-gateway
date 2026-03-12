import fs from 'node:fs';
import path from 'node:path';

import { createLogger } from '../utils/logger.js';

const log = createLogger('WeComApi');

interface WeComApiOptions {
  corpId: string;
  secret: string;
  agentId: number;
  timeoutMs?: number;
  retryOnTimeout?: boolean;
}

interface TokenCache {
  value: string;
  expiresAt: number;
}

export interface WeComOutgoingMessage {
  msgType: string;
  content: Record<string, unknown> | string;
}

const DEFAULT_TEXT_CHUNK_BYTES = 1600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function utf8Bytes(input: string): number {
  return Buffer.byteLength(input, 'utf8');
}

export function splitTextByUtf8Bytes(content: string, maxBytes = DEFAULT_TEXT_CHUNK_BYTES): string[] {
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

export class WeComApi {
  private readonly corpId: string;
  private readonly secret: string;
  private readonly agentId: number;
  private readonly timeoutMs: number;
  private readonly retryOnTimeout: boolean;
  private tokenCache?: TokenCache;
  private tokenInFlight?: Promise<string>;

  constructor(options: WeComApiOptions) {
    this.corpId = options.corpId;
    this.secret = options.secret;
    this.agentId = options.agentId;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retryOnTimeout = options.retryOnTimeout ?? false;
    log.debug('WeComApi 构造完成', {
      corpId: this.corpId,
      agentId: this.agentId,
      timeoutMs: this.timeoutMs,
      retryOnTimeout: this.retryOnTimeout,
    });
  }

  async sendText(toUser: string, content: string): Promise<void> {
    const textContent = requireNonEmptyText(content, 'wecom send failed: text content is required');
    log.info('发送文本消息', {
      toUser,
      contentLength: textContent.length,
      contentPreview: textContent.substring(0, 200),
    });

    const chunks = splitTextByUtf8Bytes(textContent);
    log.debug('消息分片结果', {
      toUser,
      chunkCount: chunks.length,
    });

    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}] ` : '';
      await this.sendSingleText(toUser, `${prefix}${chunks[i]}`);
    }
  }

  async sendMessage(toUser: string, message: WeComOutgoingMessage): Promise<void> {
    const msgType = message.msgType.trim().toLowerCase();
    if (!msgType) {
      throw new Error('wecom send failed: msgType is required');
    }
    if (msgType === 'text') {
      const text = requireNonEmptyText(
        extractWeComText(message.content),
        'wecom send failed: text content is required',
      );
      await this.sendText(toUser, text);
      return;
    }

    const requestBody = {
      touser: toUser,
      msgtype: msgType,
      agentid: this.agentId,
      ...await this.resolveWeComPayload(msgType, message.content),
      safe: 0,
    };
    await this.sendRequest(toUser, requestBody);
  }

  private async resolveWeComPayload(
    msgType: string,
    content: WeComOutgoingMessage['content'],
  ): Promise<Record<string, unknown>> {
    if (typeof content === 'string') {
      if (msgType === 'image' || msgType === 'voice' || msgType === 'video' || msgType === 'file') {
        return { [msgType]: { media_id: content } };
      }
      if (msgType === 'markdown') {
        return { markdown: { content } };
      }
      return { text: { content } };
    }

    if (msgType === 'image' || msgType === 'voice' || msgType === 'video' || msgType === 'file') {
      const mediaId = firstString(content.media_id);
      if (mediaId) {
        return { [msgType]: { media_id: mediaId } };
      }
      const localPath = resolveWeComLocalUploadPath(msgType, content);
      if (localPath) {
        const uploadedMediaId = await this.uploadMediaFromPath(msgType, localPath);
        return { [msgType]: { media_id: uploadedMediaId } };
      }
    }

    if (msgType === 'markdown') {
      if (typeof content.content === 'string') {
        return { markdown: { content: content.content } };
      }
    }

    return { [msgType]: content };
  }

  private async sendSingleText(toUser: string, content: string): Promise<void> {
    const requestBody = {
      touser: toUser,
      msgtype: 'text',
      agentid: this.agentId,
      text: {
        content,
      },
      safe: 0,
    };
    await this.sendRequest(toUser, requestBody);
  }

  private async sendRequest(toUser: string, requestBody: Record<string, unknown>): Promise<void> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const accessToken = await this.getAccessToken();
        log.debug('sendSingleText 获取 accessToken 成功', { attempt });

        const startTime = Date.now();
        const response = await this.fetchWithTimeout(
          `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          },
        );

        const body = (await response.json()) as { errcode?: number; errmsg?: string };
        const elapsed = Date.now() - startTime;

        if (response.ok && body.errcode === 0) {
          log.info('发送单条文本消息成功', {
            toUser,
            elapsedMs: elapsed,
            attempt,
          });
          return;
        }

        log.warn('发送单条文本消息返回异常', {
          toUser,
          httpStatus: response.status,
          errcode: body.errcode,
          errmsg: body.errmsg,
          elapsedMs: elapsed,
          attempt,
        });

        // access_token 失效，清缓存后重试
        if (body.errcode === 40014 || body.errcode === 42001) {
          this.tokenCache = undefined;
        }
        lastError = new Error(`wecom send failed: ${response.status} ${body.errcode ?? 'unknown'} ${body.errmsg ?? 'unknown'}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        log.warn('发送单条文本消息请求失败，准备重试', {
          toUser,
          attempt,
          error: lastError.message,
        });
        if (isAbortError(lastError) && !this.retryOnTimeout) {
          log.warn('发送单条文本消息命中超时，已禁用超时重试以避免重复消息', {
            toUser,
            attempt,
          });
          throw lastError;
        }
      }

      if (attempt < 3) {
        await sleep(200 * attempt);
      }
    }

    throw lastError ?? new Error('wecom send failed: unknown');
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

    if (this.tokenInFlight) {
      log.debug('等待进行中的 accessToken 获取请求');
      return this.tokenInFlight;
    }

    this.tokenInFlight = this.fetchAccessToken();
    try {
      return await this.tokenInFlight;
    } finally {
      this.tokenInFlight = undefined;
    }
  }

  private async fetchAccessToken(): Promise<string> {
    log.info('accessToken 已过期或不存在，重新获取...');
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.secret}`;

    const now = Date.now();
    const startTime = Date.now();
    const response = await this.fetchWithTimeout(url);
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

  private async uploadMediaFromPath(
    msgType: 'image' | 'voice' | 'video' | 'file' | string,
    localPath: string,
  ): Promise<string> {
    const normalizedPath = validateLocalPath(localPath);
    const uploadType = normalizeWeComUploadType(msgType);
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const accessToken = await this.getAccessToken();
        const form = new FormData();
        form.append(
          'media',
          new Blob([fs.readFileSync(normalizedPath)]),
          path.basename(normalizedPath),
        );

        const response = await this.fetchWithTimeout(
          `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=${uploadType}`,
          {
            method: 'POST',
            body: form,
          },
        );

        const body = (await response.json()) as { errcode?: number; errmsg?: string; media_id?: string };
        if (response.ok && body.errcode === 0 && body.media_id) {
          return body.media_id;
        }

        if (body.errcode === 40014 || body.errcode === 42001) {
          this.tokenCache = undefined;
        }
        lastError = new Error(
          `wecom media upload failed: ${response.status} ${body.errcode ?? 'unknown'} ${body.errmsg ?? 'unknown'}`,
        );
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

    throw lastError ?? new Error('wecom media upload failed: unknown');
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

function extractWeComText(content: WeComOutgoingMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  const text = content.text as { content?: unknown } | undefined;
  if (text && typeof text.content === 'string') {
    return text.content;
  }
  const rawText = content.text;
  if (typeof rawText === 'string') {
    return rawText;
  }
  return '';
}

function requireNonEmptyText(text: string, errorMessage: string): string {
  if (!text.trim()) {
    throw new Error(errorMessage);
  }
  return text;
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveWeComLocalUploadPath(msgType: string, content: Record<string, unknown>): string | undefined {
  if (msgType === 'image') {
    return firstString(content.local_image_path) ?? firstString(content.local_file_path);
  }
  if (msgType === 'voice') {
    return firstString(content.local_audio_path) ?? firstString(content.local_file_path);
  }
  if (msgType === 'video') {
    return firstString(content.local_media_path) ?? firstString(content.local_file_path);
  }
  if (msgType === 'file') {
    return firstString(content.local_file_path)
      ?? firstString(content.local_media_path)
      ?? firstString(content.local_audio_path);
  }
  return undefined;
}

function validateLocalPath(localPath: string): string {
  const normalizedPath = localPath.trim();
  if (!normalizedPath) {
    throw new Error('wecom media upload failed: local path is required');
  }
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`wecom media upload failed: local path not found: ${normalizedPath}`);
  }
  return normalizedPath;
}

function normalizeWeComUploadType(msgType: string): 'image' | 'voice' | 'video' | 'file' {
  if (msgType === 'image' || msgType === 'voice' || msgType === 'video' || msgType === 'file') {
    return msgType;
  }
  throw new Error(`wecom media upload failed: unsupported msgType ${msgType}`);
}
