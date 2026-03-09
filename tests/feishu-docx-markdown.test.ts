import { describe, expect, it } from 'vitest';

import {
  buildDocxChildrenFromConvertPayload,
  buildDocxCreateNodes,
} from '../.codex/skills/feishu-official-ops/scripts/docx-markdown.mjs';

describe('buildDocxChildrenFromConvertPayload', () => {
  it('rebuilds first-level blocks with nested children and strips transport ids', () => {
    const children = buildDocxChildrenFromConvertPayload({
      first_level_block_ids: ['heading', 'bullet'],
      blocks: [
        {
          block_id: 'heading',
          parent_id: 'root',
          block_type: 3,
          heading1: {
            elements: [{ text_run: { content: '项目周报' } }],
            style: {},
          },
        },
        {
          block_id: 'bullet',
          parent_id: 'root',
          children: ['paragraph'],
          block_type: 12,
          bullet: {
            elements: [{ text_run: { content: '进展' } }],
            style: {},
          },
        },
        {
          block_id: 'paragraph',
          parent_id: 'bullet',
          block_type: 2,
          text: {
            elements: [{ text_run: { content: '已完成 markdown 转换接入' } }],
            style: {},
          },
        },
      ],
    });

    expect(children).toEqual([
      {
        block_type: 3,
        heading1: {
          elements: [{ text_run: { content: '项目周报' } }],
          style: {},
        },
      },
      {
        block_type: 12,
        bullet: {
          elements: [{ text_run: { content: '进展' } }],
          style: {},
        },
        children: [
          {
            block_type: 2,
            text: {
              elements: [{ text_run: { content: '已完成 markdown 转换接入' } }],
              style: {},
            },
          },
        ],
      },
    ]);
  });

  it('fails fast when convert payload references a missing block', () => {
    expect(() =>
      buildDocxChildrenFromConvertPayload({
        first_level_block_ids: ['missing'],
        blocks: [],
      }),
    ).toThrow('docx convert returned missing block: missing');
  });

  it('splits nested children into recursive create nodes', () => {
    const createNodes = buildDocxCreateNodes([
      {
        block_type: 12,
        bullet: {
          elements: [{ text_run: { content: '进展' } }],
          style: {},
        },
        children: [
          {
            block_type: 2,
            text: {
              elements: [{ text_run: { content: '第一项' } }],
              style: {},
            },
          },
        ],
      },
    ]);

    expect(createNodes).toEqual([
      {
        block: {
          block_type: 12,
          bullet: {
            elements: [{ text_run: { content: '进展' } }],
            style: {},
          },
        },
        children: [
          {
            block: {
              block_type: 2,
              text: {
                elements: [{ text_run: { content: '第一项' } }],
                style: {},
              },
            },
            children: [],
          },
        ],
      },
    ]);
  });
});
