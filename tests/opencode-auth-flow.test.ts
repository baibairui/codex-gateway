import { describe, expect, it } from 'vitest';

import { buildOpenCodeAuthCommand } from '../src/services/opencode-auth-flow.js';

describe('buildOpenCodeAuthCommand', () => {
  it('passes provider with the explicit --provider flag', () => {
    expect(buildOpenCodeAuthCommand('/root/.opencode/bin/opencode', 'openai')).toBe(
      '/root/.opencode/bin/opencode auth login --provider openai',
    );
  });
});
