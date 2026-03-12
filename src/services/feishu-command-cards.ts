type Channel = 'wecom' | 'feishu';
type CliProvider = 'codex' | 'opencode';

type FeishuCardTemplate = 'blue' | 'wathet' | 'turquoise' | 'green' | 'yellow' | 'orange' | 'red' | 'purple' | 'grey';

interface CommandQuickAction {
  label: string;
  cmd: string;
  type?: 'default' | 'primary' | 'danger';
}

interface FeishuCardButton {
  label: string;
  cmd: string;
  type?: 'default' | 'primary' | 'danger';
}

interface FeishuValueButton {
  label: string;
  value: Record<string, unknown>;
  type?: 'default' | 'primary' | 'danger';
}

interface FeishuCardField {
  label: string;
  value: string;
}

type CardElementBuilder = (text: string) => Array<Record<string, unknown>>;
const COMMAND_LABELS: Record<string, string> = {
  '/help': '命令帮助',
  '/new': '会话管理',
  '/clear': '会话管理',
  '/session': '当前会话',
  '/sessions': '会话列表',
  '/agents': 'Agent 列表',
  '/agent': 'Agent 管理',
  '/skill-agent': '技能扩展助手',
  '/skillagent': '技能扩展助手',
  '/skill': '技能扩展助手',
  '/login': '登录授权',
  '/rename': '会话重命名',
  '/switch': '会话切换',
  '/model': '模型管理',
  '/provider': '框架管理',
  '/models': '模型列表',
  '/skills': 'Skill 管理',
  '/search': '联网搜索',
  '/deploy-workspace': 'Workspace 发布',
  '/publish-workspace': 'Workspace 发布',
  '/repair-users': '用户工作区修复',
  '/review': '代码审查',
};

const COMMAND_SUMMARIES: Record<string, string> = {
  '/session': '查看当前会话上下文，并进入切换或重命名流程。',
  '/sessions': '管理当前 agent 的历史会话，快速定位并切换目标会话。',
  '/agents': '查看可用 agent 列表，并在不同工作区之间切换。',
  '/agent': '查看当前 agent 状态，包括工作区和会话绑定情况。',
  '/skills': '查看当前会话生效的 skills，并快速切换不同范围。',
  '/model': '查看或切换当前模型，并在需要时恢复默认值。',
  '/provider': '查看当前执行框架，并通过卡片按钮切换 Codex 或 OpenCode。',
  '/models': '查看当前支持的模型集合，并回到当前模型设置。',
  '/search': '控制本会话的联网搜索开关，按需临时开启。',
  '/review': '发起当前工作区的代码审查，支持按分支或提交审查。',
  '/login': '重新触发登录授权流程，恢复 Codex 执行能力。',
  '/repair-users': '批量清理并升级已部署用户工作区，修复内置 skill、规则注入与工作目录状态。',
};

const COMMAND_TEMPLATES: Record<string, FeishuCardTemplate> = {
  '/help': 'blue',
  '/session': 'wathet',
  '/sessions': 'wathet',
  '/switch': 'wathet',
  '/rename': 'wathet',
  '/agents': 'green',
  '/agent': 'green',
  '/skills': 'turquoise',
  '/model': 'blue',
  '/provider': 'blue',
  '/models': 'blue',
  '/search': 'wathet',
  '/review': 'orange',
  '/login': 'blue',
  '/repair-users': 'orange',
};

const CARD_COPY = {
  genericTitle: '命令结果',
  actionTitle: '快捷操作',
  actionHint: '点击按钮可继续执行相关命令',
  sessionsTitle: '会话总览',
  agentsTitle: 'Agent 列表',
  helpTitle: '帮助目录',
  helpGroupLabel: '当前分组',
  searchTitle: '当前状态',
  searchAdvice: '建议：默认关闭，按需临时开启。',
  statusTitles: {
    success: '执行成功',
    error: '执行失败',
    warning: '风险提示',
    pending: '执行中',
  },
} as const;

const STATIC_QUICK_ACTIONS: Record<string, CommandQuickAction[]> = {
  '/agents': [
    { label: '查看 Agents', cmd: '/agents', type: 'primary' },
    { label: '当前 Agent', cmd: '/agent' },
    { label: '切换会话', cmd: '/sessions' },
  ],
  '/agent': [
    { label: '查看 Agents', cmd: '/agents', type: 'primary' },
    { label: '当前 Agent', cmd: '/agent' },
    { label: '切换会话', cmd: '/sessions' },
  ],
  '/skills': [
    { label: '生效 Skills', cmd: '/skills', type: 'primary' },
    { label: '全局 Skills', cmd: '/skills global' },
    { label: 'Agent Skills', cmd: '/skills agent' },
  ],
  '/review': [
    { label: '审查当前改动', cmd: '/review', type: 'primary' },
    { label: '按分支审查', cmd: '/review base main' },
    { label: '按提交审查', cmd: '/review commit <SHA>' },
  ],
  '/session': [
    { label: '当前会话', cmd: '/session', type: 'primary' },
    { label: '会话列表', cmd: '/sessions' },
    { label: '切换会话', cmd: '/switch <编号|threadId>' },
  ],
  '/sessions': [
    { label: '当前会话', cmd: '/session', type: 'primary' },
    { label: '会话列表', cmd: '/sessions' },
    { label: '切换会话', cmd: '/switch <编号|threadId>' },
  ],
  '/switch': [
    { label: '当前会话', cmd: '/session', type: 'primary' },
    { label: '会话列表', cmd: '/sessions' },
    { label: '切换会话', cmd: '/switch <编号|threadId>' },
  ],
  '/rename': [
    { label: '当前会话', cmd: '/session', type: 'primary' },
    { label: '会话列表', cmd: '/sessions' },
    { label: '切换会话', cmd: '/switch <编号|threadId>' },
  ],
  '/login': [
    { label: '重新登录', cmd: '/login', type: 'primary' },
    { label: '查看帮助', cmd: '/help' },
  ],
  '/provider': [
    { label: '查看当前', cmd: '/provider', type: 'primary' },
    { label: '使用 Codex', cmd: '/provider codex' },
    { label: '使用 OpenCode', cmd: '/provider opencode' },
  ],
  '/repair-users': [
    { label: '执行修复', cmd: '/repair-users', type: 'primary' },
    { label: '查看帮助', cmd: '/help' },
  ],
};

