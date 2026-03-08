import { describe, expect, it } from 'vitest';

import { BrowserManager, type BrowserContextLike, type BrowserLauncher, type BrowserPageLike } from '../src/services/browser-manager.js';

class FakeLocator {
  async click(): Promise<void> {}
  async fill(): Promise<void> {}
  async pressSequentially(): Promise<void> {}
  async selectOption(): Promise<void> {}
  async screenshot(): Promise<Buffer> { return Buffer.from('locator'); }
}

class FakeKeyboard {
  async press(): Promise<void> {}
  async type(): Promise<void> {}
}

class FakePage implements BrowserPageLike {
  public currentUrl = 'about:blank';
  public readonly keyboard = new FakeKeyboard();
  public waitedMs?: number;
  public snapshotEntries: Array<Record<string, unknown>> = [];
  public screenshotCount = 0;

  constructor(url = 'about:blank') {
    this.currentUrl = url;
  }

  url(): string {
    return this.currentUrl;
  }

  async title(): Promise<string> {
    return this.currentUrl;
  }

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
  }

  async close(): Promise<void> {}

  async bringToFront(): Promise<void> {}

  locator(): FakeLocator {
    return new FakeLocator();
  }

  async waitForTimeout(ms: number): Promise<void> {
    this.waitedMs = ms;
  }

  async waitForSelector(): Promise<void> {}

  async waitForFunction(): Promise<void> {}

  async screenshot(): Promise<Buffer> {
    this.screenshotCount += 1;
    return Buffer.from(`frame-${this.screenshotCount}`);
  }

  async evaluate<T>(fn: ((arg: unknown) => T) | (() => T), arg?: unknown): Promise<T> {
    void fn;
    return {
      url: this.currentUrl,
      title: this.currentUrl,
      entries: this.snapshotEntries,
    } as T;
  }
}

class FakeContext implements BrowserContextLike {
  constructor(private readonly currentPages: FakePage[] = []) {}

  pages(): BrowserPageLike[] {
    return this.currentPages;
  }

  async newPage(): Promise<BrowserPageLike> {
    const page = new FakePage();
    this.currentPages.push(page);
    return page;
  }

  async close(): Promise<void> {}
}

describe('BrowserManager', () => {
  it('lazily starts browser context on first tab request', async () => {
    let launches = 0;
    const launcher: BrowserLauncher = async () => {
      launches++;
      return new FakeContext();
    };
    const manager = new BrowserManager({ launcher });

    expect(launches).toBe(0);
    await manager.ensureCurrentTab();
    expect(launches).toBe(1);
  });

  it('preserves current tab URL across multiple operations', async () => {
    const manager = new BrowserManager({
      launcher: async () => new FakeContext(),
    });

    await manager.navigate('https://example.com/a');
    expect(await manager.currentUrl()).toBe('https://example.com/a');

    await manager.snapshot();
    expect(await manager.currentUrl()).toBe('https://example.com/a');
  });

  it('switches to another existing tab when closing the current tab', async () => {
    const existingPages = [
      new FakePage('https://example.com/1'),
      new FakePage('https://example.com/2'),
    ];
    const manager = new BrowserManager({
      launcher: async () => new FakeContext(existingPages),
    });

    const tabs = await manager.listTabs();
    await manager.selectTab(tabs[1]!.index);
    expect(await manager.currentUrl()).toBe('https://example.com/2');

    await manager.closeCurrentTab();
    expect(await manager.currentUrl()).toBe('https://example.com/1');
  });

  it('treats large browser_wait_for time values as milliseconds', async () => {
    const page = new FakePage('https://example.com');
    const manager = new BrowserManager({
      launcher: async () => new FakeContext([page]),
    });

    await manager.waitFor({ time: 1500 });

    expect(page.waitedMs).toBe(1500);
  });

  it('renders snapshot entries with readable labels and states', async () => {
    const page = new FakePage('https://example.com/form');
    page.snapshotEntries = [
      { ref: 'e1', tag: 'input', placeholder: 'Search docs', value: 'billing status' },
      { ref: 'e2', tag: 'button', text: 'Save changes' },
      { ref: 'e3', tag: 'input', label: 'Remember me', checked: true },
      { ref: 'e4', tag: 'select', label: 'Region', selectedText: 'Hangzhou' },
    ];
    const manager = new BrowserManager({
      launcher: async () => new FakeContext([page]),
    });

    const snapshot = await manager.snapshot();

    expect(snapshot.snapshot).toContain('- input "Search docs" value="billing status" [ref=e1]');
    expect(snapshot.snapshot).toContain('- button "Save changes" [ref=e2]');
    expect(snapshot.snapshot).toContain('- input "Remember me" checked [ref=e3]');
    expect(snapshot.snapshot).toContain('- select "Region" value="Hangzhou" [ref=e4]');
  });

  it('supports element screenshots by ref', async () => {
    const page = new FakePage('https://example.com/form');
    const manager = new BrowserManager({
      launcher: async () => new FakeContext([page]),
      screenshotDir: '/tmp/browser-manager-tests',
    });

    const filePath = await manager.takeScreenshot({
      filename: 'field.png',
      ref: 'e2',
    });

    expect(filePath).toBe('/tmp/browser-manager-tests/field.png');
  });

  it('records current tab into a video file via injected encoder', async () => {
    const page = new FakePage('https://example.com/record');
    const encoded: Array<{ framesDir: string; outputPath: string; fps: number }> = [];
    const manager = new BrowserManager({
      launcher: async () => new FakeContext([page]),
      recordingDir: '/tmp/browser-manager-record-tests',
      videoEncoder: async (input) => {
        encoded.push(input);
      },
    });

    const started = await manager.startRecording({
      filename: 'demo.mp4',
      intervalMs: 200,
    });
    const stopped = await manager.stopRecording();

    expect(started.outputPath).toBe('/tmp/browser-manager-record-tests/demo.mp4');
    expect(stopped.outputPath).toBe('/tmp/browser-manager-record-tests/demo.mp4');
    expect(stopped.frames).toBeGreaterThan(0);
    expect(encoded).toHaveLength(1);
    expect(encoded[0]?.outputPath).toBe('/tmp/browser-manager-record-tests/demo.mp4');
    expect(encoded[0]?.fps).toBe(5);
  });
});
