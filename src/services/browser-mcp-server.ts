import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import * as z from 'zod/v4';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import type { BrowserManager, BrowserSnapshotResult, BrowserTabSummary } from './browser-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('BrowserMcpServer');
const BROWSER_MCP_SERVER_NAME = 'gateway_browser';
let browserMcpHttpServer: HttpServer | undefined;
let browserMcpStartPromise: Promise<void> | undefined;
const browserMcpTransports = new Map<string, StreamableHTTPServerTransport>();
const browserMcpServers = new Map<string, McpServer>();

type BrowserBackend = ReturnType<typeof createBrowserMcpBackend>;

export interface BrowserMcpRuntime {
  url: string;
  port: number;
  shouldAutoStart: boolean;
}

export function resolveBrowserMcpRuntime(input: {
  enabled: boolean;
  url?: string;
  port: number;
}): BrowserMcpRuntime | undefined {
  if (!input.enabled) {
    return undefined;
  }
  const resolvedUrl = input.url?.trim() || `http://127.0.0.1:${input.port}/mcp`;
  return {
    url: resolvedUrl,
    port: input.port,
    shouldAutoStart: !input.url?.trim(),
  };
}

export function createBrowserMcpBackend(manager: Pick<
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
>): {
  listTools(): Promise<Array<Record<string, unknown>>>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }> }>;
} {
  const snapshotResult = async (): Promise<{ content: Array<{ type: 'text'; text: string }> }> => (
    textResult(renderSnapshot(await manager.snapshot()))
  );

  return {
    async listTools() {
      const tools = [
        tool('browser_snapshot', 'Capture accessibility-style page snapshot', {}),
        tool('browser_navigate', 'Navigate current tab to a URL', {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        }),
        tool('browser_click', 'Click an element by ref', requiredProps({ ref: stringProp(), element: stringPropOptional() })),
        tool('browser_hover', 'Hover an element by ref', requiredProps({ ref: stringProp(), element: stringPropOptional() })),
        tool('browser_drag', 'Drag from start ref to end ref', requiredProps({
          startRef: stringProp(),
          endRef: stringProp(),
          startElement: stringPropOptional(),
          endElement: stringPropOptional(),
        }, ['startRef', 'endRef'])),
        tool('browser_type', 'Type into an element by ref', requiredProps({
          ref: stringProp(),
          text: stringProp(),
          element: stringPropOptional(),
          slowly: boolPropOptional(),
          submit: boolPropOptional(),
        }, ['ref', 'text'])),
        tool('browser_select_option', 'Select option(s) by ref', requiredProps({
          ref: stringProp(),
          values: { type: 'array', items: { type: 'string' } },
          element: stringPropOptional(),
        }, ['ref', 'values'])),
        tool('browser_press_key', 'Press a keyboard key', requiredProps({ key: stringProp() }, ['key'])),
        tool('browser_wait_for', 'Wait for time or text condition', {
          type: 'object',
          properties: { time: { type: 'number' }, text: { type: 'string' }, textGone: { type: 'string' } },
        }),
        tool('browser_evaluate', 'Evaluate JavaScript expression on page or element', requiredProps({
          function: stringProp(),
          ref: stringPropOptional(),
          element: stringPropOptional(),
        }, ['function'])),
        tool('browser_file_upload', 'Upload file(s) to a file input', requiredProps({
          ref: stringProp(),
          paths: { type: 'array', items: { type: 'string' } },
          element: stringPropOptional(),
        }, ['ref'])),
        tool('browser_fill_form', 'Fill multiple form fields', requiredProps({
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                ref: stringProp(),
                type: stringProp(),
                value: stringProp(),
              },
              required: ['ref', 'type', 'value'],
            },
          },
        }, ['fields'])),
        tool('browser_handle_dialog', 'Accept or dismiss the next dialog', requiredProps({
          accept: boolPropOptional(),
          promptText: stringPropOptional(),
        }, ['accept'])),
        tool('browser_resize', 'Resize viewport', requiredProps({
          width: { type: 'number' },
          height: { type: 'number' },
        }, ['width', 'height'])),
        tool('browser_take_screenshot', 'Take screenshot of current page', {
          type: 'object',
          properties: {
            filename: { type: 'string' },
            fullPage: { type: 'boolean' },
            type: { type: 'string', enum: ['png', 'jpeg'] },
            ref: { type: 'string' },
            element: { type: 'string' },
          },
        }),
        tool('browser_navigate_back', 'Navigate back in history', {}),
        tool('browser_close', 'Close current tab', {}),
        tool('browser_start_recording', 'Start recording current tab into a local mp4 file', {
          type: 'object',
          properties: {
            filename: { type: 'string' },
            intervalMs: { type: 'number' },
          },
        }),
        tool('browser_stop_recording', 'Stop active recording and return the local mp4 path', {}),
        tool('browser_tabs', 'List, create, or select tabs', {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
            index: { type: 'number' },
          },
          required: ['action'],
        }),
      ];
      log.info('Browser MCP tools/list', {
        toolNames: tools.map((item) => String(item.name)),
        toolCount: tools.length,
      });
      return tools;
    },
    async callTool(name, args) {
      log.info('Browser MCP tools/call', {
        toolName: name,
        argumentsPreview: JSON.stringify(args).slice(0, 500),
      });
      switch (name) {
        case 'browser_snapshot':
          return textResult(renderSnapshot(await manager.snapshot()));
        case 'browser_navigate':
          await manager.navigate(String(args.url ?? ''));
          return textResult(renderSnapshot(await manager.snapshot()));
        case 'browser_click':
          await manager.click(String(args.ref ?? ''));
          return snapshotResult();
        case 'browser_hover':
          await manager.hover(String(args.ref ?? ''));
          return snapshotResult();
        case 'browser_drag':
          await manager.drag(String(args.startRef ?? ''), String(args.endRef ?? ''));
          return snapshotResult();
        case 'browser_type':
          await manager.type(String(args.ref ?? ''), String(args.text ?? ''), {
            slowly: args.slowly === true,
            submit: args.submit === true,
          });
          return snapshotResult();
        case 'browser_select_option':
          await manager.selectOption(String(args.ref ?? ''), ((args.values as string[] | undefined) ?? []).map(String));
          return snapshotResult();
        case 'browser_press_key':
          await manager.pressKey(String(args.key ?? ''));
          return snapshotResult();
        case 'browser_wait_for':
          await manager.waitFor({
            time: typeof args.time === 'number' ? args.time : undefined,
            text: typeof args.text === 'string' ? args.text : undefined,
            textGone: typeof args.textGone === 'string' ? args.textGone : undefined,
          });
          return snapshotResult();
        case 'browser_evaluate': {
          const output = await manager.evaluate(String(args.function ?? ''), typeof args.ref === 'string' ? args.ref : undefined);
          return textResult(typeof output === 'string' ? output : JSON.stringify(output));
        }
        case 'browser_file_upload':
          await manager.fileUpload(
            String(args.ref ?? ''),
            Array.isArray(args.paths) ? args.paths.map(String) : [],
          );
          return snapshotResult();
        case 'browser_fill_form':
          await manager.fillForm(
            Array.isArray(args.fields)
              ? args.fields.map((field) => ({
                  ref: String((field as Record<string, unknown>).ref ?? ''),
                  type: String((field as Record<string, unknown>).type ?? ''),
                  value: String((field as Record<string, unknown>).value ?? ''),
                }))
              : [],
          );
          return snapshotResult();
        case 'browser_handle_dialog':
          await manager.handleDialog({
            accept: args.accept === true,
            promptText: typeof args.promptText === 'string' ? args.promptText : undefined,
          });
          return snapshotResult();
        case 'browser_resize':
          await manager.resize({
            width: Number(args.width ?? 0),
            height: Number(args.height ?? 0),
          });
          return snapshotResult();
        case 'browser_take_screenshot': {
          const filePath = await manager.takeScreenshot({
            filename: typeof args.filename === 'string' ? args.filename : undefined,
            fullPage: args.fullPage === true,
            type: args.type === 'jpeg' ? 'jpeg' : 'png',
            ref: typeof args.ref === 'string' ? args.ref : undefined,
          });
          return textResult(filePath);
        }
        case 'browser_navigate_back':
          await manager.navigateBack();
          return snapshotResult();
        case 'browser_close':
          await manager.closeCurrentTab();
          return textResult('OK');
        case 'browser_start_recording': {
          const result = await manager.startRecording({
            filename: typeof args.filename === 'string' ? args.filename : undefined,
            intervalMs: typeof args.intervalMs === 'number' ? args.intervalMs : undefined,
          });
          return textResult(`recording started: session=${result.sessionId} output=${result.outputPath}`);
        }
        case 'browser_stop_recording': {
          const result = await manager.stopRecording();
          return textResult(`recording saved: ${result.outputPath} (session=${result.sessionId}, frames=${result.frames})`);
        }
        case 'browser_tabs':
          return textResult(await handleTabsTool(manager, args));
        default:
          throw new Error(`Unsupported browser tool: ${name}`);
      }
    },
  };
}

