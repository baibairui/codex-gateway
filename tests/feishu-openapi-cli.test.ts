import { describe, expect, it } from 'vitest';

import {
  buildFeishuDocxUrl,
  extractDocxDocumentId,
  extractWikiNodeToken,
} from '../.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs';

describe('feishu-openapi doc target helpers', () => {
  it('builds a default feishu docx url from document_id', () => {
    expect(buildFeishuDocxUrl('EChBdybp4oCAf2x6VqqcXQhmnvh')).toBe(
      'https://feishu.cn/docx/EChBdybp4oCAf2x6VqqcXQhmnvh',
    );
  });

  it('honors a custom docx url prefix override', () => {
    expect(buildFeishuDocxUrl('doccnxxxxxxxx', 'https://tenant.feishu.cn/docx/')).toBe(
      'https://tenant.feishu.cn/docx/doccnxxxxxxxx',
    );
  });

  it('extracts document ids from raw ids and docx urls', () => {
    expect(extractDocxDocumentId('doccnxxxxxxxx')).toBe('doccnxxxxxxxx');
    expect(extractDocxDocumentId('https://feishu.cn/docx/doccnxxxxxxxx')).toBe('doccnxxxxxxxx');
    expect(extractDocxDocumentId('https://tenant.feishu.cn/docs/doxcnyyyyyyyy?from=share')).toBe('doxcnyyyyyyyy');
  });

  it('extracts wiki node tokens from wiki urls', () => {
    expect(extractWikiNodeToken('https://tenant.feishu.cn/wiki/wikicnabcdefghijk')).toBe(
      'wikicnabcdefghijk',
    );
  });
});
