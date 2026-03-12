import fs from 'node:fs';
import path from 'node:path';

export function loadCanvasSession(statePath) {
  if (!fs.existsSync(statePath)) {
    return undefined;
  }
  try {
    return normalizeCanvasSession(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch {
    return undefined;
  }
}

export function saveCanvasSession(statePath, input) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const existing = loadCanvasSession(statePath);
  const nextHistory = [
    ...(Array.isArray(existing?.history) ? existing.history : []),
    {
      action: input.last_action,
      heading: input.last_heading,
      updated_at: input.updated_at,
    },
  ].filter((item) => item.action).slice(-20);
  const next = {
    document_id: stringOrUndefined(input.document_id),
    document_url: stringOrUndefined(input.document_url),
    title: stringOrUndefined(input.title),
    last_action: stringOrUndefined(input.last_action),
    last_heading: stringOrUndefined(input.last_heading),
    updated_at: Number(input.updated_at || Date.now()),
    history: nextHistory,
  };
  fs.writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function clearCanvasSession(statePath) {
  if (!fs.existsSync(statePath)) {
    return false;
  }
  fs.rmSync(statePath, { force: true });
  return true;
}

export function normalizeCanvasSession(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return {
    document_id: stringOrUndefined(value.document_id),
    document_url: stringOrUndefined(value.document_url),
    title: stringOrUndefined(value.title),
    last_action: stringOrUndefined(value.last_action),
    last_heading: stringOrUndefined(value.last_heading),
    updated_at: Number(value.updated_at || 0),
    history: Array.isArray(value.history)
      ? value.history.map((item) => ({
        action: stringOrUndefined(item?.action),
        heading: stringOrUndefined(item?.heading),
        updated_at: Number(item?.updated_at || 0),
      }))
      : [],
  };
}

export function buildCanvasSectionMarkdown({ action, markdown, heading }) {
  const content = String(markdown || '').trim();
  const finalHeading = stringOrUndefined(heading) || `${capitalize(action)} @ ${new Date().toISOString()}`;
  return {
    heading: finalHeading,
    markdown: `## ${finalHeading}\n\n${content}\n`,
  };
}

function stringOrUndefined(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
