import fs from 'node:fs';
import path from 'node:path';

function readCodexHomeFile(codexHomeDir: string | undefined, fileName: string): string | undefined {
  if (!codexHomeDir) {
    return undefined;
  }
  const filePath = path.join(path.resolve(codexHomeDir), fileName);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return undefined;
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function hasCodexHomeConfig(codexHomeDir: string | undefined): boolean {
  return readCodexHomeFile(codexHomeDir, 'config.toml') !== undefined;
}

export function hasCodexHomeAuth(codexHomeDir: string | undefined): boolean {
  return readCodexHomeFile(codexHomeDir, 'auth.json') !== undefined;
}

export function readCodexHomeDefaultModel(codexHomeDir: string | undefined): string | undefined {
  const configText = readCodexHomeFile(codexHomeDir, 'config.toml');
  if (!configText) {
    return undefined;
  }

  for (const rawLine of configText.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('model')) {
      continue;
    }
    const match = line.match(/^model\s*=\s*"([^"]+)"\s*$/);
    if (!match) {
      continue;
    }
    const model = match[1]?.trim();
    if (model) {
      return model;
    }
  }

  return undefined;
}
