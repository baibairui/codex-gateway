# AgentClaw

[English README](./README.en.md)

[![CI](https://github.com/baibairui/AgentClaw/actions/workflows/ci.yml/badge.svg)](https://github.com/baibairui/AgentClaw/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)

把 Codex CLI 接到飞书、企业微信或个人微信，让 AI 不再只是一次性聊天窗口，而是一个长期在线、带记忆、带工作区、可执行真实动作的多 Agent 系统。

AgentClaw 适合想把 AI 真正接入团队协作流程的人：每个 Agent 有独立工作目录、长期身份、短期记忆、本地技能、浏览器能力和定时执行能力，可以在消息渠道里持续接着做事。

## 为什么值得 Star

- 它把 Codex CLI 从“终端单人工具”变成了“团队可用的长期在线 Agent 系统”。
- 它给每个 Agent 独立工作区和记忆边界，避免任务和人格互相污染。
- 它支持真实执行，不只是回复文本：浏览器操作、提醒、飞书 API、文档流和自定义本地技能都能接进来。
- 它可以自托管，凭证、上下文、工作区和自动化能力都在你自己控制下。

## AgentClaw 和普通聊天机器人有什么不同

| 能力 | AgentClaw | 普通聊天机器人 |
| --- | --- | --- |
| 长期在线的 Agent 工作区 | 有 | 通常没有 |
| 每个 Agent 独立记忆 | 有 | 常常共用或临时 |
| 在真实项目目录里运行 Codex CLI | 有 | 少见 |
| 本地 Skill 系统 | 有 | 少见 |
| 飞书 / 企业微信 / 微信接入 | 有 | 常常只有单一渠道 |
| 自托管部署 | 有 | 常常依赖 SaaS |

## 适合的使用场景

- 在飞书或企业微信里放一个长期在线的 coding agent。
- 给不同角色分配不同 Agent：工程、评审、研究、文档、运营。
- 让 Agent 打开浏览器、读写文件、更新文档，再把结果回传到聊天渠道。
- 把团队内部自动化脚本封装成 Skill，直接交给 Agent 调用。
- 把上下文和记忆保留在自己的服务器和工作目录里，而不是托管给外部机器人平台。

## 工作方式

```text
飞书 / 企业微信 / 微信
        |
        v
      AgentClaw
        |
        +--> 用户 / 会话 / Agent 路由
        +--> Agent 独立工作区与记忆
        +--> Codex CLI / OpenCode 运行器
        +--> 本地 Skill / 浏览器 / 提醒 / 平台 API
        |
        v
   回复结果 + 更新后的状态
```

## 渠道支持

| 渠道 | 状态 | 说明 |
| --- | --- | --- |
| 飞书 | 支持 | 支持长连接模式 |
| 企业微信 | 支持 | 需要公网回调地址 |
| 个人微信 | 支持 | 扫码登录 + 轮询收发 |

## 快速开始

### 1. 环境准备

- Node.js 20+
- npm 10+
- 已安装可执行的 `codex`
- 至少接入一种渠道：飞书、企业微信或个人微信

可选但常用：

- Playwright，用于浏览器自动化
- `xvfb`，用于无桌面 Linux 服务器
- Nginx、FRP、ngrok 等反向代理或隧道

安装依赖：

```bash
npm install
```

如需浏览器自动化：

```bash
npx playwright install chromium
```

### 2. 初始化配置

```bash
cp .env.example .env
```

或者使用配置向导：

```bash
agentclaw setup
```

### 3. 最小配置示例

飞书：

```env
PORT=3000
WECOM_ENABLED=false
FEISHU_ENABLED=true
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
FEISHU_LONG_CONNECTION=true
CODEX_BIN=codex
CODEX_WORKDIR=/absolute/path/to/agent-root
CODEX_SANDBOX=full-auto
CODEX_WORKDIR_ISOLATION=off
RUNNER_ENABLED=true
```

企业微信：

```env
PORT=3000
WECOM_ENABLED=true
WEWORK_CORP_ID=your_corp_id
WEWORK_SECRET=your_secret
WEWORK_AGENT_ID=your_agent_id
WEWORK_TOKEN=your_callback_token
WEWORK_ENCODING_AES_KEY=your_encoding_aes_key
CODEX_BIN=codex
CODEX_WORKDIR=/absolute/path/to/agent-root
RUNNER_ENABLED=true
```

个人微信：

```env
PORT=3000
WECOM_ENABLED=false
FEISHU_ENABLED=false
WEIXIN_ENABLED=true
CODEX_BIN=codex
CODEX_WORKDIR=/absolute/path/to/agent-root
RUNNER_ENABLED=true
```

首次启用微信且还没有会话时：

```bash
npm run weixin:login
```

### 4. 启动

开发模式：

```bash
agentclaw doctor
agentclaw up
```

生产模式：

```bash
npm run build
agentclaw start
```

### 5. 健康检查

```bash
curl http://127.0.0.1:3000/healthz
```

## 为什么工作区模型很重要

每个 Agent 都有自己的工作区、长期身份和短期记忆，这正是系统长期稳定的核心。

典型结构：

```text
.data/
  users/<user>/
    user.md
    agents/<agent>/
      AGENTS.md
      README.md
      SOUL.md
      memory/daily/
      .codex/workspace.json
```

这个结构把：

- 用户长期身份放在 `user.md`
- Agent 长期身份放在 `SOUL.md`
- 短期上下文放在 `memory/daily/`
- 每次执行严格限制在具体 Agent 工作区

## 内置能力

- 多 Agent 路由和会话持久化
- 飞书、企业微信、微信渠道接入
- 工作区级别的本地 Skill 加载
- 浏览器和桌面自动化接入
- 提醒和周期任务能力
- 健康检查和 PM2 友好部署

## 常用命令

```bash
npm run dev
npm run build
npm run weixin:login
npm run config:check
npm run publish:workspace
```

使用本地 CLI：

```bash
agentclaw setup
agentclaw doctor
agentclaw up
agentclaw start
```

## 部署说明

- `deploy.sh` 会发布当前工作区到目标服务器，同时保留 `.env` 和 `.data`
- 生产环境默认使用 PM2
- `/healthz` 是主要就绪检查接口
- `CODEX_WORKDIR` 应指向 Agent 根目录，而每次实际执行必须落到某个具体 Agent 工作区

## FAQ

### 这是一个机器人还是 Agent 运行时？

更接近 Agent 运行时，消息渠道只是入口。

### 支持一个用户对应多个 Agent 吗？

支持，这是核心设计之一。

### 它能执行真实动作而不只是回复吗？

能，这正是 Skill 系统和运行器存在的意义。

### 必须依赖 SaaS 托管吗？

不用，它是面向自托管设计的。

### 微信登录是交互式的吗？

是，首次登录通过二维码授权，之后会把会话保存在本地。

## 参与贡献

欢迎提 Issue 和 PR。高质量贡献通常包含：

- 清晰的使用场景
- 可复现的最小问题
- 行为变更的验证说明
- 影响外部使用方式时同步更新 README 或文档

先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，然后再提交 Issue 或 PR。

## 项目状态

AgentClaw 正在持续演进。当前仓库优先服务真实部署和实际工作流，所以有些部分仍然偏工程化而不是营销化。如果你在原始环境之外使用它，能提升安装、文档、复现性和演示效果的改进会非常有价值。

## 许可证

[ISC](./LICENSE)
