# codex-gateway

[![CI](https://github.com/baibairui/codex-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/baibairui/codex-gateway/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)

把企业微信或飞书接到本地 Codex CLI，让 AI 不再停留在一次性对话窗口，而是成为一组长期在线、带记忆、可执行真实动作的 agent。

`codex-gateway` 适合希望把 Codex 接入日常协作工具的外部开发者和团队：你可以把它部署在自己的机器或服务器上，为不同岗位配置多个 agent，让它们在独立工作区里持续处理开发、文档、搜索、浏览器操作、提醒和平台集成任务。

它不是一个只会“回消息”的聊天机器人，而是一个把 `Codex CLI + 多 agent 工作区 + skill 执行能力 + 企业协作入口` 串起来的网关。

## 目录

- [核心价值](#核心价值)
- [核心能力一览](#核心能力一览)
- [系统怎么工作](#系统怎么工作)
- [快速开始](#快速开始)
- [环境变量与关键配置](#环境变量与关键配置)
- [飞书接入](#飞书接入)
- [企业微信接入](#企业微信接入)
- [登录与授权](#登录与授权)
- [CLI 与会话命令](#cli-与会话命令)
- [Skill、浏览器与提醒能力](#skill浏览器与提醒能力)
- [部署、发布与健康检查](#部署发布与健康检查)
- [典型使用场景](#典型使用场景)
- [常见问题](#常见问题)
- [开发与测试](#开发与测试)
- [协作与许可证](#协作与许可证)

## 核心价值

大多数 AI 工具的问题不是“不够聪明”，而是“不能持续工作”。

`codex-gateway` 解决的是这一层：

- 把 Codex 接进企业微信或飞书，而不是停留在终端里单人使用
- 让不同 agent 拥有独立工作区、独立会话和长期记忆
- 用 skill 扩展 agent 的真实执行能力，而不只是文本回复
- 让提醒、定时任务、浏览器操作、文档写入等动作进入同一条工作链路
- 让开发团队能把 AI 当作长期在线的协作成员，而不是临时问答工具

如果你想做的是“把 AI 嵌入现有团队协作”，这个项目比单纯的 bot 更接近可用系统。

## 核心能力一览

### 1. 多 agent 协作

你可以配置多个 agent，按职责分工长期待命，例如：

- 开发 agent：写代码、修 Bug、做 code review
- 文档 agent：整理需求、维护 README、生成交付文档
- 搜索 agent：联网查资料、汇总公开信息、补充上下文
- 执行 agent：调用 skill、打开浏览器、执行页面操作
- 助理 agent：做提醒、跟进待办、安排周期任务

### 2. 独立工作区与上下文

每个 agent 都可以拥有自己的工作区、历史会话和记忆文件，避免不同任务互相污染。

### 3. 渠道接入

当前支持：

- 企业微信自建应用
- 飞书应用

飞书支持长连接模式，适合没有公网回调条件的部署环境；企业微信仍需要公网可访问回调地址。

### 4. Skill 驱动的真实执行

通过本地 skill，agent 可以获得真实动作能力，例如：

- 浏览器访问、点击、输入、截图、录屏
- 提醒和定时任务
- 飞书 OpenAPI 实际操作
- 公开信息调研和结果沉淀
- 你自己的脚本、平台工作流或内部自动化链路

### 5. 运维与交付友好

项目自带：

- `codexclaw setup` 交互配置向导
- `codexclaw doctor` / `codexclaw check` 安装自检
- `codexclaw up` / `start` 启动入口
- `npm run publish:workspace` 跨平台发布脚本
- `/healthz` 健康检查

## 系统怎么工作

整体链路可以理解为：

1. 用户在企业微信或飞书中给 agent 发消息。
2. gateway 读取当前用户、当前 agent、当前会话和工作区状态。
3. gateway 调用本地 Codex CLI，在指定工作目录中执行。
4. Codex 根据当前上下文、记忆文件和已安装 skill 处理任务。
5. 如果需要真实动作，agent 通过 skill 调用浏览器、提醒工具、飞书 API 或本地脚本。
6. 结果被回传到企业微信或飞书，对话和工作区状态继续保留。

这使得 agent 既能“理解任务”，也能“持续接着做”。

## 快速开始

如果你想尽快跑通一个可用实例，按下面顺序即可。

### 1. 环境准备

必须项：

- Node.js 20+
- npm 10+
- 已安装且可执行的 `codex` CLI
- 至少一种渠道应用：企业微信或飞书

可选项：

- Playwright 浏览器环境，用于真实浏览器自动化
- `xvfb`，用于无图形界面的 Linux 服务器
- 反向代理或隧道，如 Nginx、frp、ngrok

安装依赖：

```bash
npm install
```

如需浏览器自动化，建议安装 Chromium：

```bash
npx playwright install chromium
```

在无桌面的 Linux 上，如需可见浏览器上下文：

```bash
sudo apt-get install -y xvfb
```

可选：安装本地 CLI 命令后，可直接使用 `codexclaw`：

```bash
npm link
```

### 2. 初始化配置

复制环境变量模板：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

更推荐直接使用向导：

```bash
codexclaw setup
```

该命令会逐项写入 `.env`，结束后自动执行一次 `codexclaw check`。

### 3. 先填最小可运行配置

一个最小可用示例：

```env
PORT=3000

WECOM_ENABLED=true
WEWORK_CORP_ID=你的企业ID
WEWORK_SECRET=你的应用Secret
WEWORK_AGENT_ID=你的应用AgentId
WEWORK_TOKEN=你配置的回调Token
WEWORK_ENCODING_AES_KEY=你配置的43位EncodingAESKey

CODEX_BIN=codex
CODEX_WORKDIR=/你的项目绝对路径
CODEX_SANDBOX=full-auto
CODEX_WORKDIR_ISOLATION=off
RUNNER_ENABLED=true
CODEX_SEARCH=false
```

如果你只接飞书，可以把：

```env
WECOM_ENABLED=false
FEISHU_ENABLED=true
FEISHU_APP_ID=你的飞书AppID
FEISHU_APP_SECRET=你的飞书AppSecret
FEISHU_LONG_CONNECTION=true
FEISHU_GROUP_REQUIRE_MENTION=true
```

### 4. 自检并启动

```bash
codexclaw doctor
codexclaw up
```

生产模式：

```bash
codexclaw build
codexclaw start
```

### 5. 验证服务是否可用

```bash
curl http://127.0.0.1:3000/healthz
```

返回 `ok` 表示服务已经启动成功。`/healthz` 还会返回渠道状态摘要，方便确认飞书模式、群触发策略和启动帮助等状态。

## 环境变量与关键配置

完整模板见 [`.env.example`](./.env.example)。这里列出最常用、也最容易决定架构行为的配置项。

### 通用运行配置

- `PORT`：HTTP 服务端口，默认 `3000`
- `CODEX_BIN`：Codex CLI 可执行文件路径，默认 `codex`
- `CODEX_WORKDIR`：默认工作目录，建议填主项目的绝对路径
- `GATEWAY_ROOT_DIR`：可选，workspace 发布命令的运行根目录
- `RUNNER_ENABLED`：是否允许网关实际调用 Codex
- `CODEX_SEARCH`：默认是否开启联网搜索，可被用户 `/search on|off` 覆盖
- `CODEX_SANDBOX`：Codex 沙箱模式，通常使用 `full-auto`

### 工作目录隔离

- `CODEX_WORKDIR_ISOLATION=off`：仅决定默认启动目录，不限制 agent 可见范围
- `CODEX_WORKDIR_ISOLATION=bwrap`：使用 bubblewrap 限制 Codex 进程可见文件系统

`bwrap` 模式下，Codex 进程主要只会看到：

- 当前 agent 工作目录，挂载为 `/workspace`
- 必要系统运行时目录
- 工作区内的 `.codex-runtime/home`，作为运行时 HOME

如果你需要更硬的目录隔离，这是推荐模式；前提是宿主机已安装 `bubblewrap`。

### 超时与流量控制

- `COMMAND_TIMEOUT_MS`：固定超时，留空则启用自适应超时
- `COMMAND_TIMEOUT_MIN_MS`
- `COMMAND_TIMEOUT_MAX_MS`
- `COMMAND_TIMEOUT_PER_CHAR_MS`
- `ALLOW_FROM`：允许的用户 ID 白名单，`*` 表示全部允许
- `DEDUP_WINDOW_SECONDS`
- `RATE_LIMIT_MAX_MESSAGES`
- `RATE_LIMIT_WINDOW_SECONDS`

### 浏览器能力

默认情况下，gateway 会在第一次需要浏览器工具时懒启动内置 browser MCP 和共享浏览器窗口。

相关配置：

- `BROWSER_MCP_ENABLED`：默认开启
- `BROWSER_MCP_PORT`：内置 browser MCP 端口，默认 `8931`
- `BROWSER_MCP_PROFILE_DIR`：共享浏览器 profile 目录

运行行为：

- 浏览器由 gateway 自己持有共享 context 和持久 profile
- 浏览器窗口不会随着单次 Codex run 结束而关闭
- 所有 agent 默认共用一套浏览器 profile，可复用登录态
- 外部 browser MCP URL 覆盖不再支持
- 录屏已支持：`browser_start_recording` / `browser_stop_recording`

无图形界面的 Linux 环境中：

- 有可用 `DISPLAY` 时，沿用有头模式
- 没有 `DISPLAY` 时，自动改用 `xvfb-run`
- 如需强制使用虚拟显示，可设置 `GATEWAY_FORCE_XVFB=true`

### 内存管家

- `MEMORY_STEWARD_ENABLED=true`：默认开启后台记忆管家
- `MEMORY_STEWARD_INTERVAL_HOURS=1`：默认每小时运行一次

### 语音转写（Stage 1）

- `SPEECH_ENABLED=true`：启用入站语音转写
- `SPEECH_MODE=transcribe_and_reply|transcribe_only`
- `SPEECH_STT_PROVIDER`：当前实现支持 `openai-compatible`
- `SPEECH_STT_BASE_URL`：可选，默认 `https://api.openai.com/v1`
- `SPEECH_STT_API_KEY_ENV`：读取 API Key 的环境变量名，默认 `OPENAI_API_KEY`
- `SPEECH_STT_MODEL`：默认 `gpt-4o-mini-transcribe`
- `SPEECH_AUDIO_MAX_SIZE_MB`
- `SPEECH_AUDIO_MAX_DURATION_SEC`
- `SPEECH_AUDIO_ALLOWED_MIME_TYPES`

当前阶段的行为：

- 入站语音先做 STT，再进入现有文本处理链路
- `transcribe_and_reply`：把转写文本直接当作 query 继续交给 agent
- `transcribe_only`：只把转写文本回给用户，不调用 agent
- 当前首个完整闭环基于飞书入站语音；企微仍保留既有语音消息收发能力，但本阶段不包含新的企微入站下载链路
- 当前不支持“把 agent 的文本回答自动合成为语音”
- 如果 agent 已经拿到了 `local_audio_path`，仍然可以按既有能力回发音频文件

## 飞书接入

飞书适合没有公网回调条件、或者更希望直接利用长连接模式的部署方式。

### 基础配置

```env
FEISHU_ENABLED=true
FEISHU_APP_ID=你的飞书AppID
FEISHU_APP_SECRET=你的飞书AppSecret
FEISHU_LONG_CONNECTION=true
FEISHU_GROUP_REQUIRE_MENTION=true
```

说明：

- `FEISHU_LONG_CONNECTION=true`：启用官方 SDK 长连接，不需要公网 webhook
- 开启后会关闭 `/feishu/callback`
- `FEISHU_VERIFICATION_TOKEN`：仅 webhook 模式必需，长连接模式可留空
- `FEISHU_GROUP_REQUIRE_MENTION=true`：群聊中默认需要 `@机器人` 才会触发

### 推荐安装顺序

```bash
codexclaw setup
codexclaw doctor
```

`doctor` 会提示：

- 当前是长连接还是 webhook
- 飞书凭据是否缺失
- 群触发策略是否开启
- DocX 链路是否可直接使用

### 消息能力

飞书消息类型支持：

- 入站：`text`、`post`、`image`、`file`、`audio`、`media`、`sticker`、`interactive`、`share_chat`、`share_user`
- 出站：`text`、`post`、`image`、`file`、`audio`、`media`、`sticker`、`interactive`、`share_chat`、`share_user`

附件行为：

- 入站二进制消息会先下载到本地，再把 `local_*_path` 注入给 Codex
- 当模型明确回发非文本且提供 `local_image_path/local_file_path/local_audio_path/local_media_path` 时，网关会先上传到飞书，再发送对应消息类型
- 若启用 `SPEECH_ENABLED=true`，飞书入站 `audio` 还会在进入 agent 前先做一次 STT；`transcribe_only` 模式下不会调用 agent

推送行为：

- 当前飞书文本回复采用“多条消息推送”模式

群聊触发规则：

- 群聊默认要求 `@机器人`
- 私聊始终直接触发
- 文本消息会优先使用 `text_without_at_bot`

### 飞书官方操作 skill

当用户要求 agent 创建飞书文档、知识库节点或其他真实飞书对象时，可使用：

- `./.codex/skills/feishu-official-ops/SKILL.md`

当前覆盖的能力包括：

- 消息读取和搜索
- DocX 内容读取
- 多维表格查询
- 日历、日程和忙闲时间查询
- 任务与子任务操作
- 新版飞书文档（DocX）创建
- 知识库空间查询与节点创建

这类动作通过飞书 OpenAPI 真实执行，不是文本模拟。

## 企业微信接入

企业微信适合已经有自建应用、并且可以提供公网回调地址的部署方式。

### 基础配置

```env
WECOM_ENABLED=true
WEWORK_CORP_ID=你的企业ID
WEWORK_SECRET=你的应用Secret
WEWORK_AGENT_ID=你的应用AgentId
WEWORK_TOKEN=你配置的回调Token
WEWORK_ENCODING_AES_KEY=你配置的43位EncodingAESKey
```

如果你完全不使用企业微信：

```env
WECOM_ENABLED=false
```

### 回调配置

在企业微信应用后台填写：

- URL：`https://你的域名/wecom/callback`
- Token：与 `.env` 中 `WEWORK_TOKEN` 一致
- EncodingAESKey：与 `.env` 中 `WEWORK_ENCODING_AES_KEY` 一致

企业微信保存回调时会立即验签和解密；验证通过后，机器人才能正常收发消息。

### 消息能力

企业微信消息类型支持：

- 入站：`text`、`image`、`voice`、`video`、`file`
- 出站：`text`、`markdown`、`image`、`voice`、`video`、`file`

附件行为：

- 入站非文本消息会把 `media_id` 等关键信息注入给 Codex
- 当模型明确回发企微非文本且提供 `local_image_path/local_file_path/local_audio_path/local_media_path` 时，网关会先上传素材，再发送对应消息类型
- 当前阶段不会把 agent 的文本答案自动合成为企微语音；如需回发语音，仍需提供已有的 `local_audio_path`

## 登录与授权

第一次使用前，需要先完成 Codex 登录授权。

在企业微信或飞书里给机器人发送：

```text
/login
```

### 企业微信中的 `/login`

企业微信会直接返回设备码和授权提示。

### 飞书中的 `/login`

飞书会先返回一张登录方式卡片：

- `设备授权登录`
- `API URL / Key 登录`

如果选择 API 登录，系统会直接写入当前项目下的 `.codex/config.toml` 和 `.codex/auth.json`。

示例：

```toml
model = "gpt-5.3-codex"
model_provider = "codex"

[model_providers.codex]
name = "codex"
base_url = "https://codex.ai02.cn"
wire_api = "responses"
requires_openai_auth = true

[features]
enable_request_compression = false
```

```json
{"OPENAI_API_KEY":"sk-你的密钥"}
```

如果 15 分钟内没有完成授权，需要重新发送 `/login`。

## CLI 与会话命令

安装 `npm link` 后，你可以直接使用 `codexclaw` 管理服务。

### 服务侧 CLI

```text
codexclaw up
codexclaw dev
codexclaw build
codexclaw start
codexclaw setup
codexclaw check
codexclaw doctor
codexclaw doc-log
codexclaw update
codexclaw test
codexclaw help
```

用途：

- `codexclaw up`：开发模式启动，启动前自动配置检查
- `codexclaw dev`：同 `up`
- `codexclaw build`：构建 TypeScript
- `codexclaw start`：生产模式启动，启动前自动配置检查
- `codexclaw setup`：交互配置向导，自动写入 `.env`
- `codexclaw check`：仅检查配置，不启动服务
- `codexclaw doctor`：同 `check`，更适合作为安装自检入口
- `codexclaw doc-log`：把本轮迭代内容追加到飞书 DocX
- `codexclaw update`：拉取远端最新代码并更新依赖、构建
- `codexclaw test`：执行测试
- `codexclaw help`：查看帮助

### 会话命令

```text
/new
/clear
/session
/sessions
/switch <编号|threadId>
/rename <编号|threadId> <名称>
```

用途：

- `/new` 或 `/clear`：清空当前会话，从新上下文开始
- `/session`：查看当前会话
- `/sessions`：查看当前 agent 的历史会话
- `/switch`：切换到旧会话
- `/rename`：给会话改名，便于识别

### Agent 命令

```text
/agent
/agents
/agent create <名称>
/agent use <编号|agentId>
/agent init-memory
/skill-agent
```

用途：

- `/agent`：查看当前 agent
- `/agents`：查看所有 agent
- `/agent create`：创建新的数字员工
- `/agent use`：切换当前 agent
- `/agent init-memory`：初始化记忆型 agent
- `/skill-agent`：启动技能扩展助手 agent

### 模型与搜索命令

```text
/model
/model <模型名>
/model reset
/models
/search
/search on
/search off
```

用途：

- 查看或切换当前模型
- 恢复默认模型
- 查看可用模型
- 控制联网搜索开关

## Skill、浏览器与提醒能力

### Skill 命令

```text
/skills
/skills global
/skills agent
/skills disable global <skillName>
/skills add global <skillName>
/skills disable agent <skillName>
/review
/review base <分支>
/review commit <SHA>
/help
```

用途：

- `/skills`：查看当前会话生效的 skill
- `/skills global`：查看全局 skill
- `/skills agent`：查看当前 agent skill
- `/skills disable global`：仅对当前 agent 禁用某个全局 skill
- `/skills add global`：重新启用某个全局 skill
- `/skills disable agent`：禁用当前 agent 上的某个 skill
- `/review`：审查当前工作区改动
- `/review base`：审查相对某分支的改动
- `/review commit`：审查指定提交

### 浏览器操作规范

推荐按下面的方式让 agent 操作浏览器：

1. 先定义任务成功标准，再执行页面动作。
2. 默认复用当前标签页，先 `browser_snapshot` 再决定是否导航。
3. 每次只做一个小动作，动作后立刻 `snapshot` 或截图确认。
4. 回报里必须包含执行动作、页面证据、当前结论和下一步。

边界：

- 遇到登录、OTP、验证码、支付确认，必须人工接管
- 扫码流程应先输出二维码截图，再等待用户回复“继续”
- 同一动作最多重试 2 次
- 不允许在页面状态未知时连续点击或连续输入
- 只允许走 gateway 的 `browser_*` MCP 工具链路

### 提醒与定时任务

定时任务不需要专门记命令，直接使用自然语言即可。

例如：

```text
明天上午 10 点提醒我检查发布结果
```

```text
30 分钟后提醒我继续处理这个 bug
```

```text
每周一上午 9 点提醒我整理本周计划
```

只要对应 `reminder-tool` skill 已安装，agent 就可以创建可持续跟进的提醒任务。

## 部署、发布与健康检查

### 启动命令

推荐开发环境直接使用：

```bash
codexclaw up
```

生产环境：

```bash
codexclaw build
codexclaw start
```

### 运行发布

```bash
npm run publish:workspace
```

该命令默认走 Node 脚本，不依赖 bash，可在 Windows 和 Linux 运行。

### 健康检查

```bash
curl http://127.0.0.1:3000/healthz
```

除了 `ok`，当前还会返回渠道状态摘要，例如：

- 飞书是否启用
- 当前是长连接还是 webhook
- webhook 是否开放
- 群聊是否要求 `@`
- DocX 链接域名是否已配置
- 启动 help 是否开启

### 无公网 IP 部署

如果你没有公网 IP，推荐优先使用飞书长连接模式：

```env
FEISHU_ENABLED=true
FEISHU_LONG_CONNECTION=true
```

此模式下：

- 不需要飞书公网回调地址
- 只要求当前机器能够主动访问飞书开放平台
- 启动后由 SDK 建立 WebSocket 长连接接收事件

注意：

- 飞书长连接与 webhook 互斥
- 企业微信回调仍然需要公网可访问地址
- 如果只用飞书，建议同时设置 `WECOM_ENABLED=false`

## 典型使用场景

### 把它当开发员工

你可以直接在聊天里说：

```text
检查这个项目里登录流程哪里可能超时
```

gateway 会把任务送到本地工作区，让 Codex 在真实代码上下文里分析，再把结果回传。

### 把它当多个员工

例如：

```text
/agent create 开发负责人
/agent create 文档助理
/agent create 运营执行
```

再按需切换：

```text
/agent use 1
/agent use 2
/agent use 3
```

每个 agent 都可以保留自己的上下文、工作区和记忆。

### 把它当可扩展执行系统

通过 skill，你可以不断增加新能力，例如：

- 提醒和定时任务
- 联网搜索
- 浏览器访问和页面操作
- 飞书真实对象写入
- 你自己的脚本和第三方工作流

这使它从“会回复的 bot”变成“会持续执行的系统”。

## 常见问题

### `/login` 失败

先检查：

```bash
which codex
```

然后确认：

- `.env` 中 `RUNNER_ENABLED=true`
- 机器网络正常
- `codex` CLI 本身可单独启动

如果你在飞书里使用 `API URL / Key 登录`，还要再确认：

- 当前项目目录下的 `.codex/` 可写
- `base_url` 是合法的 `http/https` URL
- `api_key` 不为空

### 企业微信收不到回复

优先检查：

- 回调 URL 是否公网可访问
- `WEWORK_TOKEN` 是否与后台一致
- `WEWORK_ENCODING_AES_KEY` 是否与后台一致
- 服务日志里是否存在签名失败或解密失败

### 命令执行超时

可以调大：

- `COMMAND_TIMEOUT_MIN_MS`
- `COMMAND_TIMEOUT_MAX_MS`
- `COMMAND_TIMEOUT_PER_CHAR_MS`

### 飞书没有收到事件

优先确认：

- `FEISHU_ENABLED=true`
- 长连接模式下 `FEISHU_LONG_CONNECTION=true`
- webhook 模式下 `FEISHU_VERIFICATION_TOKEN` 已正确填写
- `codexclaw doctor` 没有飞书阻塞项

## 开发与测试

```bash
npm run build
npm test
```

如需发布当前工作区：

```bash
npm run publish:workspace
```

## 协作与许可证

- 贡献指南：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 行为准则：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- 安全策略：[SECURITY.md](./SECURITY.md)
- 许可证：[LICENSE](./LICENSE)
