import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';

export interface BrowserLocatorLike {
  click(options?: Record<string, unknown>): Promise<void>;
  hover?(): Promise<void>;
  dragTo?(target: BrowserLocatorLike): Promise<void>;
  fill(value: string): Promise<void>;
  pressSequentially?(value: string): Promise<void>;
  selectOption?(value: string | string[]): Promise<void>;
  setInputFiles?(files: string | string[]): Promise<void>;
  setChecked?(checked: boolean): Promise<void>;
  screenshot?(options: Record<string, unknown>): Promise<Buffer>;
}

export interface BrowserKeyboardLike {
  press(key: string): Promise<void>;
  type(text: string, options?: { delay?: number }): Promise<void>;
}

export interface BrowserPageLike {
  url(): string;
  title(): Promise<string>;
  goto(url: string): Promise<void>;
  goBack?(): Promise<void>;
  close(): Promise<void>;
  bringToFront(): Promise<void>;
  locator(selector: string): BrowserLocatorLike;
  keyboard: BrowserKeyboardLike;
  setViewportSize?(size: { width: number; height: number }): Promise<void>;
  screenshot?(options: Record<string, unknown>): Promise<Buffer>;
  once?(event: string, listener: (...args: unknown[]) => void): void;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<void>;
  waitForFunction(fn: (arg: unknown) => boolean, arg?: unknown): Promise<void>;
  evaluate<T>(fn: ((arg: unknown) => T) | (() => T), arg?: unknown): Promise<T>;
}

export interface BrowserContextLike {
  pages(): BrowserPageLike[];
  newPage(): Promise<BrowserPageLike>;
  close(): Promise<void>;
}

export type BrowserLauncher = () => Promise<BrowserContextLike>;
export type BrowserLaunchMode = 'display' | 'xvfb' | 'headless';

export interface BrowserTabSummary {
  index: number;
  url: string;
  title: string;
  current: boolean;
}

export interface BrowserSnapshotResult {
  page: string;
  snapshot: string;
}

interface BrowserSnapshotEntry {
  ref: string;
  tag: string;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  text?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  selectedText?: string;
  label?: string;
}

interface BrowserManagerOptions {
  launcher?: BrowserLauncher;
  profileDir?: string;
  screenshotDir?: string;
  recordingDir?: string;
  videoEncoder?: BrowserVideoEncoder;
}

const DEFAULT_REF_ATTR = 'data-gateway-ref';

type BrowserVideoEncoder = (input: {
  framesDir: string;
  outputPath: string;
  fps: number;
}) => Promise<void>;

interface BrowserRecordingState {
  sessionId: string;
  page: BrowserPageLike;
  framesDir: string;
  outputPath: string;
  fps: number;
  nextFrame: number;
  timer: NodeJS.Timeout;
  captureInFlight?: Promise<void>;
}

export class BrowserManager {
  private readonly launcher: BrowserLauncher;
  private readonly tabs = new Map<number, BrowserPageLike>();
  private currentTabId?: number;
  private nextTabId = 0;
  private contextPromise?: Promise<BrowserContextLike>;
  private readonly screenshotDir: string;
  private readonly recordingDir: string;
  private readonly videoEncoder: BrowserVideoEncoder;
  private recording?: BrowserRecordingState;

  constructor(options: BrowserManagerOptions = {}) {
    this.launcher = options.launcher ?? createDefaultLauncher(options.profileDir);
    this.screenshotDir = path.resolve(options.screenshotDir ?? '.data/browser/screenshots');
    this.recordingDir = path.resolve(options.recordingDir ?? '.data/browser/recordings');
    this.videoEncoder = options.videoEncoder ?? encodeRecordingWithFfmpeg;
  }

  async ensureCurrentTab(): Promise<BrowserPageLike> {
    await this.ensureContext();
    if (this.currentTabId !== undefined) {
      const existing = this.tabs.get(this.currentTabId);
      if (existing) {
        return existing;
      }
    }
    if (this.tabs.size > 0) {
      const first = this.tabs.entries().next().value as [number, BrowserPageLike];
      this.currentTabId = first[0];
      return first[1];
    }
    return this.newTab();
  }

  async newTab(): Promise<BrowserPageLike> {
    const context = await this.ensureContext();
    const page = await context.newPage();
    return this.attachTab(page);
  }