function buildGatewayStructuredMessage(msgType: string, content: Record<string, unknown> | string): string {
  return JSON.stringify({
    __gateway_message__: true,
    msg_type: msgType,
    content,
  });
}

function buildFeishuInteractiveMessage(card: Record<string, unknown>): string {
  return buildGatewayStructuredMessage('interactive', card);
}

function resolveCommandLabel(commandName: string): string {
  const normalized = commandName.toLowerCase();
  return COMMAND_LABELS[normalized] ?? CARD_COPY.genericTitle;
}

function resolveCardTemplate(commandName: string, text: string): FeishuCardTemplate {
  const normalized = text.trim();
  if (normalized.startsWith('✅')) {
    return 'green';
  }
  if (normalized.startsWith('❌')) {
    return 'red';
  }
  if (normalized.startsWith('⚠️')) {
    return 'orange';
  }
  if (normalized.startsWith('⏳')) {
    return 'wathet';
  }
  if (normalized.startsWith('可用命令：') || normalized.startsWith('用法：')) {
    return 'blue';
  }
  return COMMAND_TEMPLATES[commandName.toLowerCase()] ?? 'grey';
}

function resolveSearchState(text: string): 'on' | 'off' | 'unknown' {
  const normalized = text.trim();
  if (normalized.includes('联网搜索：on') || normalized.includes('已开启联网搜索')) {
    return 'on';
  }
  if (normalized.includes('联网搜索：off') || normalized.includes('已关闭联网搜索')) {
    return 'off';
  }
  return 'unknown';
}

function resolveHelpPageInfo(text: string): { page: number; total: number } | undefined {
  const match = text.match(/帮助页\s+(\d+)\/(\d+)/);
  if (!match) {
    return undefined;
  }
  const page = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(page) || !Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return {
    page: Math.trunc(page),
    total: Math.trunc(total),
  };
}

function resolveCommandQuickActions(commandName: string, text: string): CommandQuickAction[] {
  const normalized = commandName.toLowerCase();
  if (normalized === '/help') {
    const pageInfo = resolveHelpPageInfo(text);
    const page = pageInfo?.page ?? 1;
    const total = pageInfo?.total ?? 1;
    const prev = Math.max(1, page - 1);
    const next = Math.min(total, page + 1);
    return [
      { label: '上一页', cmd: `/help ${prev}`, type: page > 1 ? 'primary' : 'default' },
      { label: '下一页', cmd: `/help ${next}`, type: page < total ? 'primary' : 'default' },
    ];
  }
  const staticActions = STATIC_QUICK_ACTIONS[normalized];
  if (staticActions) {
    return staticActions;
  }
  if (normalized === '/search') {
    const state = resolveSearchState(text);
    return [
      { label: '查看状态', cmd: '/search', type: state === 'unknown' ? 'primary' : 'default' },
      { label: '开启', cmd: '/search on', type: state === 'off' ? 'primary' : 'default' },
      { label: '关闭', cmd: '/search off', type: state === 'on' ? 'danger' : 'default' },
    ];
  }
  return [
    { label: '命令帮助', cmd: '/help', type: 'primary' },
  ];
}

function buildFeishuTextBlock(content: string): Record<string, unknown> {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return {
    tag: 'markdown',
    content: escaped,
  };
}

function buildFeishuDivider(): Record<string, unknown> {
  return { tag: 'hr' };
}

function buildFeishuTitleBlock(title: string, summary: string): Record<string, unknown> {
  return buildFeishuTextBlock(`**${title}**\n${summary}`);
}

function buildFeishuSectionBlock(title: string, body: string | string[]): Record<string, unknown> {
  const normalizedBody = Array.isArray(body) ? body.filter(Boolean).join('\n') : body;
  const content = normalizedBody ? `**${title}**\n${normalizedBody}` : `**${title}**`;
  return buildFeishuTextBlock(content);
}

