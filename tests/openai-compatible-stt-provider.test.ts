import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleSttProvider } from '../src/services/openai-compatible-stt-provider.js';

describe('OpenAICompatibleSttProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('posts multipart audio to the configured transcription endpoint', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-stt-provider-'));
    const audioPath = path.join(tempDir, 'sample.ogg');
    fs.writeFileSync(audioPath, Buffer.from('fake-audio'));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://speech.example.com/v1/audio/transcriptions');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual(expect.objectContaining({
        Authorization: 'Bearer secret',
      }));
      expect(init?.body).toBeInstanceOf(FormData);
      const formData = init?.body as FormData;
      expect(formData.get('model')).toBe('gpt-4o-mini-transcribe');
      expect(formData.get('file')).toBeTruthy();

      return new Response(JSON.stringify({ text: '你好，世界' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleSttProvider({
      baseUrl: 'https://speech.example.com/v1',
      apiKey: 'secret',
      model: 'gpt-4o-mini-transcribe',
      timeoutMs: 5000,
    });

    const result = await provider.transcribe({
      filePath: audioPath,
      mimeType: 'audio/ogg',
    });

    expect(result).toEqual({ text: '你好，世界' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the upstream response is not successful', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-stt-provider-error-'));
    const audioPath = path.join(tempDir, 'sample.ogg');
    fs.writeFileSync(audioPath, Buffer.from('fake-audio'));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'bad api key' },
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleSttProvider({
      baseUrl: 'https://speech.example.com/v1',
      apiKey: 'secret',
      model: 'gpt-4o-mini-transcribe',
      timeoutMs: 5000,
    });

    await expect(provider.transcribe({
      filePath: audioPath,
      mimeType: 'audio/ogg',
    })).rejects.toThrow(/speech transcription failed: 401/i);
  });
});
