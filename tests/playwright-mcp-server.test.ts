import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildLocalPlaywrightMcpArgs,
  classifyPlaywrightMcpStderrText,
  drainPlaywrightMcpStderrBuffer,
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
      url: 'http://localhost:8931/mcp',
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

describe('classifyPlaywrightMcpStderrText', () => {
  it('ignores the startup banner because gateway already logs readiness separately', () => {
    const classification = classifyPlaywrightMcpStderrText(`Listening on http://localhost:8931
Put this in your client config:
{
  "mcpServers": {
    "playwright": {
      "url": "http://localhost:8931/mcp"
    }
  }
}
For legacy SSE transport support, you can use the /sse endpoint instead.
`);

    expect(classification).toBeUndefined();
  });

  it('keeps real stderr content as warnings', () => {
    expect(classifyPlaywrightMcpStderrText('browser launch failed')).toEqual({
      level: 'warn',
      text: 'browser launch failed',
    });
  });

  it('ignores blank stderr chunks', () => {
    expect(classifyPlaywrightMcpStderrText(' \n\t ')).toBeUndefined();
  });
});

describe('drainPlaywrightMcpStderrBuffer', () => {
  it('waits for the full startup banner before deciding to ignore it', () => {
    const partial = drainPlaywrightMcpStderrBuffer(`Listening on http://localhost:8931
Put this in your client config:
{
  "mcpServers": {
`);

    expect(partial).toEqual({
      remaining: `Listening on http://localhost:8931
Put this in your client config:
{
  "mcpServers": {
`,
    });

    const complete = drainPlaywrightMcpStderrBuffer(
      `${partial.remaining}    "playwright": {
      "url": "http://localhost:8931/mcp"
    }
  }
}
For legacy SSE transport support, you can use the /sse endpoint instead.
`,
    );

    expect(complete).toEqual({
      remaining: '',
    });
  });
});