function buildFeishuFieldGrid(fields: FeishuCardField[]): Record<string, unknown> {
  return {
    tag: 'div',
    fields: fields
      .filter((field) => field.value.trim())
      .map((field) => ({
        is_short: true,
        text: {
          tag: 'lark_md',
          content: `**${field.label}**\n${field.value}`,
        },
      })),
  };
}

function buildFeishuTipsNote(content: string): Record<string, unknown> {
  return {
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content,
      },
    ],
  };
}

function buildFeishuLeadNote(content: string): Record<string, unknown> {
  return {
    tag: 'note',
    elements: [
      {
        tag: 'plain_text',
        content,
      },
    ],
  };
}

function extractIndexedLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line) || /^👉\s+\d+\.\s+/.test(line));
}

function extractBulletedLines(text: string, sectionTitle: string): string[] {
  const lines = text.split('\n').map((line) => line.trim());
  const startIndex = lines.findIndex((line) => line === sectionTitle);
  if (startIndex < 0) {
    return [];
  }
  const collected: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line) {
      continue;
    }
    if (line.endsWith('：') && !line.startsWith('- ')) {
      break;
    }
    if (line.startsWith('- ')) {
      collected.push(line.slice(2).trim());
      continue;
    }
    break;
  }
  return collected;
}

function stripListMarker(line: string): string {
  return line.replace(/^👉\s+/, '').replace(/^\d+\.\s+/, '').trim();
}

function extractCurrentModelName(currentLine: string | undefined): string | undefined {
  if (!currentLine) {
    return undefined;
  }
  const normalized = currentLine.replace(/^(当前模型：|✅ 已切换模型为：|✅ 已重置模型：)/, '').trim();
  return normalized || undefined;
}

function prioritizeCurrentModel(models: string[], currentModel: string | undefined): string[] {
  if (!currentModel) {
    return models;
  }
  const selected = models.find((model) => model === currentModel);
  if (!selected) {
    return models;
  }
  return [selected, ...models.filter((model) => model !== selected)];
}

function resolveModelPageInfo(text: string): { page: number; total: number } | undefined {
  const match = text.match(/模型页\s+(\d+)\/(\d+)/);
  if (!match) {
    return undefined;
  }
  const page = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(page) || !Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return {
    page: Math.trunc(page),
    total: Math.trunc(total),
  };
}

function buildSessionsCardElements(text: string): Array<Record<string, unknown>> {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const indexed = extractIndexedLines(text);
  const currentSession = indexed.find((line) => line.startsWith('👉'));
  const summary = lines[0] ?? text;
  const sessionButtons = buildSessionButtons(indexed);
  const elements: Array<Record<string, unknown>> = [
    buildFeishuTitleBlock(CARD_COPY.sessionsTitle, summary),
  ];
  if (indexed.length > 0) {
    elements.push(buildFeishuFieldGrid([
      { label: '会话数量', value: String(indexed.length) },
      { label: '当前会话', value: currentSession ? stripListMarker(currentSession) : '未标记' },
      { label: '可执行操作', value: '切换 / 重命名' },
    ]));
  }
  if (sessionButtons.length > 0) {
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('会话切换', '点击按钮切换会话'));
    elements.push(...buildCommandButtonRows(sessionButtons, 1));
  }
  return elements;
}

function buildSessionButtons(lines: string[]): FeishuCardButton[] {
  const buttons: FeishuCardButton[] = [];
  for (const line of lines) {
      const normalized = line.replace(/^👉\s+/, '');
      const match = normalized.match(/^(\d+)\.\s+(.+)$/);
      if (!match) {
        continue;
      }
      const index = match[1];
      const body = match[2] ?? '';
      const title = body.split(' (')[0]?.trim() ?? body.trim();
      const preview = body.match(/\)\s*-\s*(.+)$/)?.[1]?.trim() ?? '';
      const labelText = preview ? `${title} · ${preview}` : title;
      const label = truncateCardButtonLabel(labelText || `会话 ${index}`, 26);
      buttons.push({
        label,
        cmd: `/switch ${index}`,
        type: line.startsWith('👉') ? 'primary' : 'default',
      });
  }
  return buttons;
}

function truncateCardButtonLabel(input: string, max = 22): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function buildAgentsCardElements(text: string): Array<Record<string, unknown>> {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const indexed = compactAgentEntries(lines);
  const currentAgent = indexed.find((line) => line.startsWith('👉'));
  const summary = lines[0] ?? text;
  const workspaceLines = lines.filter((line) => line.startsWith('/'));
  const agentButtons = buildAgentButtons(lines);
  const elements: Array<Record<string, unknown>> = [
    buildFeishuTitleBlock(CARD_COPY.agentsTitle, summary),
  ];
  if (indexed.length > 0) {
    elements.push(buildFeishuFieldGrid([
      { label: 'Agent 数量', value: String(indexed.length) },
      { label: '当前 Agent', value: currentAgent ? stripListMarker(currentAgent) : '未标记' },
      { label: '切换', value: '/agent use' },
    ]));
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('Agent 切换', '点击按钮切换 Agent'));
    elements.push(...buildCommandButtonRows(agentButtons, 1));
  } else if (workspaceLines.length > 0) {
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('工作区', workspaceLines));
  }
  return elements;
}