export async function startBrowserMcpServer(
  runtime: BrowserMcpRuntime | undefined,
  manager: BrowserManager,
): Promise<void> {
  if (!runtime?.shouldAutoStart) {
    return;
  }
  if (browserMcpHttpServer) {
    return;
  }
  if (browserMcpStartPromise) {
    return browserMcpStartPromise;
  }

  const url = new URL(runtime.url);
  const host = normalizeListenHost(url.hostname);
  const app = createMcpExpressApp({ host });

  app.post('/mcp', async (req, res) => {
    try {
      const sessionId = headerSessionId(req.headers['mcp-session-id']);
      const existingTransport = sessionId ? browserMcpTransports.get(sessionId) : undefined;
      const initialize = !sessionId && isInitializeRequest(req.body);
      log.info('Browser MCP HTTP POST', {
        sessionId: sessionId ?? '(none)',
        initialize,
        bodyMethod: requestMethodName(req.body),
        hasExistingTransport: !!existingTransport,
      });

      if (existingTransport) {
        await existingTransport.handleRequest(req, res, req.body);
        log.info('Browser MCP HTTP POST handled by existing transport', {
          sessionId,
          statusCode: res.statusCode,
          contentType: responseContentType(res.getHeader('content-type')),
        });
        return;
      }

      if (initialize) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            browserMcpTransports.set(newSessionId, transport);
            log.info('Browser MCP session initialized', { sessionId: newSessionId });
          },
        });
        const server = createSdkBrowserServer(manager);

        transport.onclose = () => {
          const currentSessionId = transport.sessionId;
          if (currentSessionId) {
            browserMcpTransports.delete(currentSessionId);
            const activeServer = browserMcpServers.get(currentSessionId);
            browserMcpServers.delete(currentSessionId);
            void activeServer?.close().catch(() => undefined);
          }
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);

        if (transport.sessionId) {
          browserMcpServers.set(transport.sessionId, server);
        }
        log.info('Browser MCP initialize handled', {
          sessionId: transport.sessionId ?? '(none)',
          statusCode: res.statusCode,
          contentType: responseContentType(res.getHeader('content-type')),
        });
        return;
      }

      log.warn('Browser MCP HTTP POST rejected', {
        sessionId: sessionId ?? '(none)',
        bodyMethod: requestMethodName(req.body),
      });
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
    } catch (error) {
      log.error('Browser MCP request 处理失败', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = headerSessionId(req.headers['mcp-session-id']);
    const transport = sessionId ? browserMcpTransports.get(sessionId) : undefined;
    log.info('Browser MCP HTTP GET', {
      sessionId: sessionId ?? '(none)',
      hasTransport: !!transport,
    });
    if (!sessionId || !transport) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Invalid or missing session ID',
        },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res);
    log.info('Browser MCP HTTP GET handled', {
      sessionId,
      statusCode: res.statusCode,
      contentType: responseContentType(res.getHeader('content-type')),
    });
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = headerSessionId(req.headers['mcp-session-id']);
    const transport = sessionId ? browserMcpTransports.get(sessionId) : undefined;
    log.info('Browser MCP HTTP DELETE', {
      sessionId: sessionId ?? '(none)',
      hasTransport: !!transport,
    });
    if (!sessionId || !transport) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Invalid or missing session ID',
        },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res);
    log.info('Browser MCP HTTP DELETE handled', {
      sessionId,
      statusCode: res.statusCode,
      contentType: responseContentType(res.getHeader('content-type')),
    });
  });

  browserMcpStartPromise = new Promise<void>((resolve, reject) => {
    const server = app.listen(runtime.port, host, () => {
      browserMcpHttpServer = server;
      log.info('Gateway browser MCP 已启动', { url: runtime.url, host, port: runtime.port });
      resolve();
    });
    server.on('error', (error) => {
      browserMcpStartPromise = undefined;
      reject(error);
    });
  });

  return browserMcpStartPromise;
}

