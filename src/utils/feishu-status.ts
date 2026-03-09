export interface FeishuStatusInput {
  enabled?: boolean;
  longConnection?: boolean;
  groupRequireMention?: boolean;
  docBaseUrlConfigured?: boolean;
  startupHelpEnabled?: boolean;
  startupHelpAdminConfigured?: boolean;
}

export interface FeishuStatusSummary {
  enabled: boolean;
  mode: 'long-connection' | 'webhook';
  webhookEnabled: boolean;
  groupRequireMention: boolean;
  docBaseUrlConfigured: boolean;
  startupHelpEnabled: boolean;
  startupHelpAdminConfigured: boolean;
}

export function buildFeishuStatusSummary(input: FeishuStatusInput): FeishuStatusSummary {
  const enabled = input.enabled === true;
  const longConnection = input.longConnection === true;
  return {
    enabled,
    mode: longConnection ? 'long-connection' : 'webhook',
    webhookEnabled: !longConnection,
    groupRequireMention: input.groupRequireMention !== false,
    docBaseUrlConfigured: input.docBaseUrlConfigured === true,
    startupHelpEnabled: input.startupHelpEnabled === true,
    startupHelpAdminConfigured: input.startupHelpAdminConfigured === true,
  };
}