function buildSkillsCardElements(text: string): Array<Record<string, unknown>> {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const indexed = extractIndexedLines(text);
  const summary = lines[0] ?? text;
  const scopeMatch = summary.match(/范围：([^，)]+).*agent：(.+)）$/);
  const scope = scopeMatch?.[1]?.trim() ?? '';
  const agent = scopeMatch?.[2]?.trim() ?? '';
  const titleSummary = [scope || 'effective', agent].filter(Boolean).join(' · ');
  const elements: Array<Record<string, unknown>> = [
    buildFeishuTitleBlock('Skills', titleSummary || summary),
  ];
  if (scope || agent || indexed.length > 0) {
    elements.push(buildFeishuFieldGrid([
      { label: '范围', value: scope || 'effective' },
      { label: 'Agent', value: agent },
      { label: '数量', value: indexed.length > 0 ? String(indexed.length) : '' },
    ]));
  }
  if (indexed.length > 0) {
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('技能', compactSkillEntries(indexed)));
  } else if (lines.length > 1) {
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('详情', lines.slice(1)));
  }
  return elements;
}

function compactAgentEntries(lines: string[]): string[] {
  const results: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!/^\d+\.\s+|^👉\s+\d+\.\s+/.test(line)) {
      continue;
    }
    const workspace = lines[i + 1]?.startsWith('/') ? lines[i + 1] : '';
    results.push(workspace ? `${line} · ${workspace}` : line);
  }
  return results;
}

function compactSkillEntries(lines: string[]): string[] {
  return lines.map((line) => {
    const normalized = stripListMarker(line);
    return normalized.split(' - ')[0]?.trim() ?? normalized;
  });
}

function buildAgentButtons(lines: string[]): FeishuCardButton[] {
  const buttons: FeishuCardButton[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!/^\d+\.\s+|^👉\s+\d+\.\s+/.test(line)) {
      continue;
    }
    const normalized = line.replace(/^👉\s+/, '');
    const match = normalized.match(/^(\d+)\.\s+(.+)$/);
    if (!match) {
      continue;
    }
    const index = match[1];
    const body = match[2] ?? '';
    const title = body.split(' (')[0]?.trim() ?? body.trim();
    const workspace = lines[i + 1]?.startsWith('/') ? lines[i + 1].split('/').filter(Boolean).pop() ?? '' : '';
    const labelText = workspace ? `${title} · ${workspace}` : title;
    buttons.push({
      label: truncateCardButtonLabel(labelText || `Agent ${index}`, 26),
      cmd: `/agent use ${index}`,
      type: line.startsWith('👉') ? 'primary' : 'default',
    });
  }
  return buttons;
}

function buildAgentCardElements(text: string): Array<Record<string, unknown>> {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const elements: Array<Record<string, unknown>> = [];
  const agentLine = lines.find((line) => line.startsWith('当前 agent：') || line.startsWith('✅ 已切换到 agent：') || line.startsWith('✅ 已创建并切换到 agent：'));
  const workspaceLine = lines.find((line) => line.startsWith('工作区：'));
  const sessionLine = lines.find((line) => line.startsWith('当前会话：'));
  if (agentLine) {
    elements.push(buildFeishuTitleBlock('Agent', agentLine));
  }
  if (workspaceLine || sessionLine) {
    elements.push(buildFeishuFieldGrid([
      { label: '工作区', value: workspaceLine?.replace(/^工作区：/, '').trim() ?? '' },
      { label: '当前会话', value: sessionLine?.replace(/^当前会话：/, '').trim() ?? '' },
    ]));
    elements.push(buildFeishuDivider());
    elements.push(...buildCommandButtonRows([
      { label: 'Agent 列表', cmd: '/agents', type: 'primary' },
      { label: '当前会话', cmd: '/sessions' },
    ]));
  }
  if (elements.length === 0) {
    elements.push(buildFeishuTitleBlock('Agent', text));
  }
  return elements;
}

