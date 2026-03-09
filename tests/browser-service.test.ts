import { describe, expect, it, vi } from 'vitest';

import { createBrowserAutomationBackend } from '../src/services/browser-service.js';

describe('createBrowserAutomationBackend', () => {
  it('reuses the current tab for snapshot and navigate', async () => {
    const manager = {
      snapshot: vi.fn(async () => ({
        page: '- Page URL: about:blank',
        snapshot: '- button "Go" [ref=e1]',
      })),
      navigate: vi.fn(async () => undefined),
      navigateBack: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      waitFor: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => 'ok'),
      fileUpload: vi.fn(async () => undefined),
      fillForm: vi.fn(async () => undefined),
      handleDialog: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/s.png'),
      startRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4' })),
      stopRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4', frames: 10 })),
      listTabs: vi.fn(async () => []),
      selectTab: vi.fn(async () => undefined),
      newTab: vi.fn(async () => undefined),
      closeCurrentTab: vi.fn(async () => undefined),
    };
    const backend = createBrowserAutomationBackend(manager);

    const snapshotResult = await backend.execute('snapshot', {});
    const navigateResult = await backend.execute('navigate', { url: 'https://example.com' });

    expect(manager.snapshot).toHaveBeenCalledTimes(2);
    expect(manager.navigate).toHaveBeenCalledWith('https://example.com');
    expect(snapshotResult.text).toContain('Page URL');
    expect(navigateResult.text).toContain('Page URL');
  });

  it('returns a fresh snapshot after click-style interactions', async () => {
    const manager = {
      snapshot: vi.fn(async () => ({
        page: '- Page URL: https://example.com',
        snapshot: '- button "Save" [ref=e1]',
      })),
      navigate: vi.fn(async () => undefined),
      navigateBack: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      waitFor: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => 'ok'),
      fileUpload: vi.fn(async () => undefined),
      fillForm: vi.fn(async () => undefined),
      handleDialog: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/s.png'),
      startRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4' })),
      stopRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4', frames: 10 })),
      listTabs: vi.fn(async () => []),
      selectTab: vi.fn(async () => undefined),
      newTab: vi.fn(async () => undefined),
      closeCurrentTab: vi.fn(async () => undefined),
    };
    const backend = createBrowserAutomationBackend(manager);

    const clickResult = await backend.execute('click', { ref: 'e1' });
    const typeResult = await backend.execute('type', { ref: 'e1', text: 'hello' });

    expect(manager.click).toHaveBeenCalledWith('e1');
    expect(manager.type).toHaveBeenCalledWith('e1', 'hello', { slowly: false, submit: false });
    expect(manager.snapshot).toHaveBeenCalledTimes(2);
    expect(clickResult.text).toContain('Page URL');
    expect(typeResult.text).toContain('button "Save"');
  });

  it('supports tabs list/new/select actions', async () => {
    const manager = {
      snapshot: vi.fn(async () => ({ page: '', snapshot: '' })),
      navigate: vi.fn(async () => undefined),
      navigateBack: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      waitFor: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => 'ok'),
      fileUpload: vi.fn(async () => undefined),
      fillForm: vi.fn(async () => undefined),
      handleDialog: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/s.png'),
      startRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4' })),
      stopRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4', frames: 10 })),
      listTabs: vi.fn(async () => [{ index: 0, url: 'https://example.com', title: 'Example', current: true }]),
      selectTab: vi.fn(async () => undefined),
      newTab: vi.fn(async () => undefined),
      closeCurrentTab: vi.fn(async () => undefined),
    };
    const backend = createBrowserAutomationBackend(manager);

    await backend.execute('tabs', { action: 'list' });
    await backend.execute('tabs', { action: 'new' });
    await backend.execute('tabs', { action: 'select', index: 0 });

    expect(manager.listTabs).toHaveBeenCalledTimes(3);
    expect(manager.newTab).toHaveBeenCalledTimes(1);
    expect(manager.selectTab).toHaveBeenCalledWith(0);
  });

  it('passes screenshot ref through to the manager', async () => {
    const manager = {
      snapshot: vi.fn(async () => ({ page: '', snapshot: '' })),
      navigate: vi.fn(async () => undefined),
      navigateBack: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      waitFor: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => 'ok'),
      fileUpload: vi.fn(async () => undefined),
      fillForm: vi.fn(async () => undefined),
      handleDialog: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/field.png'),
      startRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4' })),
      stopRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4', frames: 10 })),
      listTabs: vi.fn(async () => []),
      selectTab: vi.fn(async () => undefined),
      newTab: vi.fn(async () => undefined),
      closeCurrentTab: vi.fn(async () => undefined),
    };
    const backend = createBrowserAutomationBackend(manager);

    const result = await backend.execute('screenshot', { ref: 'e2', type: 'png' });

    expect(manager.takeScreenshot).toHaveBeenCalledWith({
      filename: undefined,
      fullPage: false,
      type: 'png',
      ref: 'e2',
    });
    expect(result.text).toBe('/tmp/field.png');
  });

  it('supports recording start/stop actions', async () => {
    const manager = {
      snapshot: vi.fn(async () => ({ page: '', snapshot: '' })),
      navigate: vi.fn(async () => undefined),
      navigateBack: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      hover: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      selectOption: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      waitFor: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => 'ok'),
      fileUpload: vi.fn(async () => undefined),
      fillForm: vi.fn(async () => undefined),
      handleDialog: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/field.png'),
      startRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4' })),
      stopRecording: vi.fn(async () => ({ sessionId: 'rec-1', outputPath: '/tmp/rec.mp4', frames: 24 })),
      listTabs: vi.fn(async () => []),
      selectTab: vi.fn(async () => undefined),
      newTab: vi.fn(async () => undefined),
      closeCurrentTab: vi.fn(async () => undefined),
    };
    const backend = createBrowserAutomationBackend(manager);

    const start = await backend.execute('start-recording', { filename: 'demo.mp4', intervalMs: 400 });
    const stop = await backend.execute('stop-recording', {});

    expect(manager.startRecording).toHaveBeenCalledWith({
      filename: 'demo.mp4',
      intervalMs: 400,
    });
    expect(manager.stopRecording).toHaveBeenCalledTimes(1);
    expect(start.text).toContain('recording started');
    expect(stop.text).toContain('/tmp/rec.mp4');
  });
});
