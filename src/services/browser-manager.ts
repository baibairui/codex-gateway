import fs from 'node:fs';
import path from 'node:path';
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
}

const DEFAULT_REF_ATTR = 'data-gateway-ref';

export class BrowserManager {
  private readonly launcher: BrowserLauncher;
  private readonly tabs = new Map<number, BrowserPageLike>();
  private currentTabId?: number;
  private nextTabId = 0;
  private contextPromise?: Promise<BrowserContextLike>;
  private readonly screenshotDir: string;

  constructor(options: BrowserManagerOptions = {}) {
    this.launcher = options.launcher ?? createDefaultLauncher(options.profileDir);
    this.screenshotDir = path.resolve(options.screenshotDir ?? '.data/browser/screenshots');
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
      snapshot: renderSnapshotEntries((state.entries as BrowserSnapshotEntry[] | undefined) ?? []),
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
}

function selectorForRef(ref: string): string {
  return `[${DEFAULT_REF_ATTR}="${ref}"]`;
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

function createDefaultLauncher(profileDir = '.data/browser/profile'): BrowserLauncher {
  return async () => {
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: false,
      viewport: null,
    });
    return adaptContext(context);
  };
}

function adaptContext(context: BrowserContext): BrowserContextLike {
  return {
    pages: () => context.pages().map(adaptPage),
    newPage: async () => adaptPage(await context.newPage()),
    close: async () => {
      await context.close();
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