  async navigate(url: string): Promise<BrowserPageLike> {
    const page = await this.ensureCurrentTab();
    await page.goto(url);
    return page;
  }

  async currentUrl(): Promise<string | undefined> {
    const page = await this.ensureCurrentTab();
    return page.url();
  }

  async listTabs(): Promise<BrowserTabSummary[]> {
    await this.ensureContext();
    const summaries = await Promise.all(
      [...this.tabs.entries()].map(async ([id, page]) => ({
        index: id,
        url: page.url(),
        title: await page.title(),
        current: id === this.currentTabId,
      })),
    );
    return summaries.sort((a, b) => a.index - b.index);
  }

  async selectTab(index: number): Promise<BrowserPageLike> {
    await this.ensureContext();
    const page = this.tabs.get(index);
    if (!page) {
      throw new Error(`Tab ${index} not found`);
    }
    await page.bringToFront();
    this.currentTabId = index;
    return page;
  }

  async closeCurrentTab(): Promise<void> {
    const page = await this.ensureCurrentTab();
    const closingId = this.currentTabId;
    await page.close();
    if (closingId !== undefined) {
      this.tabs.delete(closingId);
    }
    const remaining = [...this.tabs.keys()].sort((a, b) => a - b);
    this.currentTabId = remaining.at(-1);
  }

  async hover(ref: string): Promise<void> {
    const page = await this.ensureCurrentTab();
    const locator = page.locator(selectorForRef(ref));
    if (!locator.hover) {
      throw new Error('hover is not supported for this locator');
    }
    await locator.hover();
  }

  async drag(startRef: string, endRef: string): Promise<void> {
    const page = await this.ensureCurrentTab();
    const source = page.locator(selectorForRef(startRef));
    const target = page.locator(selectorForRef(endRef));
    if (!source.dragTo) {
      throw new Error('drag is not supported for this locator');
    }
    await source.dragTo(target);
  }

  async snapshot(): Promise<BrowserSnapshotResult> {
    const page = await this.ensureCurrentTab();
    const state = await page.evaluate((refAttr) => {
      const attr = String(refAttr);
      const elements = Array.from(document.querySelectorAll<HTMLElement>(
        'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]',
      ));
      let index = 0;
      const entries: Array<Record<string, unknown>> = [];
      for (const element of elements) {
        const visible = element.getClientRects().length > 0;
        if (!visible) {
          continue;
        }
        index += 1;
        const ref = `e${index}`;
        element.setAttribute(attr, ref);
        const base = {
          ref,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || undefined,
          ariaLabel: element.getAttribute('aria-label') || undefined,
          placeholder: element.getAttribute('placeholder') || undefined,
          text: element.textContent || undefined,
          disabled: element.hasAttribute('disabled'),
        } as Record<string, unknown>;
        if (element instanceof HTMLInputElement) {
          entries.push({
            ...base,
            value: element.value || undefined,
            checked: ['checkbox', 'radio'].includes(element.type) ? element.checked : undefined,
            label: element.labels?.[0]?.textContent || undefined,
          });
          continue;
        }
        if (element instanceof HTMLTextAreaElement) {
          entries.push({
            ...base,
            value: element.value || undefined,
            label: element.labels?.[0]?.textContent || undefined,
          });
          continue;
        }
        if (element instanceof HTMLSelectElement) {
          entries.push({
            ...base,
            value: element.value || undefined,
            selectedText: element.selectedOptions?.[0]?.textContent || undefined,
            label: element.labels?.[0]?.textContent || undefined,
          });
          continue;
        }
        entries.push(base);
      }
      return {
        url: window.location.href,
        title: document.title,
        entries,
      };
    }, DEFAULT_REF_ATTR);

    return {
      page: `- Page URL: ${state.url}\n- Page Title: ${state.title}`,
      snapshot: renderSnapshotEntries(normalizeSnapshotEntries(state.entries)),
    };
  }

  async click(ref: string): Promise<void> {
    const page = await this.ensureCurrentTab();
    await page.locator(selectorForRef(ref)).click();
  }

