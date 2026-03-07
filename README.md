# wecom-codex-gateway

[![CI](https://github.com/baibairui/codex-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/baibairui/codex-gateway/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)

一个面向个人/小团队的消息网关：将企业微信（WeCom）和飞书文本消息接入到本地 Codex CLI，并支持多 agent 工作区、会话持久化与长期记忆管理。

## 特性

- WeCom 安全模式回调（验签 + 解密）
- 飞书事件回调（可选）
- 文本消息转发到本地 `codex` CLI，并流式回推结果
- 多 agent 工作区与会话切换（`/agent`、`/agents`、`/switch`）
- Shared Memory + Agent Memory 分层记忆
- 内置记忆初始化引导 agent、技能扩展助手 agent
- 内置 reminder skill（通过 MCP reminder server）

## 架构概览

```text
WeCom/Feishu webhook
        |
        v
   Express Server
        |
        v
    Chat Handler
   /            \
Codex Runner   Session Store (SQLite)
   |                  |
   v                  v
Agent Workspace   .data/sessions.db
  (.data/agents)
```

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

3. 本地开发

```bash
npm run dev
```

4. 生产构建与启动

```bash
npm run build
npm start
```

## 核心环境变量

- `WEWORK_CORP_ID` / `WEWORK_SECRET` / `WEWORK_AGENT_ID`
- `WEWORK_TOKEN` / `WEWORK_ENCODING_AES_KEY`
- `FEISHU_ENABLED` / `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
- `CODEX_WORKDIR` / `CODEX_AGENTS_DIR`
- `CODEX_MODEL` / `CODEX_SEARCH`
- `MEMORY_STEWARD_ENABLED` / `MEMORY_STEWARD_INTERVAL_HOURS`
- `RUNNER_ENABLED` / `COMMAND_TIMEOUT_*`

完整配置请看 [.env.example](./.env.example)。

## HTTP 接口

- `GET /healthz`
- `GET /wecom/callback`
- `POST /wecom/callback`
- `POST /feishu/callback`

## 聊天命令

- `/help`
- `/session` `/sessions` `/switch <编号|threadId>`
- `/agent` `/agents`
- `/agent create <名称>`
- `/agent init-memory`
- `/skill-agent`
- `/agent use <编号|agentId>`
- `/rename <编号|threadId> <名称>`
- `/model` `/models`
- `/search on|off`
- `/open <URL>`
- `/review` `/review base <分支>` `/review commit <SHA>`

## 工作区与记忆设计

```text
.data/agents/
  global-memory/
  users/
    <user-slug>-<hash>/
      shared-memory/
      _memory-steward/
      <agent-id>/
```

说明：

- `shared-memory/identity.md`：跨 agent 统一身份内核
- `<agent-id>/memory/identity.md`：当前 agent 身份副本
- 系统会自动补齐旧模板缺失字段（如 `Language style`）

## 开发与测试

```bash
npm run build
npm test
```

## 开源协作

- 贡献指南：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 行为准则：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- 安全策略：[SECURITY.md](./SECURITY.md)

## 路线图（建议）

- [ ] 增加 Docker 一键部署
- [ ] 增加更多渠道适配器
- [ ] 增加可视化运营面板
- [ ] 增强多用户隔离能力

## 许可证

ISC，见 [LICENSE](./LICENSE)。
