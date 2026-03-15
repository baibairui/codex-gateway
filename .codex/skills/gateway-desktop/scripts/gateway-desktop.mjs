#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const argv = process.argv.slice(2);
const requireFromSkill = createRequire(import.meta.url);
const requireFromCwd = createRequire(path.join(process.cwd(), '__gateway-desktop__.cjs'));
const HOST_APP_NAMES = new Set(['Codex', 'Terminal', 'iTerm2', 'Warp', 'Ghostty', 'Visual Studio Code', 'Cursor']);
let nutJsPromise;
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

try {
  assertSupportedPlatform();
  const [command, ...rest] = argv;
  const parsed = parseArgs(rest);
  const args = normalizeArgs(command, parsed);
  const result = await execute(command, args);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function printHelp() {
  process.stdout.write([
    'Gateway Desktop CLI (direct)',
    '',
    'Commands:',
    '  observe [--app-name <name>] [--filename desktop-observe.png] [--label inbox] [--show-cursor true] [--settle-ms 350]',
    '  act --steps <json-array>',
    '  launch-app --app-name <name> [--settle-ms 350]',
    '  activate-app --app-name <name> [--settle-ms 350]',
    '  frontmost-app',
    '  move-mouse --x <n> --y <n>',
    '  click [--x <n>] [--y <n>] [--button left|right] [--double true]',
    '  drag --from-x <n> --from-y <n> --to-x <n> --to-y <n>',
    '  type-text --text <value>',
    '  press-key --key <key>',
    '  hotkey --keys Meta,Shift,4',
    '  screenshot [--app-name <name>] [--filename desktop-step.png] [--show-cursor true] [--settle-ms 350]',
    '  run-applescript --script <value>',
    '  run-shell --command <value>',
  ].join('\n'));
}

async function execute(command, args) {
  if (command === 'observe') {
    return observe(args);
  }
  if (command === 'act') {
    return act(args.steps);
  }
  return executeAtomic(command, args);
}

async function executeAtomic(command, args) {
  switch (command) {
    case 'launch-app':
      await launchAppName(args.appName, args.settleMs ?? 350);
      rememberDesktopApp(args.appName);
      return { text: `launched app: ${args.appName}`, data: { appName: args.appName } };
    case 'activate-app':
      await activateAppName(args.appName, args.settleMs ?? 350);
      rememberDesktopApp(args.appName);
      return { text: `activated app: ${args.appName}`, data: { appName: args.appName } };
    case 'frontmost-app': {
      const frontmostApp = await getFrontmostApp();
      return { text: `frontmost app: ${frontmostApp}`, data: { frontmostApp } };
    }
    case 'move-mouse': {
      await ensureAccessibilityAccess();
      const nutJs = await loadNutJs();
      await nutJs.mouse.setPosition(new nutJs.Point(args.x, args.y));
      return { text: 'mouse moved', data: { ok: true } };
    }
    case 'click': {
      await ensureAccessibilityAccess();
      const nutJs = await loadNutJs();
      if (args.x !== undefined && args.y !== undefined) {
        await nutJs.mouse.setPosition(new nutJs.Point(args.x, args.y));
      }
      const button = args.button === 'right' ? nutJs.Button.RIGHT : nutJs.Button.LEFT;
      if (args.double) {
        await nutJs.mouse.doubleClick(button);
      } else {
        await nutJs.mouse.click(button);
      }
      return { text: 'click complete', data: { ok: true } };
    }
    case 'drag': {
      await ensureAccessibilityAccess();
      const nutJs = await loadNutJs();
      await nutJs.mouse.setPosition(new nutJs.Point(args.from.x, args.from.y));
      const dragPath = await nutJs.straightTo(new nutJs.Point(args.to.x, args.to.y));
      await nutJs.mouse.drag(dragPath);
      return { text: 'drag complete', data: { ok: true } };
    }
    case 'type-text': {
      await ensureAccessibilityAccess();
      const nutJs = await loadNutJs();
      await nutJs.keyboard.type(args.text);
      return { text: 'text entered', data: { ok: true } };
    }
    case 'press-key': {
      await ensureAccessibilityAccess();
      const nutJs = await loadNutJs();
      const mapped = mapNutKey(nutJs, args.key);
      await nutJs.keyboard.pressKey(mapped);
      await nutJs.keyboard.releaseKey(mapped);
      return { text: 'key pressed', data: { ok: true } };
    }
    case 'hotkey': {
      await ensureAccessibilityAccess();
      const nutJs = await loadNutJs();
      const mapped = args.keys.map((key) => mapNutKey(nutJs, key));
      await nutJs.keyboard.pressKey(...mapped);
      await nutJs.keyboard.releaseKey(...mapped);
      return { text: 'hotkey pressed', data: { ok: true } };
    }
    case 'screenshot': {
      const frontmostApp = await maybeRestoreRememberedApp({ appName: args.appName, settleMs: args.settleMs ?? 350 });
      const filePath = await takeScreenshot(args);
      return { text: filePath, data: { path: filePath, frontmostApp } };
    }
    case 'run-applescript': {
      const result = await runAppleScript(args.script, 'the requested application');
      return { text: summarizeResult(result.stdout, result.stderr, 'applescript complete'), data: { stdout: result.stdout, stderr: result.stderr } };
    }
    case 'run-shell': {
      const result = await run('/bin/zsh', ['-lc', args.command]);
      return { text: summarizeResult(result.stdout, result.stderr, 'shell command complete'), data: { stdout: result.stdout, stderr: result.stderr } };
    }
    default:
      throw new Error(`unsupported desktop command: ${command}`);
  }
}

async function observe(input) {
  const frontmostApp = await maybeRestoreRememberedApp({ appName: input.appName, settleMs: input.settleMs ?? 350 });
  const filename = input.filename ?? defaultObserveFilename(input.label, frontmostApp);
  const filePath = await takeScreenshot({ filename, showCursor: input.showCursor === true });
  return { text: `observed ${frontmostApp}`, data: { path: filePath, local_image_path: filePath, frontmostApp, label: input.label ?? null } };
}

async function act(steps) {
  validateActionBundle(steps);
  await maybeRestoreRememberedApp({ settleMs: 350 });
  const executed = [];
  for (const step of steps) {
    const normalized = normalizeActionStep(step);
    const result = await executeAtomic(normalized.command, normalized.args);
    executed.push({ type: normalized.command, text: result.text, data: result.data ?? null });
  }
  const frontmostApp = await getFrontmostApp().catch(() => '');
  rememberDesktopApp(frontmostApp);
  return { text: `executed ${executed.length} bundled actions`, data: { steps: executed, frontmostApp: frontmostApp || null } };
}

function validateActionBundle(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('action bundles require at least one step');
  }
  if (steps.length > 5) {
    throw new Error('action bundles support at most 5 steps');
  }
  for (const step of steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new Error('action bundle steps must be objects');
    }
    if (step.type === 'run-shell' || step.type === 'run-applescript') {
      throw new Error('action bundles do not allow run-shell or run-applescript');
    }
  }
}

