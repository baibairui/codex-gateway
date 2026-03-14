import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { SpeechService } from '../src/services/speech-service.js';

function createAudioFile(prefix: string): { tempDir: string; audioPath: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const audioPath = path.join(tempDir, 'sample.ogg');
  fs.writeFileSync(audioPath, Buffer.from('fake-audio'));
  return { tempDir, audioPath };
}

describe('SpeechService', () => {
  it('returns continue with transcript text in transcribe_and_reply mode', async () => {
    const { tempDir, audioPath } = createAudioFile('speech-service-success-');
    const sttProvider = {
      transcribe: vi.fn(async () => ({ text: '你好，帮我总结一下' })),
    };
    const service = new SpeechService({
      mode: 'transcribe_and_reply',
      sttProvider,
      audio: {
        maxSizeMb: 25,
        maxDurationSec: 300,
        allowedMimeTypes: ['audio/ogg'],
      },
    });

    const result = await service.processInboundAudio({
      prompt: `[飞书语音] file_key=file_1 duration=3200 mime_type=audio/ogg
[飞书附件元数据]
local_audio_path=${audioPath}`,
      channel: 'feishu',
      userId: 'u1',
      workspaceDir: tempDir,
    });

    expect(result).toEqual({
      type: 'continue',
      prompt: '你好，帮我总结一下',
    });
    expect(sttProvider.transcribe).toHaveBeenCalledWith({
      filePath: audioPath,
      mimeType: 'audio/ogg',
    });
  });

  it('returns undefined when no local_audio_path exists', async () => {
    const sttProvider = {
      transcribe: vi.fn(async () => ({ text: 'ignored' })),
    };
    const service = new SpeechService({
      mode: 'transcribe_and_reply',
      sttProvider,
      audio: {
        maxSizeMb: 25,
        maxDurationSec: 300,
        allowedMimeTypes: ['audio/ogg'],
      },
    });

    const result = await service.processInboundAudio({
      prompt: '普通文本消息',
      channel: 'feishu',
      userId: 'u1',
      workspaceDir: '/tmp/workspace',
    });

    expect(result).toBeUndefined();
    expect(sttProvider.transcribe).not.toHaveBeenCalled();
  });

  it('returns reply with transcript text in transcribe_only mode', async () => {
    const { tempDir, audioPath } = createAudioFile('speech-service-transcribe-only-');
    const sttProvider = {
      transcribe: vi.fn(async () => ({ text: '帮我记一下会议重点' })),
    };
    const service = new SpeechService({
      mode: 'transcribe_only',
      sttProvider,
      audio: {
        maxSizeMb: 25,
        maxDurationSec: 300,
        allowedMimeTypes: ['audio/ogg'],
      },
    });

    const result = await service.processInboundAudio({
      prompt: `[飞书语音] file_key=file_1 duration=3200 mime_type=audio/ogg
[飞书附件元数据]
local_audio_path=${audioPath}`,
      channel: 'feishu',
      userId: 'u1',
      workspaceDir: tempDir,
    });

    expect(result).toEqual({
      type: 'reply',
      message: '帮我记一下会议重点',
    });
  });

  it('returns a user-safe reply for unsupported mime types', async () => {
    const { tempDir, audioPath } = createAudioFile('speech-service-mime-');
    const sttProvider = {
      transcribe: vi.fn(async () => ({ text: 'ignored' })),
    };
    const service = new SpeechService({
      mode: 'transcribe_and_reply',
      sttProvider,
      audio: {
        maxSizeMb: 25,
        maxDurationSec: 300,
        allowedMimeTypes: ['audio/ogg'],
      },
    });

    const result = await service.processInboundAudio({
      prompt: `[飞书语音] file_key=file_1 duration=3200 mime_type=audio/mp3
[飞书附件元数据]
local_audio_path=${audioPath}`,
      channel: 'feishu',
      userId: 'u1',
      workspaceDir: tempDir,
    });

    expect(result).toEqual({
      type: 'reply',
      message: '⚠️ 语音格式暂不支持，请发送 mp3/mp4/ogg/wav/webm。',
    });
    expect(sttProvider.transcribe).not.toHaveBeenCalled();
  });

  it('returns a user-safe reply when the audio file is missing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-service-missing-'));
    const missingPath = path.join(tempDir, 'missing.ogg');
    const sttProvider = {
      transcribe: vi.fn(async () => ({ text: 'ignored' })),
    };
    const service = new SpeechService({
      mode: 'transcribe_and_reply',
      sttProvider,
      audio: {
        maxSizeMb: 25,
        maxDurationSec: 300,
        allowedMimeTypes: ['audio/ogg'],
      },
    });

    const result = await service.processInboundAudio({
      prompt: `[飞书语音] file_key=file_1 duration=3200 mime_type=audio/ogg
[飞书附件元数据]
local_audio_path=${missingPath}`,
      channel: 'feishu',
      userId: 'u1',
      workspaceDir: tempDir,
    });

    expect(result).toEqual({
      type: 'reply',
      message: '⚠️ 语音文件不存在，暂时无法转写，请重新发送。',
    });
    expect(sttProvider.transcribe).not.toHaveBeenCalled();
  });

  it('returns a user-safe reply when the provider fails', async () => {
    const { tempDir, audioPath } = createAudioFile('speech-service-provider-error-');
    const sttProvider = {
      transcribe: vi.fn(async () => {
        throw new Error('upstream 401');
      }),
    };
    const service = new SpeechService({
      mode: 'transcribe_and_reply',
      sttProvider,
      audio: {
        maxSizeMb: 25,
        maxDurationSec: 300,
        allowedMimeTypes: ['audio/ogg'],
      },
    });

    const result = await service.processInboundAudio({
      prompt: `[飞书语音] file_key=file_1 duration=3200 mime_type=audio/ogg
[飞书附件元数据]
local_audio_path=${audioPath}`,
      channel: 'feishu',
      userId: 'u1',
      workspaceDir: tempDir,
    });

    expect(result).toEqual({
      type: 'reply',
      message: '⚠️ 语音转写失败，请稍后重试。',
    });
  });
});