  async type(ref: string, text: string, options: { slowly?: boolean; submit?: boolean } = {}): Promise<void> {
    const page = await this.ensureCurrentTab();
    const locator = page.locator(selectorForRef(ref));
    await locator.click();
    if (options.slowly && locator.pressSequentially) {
      await locator.pressSequentially(text);
    } else {
      await locator.fill(text);
    }
    if (options.submit) {
      await page.keyboard.press('Enter');
    }
  }

  async selectOption(ref: string, values: string[]): Promise<void> {
    const page = await this.ensureCurrentTab();
    const locator = page.locator(selectorForRef(ref));
    if (!locator.selectOption) {
      throw new Error('selectOption is not supported for this locator');
    }
    await locator.selectOption(values);
  }

  async pressKey(key: string): Promise<void> {
    const page = await this.ensureCurrentTab();
    await page.keyboard.press(key);
  }

  async navigateBack(): Promise<void> {
    const page = await this.ensureCurrentTab();
    if (!page.goBack) {
      throw new Error('navigateBack is not supported for this page');
    }
    await page.goBack();
  }

  async evaluate(functionCode: string, ref?: string): Promise<unknown> {
    const page = await this.ensureCurrentTab();
    if (ref) {
      return page.evaluate((payload: unknown) => {
        const { attr, targetRef, code } = payload as { attr: string; targetRef: string; code: string };
        const selector = `[${String(attr)}="${String(targetRef)}"]`;
        const element = document.querySelector(selector);
        const fn = (0, eval)(`(${String(code)})`) as (node: Element | null) => unknown;
        return fn(element);
      }, { attr: DEFAULT_REF_ATTR, targetRef: ref, code: functionCode });
    }
    return page.evaluate((code) => {
      const fn = (0, eval)(`(${String(code)})`) as () => unknown;
      return fn();
    }, functionCode);
  }

  async fileUpload(ref: string, paths: string[] = []): Promise<void> {
    const page = await this.ensureCurrentTab();
    const locator = page.locator(selectorForRef(ref));
    if (!locator.setInputFiles) {
      throw new Error('file upload is not supported for this locator');
    }
    await locator.setInputFiles(paths);
  }

  async fillForm(fields: Array<{ ref: string; type: string; value: string }>): Promise<void> {
    const page = await this.ensureCurrentTab();
    for (const field of fields) {
      const locator = page.locator(selectorForRef(field.ref));
      const fieldType = field.type.toLowerCase();
      if (fieldType === 'checkbox') {
        if (!locator.setChecked) {
          throw new Error('checkbox operation is not supported for this locator');
        }
        await locator.setChecked(field.value === 'true');
        continue;
      }
      if (fieldType === 'combobox' || fieldType === 'select') {
        if (!locator.selectOption) {
          throw new Error('select operation is not supported for this locator');
        }
        await locator.selectOption(field.value);
        continue;
      }
      await locator.fill(field.value);
    }
  }

  async handleDialog(options: { accept: boolean; promptText?: string }): Promise<void> {
    const page = await this.ensureCurrentTab();
    if (!page.once) {
      throw new Error('dialog handler is not supported for this page');
    }
    page.once('dialog', (dialog) => {
      const maybeDialog = dialog as { accept: (text?: string) => Promise<void>; dismiss: () => Promise<void> };
      if (options.accept) {
        void maybeDialog.accept(options.promptText);
      } else {
        void maybeDialog.dismiss();
      }
    });
  }

  async resize(size: { width: number; height: number }): Promise<void> {
    const page = await this.ensureCurrentTab();
    if (!page.setViewportSize) {
      throw new Error('resize is not supported for this page');
    }
    await page.setViewportSize(size);
  }

