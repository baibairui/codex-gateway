import { OpenAICompatibleSttProvider } from './openai-compatible-stt-provider.js';
import { SpeechService } from './speech-service.js';

interface SpeechConfigLike {
  enabled: boolean;
  mode: 'transcribe_only' | 'transcribe_and_reply';
  stt: {
    provider: string;
    baseUrl?: string;
    apiKeyEnv: string;
    model: string;
  };
  audio: {
    maxSizeMb: number;
    maxDurationSec: number;
    allowedMimeTypes: string[];
  };
  prompt: {
    includeTranscriptMeta: boolean;
  };
}

export function createSpeechService(input: {
  speech: SpeechConfigLike;
  apiTimeoutMs: number;
}): SpeechService | undefined {
  if (!input.speech.enabled) {
    return undefined;
  }
  if (input.speech.stt.provider !== 'openai-compatible') {
    throw new Error(`unsupported speech provider: ${input.speech.stt.provider}`);
  }

  const apiKey = process.env[input.speech.stt.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw new Error(`missing speech api key env: ${input.speech.stt.apiKeyEnv}`);
  }

  return new SpeechService({
    mode: input.speech.mode,
    sttProvider: new OpenAICompatibleSttProvider({
      baseUrl: input.speech.stt.baseUrl ?? 'https://api.openai.com/v1',
      apiKey,
      model: input.speech.stt.model,
      timeoutMs: input.apiTimeoutMs,
    }),
    audio: input.speech.audio,
  });
}
