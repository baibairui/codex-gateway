import type { BrowserManager, BrowserSnapshotResult, BrowserTabSummary } from './browser-manager.js';

export interface BrowserAutomationResult {
  text: string;
  data?: Record<string, unknown>;
}

type BrowserCapableManager = Pick<
  BrowserManager,
  | 'snapshot'
  | 'navigate'
  | 'navigateBack'
  | 'click'
  | 'hover'
  | 'drag'
  | 'type'
  | 'selectOption'
  | 'pressKey'
  | 'waitFor'
  | 'evaluate'
  | 'fileUpload'
  | 'fillForm'
  | 'handleDialog'
  | 'resize'
  | 'takeScreenshot'
  | 'startRecording'
  | 'stopRecording'
  | 'listTabs'
  | 'selectTab'
  | 'newTab'
  | 'closeCurrentTab'
>;

export function createBrowserAutomationBackend(manager: BrowserCapableManager): {
  execute(command: string, args: Record<string, unknown>): Promise<BrowserAutomationResult>;
} {
  const snapshotResult = async (): Promise<BrowserAutomationResult> => {
    const snapshot = await manager.snapshot();
    return {
      text: renderSnapshot(snapshot),
      data: {
        page: snapshot.page,
        snapshot: snapshot.snapshot,
      },
    };
  };

  return {
    async execute(command, args) {
      switch (command) {
        case 'snapshot':
          return snapshotResult();
        case 'navigate':
          await manager.navigate(String(args.url ?? ''));
          return snapshotResult();
        case 'click':
          await manager.click(String(args.ref ?? ''));
          return snapshotResult();
        case 'hover':
          await manager.hover(String(args.ref ?? ''));
          return snapshotResult();
        case 'drag':
          await manager.drag(String(args.startRef ?? ''), String(args.endRef ?? ''));
          return snapshotResult();
        case 'type':
          await manager.type(String(args.ref ?? ''), String(args.text ?? ''), {
            slowly: args.slowly === true,
            submit: args.submit === true,
          });
          return snapshotResult();
        case 'select-option':
          await manager.selectOption(String(args.ref ?? ''), normalizeStringArray(args.values));
          return snapshotResult();
        case 'press-key':
          await manager.pressKey(String(args.key ?? ''));
          return snapshotResult();
        case 'wait-for':
          await manager.waitFor({
            time: typeof args.time === 'number' ? args.time : undefined,
            text: typeof args.text === 'string' ? args.text : undefined,
            textGone: typeof args.textGone === 'string' ? args.textGone : undefined,
          });
          return snapshotResult();
        case 'evaluate': {
          const output = await manager.evaluate(
            String(args.function ?? ''),
            typeof args.ref === 'string' ? args.ref : undefined,
          );
          return {
            text: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
            data: { output },
          };
        }
        case 'file-upload':
          await manager.fileUpload(String(args.ref ?? ''), normalizeStringArray(args.paths));
          return snapshotResult();
        case 'fill-form':
          await manager.fillForm(normalizeFields(args.fields));
          return snapshotResult();
        case 'handle-dialog':
          await manager.handleDialog({
            accept: args.accept === true,
            promptText: typeof args.promptText === 'string' ? args.promptText : undefined,
          });
          return snapshotResult();
        case 'resize':
          await manager.resize({
            width: Number(args.width ?? 0),
            height: Number(args.height ?? 0),
          });
          return snapshotResult();
        case 'screenshot': {
          const filePath = await manager.takeScreenshot({
            filename: typeof args.filename === 'string' ? args.filename : undefined,
            fullPage: args.fullPage === true,
            type: args.type === 'jpeg' ? 'jpeg' : 'png',
            ref: typeof args.ref === 'string' ? args.ref : undefined,
          });
          return {
            text: filePath,
            data: { path: filePath },
          };
        }
        case 'navigate-back':
          await manager.navigateBack();
          return snapshotResult();
        case 'close':
          await manager.closeCurrentTab();
          return {
            text: 'OK',
            data: { ok: true },
          };
        case 'start-recording': {
          const result = await manager.startRecording({
            filename: typeof args.filename === 'string' ? args.filename : undefined,
            intervalMs: typeof args.intervalMs === 'number' ? args.intervalMs : undefined,
          });
          return {
            text: `recording started: session=${result.sessionId} output=${result.outputPath}`,
            data: {
              sessionId: result.sessionId,
              outputPath: result.outputPath,
            },
          };
        }
        case 'stop-recording': {
          const result = await manager.stopRecording();
          return {
            text: `recording saved: ${result.outputPath} (session=${result.sessionId}, frames=${result.frames})`,
            data: {
              sessionId: result.sessionId,
              outputPath: result.outputPath,
              frames: result.frames,
            },
          };
        }
        case 'tabs':
          return handleTabsCommand(manager, args);
        default:
          throw new Error(`Unsupported browser command: ${command}`);
      }
    },
  };
}

async function handleTabsCommand(
  manager: Pick<BrowserManager, 'listTabs' | 'selectTab' | 'newTab' | 'closeCurrentTab'>,
  args: Record<string, unknown>,
): Promise<BrowserAutomationResult> {
  const action = String(args.action ?? 'list');
  if (action === 'new') {
    await manager.newTab();
  } else if (action === 'select') {
    await manager.selectTab(Number(args.index));
  } else if (action === 'close') {
    await manager.closeCurrentTab();
  } else if (action !== 'list') {
    throw new Error(`Unsupported tabs action: ${action}`);
  }

  const tabs = await manager.listTabs();
  return {
    text: renderTabs(tabs),
    data: { tabs },
  };
}

function renderSnapshot(result: BrowserSnapshotResult): string {
  return [result.page, result.snapshot].filter(Boolean).join('\n');
}

function renderTabs(tabs: BrowserTabSummary[]): string {
  if (tabs.length === 0) {
    return 'No open tabs.';
  }
  return tabs
    .map((tab) => `${tab.current ? '->' : '  '} [${tab.index}] ${tab.title} ${tab.url}`)
    .join('\n');
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}

function normalizeFields(value: unknown): Array<{ ref: string; type: string; value: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((field) => {
    const record = (field && typeof field === 'object' && !Array.isArray(field))
      ? field as Record<string, unknown>
      : {};
    return {
      ref: String(record.ref ?? ''),
      type: String(record.type ?? ''),
      value: String(record.value ?? ''),
    };
  });
}