function normalizeActionStep(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error('action bundle step must be an object');
  }
  switch (step.type) {
    case 'launch-app':
      return { command: 'launch-app', args: { appName: stringValue(step.appName ?? step['app-name']) } };
    case 'activate-app':
      return { command: 'activate-app', args: { appName: stringValue(step.appName ?? step['app-name']) } };
    case 'move-mouse':
      return { command: 'move-mouse', args: { x: requiredNumber(step.x, 'step.x'), y: requiredNumber(step.y, 'step.y') } };
    case 'click':
      return { command: 'click', args: { x: optionalNumber(step.x), y: optionalNumber(step.y), button: optionalString(step.button) ?? 'left', double: booleanValue(step.double) } };
    case 'drag':
      return { command: 'drag', args: { from: { x: requiredNumber(step.from?.x, 'step.from.x'), y: requiredNumber(step.from?.y, 'step.from.y') }, to: { x: requiredNumber(step.to?.x, 'step.to.x'), y: requiredNumber(step.to?.y, 'step.to.y') } } };
    case 'type-text':
      return { command: 'type-text', args: { text: stringValue(step.text) } };
    case 'press-key':
      return { command: 'press-key', args: { key: stringValue(step.key) } };
    case 'hotkey':
      return { command: 'hotkey', args: { keys: arrayValue(step.keys) } };
    default:
      throw new Error(`unsupported action bundle step: ${step.type}`);
  }
}

