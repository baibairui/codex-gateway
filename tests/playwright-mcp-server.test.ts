import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildLocalPlaywrightMcpArgs,
  resolvePlaywrightMcpRuntime,
} from '../src/services/playwright-mcp-server.js';

describe('resolvePlaywrightMcpRuntime', () => {
  it('uses the provided url without auto start', () => {
    const runtime = resolvePlaywrightMcpRuntime({
      enabled: true,
      url: 'http://127.0.0.1:9931/mcp',
      port: 8931,
      profileDir: '/tmp/profile',
      outputDir: '/tmp/artifacts',
    });

    expect(runtime).toEqual({
      url: 'http://127.0.0.1:9931/mcp',
      port: 8931,
      profileDir: '/tmp/profile',
      outputDir: '/tmp/artifacts',
      shouldAutoStart: false,
    });
  });

  it('builds a local url and enables auto start by default', () => {
    const runtime = resolvePlaywrightMcpRuntime({
      enabled: true,
      port: 8931,
      profileDir: '/tmp/profile',
      outputDir: '/tmp/artifacts',
    });

    expect(runtime).toEqual({
      url: 'http://127.0.0.1:8931/mcp',
      port: 8931,
      profileDir: '/tmp/profile',
      outputDir: '/tmp/artifacts',
      shouldAutoStart: true,
    });
  });
});

describe('buildLocalPlaywrightMcpArgs', () => {
  it('builds local cli args with host, port, shared profile, and output dir', () => {
    const cliPath = fileURLToPath(new URL('../node_modules/@playwright/mcp/cli.js', import.meta.url));
    const args = buildLocalPlaywrightMcpArgs({
      port: 8931,
      profileDir: '/tmp/profile',
      outputDir: '/tmp/artifacts',
    });

    expect(args).toEqual([
      cliPath,
      '--host',
      '127.0.0.1',
      '--port',
      '8931',
      '--save-session',
      '--user-data-dir',
      '/tmp/profile',
      '--output-dir',
      '/tmp/artifacts',
    ]);
  });
});
