import { spawn } from 'node:child_process';

export interface BrowserOpenerOptions {
  command?: string;
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveOpenCommand(command?: string): { bin: string; args: string[] } {
  if (command) {
    const parts = command.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      return { bin: parts[0]!, args: parts.slice(1) };
    }
  }

  switch (process.platform) {
    case 'darwin':
      return { bin: 'open', args: [] };
    case 'win32':
      return { bin: 'cmd', args: ['/c', 'start', ''] };
    default:
      return { bin: 'xdg-open', args: [] };
  }
}

export class BrowserOpener {
  private readonly command?: string;

  constructor(options: BrowserOpenerOptions = {}) {
    this.command = options.command;
  }

  open(url: string): Promise<void> {
    if (!isSafeUrl(url)) {
      return Promise.reject(new Error('invalid url'));
    }

    const { bin, args } = resolveOpenCommand(this.command);

    return new Promise<void>((resolve, reject) => {
      const child = spawn(bin, [...args, url], {
        stdio: 'ignore',
        detached: process.platform !== 'win32',
      });

      child.on('error', reject);
      child.on('spawn', () => {
        if (process.platform !== 'win32') {
          child.unref();
        }
        resolve();
      });
    });
  }
}
