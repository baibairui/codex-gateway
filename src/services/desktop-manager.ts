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

interface DesktopWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

interface DesktopManagerOptions {
  adapter: DesktopAutomationAdapter;
  commandRunner?: CommandRunner;
  screenshotDir?: string;
}

type NutJsLike = typeof import('@nut-tree-fork/nut-js');

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

    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }

    const capturedNatively = await this.tryCaptureFrontmostWindow(filePath);
    if (!capturedNatively) {
      await this.adapter.screenshot(filePath);
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`Desktop screenshot was not created at expected path: ${filePath}`);
    }
    return filePath;
  }

  private async tryCaptureFrontmostWindow(filePath: string): Promise<boolean> {
    const bounds = await this.readFrontmostWindowBounds().catch(() => undefined);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }

    await this.commandRunner('screencapture', [
      '-x',
      '-R',
      `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
      filePath,
    ]);
    return fs.existsSync(filePath);
  }

  private async readFrontmostWindowBounds(): Promise<DesktopWindowBounds | undefined> {
    const result = await this.commandRunner('osascript', [
      '-e',
      [
        'tell application "System Events"',
        'tell (first application process whose frontmost is true)',
        'tell front window',
        'set p to position',
        'set s to size',
        'return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)',
        'end tell',
        'end tell',
        'end tell',
      ].join('\n'),
    ]);
    const numbers = result.stdout.match(/-?\d+/g)?.map((value) => Number(value)) ?? [];
    if (numbers.length < 4 || numbers.some((value) => !Number.isFinite(value))) {
      return undefined;
    }
    return {
      x: numbers[0],
      y: numbers[1],
      width: numbers[2],
      height: numbers[3],
    };
  }
}

export async function createNutJsDesktopAutomationAdapter(nutJsModule?: NutJsLike): Promise<DesktopAutomationAdapter> {
  const nutJs = nutJsModule ?? await import('@nut-tree-fork/nut-js');

  return {
    async moveMouse(coordinate) {
      await nutJs.mouse.setPosition(new nutJs.Point(coordinate.x, coordinate.y));
    },
    async click(input) {
      if (input.coordinate) {
        await nutJs.mouse.setPosition(new nutJs.Point(input.coordinate.x, input.coordinate.y));
      }
      const button = (input.button === 'right' ? nutJs.Button.RIGHT : nutJs.Button.LEFT) as import('@nut-tree-fork/nut-js').Button;
      if (input.double) {
        await nutJs.mouse.doubleClick(button);
        return;
      }
      await nutJs.mouse.click(button);
    },
    async drag(input) {
      await nutJs.mouse.setPosition(new nutJs.Point(input.from.x, input.from.y));
      const path = await nutJs.straightTo(new nutJs.Point(input.to.x, input.to.y));
      await nutJs.mouse.drag(path);
    },
    async typeText(text) {
      await nutJs.keyboard.type(text);
    },
    async pressKey(key) {
      const mapped = mapNutKey(nutJs, key);
      await nutJs.keyboard.pressKey(mapped);
      await nutJs.keyboard.releaseKey(mapped);
    },
    async hotkey(keys) {
      const mapped = keys.map((key) => mapNutKey(nutJs, key));
      await nutJs.keyboard.pressKey(...mapped);
      await nutJs.keyboard.releaseKey(...mapped);
    },
    async screenshot(filePath) {
      const parsed = path.parse(filePath);
      const capturedPath = path.resolve(
        await nutJs.screen.capture(parsed.name, nutJs.FileType.PNG, parsed.dir),
      );
      if (capturedPath !== filePath) {
        fs.renameSync(capturedPath, filePath);
      }
    },
  };
}

async function defaultCommandRunner(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, args);
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function mapNutKey(nutJs: NutJsLike, key: string): import('@nut-tree-fork/nut-js').Key {
  const normalized = key.trim();
  switch (normalized.toLowerCase()) {
    case 'meta':
    case 'cmd':
    case 'command':
      return nutJs.Key.LeftCmd;
    case 'shift':
      return nutJs.Key.LeftShift;
    case 'ctrl':
    case 'control':
      return nutJs.Key.LeftControl;
    case 'alt':
    case 'option':
      return nutJs.Key.LeftAlt;
    case 'enter':
    case 'return':
      return nutJs.Key.Return;
    case 'tab':
      return nutJs.Key.Tab;
    case 'space':
      return nutJs.Key.Space;
    case 'up':
    case 'arrowup':
      return nutJs.Key.Up;
    case 'down':
    case 'arrowdown':
      return nutJs.Key.Down;
    case 'left':
    case 'arrowleft':
      return nutJs.Key.Left;
    case 'right':
    case 'arrowright':
      return nutJs.Key.Right;
    default: {
      if (/^[a-z]$/i.test(normalized)) {
        return nutJs.Key[normalized.toUpperCase() as keyof typeof nutJs.Key] as import('@nut-tree-fork/nut-js').Key;
      }
      if (/^[0-9]$/.test(normalized)) {
        return nutJs.Key[`Num${normalized}` as keyof typeof nutJs.Key] as import('@nut-tree-fork/nut-js').Key;
      }
      const direct = nutJs.Key[normalized as keyof typeof nutJs.Key];
      if (direct !== undefined) {
        return direct as import('@nut-tree-fork/nut-js').Key;
      }
      throw new Error(`Unsupported desktop key: ${key}`);
    }
  }
}