function buildModelCardElements(text: string): Array<Record<string, unknown>> {
  const maxVisibleModelButtons = 9;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const elements: Array<Record<string, unknown>> = [];
  const visibleModels = extractBulletedLines(text, '可见模型：');
  const hiddenModels = extractBulletedLines(text, '隐藏/兼容模型：');
  const currentLine = lines.find((line) => line.startsWith('当前模型：') || line.startsWith('✅ 已切换模型为：') || line.startsWith('✅ 已重置模型：'));
  const currentModel = extractCurrentModelName(currentLine);
  const prioritizedVisibleModels = prioritizeCurrentModel(visibleModels, currentModel);
  const visibleModelButtons = prioritizedVisibleModels.slice(0, maxVisibleModelButtons);
  const pageInfo = resolveModelPageInfo(text);
  const hasMoreVisibleModels = (pageInfo?.page ?? 1) < (pageInfo?.total ?? 1)
    || prioritizedVisibleModels.length > visibleModelButtons.length;
  if (currentLine) {
    elements.push(buildFeishuTitleBlock('当前模型', currentLine));
    elements.push(buildFeishuFieldGrid([
      { label: '模型状态', value: currentModel ?? '' },
      { label: '可见模型数', value: visibleModels.length > 0 ? String(visibleModels.length) : '' },
      { label: '隐藏模型数', value: hiddenModels.length > 0 ? String(hiddenModels.length) : '' },
      { label: '页码', value: pageInfo ? `${pageInfo.page}/${pageInfo.total}` : '' },
    ]));
  }
  const warnings = lines.filter((line) => line.startsWith('⚠️'));
  if (warnings.length > 0) {
    if (elements.length > 0) {
      elements.push(buildFeishuDivider());
    }
    elements.push(buildFeishuSectionBlock('提示', warnings));
  }
  if (visibleModelButtons.length > 0) {
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('可选模型', `点击即可切换，共显示 ${visibleModelButtons.length} 个`));
    elements.push(...buildCommandButtonRows(
      visibleModelButtons.map((model) => ({
        label: model === currentModel ? `当前 · ${model}` : model,
        cmd: model === currentModel ? '/model' : `/model ${model}`,
        type: model === currentModel ? 'primary' : 'default',
      })),
      3,
    ));
    if (hasMoreVisibleModels) {
      elements.push(buildFeishuTipsNote('还有更多可见模型，点击下方按钮继续查看。'));
      elements.push(...buildCommandButtonRows([
        { label: '更多模型', cmd: `/model page ${Math.min(pageInfo?.total ?? 2, (pageInfo?.page ?? 1) + 1)}`, type: 'primary' },
      ]));
    }
  }
  if (pageInfo && pageInfo.total > 1) {
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('模型翻页', `当前第 ${pageInfo.page} / ${pageInfo.total} 页`));
    elements.push(...buildCommandButtonRows([
      { label: '上一页', cmd: `/model page ${Math.max(1, pageInfo.page - 1)}`, type: pageInfo.page > 1 ? 'primary' : 'default' },
      { label: '下一页', cmd: `/model page ${Math.min(pageInfo.total, pageInfo.page + 1)}`, type: pageInfo.page < pageInfo.total ? 'primary' : 'default' },
    ]));
  }
  if (hiddenModels.length > 0) {
    elements.push(buildFeishuTipsNote(`还有 ${hiddenModels.length} 个隐藏/兼容模型，已默认收起。`));
  }
  if (currentModel) {
    elements.push(buildFeishuDivider());
    elements.push(...buildCommandButtonRows([
      { label: '重置模型', cmd: '/model reset', type: 'default' },
    ]));
  }
  if (elements.length === 0) {
    elements.push(buildFeishuTitleBlock('当前模型', text));
  }
  return elements;
}

function buildSearchCardElements(text: string): Array<Record<string, unknown>> {
  const state = resolveSearchState(text);
  const stateLine = state === 'on'
    ? '🟢 已开启'
    : state === 'off'
    ? '⚪ 已关闭'
    : '🟡 状态未知';
  const elements: Array<Record<string, unknown>> = [
    buildFeishuTitleBlock(CARD_COPY.searchTitle, stateLine),
  ];
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  elements.push(buildFeishuFieldGrid([
    { label: '联网搜索', value: stateLine },
    { label: '推荐策略', value: state === 'on' ? '当前临时开启' : '默认关闭，按需开启' },
  ]));
  if (lines.some((line) => line.startsWith('⚠️'))) {
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('提示', lines.filter((line) => line.startsWith('⚠️'))));
  }
  return elements;
}

function buildHelpCardElements(text: string): Array<Record<string, unknown>> {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const pageInfo = resolveHelpPageInfo(text);
  const groups: Array<{ title: string; lines: string[] }> = [];
  let currentGroup: { title: string; lines: string[] } | undefined;
  for (const line of lines) {
    if (line.startsWith('【') && line.endsWith('】')) {
      currentGroup = {
        title: line.replace(/^【/, '').replace(/】$/, ''),
        lines: [],
      };
      groups.push(currentGroup);
      continue;
    }
    if (line.startsWith('可用命令（按功能分组')) {
      continue;
    }
    if (line.startsWith('翻页：')) {
      continue;
    }
    if (!currentGroup) {
      continue;
    }
    currentGroup.lines.push(line);
  }
  const groupNames = groups.map((group) => group.title).filter(Boolean);
  const primaryGroupName = groupNames[0] ?? '';
  const summary = groupNames.length === 1 && pageInfo
    ? `${primaryGroupName} · ${pageInfo.page}/${pageInfo.total}`
    : pageInfo
    ? `帮助页 ${pageInfo.page}/${pageInfo.total}`
    : primaryGroupName || '可用命令';
  const commandCount = groups.reduce((count, group) => count + group.lines.length, 0);
  const elements: Array<Record<string, unknown>> = [
    buildFeishuTitleBlock(CARD_COPY.helpTitle, summary),
  ];
  elements.push(buildFeishuFieldGrid([
    { label: CARD_COPY.helpGroupLabel, value: groupNames.join(' / ') },
    { label: '页码', value: pageInfo ? `${pageInfo.page}/${pageInfo.total}` : '' },
    { label: '命令数', value: commandCount > 0 ? String(commandCount) : '' },
  ]));
  elements.push(buildFeishuDivider());
  for (const group of groups) {
    elements.push(buildFeishuSectionBlock(group.title, group.lines));
    elements.push(buildFeishuDivider());
  }
  const shortcutButtons = resolveHelpShortcutButtons(primaryGroupName);
  if (shortcutButtons.length > 0) {
    elements.push(...buildCommandButtonRows(shortcutButtons, 3));
  }
  if (elements[elements.length - 1]?.tag === 'hr') {
    elements.pop();
  }
  return elements;
}

