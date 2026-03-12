import { describe, expect, it } from 'vitest';

import { buildFeishuStatusSummary } from '../src/utils/feishu-status.js';

describe('buildFeishuStatusSummary', () => {
  it('builds long-connection summary with install-related flags', () => {
    expect(buildFeishuStatusSummary({
      enabled: true,
      longConnection: true,
      groupRequireMention: true,
      docBaseUrlConfigured: true,
      startupHelpEnabled: true,
      startupHelpAdminConfigured: false,
    })).toEqual({
      enabled: true,
      mode: 'long-connection',
      webhookEnabled: false,
      groupRequireMention: true,
      docBaseUrlConfigured: true,
      startupHelpEnabled: true,
      startupHelpAdminConfigured: false,
    });
  });

  it('defaults to webhook summary with conservative flags', () => {
    expect(buildFeishuStatusSummary({})).toEqual({
      enabled: false,
      mode: 'webhook',
      webhookEnabled: true,
      groupRequireMention: true,
      docBaseUrlConfigured: false,
      startupHelpEnabled: false,
      startupHelpAdminConfigured: false,
    });
  });
});