async function getFrontmostApp() {
  await ensureAccessibilityAccess();
  const result = await runAppleScript('tell application "System Events" to get name of first application process whose frontmost is true', 'System Events');
  return result.stdout.trim();
}

async function launchAppName(appName, settleMs) {
  await run('open', ['-a', appName]);
  await sleep(settleMs);
  await activateAppName(appName, settleMs);
}

async function activateAppName(appName, settleMs) {
  await runAppleScript(`tell application ${appleScriptString(appName)} to activate`, appName);
  await sleep(settleMs);
}

async function maybeRestoreRememberedApp(options = {}) {
  const rememberedAppName = optionalString(options.appName) ?? readDesktopSessionState()?.lastAppName;
  let frontmostApp = await getFrontmostApp().catch(() => '');
  if (!rememberedAppName) {
    rememberDesktopApp(frontmostApp);
    return frontmostApp;
  }
  if (frontmostApp === rememberedAppName) {
    rememberDesktopApp(frontmostApp);
    return frontmostApp;
  }
  if (frontmostApp && !HOST_APP_NAMES.has(frontmostApp)) {
    rememberDesktopApp(frontmostApp);
    return frontmostApp;
  }
  await activateAppName(rememberedAppName, options.settleMs ?? 350);
  frontmostApp = await getFrontmostApp().catch(() => rememberedAppName);
  rememberDesktopApp(frontmostApp || rememberedAppName);
  return frontmostApp || rememberedAppName;
}

function defaultObserveFilename(label, frontmostApp) {
  const parts = [sanitizeFilename(label), sanitizeFilename(frontmostApp), String(Date.now())].filter(Boolean);
  return `${parts.join('-') || 'desktop-observe'}.png`;
}