function resolveHelpShortcutButtons(groupName: string): FeishuCardButton[] {
  if (groupName === '会话与 Agent') {
    return [
      { label: '框架管理', cmd: '/provider', type: 'primary' },
      { label: '会话列表', cmd: '/sessions' },
      { label: 'Agent 列表', cmd: '/agents' },
    ];
  }
  if (groupName === '模型、技能与执行') {
    return [
      { label: '模型管理', cmd: '/model', type: 'primary' },
      { label: '生效 Skills', cmd: '/skills' },
      { label: '搜索状态', cmd: '/search' },
    ];
  }
  return [
    { label: '查看帮助', cmd: '/help', type: 'primary' },
  ];
}

function buildCommandButtonRows(buttons: FeishuCardButton[], buttonsPerRow = 2): Array<Record<string, unknown>> {
  return buildValueButtonRows(buttons.map((item) => ({
    label: item.label,
    type: item.type,
    value: {
      gateway_cmd: item.cmd,
      command: item.cmd,
      text: item.cmd,
    },
  })), buttonsPerRow);
}

function buildValueButtonRows(buttons: FeishuValueButton[], buttonsPerRow = 2): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const step = Math.max(1, buttonsPerRow);
  for (let i = 0; i < buttons.length; i += step) {
    const chunk = buttons.slice(i, i + step);
    rows.push({
      tag: 'action',
      actions: chunk.map((item) => ({
        tag: 'button',
        type: item.type ?? 'default',
        text: {
          tag: 'plain_text',
          content: item.label,
        },
        value: item.value,
      })),
    });
  }
  return rows;
}

function buildStatusCardElements(text: string): Array<Record<string, unknown>> {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? text;
  const icon = firstLine[0] ?? '';
  const title = icon === '✅'
    ? CARD_COPY.statusTitles.success
    : icon === '❌'
    ? CARD_COPY.statusTitles.error
    : icon === '⚠'
    ? CARD_COPY.statusTitles.warning
    : icon === '⏳'
    ? CARD_COPY.statusTitles.pending
    : CARD_COPY.genericTitle;
  const summary = firstLine.replace(/^[✅❌⚠️⏳]\s*/, '').trim() || firstLine;
  const details = lines.slice(1);
  const elements: Array<Record<string, unknown>> = [
    buildFeishuTitleBlock(title, summary),
    buildFeishuFieldGrid([
      { label: '状态', value: firstLine },
      { label: '类型', value: title },
    ]),
  ];
  if (details.length > 0) {
    elements.push(buildFeishuDivider(), buildFeishuSectionBlock('详情', details));
  }
  return elements;
}

function buildFeishuActionSection(actions: CommandQuickAction[]): Array<Record<string, unknown>> {
  if (actions.length === 0) {
    return [];
  }
  return [
    buildFeishuDivider(),
    buildFeishuSectionBlock(CARD_COPY.actionTitle, CARD_COPY.actionHint),
    ...buildCommandButtonRows(actions.map((item) => ({
      label: item.label,
      cmd: item.cmd,
      type: item.type,
    })), 3),
  ];
}

function buildGenericCardElements(text: string): Array<Record<string, unknown>> {
  if (/^[✅❌⚠️⏳]/.test(text.trim())) {
    return buildStatusCardElements(text);
  }
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const summary = lines[0] ?? text;
  if (lines.length <= 1) {
    return [buildFeishuTitleBlock(CARD_COPY.genericTitle, summary)];
  }
  return [
    buildFeishuTitleBlock(CARD_COPY.genericTitle, summary),
    buildFeishuDivider(),
    buildFeishuSectionBlock('详情', lines.slice(1)),
  ];
}

function isModelRichText(text: string): boolean {
  return text.includes('当前模型：')
    || text.includes('✅ 已切换模型为：')
    || text.includes('✅ 已重置模型：')
    || text.includes('可见模型：')
    || text.includes('隐藏/兼容模型：');
}

const COMMAND_CARD_RENDERERS: Record<string, CardElementBuilder> = {
  '/session': buildSessionsCardElements,
  '/sessions': buildSessionsCardElements,
  '/switch': buildSessionsCardElements,
  '/rename': buildSessionsCardElements,
  '/agents': buildAgentsCardElements,
  '/skills': buildSkillsCardElements,
  '/agent': buildAgentCardElements,
  '/model': buildModelCardElements,
  '/models': buildModelCardElements,
  '/search': buildSearchCardElements,
  '/help': buildHelpCardElements,
};

function resolveCommandCardElements(commandName: string, text: string): Array<Record<string, unknown>> {
  const normalized = commandName.toLowerCase();
  if ((normalized === '/model' || normalized === '/models') && isModelRichText(text)) {
    return buildModelCardElements(text);
  }
  if (/^[✅❌⚠️⏳]/.test(text.trim())) {
    return buildStatusCardElements(text);
  }
  const renderer = COMMAND_CARD_RENDERERS[normalized];
  if (renderer) {
    return renderer(text);
  }
  return buildGenericCardElements(text);
}

