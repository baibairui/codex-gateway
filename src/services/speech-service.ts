import fs from 'node:fs';

import type { STTProvider } from './stt-provider.js';

export type SpeechServiceResult =
  | { type: 'continue'; prompt: string }
  | { type: 'reply'; message: string };

interface SpeechServiceInput {
  mode: 'transcribe_only' | 'transcribe_and_reply';
  sttProvider: STTProvider;
  audio: {
    maxSizeMb: number;
    maxDurationSec: number;
    allowedMimeTypes: string[];
  };
}

export class SpeechService {
  private readonly mode: 'transcribe_only' | 'transcribe_and_reply';
  private readonly sttProvider: STTProvider;
  private readonly maxSizeBytes: number;
  private readonly maxDurationMs: number;
  private readonly allowedMimeTypes: Set<string>;

  constructor(input: SpeechServiceInput) {
    this.mode = input.mode;
    this.sttProvider = input.sttProvider;
    this.maxSizeBytes = input.audio.maxSizeMb * 1024 * 1024;
    this.maxDurationMs = input.audio.maxDurationSec * 1000;
    this.allowedMimeTypes = new Set(input.audio.allowedMimeTypes);
  }

  async processInboundAudio(input: {
    prompt: string;
    channel: 'wecom' | 'feishu';
    userId: string;
    workspaceDir: string;
  }): Promise<SpeechServiceResult | undefined> {
    const localAudioPath = input.prompt.match(/\blocal_audio_path=([^\n]+)/)?.[1]?.trim();
    if (!localAudioPath) {
      return undefined;
    }

    const mimeType = input.prompt.match(/\bmime_type=([^\s]+)/)?.[1]?.trim();
    if (mimeType && !this.allowedMimeTypes.has(mimeType)) {
      return {
        type: 'reply',
        message: '⚠️ 语音格式暂不支持，请发送 mp3/mp4/ogg/wav/webm。',
      };
    }

    if (!fs.existsSync(localAudioPath)) {
      return {
        type: 'reply',
        message: '⚠️ 语音文件不存在，暂时无法转写，请重新发送。',
      };
    }

    const durationMs = Number(input.prompt.match(/\bduration=(\d+)/)?.[1] ?? '0');
    if (durationMs > this.maxDurationMs) {
      return {
        type: 'reply',
        message: '⚠️ 语音时长超出限制，请缩短后重试。',
      };
    }

    const stat = await fs.promises.stat(localAudioPath);
    if (stat.size > this.maxSizeBytes) {
      return {
        type: 'reply',
        message: '⚠️ 语音文件过大，请压缩后重试。',
      };
    }

    try {
      const result = await this.sttProvider.transcribe({
        filePath: localAudioPath,
        mimeType,
      });
      const transcript = result.text.trim();
      if (!transcript) {
        return {
          type: 'reply',
          message: '⚠️ 语音内容为空，暂时无法转写。',
        };
      }
      if (this.mode === 'transcribe_only') {
        return {
          type: 'reply',
          message: transcript,
        };
      }
      return {
        type: 'continue',
        prompt: transcript,
      };
    } catch {
      return {
        type: 'reply',
        message: '⚠️ 语音转写失败，请稍后重试。',
      };
    }
  }
}
