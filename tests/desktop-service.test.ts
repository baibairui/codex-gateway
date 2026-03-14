import { describe, expect, it, vi } from 'vitest';

import { createDesktopAutomationBackend } from '../src/services/desktop-service.js';

describe('createDesktopAutomationBackend', () => {
  it('delegates launch-app and frontmost-app commands', async () => {
    const manager = {
      launchApp: vi.fn(async () => undefined),
      activateApp: vi.fn(async () => undefined),
      frontmostApp: vi.fn(async () => ({ appName: 'Finder' })),
      moveMouse: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      typeText: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      hotkey: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/desktop.png'),
    };
    const backend = createDesktopAutomationBackend(manager);

    const launchResult = await backend.execute('launch-app', { appName: 'Finder' });
    const frontmostResult = await backend.execute('frontmost-app', {});

    expect(manager.launchApp).toHaveBeenCalledWith('Finder');
    expect(launchResult.text).toContain('Finder');
    expect(manager.frontmostApp).toHaveBeenCalledTimes(1);
    expect(frontmostResult.text).toBe('frontmost app: Finder');
    expect(frontmostResult.data).toEqual({ frontmostApp: 'Finder' });
  });

  it('normalizes pointer and keyboard commands', async () => {
    const manager = {
      launchApp: vi.fn(async () => undefined),
      activateApp: vi.fn(async () => undefined),
      frontmostApp: vi.fn(async () => ({ appName: 'Finder' })),
      moveMouse: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      typeText: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      hotkey: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/desktop.png'),
    };
    const backend = createDesktopAutomationBackend(manager);

    await backend.execute('move-mouse', { x: 640, y: 420 });
    await backend.execute('click', { x: 640, y: 420, button: 'right', double: true });
    await backend.execute('drag', { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
    await backend.execute('type-text', { text: 'hello' });
    await backend.execute('press-key', { key: 'Enter' });
    await backend.execute('hotkey', { keys: ['Meta', 'Shift', '4'] });

    expect(manager.moveMouse).toHaveBeenCalledWith({ x: 640, y: 420 });
    expect(manager.click).toHaveBeenCalledWith({
      button: 'right',
      coordinate: { x: 640, y: 420 },
      double: true,
    });
    expect(manager.drag).toHaveBeenCalledWith({
      from: { x: 1, y: 2 },
      to: { x: 3, y: 4 },
    });
    expect(manager.typeText).toHaveBeenCalledWith('hello');
    expect(manager.pressKey).toHaveBeenCalledWith('Enter');
    expect(manager.hotkey).toHaveBeenCalledWith(['Meta', 'Shift', '4']);
  });

  it('returns screenshot paths in text and data', async () => {
    const manager = {
      launchApp: vi.fn(async () => undefined),
      activateApp: vi.fn(async () => undefined),
      frontmostApp: vi.fn(async () => ({ appName: 'Finder' })),
      moveMouse: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      typeText: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      hotkey: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/desktop-step.png'),
    };
    const backend = createDesktopAutomationBackend(manager);

    const result = await backend.execute('screenshot', { filename: 'desktop-step.png' });

    expect(manager.takeScreenshot).toHaveBeenCalledWith({ filename: 'desktop-step.png' });
    expect(result.text).toBe('/tmp/desktop-step.png');
    expect(result.data).toEqual({ path: '/tmp/desktop-step.png' });
  });

  it('throws on unsupported commands', async () => {
    const manager = {
      launchApp: vi.fn(async () => undefined),
      activateApp: vi.fn(async () => undefined),
      frontmostApp: vi.fn(async () => ({ appName: 'Finder' })),
      moveMouse: vi.fn(async () => undefined),
      click: vi.fn(async () => undefined),
      drag: vi.fn(async () => undefined),
      typeText: vi.fn(async () => undefined),
      pressKey: vi.fn(async () => undefined),
      hotkey: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => '/tmp/desktop-step.png'),
    };
    const backend = createDesktopAutomationBackend(manager);

    await expect(backend.execute('unsupported', {})).rejects.toThrow('Unsupported desktop command: unsupported');
  });
});
