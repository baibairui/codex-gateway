import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DesktopManager } from '../src/services/desktop-manager.js';

describe('DesktopManager', () => {
  it('launches apps through open -a', async () => {
    const adapter = createAdapter();
    const commandRunner = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const manager = new DesktopManager({ adapter, commandRunner });

    await manager.launchApp('Finder');

    expect(commandRunner).toHaveBeenCalledWith('open', ['-a', 'Finder']);
  });

  it('activates apps through osascript', async () => {
    const adapter = createAdapter();
    const commandRunner = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const manager = new DesktopManager({ adapter, commandRunner });

    await manager.activateApp('Finder');

    expect(commandRunner).toHaveBeenCalledWith('osascript', ['-e', 'tell application "Finder" to activate']);
  });

  it('reads the frontmost app from osascript output', async () => {
    const adapter = createAdapter();
    const commandRunner = vi.fn(async () => ({ stdout: 'Finder\n', stderr: '' }));
    const manager = new DesktopManager({ adapter, commandRunner });

    const result = await manager.frontmostApp();

    expect(commandRunner).toHaveBeenCalledWith('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true']);
    expect(result).toEqual({ appName: 'Finder' });
  });

  it('stores screenshots in the configured directory and returns an absolute path', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-manager-'));
    const adapter = createAdapter();
    const commandRunner = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const manager = new DesktopManager({
      adapter,
      commandRunner,
      screenshotDir: tempDir,
    });

    const filePath = await manager.takeScreenshot({ filename: 'desktop-step.png' });

    expect(filePath).toBe(path.join(tempDir, 'desktop-step.png'));
    expect(path.isAbsolute(filePath)).toBe(true);
    expect(adapter.screenshot).toHaveBeenCalledWith(path.join(tempDir, 'desktop-step.png'));
  });
});

function createAdapter() {
  return {
    moveMouse: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    drag: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    pressKey: vi.fn(async () => undefined),
    hotkey: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
  };
}
