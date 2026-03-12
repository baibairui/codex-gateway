import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCanvasSectionMarkdown,
  clearCanvasSession,
  loadCanvasSession,
  saveCanvasSession,
} from '../.codex/skills/feishu-canvas/scripts/feishu-canvas-state.mjs';

describe('feishu-canvas-state helpers', () => {
  it('builds section markdown with custom heading', () => {
    const result = buildCanvasSectionMarkdown({
      action: 'rewrite',
      markdown: '新的版本',
      heading: '重写结果',
    });

    expect(result.heading).toBe('重写结果');
    expect(result.markdown).toContain('## 重写结果');
    expect(result.markdown).toContain('新的版本');
  });

  it('persists, reads, and clears canvas session history', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-canvas-state-'));
    const statePath = path.join(dir, 'latest-session.json');

    expect(loadCanvasSession(statePath)).toBeUndefined();

    saveCanvasSession(statePath, {
      document_id: 'doc_1',
      document_url: 'https://feishu.cn/docx/doc_1',
      title: 'Canvas 1',
      last_action: 'create',
      last_heading: '初稿',
      updated_at: 123,
    });
    saveCanvasSession(statePath, {
      document_id: 'doc_1',
      document_url: 'https://feishu.cn/docx/doc_1',
      title: 'Canvas 1',
      last_action: 'rewrite',
      last_heading: '重写结果',
      updated_at: 456,
    });

    expect(loadCanvasSession(statePath)).toEqual(expect.objectContaining({
      document_id: 'doc_1',
      title: 'Canvas 1',
      last_action: 'rewrite',
      last_heading: '重写结果',
      history: [
        expect.objectContaining({ action: 'create', heading: '初稿' }),
        expect.objectContaining({ action: 'rewrite', heading: '重写结果' }),
      ],
    }));

    expect(clearCanvasSession(statePath)).toBe(true);
    expect(loadCanvasSession(statePath)).toBeUndefined();
    expect(clearCanvasSession(statePath)).toBe(false);
  });
});