export function browserMcpConfigArgs(url: string): string[] {
  return [
    '-c',
    `mcp_servers.${BROWSER_MCP_SERVER_NAME}.url=${tomlString(url)}`,
  ];
}

function tool(name: string, description: string, inputSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {},
      ...inputSchema,
    },
  };
}

function stringProp(): Record<string, unknown> {
  return { type: 'string' };
}

function stringPropOptional(): Record<string, unknown> {
  return { type: 'string' };
}

function boolPropOptional(): Record<string, unknown> {
  return { type: 'boolean' };
}

function requiredProps(
  properties: Record<string, unknown>,
  required = Object.keys(properties),
): Record<string, unknown> {
  return { type: 'object', properties, required };
}

async function handleTabsTool(
  manager: Pick<BrowserManager, 'listTabs' | 'selectTab' | 'newTab' | 'closeCurrentTab'>,
  args: Record<string, unknown>,
): Promise<string> {
  const action = String(args.action ?? 'list');
  if (action === 'list') {
    return renderTabs(await manager.listTabs());
  }
  if (action === 'new') {
    await manager.newTab();
    return renderTabs(await manager.listTabs());
  }
  if (action === 'select') {
    await manager.selectTab(Number(args.index));
    return renderTabs(await manager.listTabs());
  }
  if (action === 'close') {
    await manager.closeCurrentTab();
    return renderTabs(await manager.listTabs());
  }
  throw new Error(`Unsupported browser_tabs action: ${action}`);
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

function textResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text }],
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function headerSessionId(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]?.trim() || undefined;
  }
  return value?.trim() || undefined;
}

