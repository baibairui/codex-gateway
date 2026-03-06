# wecom-codex-gateway

企业微信（WeCom）到 Codex CLI 的轻量网关：
- 接收企业微信安全模式回调（验签 + 解密）
- 将文本消息转发给本地 `codex` CLI
- 使用企业微信 API 主动推送回复
- 可选接入飞书事件回调（文本消息）并主动回推回复

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env
```

3. 开发启动

```bash
npm run dev
```

4. 生产构建与启动

```bash
npm run build
npm start
```

## 关键环境变量

- `WEWORK_CORP_ID` / `WEWORK_SECRET` / `WEWORK_AGENT_ID`
- `WEWORK_TOKEN` / `WEWORK_ENCODING_AES_KEY`（企业微信回调安全模式）
- `FEISHU_ENABLED`：是否启用飞书回调（默认 `false`）
- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（启用飞书时必填）
- `FEISHU_VERIFICATION_TOKEN`（推荐，飞书事件回调 token 校验）
- `CODEX_WORKDIR`（Codex 执行目录）
- `CODEX_AGENTS_DIR`（可选，agent 工作区根目录；默认 `.data/agents`）
- `CODEX_MODEL`（可选，默认模型）
- `CODEX_SEARCH`（默认是否开启联网搜索）
- `CODEX_SANDBOX`：`full-auto`（默认）或 `none`
- `MEMORY_STEWARD_ENABLED`：是否启用系统默认的后台记忆管家（默认 `true`）
- `MEMORY_STEWARD_INTERVAL_HOURS`：后台记忆管家运行周期（默认 `1` 小时）
- `BROWSER_OPEN_ENABLED`：是否允许通过 `/open <URL>` 在宿主机打开浏览器
- `BROWSER_OPEN_COMMAND`：可选，自定义浏览器打开命令
- `RUNNER_ENABLED`：`false` 时禁用执行，仅返回提示
- `COMMAND_TIMEOUT_MS`：固定超时（可选）。不设时启用自适应超时
- `COMMAND_TIMEOUT_MIN_MS` / `COMMAND_TIMEOUT_MAX_MS` / `COMMAND_TIMEOUT_PER_CHAR_MS`：自适应超时参数
- `ALLOW_FROM`：白名单，`*` 或逗号分隔用户 ID
- `DEDUP_WINDOW_SECONDS`：消息去重窗口
- `RATE_LIMIT_MAX_MESSAGES` + `RATE_LIMIT_WINDOW_SECONDS`：每用户限流
- `API_TIMEOUT_MS`：企业微信 API 请求超时
- `API_RETRY_ON_TIMEOUT`：本地超时后是否继续重试发消息（默认 `false`，防止重复发送）

## 接口

- `GET /healthz`：健康检查
- `GET /wecom/callback`：企业微信回调地址校验
- `POST /wecom/callback`：企业微信消息回调
- `POST /feishu/callback`：飞书事件回调（含 `url_verification`）

## 聊天内功能命令

- `/help`：查看可用命令
- `/new`：新建会话（清空当前上下文）
- `/clear`：清空当前会话（同 `/new`）
- `/session`：查看当前会话状态
- `/sessions`：查看历史会话列表（最近优先，含名称与最近问题摘要）
- `/switch <编号|threadId>`：切换会话
- `/agents`：查看当前用户的 agent 列表
- `/agent`：查看当前激活的 agent、工作区和会话
- `/agent create <名称>`：创建独立 agent 工作区并立即切换
- `/agent init-memory`：创建或切换到“记忆初始化引导”agent
- `/agent use <编号|agentId>`：切换到指定 agent
- `/rename <编号|threadId> <名称>`：重命名会话
- `/model`：查看当前模型
- `/model <模型名>`：切换当前用户模型
- `/model reset`：重置为默认模型（`CODEX_MODEL` 或 Codex CLI 默认）
- `/models`：查看当前 Codex 支持模型（读取本机 `~/.codex/models_cache.json`）
- `/search`：查看联网搜索状态
- `/search on|off`：开启/关闭联网搜索（按用户生效）
- `/open <URL>`：在宿主机打开浏览器
- `/review`：审查当前工作区改动（`codex exec review --uncommitted`）
- `/review base <分支>`：审查相对分支改动
- `/review commit <SHA>`：审查指定提交改动

推荐使用：
- 先输入 `/sessions` 查看编号
- 再输入 `/switch 2` 按编号切换

普通消息会先收到“处理中”提示，再持续收到 Codex 的流式回复。

## Agent 工作区与记忆设计

现在支持通过聊天命令创建 agent。每个 agent 都有独立工作区，Codex 会在对应目录执行：

```text
.data/agents/
  global-memory/
    README.md
    shared-context.md
    house-rules.md
  users/
    <user-slug>-<hash>/
      shared-memory/
        README.md
        profile.md
        preferences.md
        projects.md
        relationships.md
        decisions.md
        open-loops.md
        daily/
          YYYY-MM-DD.md
      _memory-steward/
        AGENTS.md
        agent.md
        steward-log.md
      <agent-id>/
        AGENTS.md
        agent.md
        memory/
          profile.md
          preferences.md
          projects.md
          relationships.md
          decisions.md
          open-loops.md
          daily/
            YYYY-MM-DD.md