  async takeScreenshot(input: {
    filename?: string;
    fullPage?: boolean;
    type?: 'png' | 'jpeg';
    ref?: string;
  }): Promise<string> {
    const page = await this.ensureCurrentTab();
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    const ext = input.type === 'jpeg' ? 'jpeg' : 'png';
    const filename = input.filename?.trim() || `page-${Date.now()}.${ext}`;
    const filePath = path.isAbsolute(filename) ? filename : path.join(this.screenshotDir, filename);
    let buffer: Buffer;
    if (input.ref) {
      const locator = page.locator(selectorForRef(input.ref));
      if (!locator.screenshot) {
        throw new Error('element screenshot is not supported for this locator');
      }
      buffer = await locator.screenshot({ type: ext });
    } else {
      if (!page.screenshot) {
        throw new Error('screenshot is not supported for this page');
      }
      buffer = await page.screenshot({
        type: ext,
        fullPage: input.fullPage === true,
      });
    }
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  async startRecording(input: {
    filename?: string;
    intervalMs?: number;
  } = {}): Promise<{ sessionId: string; outputPath: string }> {
    if (this.recording) {
      throw new Error(`recording is already active (session=${this.recording.sessionId})`);
    }
    const page = await this.ensureCurrentTab();
    if (!page.screenshot) {
      throw new Error('recording is not supported for this page');
    }
    const intervalMs = Number.isFinite(input.intervalMs) ? Math.max(100, Number(input.intervalMs)) : 500;
    const fps = Math.max(1, Math.round(1000 / intervalMs));
    const sessionId = `rec-${Date.now()}`;
    fs.mkdirSync(this.recordingDir, { recursive: true });
    const outputName = input.filename?.trim() || `recording-${Date.now()}.mp4`;
    const outputPath = path.isAbsolute(outputName) ? outputName : path.join(this.recordingDir, outputName);
    const framesDir = path.join(this.recordingDir, `${sessionId}-frames`);
    fs.mkdirSync(framesDir, { recursive: true });

    const state: BrowserRecordingState = {
      sessionId,
      page,
      framesDir,
      outputPath,
      fps,
      nextFrame: 0,
      timer: setInterval(() => {
        void this.captureRecordingFrameSafe(state);
      }, intervalMs),
    };

    this.recording = state;
    await this.captureRecordingFrameSafe(state);
    return {
      sessionId,
      outputPath,
    };
  }

  async stopRecording(): Promise<{ sessionId: string; outputPath: string; frames: number }> {
    const state = this.recording;
    if (!state) {
      throw new Error('no active recording');
    }
    this.recording = undefined;
    clearInterval(state.timer);
    await this.captureRecordingFrameSafe(state);
    if (state.captureInFlight) {
      await state.captureInFlight;
    }
    if (state.nextFrame === 0) {
      throw new Error('recording captured no frames');
    }
    await this.videoEncoder({
      framesDir: state.framesDir,
      outputPath: state.outputPath,
      fps: state.fps,
    });
    fs.rmSync(state.framesDir, { recursive: true, force: true });
    return {
      sessionId: state.sessionId,
      outputPath: state.outputPath,
      frames: state.nextFrame,
    };
  }

  async waitFor(input: { time?: number; text?: string; textGone?: string }): Promise<void> {
    const page = await this.ensureCurrentTab();
    if (typeof input.time === 'number') {
      const waitMs = input.time >= 100 ? input.time : input.time * 1000;
      await page.waitForTimeout(waitMs);
      return;
    }
    if (input.text) {
      await page.waitForSelector(`text=${input.text}`);
      return;
    }
    if (input.textGone) {
      await page.waitForFunction((text) => !document.body.innerText.includes(String(text)), input.textGone);
    }
  }

  async dispose(): Promise<void> {
    if (this.recording) {
      clearInterval(this.recording.timer);
      this.recording = undefined;
    }
    if (!this.contextPromise) {
      return;
    }
    const context = await this.contextPromise;
    await context.close();
    this.contextPromise = undefined;
    this.tabs.clear();
    this.currentTabId = undefined;
  }

  private async ensureContext(): Promise<BrowserContextLike> {
    if (!this.contextPromise) {
      this.contextPromise = this.launcher();
      const context = await this.contextPromise;
      for (const page of context.pages()) {
        this.attachTab(page);
      }
      return context;
    }
    return this.contextPromise;
  }

  private attachTab(page: BrowserPageLike): BrowserPageLike {
    const existing = [...this.tabs.entries()].find(([, value]) => value === page);
    if (existing) {
      this.currentTabId = existing[0];
      return existing[1];
    }
    const id = this.nextTabId++;
    this.tabs.set(id, page);
    this.currentTabId = id;
    return page;
  }

  private async captureRecordingFrameSafe(state: BrowserRecordingState): Promise<void> {
    if (state.captureInFlight) {
      return state.captureInFlight;
    }
    const next = this.captureRecordingFrame(state).finally(() => {
      state.captureInFlight = undefined;
    });
    state.captureInFlight = next;
    return next;
  }

  private async captureRecordingFrame(state: BrowserRecordingState): Promise<void> {
    if (!state.page.screenshot) {
      throw new Error('recording is not supported for this page');
    }
    state.nextFrame += 1;
    const frameName = `frame-${String(state.nextFrame).padStart(6, '0')}.png`;
    const framePath = path.join(state.framesDir, frameName);
    const buffer = await state.page.screenshot({ type: 'png' });
    fs.writeFileSync(framePath, buffer);
  }
}

function selectorForRef(ref: string): string {
  return `[${DEFAULT_REF_ATTR}="${ref}"]`;
}

function normalizeSnapshotEntries(value: unknown): BrowserSnapshotEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(toBrowserSnapshotEntry)
    .filter((entry): entry is BrowserSnapshotEntry => !!entry);
}