function sanitizeFilename(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function loadNutJs() {
  if (!nutJsPromise) {
    const moduleSpecifier = resolveNutJsSpecifier();
    nutJsPromise = import(moduleSpecifier).catch((error) => {
      throw new Error(`failed to load @nut-tree-fork/nut-js: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return nutJsPromise;
}

function resolveNutJsSpecifier() {
  for (const resolver of [requireFromCwd, requireFromSkill]) {
    try {
      return pathToFileURL(resolver.resolve('@nut-tree-fork/nut-js')).href;
    } catch {}
  }
  throw new Error('failed to resolve @nut-tree-fork/nut-js from the current workspace or skill directory');
}

async function takeScreenshot(input) {
  await ensureScreenCaptureAccess();
  const artifactDir = resolveArtifactDir();
  fs.mkdirSync(artifactDir, { recursive: true });
  const filename = input.filename?.trim() || `desktop-${Date.now()}.png`;
  const filePath = path.isAbsolute(filename) ? filename : path.join(artifactDir, filename);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
  const capturedNatively = await tryCaptureScreen(filePath, input.showCursor === true);
  if (!capturedNatively) {
    const nutJs = await loadNutJs();
    const parsed = path.parse(filePath);
    const capturedPath = path.resolve(await nutJs.screen.capture(parsed.name, nutJs.FileType.PNG, parsed.dir));
    if (capturedPath !== filePath) {
      fs.renameSync(capturedPath, filePath);
    }
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Desktop screenshot was not created at expected path: ${filePath}`);
  }
  await normalizeScreenshotToCoordinateSpace(filePath);
  return filePath;
}

function resolveArtifactDir() {
  return path.join(process.cwd(), '.codex/artifacts/desktop');
}

function resolveDesktopSessionStatePath() {
  return path.join(resolveArtifactDir(), 'session.json');
}

function readDesktopSessionState() {
  const filePath = resolveDesktopSessionStatePath();
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeDesktopSessionState(state) {
  const filePath = resolveDesktopSessionStatePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function rememberDesktopApp(appName) {
  if (!appName || HOST_APP_NAMES.has(appName)) {
    return;
  }
  writeDesktopSessionState({ lastAppName: appName, updatedAt: new Date().toISOString() });
}

async function ensureAccessibilityAccess() {
  const result = await run('swift', ['-e', 'import ApplicationServices; let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary; print(AXIsProcessTrustedWithOptions(options))']);
  if (result.stdout.trim() === 'true') {
    return;
  }
  await openAccessibilitySettings();
  throw new Error('Accessibility permission is required for mouse, keyboard, and window-state operations. A system permission prompt may have been opened for you. Enable Accessibility for Codex or the terminal host in System Settings > Privacy & Security > Accessibility, then retry.');
}

async function ensureScreenCaptureAccess() {
  const result = await run('swift', ['-e', 'import CoreGraphics; print(CGPreflightScreenCaptureAccess())']);
  if (result.stdout.trim() === 'true') {
    return;
  }
  await run('swift', ['-e', 'import CoreGraphics; print(CGRequestScreenCaptureAccess())']).catch(() => undefined);
  await openScreenCaptureSettings();
  throw new Error('Screen Recording permission is not granted for the current host application. Without it, macOS screenshots will only show the wallpaper or desktop. A system permission prompt may have been opened for you. Enable Screen Recording for Codex or the terminal host in System Settings > Privacy & Security > Screen & System Audio Recording, then retry.');
}

async function openScreenCaptureSettings() {
  await run('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture']).catch(() => undefined);
}

async function openAccessibilitySettings() {
  await run('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility']).catch(() => undefined);
}

async function openAutomationSettings() {
  await run('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Automation']).catch(() => undefined);
}

async function runAppleScript(script, targetHint) {
  try {
    return await run('osascript', ['-e', script]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAppleEventsPermissionError(message)) {
      await openAutomationSettings();
      throw new Error(`Automation permission is required to control ${targetHint}. A system permission prompt may have been opened for you. Enable Automation for Codex or the terminal host in System Settings > Privacy & Security > Automation, then retry. Original error: ${message}`);
    }
    throw error;
  }
}

function isAppleEventsPermissionError(message) {
  return /-1743|not authorized to send apple events|not permitted to send apple events|automation permission/i.test(String(message).toLowerCase());
}

async function tryCaptureScreen(filePath, showCursor) {
  try {
    await run('screencapture', [...(showCursor ? ['-C'] : []), '-x', filePath]);
  } catch {
    return false;
  }
  return fs.existsSync(filePath);
}

async function normalizeScreenshotToCoordinateSpace(filePath) {
  const screenSize = await readScreenSize().catch(() => undefined);
  if (!screenSize || screenSize.width <= 0 || screenSize.height <= 0) {
    return;
  }
  const imageSize = await readImageSize(filePath).catch(() => undefined);
  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
    return;
  }
  if (imageSize.width === screenSize.width && imageSize.height === screenSize.height) {
    return;
  }
  const scaleX = imageSize.width / screenSize.width;
  const scaleY = imageSize.height / screenSize.height;
  const isUniformUpscale = scaleX > 1 && scaleY > 1 && Math.abs(scaleX - scaleY) <= 0.01;
  if (!isUniformUpscale) {
    return;
  }
  await run('sips', ['-z', String(screenSize.height), String(screenSize.width), filePath, '--out', filePath]);
}

async function readScreenSize() {
  const nutJs = await loadNutJs();
  return {
    width: await nutJs.screen.width(),
    height: await nutJs.screen.height(),
  };
}

async function readImageSize(filePath) {
  const result = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath]);
  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}

async function run(file, args) {
  try {
    const result = await execFileAsync(file, args);
    return { stdout: result.stdout?.trimEnd?.() ?? result.stdout ?? '', stderr: result.stderr?.trimEnd?.() ?? result.stderr ?? '' };
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const message = [stderr, stdout, error instanceof Error ? error.message : String(error)].find(Boolean) ?? `command failed: ${file}`;
    throw new Error(message);
  }
}