function buildFeishuInteractiveCommandCard(commandName: string, text: string): Record<string, unknown> {
  const title = resolveCommandLabel(commandName);
  const normalized = commandName.toLowerCase();
  const actions = resolveCommandQuickActions(commandName, text);
  const elements = resolveCommandCardElements(commandName, text);
  const summary = COMMAND_SUMMARIES[normalized];
  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: resolveCardTemplate(commandName, text),
      title: {
        tag: 'plain_text',
        content: title,
      },
    },
    elements: [
      ...(summary ? [buildFeishuLeadNote(summary)] : []),
      ...elements,
      ...buildFeishuActionSection(actions),
    ],
  };
}

export function formatCommandOutboundMessage(channel: Channel, commandName: string, text: string): string {
  if (channel !== 'feishu') {
    return text;
  }
  const normalized = text.trim();
  if (!normalized) {
    return text;
  }
  return buildGatewayStructuredMessage('interactive', buildFeishuInteractiveCommandCard(commandName, normalized));
}

export function buildFeishuLoginChoiceMessage(input: {
  provider?: CliProvider;
  providerLabel?: string;
  supportsDeviceAuth?: boolean;
} = {}): string {
  const provider = input.provider ?? 'codex';
  if (provider === 'opencode') {
    return buildFeishuOpenCodeLoginChoiceMessage();
  }
  const providerLabel = input.providerLabel ?? 'Codex';
  const supportsDeviceAuth = input.supportsDeviceAuth ?? true;
  const writeLocation = 'config.toml';
  const authLocation = 'auth.json';
  return buildFeishuInteractiveMessage({
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: '登录授权',
      },
    },
    elements: [
      buildFeishuTitleBlock(
        '选择登录方式',
        supportsDeviceAuth
          ? `飞书下可以使用设备授权，或直接写入项目内的 ${providerLabel} API 配置。`
          : `当前模型通道是 ${providerLabel}，请直接写入项目内 API 配置。`,
      ),
      buildFeishuFieldGrid([
        { label: '写入位置', value: writeLocation },
        { label: '认证文件', value: authLocation },
      ]),
      buildFeishuTipsNote(`API Key 不会通过普通聊天文本转发给 ${providerLabel}。`),
      ...buildValueButtonRows([
        {
          label: 'API URL / Key 登录',
          type: supportsDeviceAuth ? 'default' : 'primary',
          value: {
            gateway_action: 'codex_login.open_api_form',
          },
        },
        ...(supportsDeviceAuth
          ? [{
              label: '设备授权登录',
              type: 'primary' as const,
              value: {
                gateway_action: 'codex_login.start_device_auth',
              },
            }]
          : []),
      ], 2),
    ],
  });
}

export function buildFeishuOpenCodeLoginChoiceMessage(): string {
  const providers = [
    ['anthropic', 'Anthropic'],
    ['openai', 'OpenAI'],
    ['openrouter', 'OpenRouter'],
    ['google', 'Google'],
    ['groq', 'Groq'],
    ['xai', 'xAI'],
  ] as const;
  return buildFeishuInteractiveMessage({
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: 'OpenCode 登录授权',
      },
    },
    elements: [
      buildFeishuTitleBlock('选择 OpenCode 登录方式', '点击登录渠道后，系统会优先返回授权链接并引导你在浏览器完成登录；只有授权流程仍需补充信息时，才需要回到聊天里继续。'),
      buildFeishuFieldGrid([
        { label: '写入位置', value: '.config/opencode/opencode.json' },
        { label: '认证文件', value: '.local/share/opencode/auth.json' },
      ]),
      ...buildValueButtonRows(providers.map(([providerId, label]) => ({
        label,
        value: {
          gateway_action: 'opencode_login.start_provider_auth',
          provider_id: providerId,
        },
      })), 2),
      ...buildValueButtonRows([
        {
          label: 'API URL / Key 登录',
          type: 'primary',
          value: {
            gateway_action: 'codex_login.open_api_form',
          },
        },
      ], 1),
    ],
  });
}

