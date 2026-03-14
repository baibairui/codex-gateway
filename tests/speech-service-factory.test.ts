import { afterEach, describe, expect, it } from 'vitest';

import { SpeechService } from '../src/services/speech-service.js';
import { createSpeechService } from '../src/services/speech-service-factory.js';

describe('createSpeechService', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it('returns undefined when speech is disabled', () => {
    const service = createSpeechService({
      speech: {
        enabled: false,
        mode: 'transcribe_and_reply',
        stt: {
          provider: 'openai-compatible',
          baseUrl: undefined,
          apiKeyEnv: 'OPENAI_API_KEY',
          model: 'gpt-4o-mini-transcribe',
        },
        audio: {
          maxSizeMb: 25,
          maxDurationSec: 300,
          allowedMimeTypes: ['audio/ogg'],
        },
        prompt: {
          includeTranscriptMeta: true,
        },
      },
      apiTimeoutMs: 15000,
    });

    expect(service).toBeUndefined();
  });

  it('creates a speech service when speech is enabled and the api key exists', () => {
    process.env.OPENAI_API_KEY = 'secret';

    const service = createSpeechService({
      speech: {
        enabled: true,
        mode: 'transcribe_and_reply',
        stt: {
          provider: 'openai-compatible',
          baseUrl: 'https://speech.example.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          model: 'gpt-4o-mini-transcribe',
        },
        audio: {
          maxSizeMb: 25,
          maxDurationSec: 300,
          allowedMimeTypes: ['audio/ogg'],
        },
        prompt: {
          includeTranscriptMeta: true,
        },
      },
      apiTimeoutMs: 15000,
    });

    expect(service).toBeInstanceOf(SpeechService);
  });

  it('throws when speech is enabled but the configured api key env is missing', () => {
    delete process.env.OPENAI_API_KEY;

    expect(() => createSpeechService({
      speech: {
        enabled: true,
        mode: 'transcribe_and_reply',
        stt: {
          provider: 'openai-compatible',
          baseUrl: undefined,
          apiKeyEnv: 'OPENAI_API_KEY',
          model: 'gpt-4o-mini-transcribe',
        },
        audio: {
          maxSizeMb: 25,
          maxDurationSec: 300,
          allowedMimeTypes: ['audio/ogg'],
        },
        prompt: {
          includeTranscriptMeta: true,
        },
      },
      apiTimeoutMs: 15000,
    })).toThrow(/missing speech api key env: OPENAI_API_KEY/i);
  });
});
