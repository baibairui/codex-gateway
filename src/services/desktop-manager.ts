import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DesktopCoordinate {
  x: number;
  y: number;
}

export interface DesktopAutomationAdapter {
  moveMouse(coordinate: DesktopCoordinate): Promise<void>;
  click(input: {
    coordinate?: DesktopCoordinate;
    button: 'left' | 'right';
    double: boolean;
  }): Promise<void>;
  drag(input: {
    from: DesktopCoordinate;
    to: DesktopCoordinate;
  }): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  hotkey(keys: string[]): Promise<void>;
  screenshot(filePath: string): Promise<void>;
}

type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

interface DesktopManagerOptions {
  adapter: DesktopAutomationAdapter;
  commandRunner?: CommandRunner;
  screenshotDir?: string;
}

export class DesktopManager {
  private readonly adapter: DesktopAutomationAdapter;
  private readonly commandRunner: CommandRunner;
  private readonly screenshotDir: string;

  constructor(options: DesktopManagerOptions) {
    this.adapter = options.adapter;
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
    this.screenshotDir = path.resolve(options.screenshotDir ?? '.data/desktop/screenshots');
  }

  async launchApp(appName: string): Promise<void> {
    await this.commandRunner('open', ['-a', appName]);
  }

  async activateApp(appName: string): Promise<void> {
    await this.commandRunner('osascript', ['-e', `tell application "${appName}" to activate`]);
  }

  async frontmostApp(): Promise<{ appName: string }> {
    const result = await this.commandRunner('osascript', [
      '-e',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ]);
    return { appName: result.stdout.trim() };
  }

  async moveMouse(coordinate: DesktopCoordinate): Promise<void> {
    await this.adapter.moveMouse(coordinate);
  }

  async click(input: {
    coordinate?: DesktopCoordinate;
    button: 'left' | 'right';
    double: boolean;
  }): Promise<void> {
    await this.adapter.click(input);
  }

  async drag(input: {
    from: DesktopCoordinate;
    to: DesktopCoordinate;
  }): Promise<void> {
    await this.adapter.drag(input);
  }

  async typeText(text: string): Promise<void> {
    await this.adapter.typeText(text);
  }

  async pressKey(key: string): Promise<void> {
    await this.adapter.pressKey(key);
  }

  async hotkey(keys: string[]): Promise<void> {
    await this.adapter.hotkey(keys);
  }

  async takeScreenshot(input: { filename?: string }): Promise<string> {
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    const filename = input.filename?.trim() || `desktop-${Date.now()}.png`;
    const filePath = path.isAbsolute(filename)
      ? filename
      : path.join(this.screenshotDir, filename);
    await this.adapter.screenshot(filePath);
    return filePath;
  }
}

async function defaultCommandRunner(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, args);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