export function buildFeishuApiLoginFormMessage(defaults?: {
  provider?: CliProvider;
  baseUrl?: string;
  model?: string;
}): string {
  const provider = defaults?.provider ?? 'codex';
  const providerLabel = provider === 'opencode' ? 'OpenCode' : 'Codex';
  const baseUrl = defaults?.baseUrl?.trim() || (provider === 'opencode' ? 'https://api.openai.com/v1' : 'https://codex.ai02.cn');
  const model = defaults?.model?.trim() || (provider === 'opencode' ? 'gpt-5' : 'gpt-5.3-codex');
  return buildFeishuInteractiveMessage({
    config: {
      wide_screen_mode: true,
      enable_forward: false,
    },
    header: {
      template: 'wathet',
      title: {
        tag: 'plain_text',
        content: 'API URL / Key 登录',
      },
    },
    elements: [
      buildFeishuTitleBlock(`写入 ${providerLabel} API 配置`, '提交后会覆盖当前项目内的登录配置。'),
      buildFeishuTipsNote(`建议填写：base_url=${baseUrl}，model=${model}`),
      {
        tag: 'form',
        name: 'codex_api_login',
        value: {
          gateway_action: 'codex_login.submit_api_credentials',
        },
        elements: [
          {
            tag: 'input',
            name: 'base_url',
            label_position: 'top',
            label: {
              tag: 'plain_text',
              content: 'API URL',
            },
            placeholder: {
              tag: 'plain_text',
              content: baseUrl,
            },
            max_length: 500,
          },
          {
            tag: 'input',
            name: 'api_key',
            label_position: 'top',
            label: {
              tag: 'plain_text',
              content: 'API Key',
            },
            placeholder: {
              tag: 'plain_text',
              content: 'sk-...',
            },
            max_length: 500,
          },
          {
            tag: 'input',
            name: 'model',
            label_position: 'top',
            label: {
              tag: 'plain_text',
              content: 'Model',
            },
            placeholder: {
              tag: 'plain_text',
              content: model,
            },
            max_length: 120,
          },
          {
            tag: 'button',
            name: 'submit_api_login',
            type: 'primary',
            action_type: 'form_submit',
            text: {
              tag: 'plain_text',
              content: '保存并启用',
            },
            value: {
              gateway_action: 'codex_login.submit_api_credentials',
            },
          },
        ],
      },
    ],
  });
}

export function buildFeishuApiLoginResultMessage(input: {
  provider?: CliProvider;
  ok: boolean;
  baseUrl?: string;
  model?: string;
  maskedApiKey?: string;
  message: string;
}): string {
  const providerLabel = input.provider === 'opencode' ? 'OpenCode' : 'Codex';
  return buildFeishuInteractiveMessage({
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: input.ok ? 'green' : 'red',
      title: {
        tag: 'plain_text',
        content: '登录授权',
      },
    },
    elements: [
      buildFeishuTitleBlock(input.ok ? `${providerLabel} 配置写入成功` : `${providerLabel} 配置写入失败`, input.message),
      buildFeishuFieldGrid([
        { label: 'API URL', value: input.baseUrl ?? '' },
        { label: 'Model', value: input.model ?? '' },
        { label: 'API Key', value: input.maskedApiKey ?? (input.ok ? '已配置' : '') },
      ]),
      ...buildValueButtonRows(input.ok
        ? [
            {
              label: '重新登录',
              type: 'primary',
              value: {
                gateway_cmd: '/login',
                command: '/login',
                text: '/login',
              },
            },
          ]
        : [
            {
              label: '返回表单',
              type: 'primary',
              value: {
                gateway_action: 'codex_login.open_api_form',
                base_url: input.baseUrl ?? '',
                model: input.model ?? '',
              },
            },
          ]),
    ],
  });
}

export function buildFeishuUserAuthMessage(input: {
  gatewayUserId: string;
  reason?: string;
  authStartUrl?: string;
  authStatusUrl?: string;
}): string {
  const gatewayUserId = input.gatewayUserId.trim();
  const authStartUrl = input.authStartUrl?.trim() || `/feishu/oauth/start?gateway_user_id=${gatewayUserId}`;
  const authStatusUrl = input.authStatusUrl?.trim() || `/feishu/auth/status?gateway_user_id=${gatewayUserId}`;
  return buildFeishuInteractiveMessage({
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: '飞书个人授权',
      },
    },
    elements: [
      buildFeishuTitleBlock(
        '授权个人任务与个人日历',
        input.reason?.trim() || '完成一次飞书 OAuth 绑定后，agent 才能创建到你本人的任务和主日历事件。',
      ),
      buildFeishuFieldGrid([
        { label: '授权入口', value: authStartUrl },
        { label: '状态检查', value: authStatusUrl },
      ]),
      buildFeishuTipsNote('这是飞书个人身份授权，不是 Codex CLI 的 /login。'),
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: {
              tag: 'plain_text',
              content: '去飞书授权',
            },
            multi_url: {
              url: authStartUrl,
            },
          },
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '查看授权状态',
            },
            multi_url: {
              url: authStatusUrl,
            },
          },
        ],
      },
    ],
  });
}

export function buildFeishuPersonalAuthUnavailableMessage(input?: {
  reason?: string;
}): string {
  return buildFeishuInteractiveMessage({
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: 'grey',
      title: {
        tag: 'plain_text',
        content: '飞书个人权限连接',
      },
    },
    elements: [
      buildFeishuTitleBlock(
        '当前环境未启用个人权限连接',
        input?.reason?.trim() || '当前环境还不能直接连接你的个人飞书权限，因此我暂时无法创建你的个人任务或个人日历事件。',
      ),
      buildFeishuFieldGrid([
        { label: '当前状态', value: '基础飞书机器人能力可用，个人任务/个人日历未启用' },
        { label: '下一步', value: '请让管理员为当前服务启用飞书个人权限连接后，再重试该请求' },
      ]),
      buildFeishuTipsNote('这不是 /login 问题，而是当前环境尚未启用“以你的身份访问飞书个人能力”。'),
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '知道了',
            },
            type: 'default',
            value: {
              gateway_action: 'noop',
            },
          },
        ],
      },
    ],
  });
}
