export interface DesktopAutomationResult {
  text: string;
  data?: Record<string, unknown>;
}

interface DesktopCoordinate {
  x: number;
  y: number;
}

type DesktopCapableManager = {
  launchApp(appName: string): Promise<void>;
  activateApp(appName: string): Promise<void>;
  frontmostApp(): Promise<{ appName: string }>;
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
  takeScreenshot(input: { filename?: string }): Promise<string>;
};

export function createDesktopAutomationBackend(manager: DesktopCapableManager): {
  execute(command: string, args: Record<string, unknown>): Promise<DesktopAutomationResult>;
} {
  return {
    async execute(command, args) {
      switch (command) {
        case 'launch-app': {
          const appName = String(args.appName ?? '');
          await manager.launchApp(appName);
          return { text: `launched app: ${appName}`, data: { appName } };
        }
        case 'activate-app': {
          const appName = String(args.appName ?? '');
          await manager.activateApp(appName);
          return { text: `activated app: ${appName}`, data: { appName } };
        }
        case 'frontmost-app': {
          const result = await manager.frontmostApp();
          return {
            text: `frontmost app: ${result.appName}`,
            data: { frontmostApp: result.appName },
          };
        }
        case 'move-mouse': {
          await manager.moveMouse({
            x: Number(args.x ?? 0),
            y: Number(args.y ?? 0),
          });
          return { text: 'mouse moved', data: nullToUndefined({ ok: true }) };
        }
        case 'click': {
          await manager.click({
            coordinate: hasCoordinate(args)
              ? { x: Number(args.x), y: Number(args.y) }
              : undefined,
            button: args.button === 'right' ? 'right' : 'left',
            double: args.double === true,
          });
          return { text: 'click complete', data: nullToUndefined({ ok: true }) };
        }
        case 'drag': {
          await manager.drag({
            from: normalizeCoordinate(args.from),
            to: normalizeCoordinate(args.to),
          });
          return { text: 'drag complete', data: nullToUndefined({ ok: true }) };
        }
        case 'type-text':
          await manager.typeText(String(args.text ?? ''));
          return { text: 'text entered', data: nullToUndefined({ ok: true }) };
        case 'press-key':
          await manager.pressKey(String(args.key ?? ''));
          return { text: 'key pressed', data: nullToUndefined({ ok: true }) };
        case 'hotkey':
          await manager.hotkey(normalizeStringArray(args.keys));
          return { text: 'hotkey pressed', data: nullToUndefined({ ok: true }) };
        case 'screenshot': {
          const path = await manager.takeScreenshot({
            filename: typeof args.filename === 'string' ? args.filename : undefined,
          });
          return {
            text: path,
            data: { path },
          };
        }
        default:
          throw new Error(`Unsupported desktop command: ${command}`);
      }
    },
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}

function normalizeCoordinate(value: unknown): DesktopCoordinate {
  const record = (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};
  return {
    x: Number(record.x ?? 0),
    y: Number(record.y ?? 0),
  };
}

function hasCoordinate(args: Record<string, unknown>): boolean {
  return typeof args.x === 'number' && typeof args.y === 'number';
}

function nullToUndefined<T extends Record<string, unknown>>(value: T): T {
  return value;
}