```

说明：
- `AGENTS.md` 是 Codex 自动读取的工作区规则入口。
- `agent.md` 是该 agent 的主记忆索引。
- `shared-memory/` 是同一用户下所有 agent 共用的记忆层。
- `_memory-steward/` 是系统后台工作区，定时运行，用于整理 shared-memory；不面向最终用户。
- `memory/profile.md` / `preferences.md` / `projects.md` / `relationships.md` 用于保存 personal agent 的长期稳定信息。
- `memory/decisions.md` 用于记录已确认的重要决定，`memory/open-loops.md` 用于记录未来还要继续跟进的事项。
- `memory/daily/YYYY-MM-DD.md` 用于保存当天短期上下文和临时笔记。
- `global-memory/*.md` 用于沉淀所有 agent 共享的背景和规则。
- `/review` 和普通对话都会自动在当前 agent 的工作区里执行。
- 系统默认会定期运行后台 `Memory Steward`，把 shared-memory 和各 agent 的 memory 做低噪声整理。
- 当检测到 `shared-memory` 为空时，用户首次发送普通消息会自动切换到记忆初始化引导 agent。

推荐用法：
1. 先输入 `/agent create 个人助理`
2. 在生成的工作区里放项目代码或拉取仓库
3. 将用户画像、偏好、长期项目、关系信息分别整理到对应的 `memory/*.md`
4. 将当天上下文和零散发现记到 `memory/daily/YYYY-MM-DD.md`
5. 将跨 agent、跨会话的用户记忆沉淀到 `shared-memory/`
6. 通过 `/agent use <编号>` 在多个 agent 之间切换
7. 系统后台会定期运行 `Memory Steward`，整理 `shared-memory/`，无需用户手动创建

首次初始化记忆推荐：
1. 先输入 `/agent init-memory`
2. 按引导 agent 的问题分轮回答（每轮只填少量信息）
3. 确认后由引导 agent 写入 shared-memory 对应文件

## 飞书接入说明

1. 在 `.env` 配置：

```bash
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
```

2. 在飞书开放平台事件订阅里设置请求地址：

```text
http://<your-host>:3000/feishu/callback
```

3. 订阅事件：
- `im.message.receive_v1`

当前实现仅处理文本消息（`message_type=text`），用户标识使用 `open_id`。

## 测试

```bash
npm test
```

## 会话持久化

- 现在使用 SQLite 存储会话、当前 agent、agent 元数据：`.data/sessions.db`
- 默认 agent 仍使用 `CODEX_WORKDIR`
- 自定义 agent 使用 `CODEX_AGENTS_DIR` 下的独立工作区
