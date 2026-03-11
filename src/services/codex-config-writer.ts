import { writeCliApiLoginConfig, type CliApiLoginWriteResult } from './cli-provider.js';

export interface CodexApiLoginWriteInput {
  codexHomeDir: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export type CodexApiLoginWriteResult = CliApiLoginWriteResult;

export async function writeCodexApiLoginConfig(input: CodexApiLoginWriteInput): Promise<CodexApiLoginWriteResult> {
  return writeCliApiLoginConfig({
    provider: 'codex',
    cliHomeDir: input.codexHomeDir,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
  });
}
