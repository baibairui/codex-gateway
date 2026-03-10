import { describe, expect, it } from 'vitest';

import config from '../vitest.config.js';

describe('vitest config', () => {
  it('excludes generated runtime data from test discovery', () => {
    expect(config.test?.exclude).toContain('.data/**');
  });
});