function summarizeResult(stdout, stderr, fallback) {
  const text = (stdout || stderr || fallback).trim();
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

function appleScriptString(value) {
  return JSON.stringify(String(value));
}

function assertSupportedPlatform() {
  if (process.platform !== 'darwin') {
    throw new Error('gateway-desktop direct mode only supports macOS hosts');
  }
}

async function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(tokens) {
  const output = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) {
      fail(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = tokens[i + 1];
    if (!value || value.startsWith('--')) {
      output[key] = 'true';
      continue;
    }
    output[key] = value;
    i += 1;
  }
  return output;
}

function normalizeArgs(command, parsed) {
  switch (command) {
    case 'observe':
      return { appName: optionalString(parsed["app-name"] ?? parsed.appName), filename: optionalString(parsed.filename), label: optionalString(parsed.label), showCursor: booleanValue(parsed["show-cursor"] ?? parsed.showCursor), settleMs: optionalNumber(parsed["settle-ms"] ?? parsed.settleMs) ?? 350 };
    case 'act': {
      const steps = jsonArrayValue(parsed.steps, '--steps');
      return { steps };
    }
    case 'frontmost-app':
      return {};
    case 'launch-app':
    case 'activate-app':
      return { appName: stringValue(parsed["app-name"] ?? parsed.appName), settleMs: optionalNumber(parsed["settle-ms"] ?? parsed.settleMs) ?? 350 };
    case 'move-mouse':
      return { x: requiredNumber(parsed.x, "--x"), y: requiredNumber(parsed.y, "--y") };
    case 'click':
      return {
        x: optionalNumber(parsed.x),
        y: optionalNumber(parsed.y),
        button: optionalString(parsed.button) ?? "left",
        double: booleanValue(parsed.double),
      };
    case 'drag':
      return {
        from: { x: requiredNumber(parsed["from-x"], "--from-x"), y: requiredNumber(parsed["from-y"], "--from-y") },
        to: { x: requiredNumber(parsed["to-x"], "--to-x"), y: requiredNumber(parsed["to-y"], "--to-y") },
      };
    case 'type-text':
      return { text: stringValue(parsed.text) };
    case 'press-key':
      return { key: stringValue(parsed.key) };
    case 'hotkey':
      return { keys: arrayValue(parsed.keys) };
    case 'screenshot':
      return { appName: optionalString(parsed["app-name"] ?? parsed.appName), filename: optionalString(parsed.filename), showCursor: booleanValue(parsed["show-cursor"] ?? parsed.showCursor), settleMs: optionalNumber(parsed["settle-ms"] ?? parsed.settleMs) ?? 350 };
    case 'run-applescript':
      return { script: stringValue(parsed.script) };
    case 'run-shell':
      return { command: stringValue(parsed.command) };
    default:
      fail(`unsupported desktop command: ${command}`);
  }
}

function arrayValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return typeof value === 'string' && value.trim() ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function jsonArrayValue(value, flagName) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`missing or invalid ${flagName}`);
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {}
  fail(`missing or invalid ${flagName}`);
}

function stringValue(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  fail('missing required string argument');
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredNumber(value, flagName) {
  const next = Number(value);
  if (Number.isFinite(next)) {
    return next;
  }
  fail(`missing or invalid ${flagName}`);
}

function optionalNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function booleanValue(value) {
  return value === true || value === 'true';
}

function mapNutKey(nutJs, key) {
  const normalized = key.trim();
  switch (normalized.toLowerCase()) {
    case 'meta':
    case 'cmd':
    case 'command':
      return nutJs.Key.LeftCmd;
    case 'shift':
      return nutJs.Key.LeftShift;
    case 'ctrl':
    case 'control':
      return nutJs.Key.LeftControl;
    case 'alt':
    case 'option':
      return nutJs.Key.LeftAlt;
    case 'enter':
    case 'return':
      return nutJs.Key.Return;
    case 'tab':
      return nutJs.Key.Tab;
    case 'esc':
    case 'escape':
      return nutJs.Key.Escape;
    case 'space':
      return nutJs.Key.Space;
    case 'up':
    case 'arrowup':
      return nutJs.Key.Up;
    case 'down':
    case 'arrowdown':
      return nutJs.Key.Down;
    case 'left':
    case 'arrowleft':
      return nutJs.Key.Left;
    case 'right':
    case 'arrowright':
      return nutJs.Key.Right;
    default: {
      if (/^[a-z]$/i.test(normalized)) {
        return nutJs.Key[normalized.toUpperCase()];
      }
      if (/^[0-9]$/.test(normalized)) {
        return nutJs.Key[`Num${normalized}`];
      }
      const direct = nutJs.Key[normalized];
      if (direct !== undefined) {
        return direct;
      }
      throw new Error(`Unsupported desktop key: ${key}`);
    }
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