function toBrowserSnapshotEntry(value: unknown): BrowserSnapshotEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const ref = optionalString(record.ref);
  const tag = optionalString(record.tag);
  if (!ref || !tag) {
    return undefined;
  }
  return {
    ref,
    tag,
    role: optionalString(record.role),
    ariaLabel: optionalString(record.ariaLabel),
    placeholder: optionalString(record.placeholder),
    text: optionalString(record.text),
    value: optionalString(record.value),
    checked: typeof record.checked === 'boolean' ? record.checked : undefined,
    disabled: typeof record.disabled === 'boolean' ? record.disabled : undefined,
    selectedText: optionalString(record.selectedText),
    label: optionalString(record.label),
  };
}

function renderSnapshotEntries(entries: BrowserSnapshotEntry[]): string {
  return entries
    .map((entry) => {
      const kind = resolveSnapshotKind(entry);
      const label = resolveSnapshotLabel(entry) || kind;
      const suffix: string[] = [];
      const value = normalizeSnapshotText(entry.selectedText || entry.value);
      if (value && value !== label) {
        suffix.push(`value="${truncateSnapshotText(value, 40)}"`);
      }
      if (entry.checked === true) {
        suffix.push('checked');
      }
      if (entry.disabled) {
        suffix.push('disabled');
      }
      const details = suffix.length > 0 ? ` ${suffix.join(' ')}` : '';
      return `- ${kind} "${truncateSnapshotText(label, 60)}"${details} [ref=${entry.ref}]`;
    })
    .join('\n');
}

function resolveSnapshotKind(entry: BrowserSnapshotEntry): string {
  if (entry.role === 'button' || entry.tag === 'button') {
    return 'button';
  }
  if (entry.role === 'link' || entry.tag === 'a') {
    return 'link';
  }
  if (entry.tag === 'textarea') {
    return 'textarea';
  }
  if (entry.tag === 'select') {
    return 'select';
  }
  return 'input';
}

function resolveSnapshotLabel(entry: BrowserSnapshotEntry): string {
  return normalizeSnapshotText(
    entry.ariaLabel
      || entry.label
      || entry.placeholder
      || entry.text
      || entry.selectedText
      || entry.value
      || entry.tag,
  );
}

function normalizeSnapshotText(value: string | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncateSnapshotText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function createDefaultLauncher(profileDir = '.data/browser/profile'): BrowserLauncher {
  return async () => {
    const launch = await prepareBrowserLaunchEnvironment();
    try {
      const context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: launch.headless,
        viewport: null,
        env: launch.env,
      });
      return adaptContext(context, launch.dispose);
    } catch (error) {
      await launch.dispose?.();
      throw error;
    }
  };
}

export function resolveBrowserLaunchMode(
  env: NodeJS.ProcessEnv,
  input: { hasXvfbRun: boolean },
): BrowserLaunchMode {
  const hasDisplay = Boolean(env.DISPLAY?.trim());
  const forceXvfb = env.GATEWAY_FORCE_XVFB === 'true';
  if (hasDisplay && !forceXvfb) {
    return 'display';
  }
  if (input.hasXvfbRun) {
    return 'xvfb';
  }
  return 'headless';
}