function requestMethodName(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  if (Array.isArray(body)) {
    const first = body[0];
    if (first && typeof first === 'object' && 'method' in first) {
      return typeof first.method === 'string' ? first.method : undefined;
    }
    return undefined;
  }
  if ('method' in body) {
    return typeof body.method === 'string' ? body.method : undefined;
  }
  return undefined;
}

function responseContentType(value: number | string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return value;
}

function normalizeListenHost(hostname: string | undefined): string {
  if (!hostname || hostname === 'localhost') {
    return '127.0.0.1';
  }
  return hostname;
}

function createSdkBrowserServer(
  manager: Pick<
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
  >,
): McpServer {
  const backend = createBrowserMcpBackend(manager);
  const server = new McpServer({
    name: BROWSER_MCP_SERVER_NAME,
    version: '0.1.0',
  });

  server.registerTool('browser_snapshot', {
    description: 'Capture accessibility-style page snapshot',
    inputSchema: {},
  }, async () => backend.callTool('browser_snapshot', {}));

  server.registerTool('browser_navigate', {
    description: 'Navigate current tab to a URL',
    inputSchema: {
      url: z.string(),
    },
  }, async ({ url }) => backend.callTool('browser_navigate', { url }));

  server.registerTool('browser_click', {
    description: 'Click an element by ref',
    inputSchema: {
      ref: z.string(),
      element: z.string().optional(),
    },
  }, async ({ ref, element }) => backend.callTool('browser_click', { ref, element }));

  server.registerTool('browser_hover', {
    description: 'Hover an element by ref',
    inputSchema: {
      ref: z.string(),
      element: z.string().optional(),
    },
  }, async ({ ref, element }) => backend.callTool('browser_hover', { ref, element }));

  server.registerTool('browser_drag', {
    description: 'Drag from start ref to end ref',
    inputSchema: {
      startRef: z.string(),
      endRef: z.string(),
      startElement: z.string().optional(),
      endElement: z.string().optional(),
    },
  }, async ({ startRef, endRef, startElement, endElement }) => backend.callTool('browser_drag', {
    startRef,
    endRef,
    startElement,
    endElement,
  }));

  server.registerTool('browser_type', {
    description: 'Type into an element by ref',
    inputSchema: {
      ref: z.string(),
      text: z.string(),
      element: z.string().optional(),
      slowly: z.boolean().optional(),
      submit: z.boolean().optional(),
    },
  }, async ({ ref, text, element, slowly, submit }) => backend.callTool('browser_type', {
    ref,
    text,
    element,
    slowly,
    submit,
  }));

  server.registerTool('browser_select_option', {
    description: 'Select option(s) by ref',
    inputSchema: {
      ref: z.string(),
      values: z.array(z.string()),
      element: z.string().optional(),
    },
  }, async ({ ref, values, element }) => backend.callTool('browser_select_option', { ref, values, element }));

  server.registerTool('browser_press_key', {
    description: 'Press a keyboard key',
    inputSchema: {
      key: z.string(),
    },
  }, async ({ key }) => backend.callTool('browser_press_key', { key }));

  server.registerTool('browser_wait_for', {
    description: 'Wait for time or text condition',
    inputSchema: {
      time: z.number().optional(),
      text: z.string().optional(),
      textGone: z.string().optional(),
    },
  }, async ({ time, text, textGone }) => backend.callTool('browser_wait_for', { time, text, textGone }));

  server.registerTool('browser_evaluate', {
    description: 'Evaluate JavaScript expression on page or element',
    inputSchema: {
      function: z.string(),
      ref: z.string().optional(),
      element: z.string().optional(),
    },
  }, async ({ function: functionCode, ref, element }) => backend.callTool('browser_evaluate', {
    function: functionCode,
    ref,
    element,
  }));

  server.registerTool('browser_file_upload', {
    description: 'Upload file(s) to a file input',
    inputSchema: {
      ref: z.string(),
      paths: z.array(z.string()).optional(),
      element: z.string().optional(),
    },
  }, async ({ ref, paths, element }) => backend.callTool('browser_file_upload', { ref, paths, element }));

  server.registerTool('browser_fill_form', {
    description: 'Fill multiple form fields',
    inputSchema: {
      fields: z.array(z.object({
        ref: z.string(),
        type: z.string(),
        value: z.string(),
      })),
    },
  }, async ({ fields }) => backend.callTool('browser_fill_form', { fields }));

  server.registerTool('browser_handle_dialog', {
    description: 'Accept or dismiss the next dialog',
    inputSchema: {
      accept: z.boolean(),
      promptText: z.string().optional(),
    },
  }, async ({ accept, promptText }) => backend.callTool('browser_handle_dialog', { accept, promptText }));

  server.registerTool('browser_resize', {
    description: 'Resize viewport',
    inputSchema: {
      width: z.number(),
      height: z.number(),
    },
  }, async ({ width, height }) => backend.callTool('browser_resize', { width, height }));

  server.registerTool('browser_take_screenshot', {
    description: 'Take screenshot of current page or a specific element ref',
    inputSchema: {
      filename: z.string().optional(),
      fullPage: z.boolean().optional(),
      type: z.enum(['png', 'jpeg']).optional(),
      ref: z.string().optional(),
      element: z.string().optional(),
    },
  }, async ({ filename, fullPage, type, ref, element }) => backend.callTool('browser_take_screenshot', {
    filename,
    fullPage,
    type,
    ref,
    element,
  }));

  server.registerTool('browser_navigate_back', {
    description: 'Navigate back in history',
    inputSchema: {},
  }, async () => backend.callTool('browser_navigate_back', {}));

  server.registerTool('browser_close', {
    description: 'Close current tab',
    inputSchema: {},
  }, async () => backend.callTool('browser_close', {}));

  server.registerTool('browser_start_recording', {
    description: 'Start recording current tab into a local mp4 file',
    inputSchema: {
      filename: z.string().optional(),
      intervalMs: z.number().optional(),
    },
  }, async ({ filename, intervalMs }) => backend.callTool('browser_start_recording', { filename, intervalMs }));

  server.registerTool('browser_stop_recording', {
    description: 'Stop active recording and return the local mp4 path',
    inputSchema: {},
  }, async () => backend.callTool('browser_stop_recording', {}));

  server.registerTool('browser_tabs', {
    description: 'List, create, or select tabs',
    inputSchema: {
      action: z.enum(['list', 'new', 'select', 'close']),
      index: z.number().optional(),
    },
  }, async ({ action, index }) => backend.callTool('browser_tabs', { action, index }));

  return server;
}

export { BROWSER_MCP_SERVER_NAME };
