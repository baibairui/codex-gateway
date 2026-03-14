import fs from 'node:fs';
import path from 'node:path';

import type { STTProvider } from './stt-provider.js';

interface OpenAICompatibleSttProviderInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export class OpenAICompatibleSttProvider implements STTProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(input: OpenAICompatibleSttProviderInput) {
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.apiKey = input.apiKey;
    this.model = input.model;
    this.timeoutMs = input.timeoutMs;
  }

  async transcribe(input: {
    filePath: string;
    mimeType?: string;
  }): Promise<{ text: string }> {
    const bytes = await fs.promises.readFile(input.filePath);
    const form = new FormData();
    form.set('model', this.model);
    form.set(
      'file',
      new Blob([bytes], { type: input.mimeType ?? 'application/octet-stream' }),
      path.basename(input.filePath),
    );

    const response = await this.fetchWithTimeout(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });
    const body = await response.json() as { text?: string };
    if (!response.ok || !body.text?.trim()) {
      throw new Error(`speech transcription failed: ${response.status}`);
    }
    return { text: body.text.trim() };
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