async function prepareBrowserLaunchEnvironment(): Promise<{
  env: NodeJS.ProcessEnv;
  headless: boolean;
  dispose?: () => Promise<void>;
}> {
  const env = { ...process.env };
  const mode = resolveBrowserLaunchMode(env, { hasXvfbRun: hasCommandInPath('xvfb-run') });
  if (mode === 'display') {
    return { env, headless: false };
  }
  if (mode === 'headless') {
    return { env, headless: true };
  }
  const session = await startXvfbSession(env);
  return {
    env: {
      ...env,
      DISPLAY: session.display,
    },
    headless: false,
    dispose: session.dispose,
  };
}

async function startXvfbSession(env: NodeJS.ProcessEnv): Promise<{
  display: string;
  dispose: () => Promise<void>;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      'xvfb-run',
      [
        '--auto-servernum',
        '--server-args=-screen 0 1280x960x24',
        'sh',
        '-lc',
        'echo "$DISPLAY"; trap "exit 0" TERM INT; while :; do sleep 3600; done',
      ],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let settled = false;
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`xvfb-run did not report DISPLAY: ${stderr || stdout || 'timeout'}`));
    }, 5000);

    const cleanupTimer = (): void => {
      clearTimeout(timer);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) {
        return;
      }
      stdout += chunk.toString('utf8');
      const line = stdout
        .split('\n')
        .map((item) => item.trim())
        .find(Boolean);
      if (!line) {
        return;
      }
      settled = true;
      cleanupTimer();
      resolve({
        display: line,
        dispose: () => stopChildProcess(child),
      });
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimer();
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupTimer();
      reject(new Error(`xvfb-run exited before browser launch env was ready (code=${code}): ${stderr || stdout}`));
    });
  });
}

function hasCommandInPath(command: string): boolean {
  const pathValue = process.env.PATH ?? '';
  for (const dir of pathValue.split(path.delimiter)) {
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function stopChildProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 2000);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function encodeRecordingWithFfmpeg(input: {
  framesDir: string;
  outputPath: string;
  fps: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      'ffmpeg',
      [
        '-y',
        '-framerate',
        String(input.fps),
        '-i',
        path.join(input.framesDir, 'frame-%06d.png'),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        input.outputPath,
      ],
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`ffmpeg encode failed: ${stderr || error.message}`));
          return;
        }
        resolve();
      },
    );
  });
}

function adaptContext(context: BrowserContext, onClose?: () => Promise<void>): BrowserContextLike {
  return {
    pages: () => context.pages().map(adaptPage),
    newPage: async () => adaptPage(await context.newPage()),
    close: async () => {
      try {
        await context.close();
      } finally {
        await onClose?.();
      }
    },
  };
}

function adaptPage(page: Page): BrowserPageLike {
  return {
    url: () => page.url(),
    title: async () => page.title(),
    goto: async (url) => {
      await page.goto(url);
    },
    goBack: async () => {
      await page.goBack();
    },
    close: async () => {
      await page.close();
    },
    bringToFront: async () => {
      await page.bringToFront();
    },
    locator: (selector: string): BrowserLocatorLike => adaptLocator(page.locator(selector)),
    keyboard: page.keyboard,
    setViewportSize: async (size) => {
      await page.setViewportSize(size);
    },
    screenshot: async (options) => page.screenshot(options as never),
    once: (event, listener) => page.once(event as never, listener as never),
    waitForTimeout: async (ms) => {
      await page.waitForTimeout(ms);
    },
    waitForSelector: async (selector, options) => {
      await page.waitForSelector(selector, options);
    },
    waitForFunction: async (fn, arg) => {
      await page.waitForFunction(fn, arg);
    },
    evaluate: async (fn, arg) => page.evaluate(fn as never, arg),
  };
}

function adaptLocator(locator: Locator): BrowserLocatorLike {
  return {
    click: async (options) => {
      await locator.click(options);
    },
    hover: async () => {
      await locator.hover();
    },
    dragTo: async (target) => {
      const targetLocator = target as unknown as Locator;
      await locator.dragTo(targetLocator);
    },
    fill: async (value) => {
      await locator.fill(value);
    },
    pressSequentially: async (value) => {
      await locator.pressSequentially(value);
    },
    selectOption: async (value) => {
      await locator.selectOption(value);
    },
    setInputFiles: async (files) => {
      await locator.setInputFiles(files);
    },
    setChecked: async (checked) => {
      await locator.setChecked(checked);
    },
  };
}
