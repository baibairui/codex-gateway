# codex-gateway

[![CI](https://github.com/baibairui/codex-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/baibairui/codex-gateway/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)

把企业微信或飞书接到本地 Codex CLI，把 AI 从一次性对话窗口变成一组长期在线、可分工、可扩展能力的数字员工。

你可以给自己配置多个 agent，让它们 24 小时待命：

- 一个写代码、修 Bug、做 code review
- 一个整理需求、维护文档、拆解任务
- 一个联网搜索、查资料、做汇总
- 一个通过 skill 打开浏览器、访问网页、执行页面操作
- 一个负责提醒、定时任务和长期跟进
- 一个接入你自己的脚本或平台工作流，完成真实执行链路

这不是聊天机器人项目，而是一套 agent 员工系统。

## 为什么值得用

大多数 AI 工具的问题是：只能对话，不能持续工作。

这个项目把 Codex 的能力接进企业微信/飞书，让 agent 具备这些特性：

- 有独立工作区，不同 agent 互不干扰
- 有独立会话，可以持续接着上次任务做
- 有长期记忆，不需要每次重复解释背景
- 有 skill 扩展能力，不只回答问题，还能真正执行任务
- 有定时任务能力，可以替你持续跟进事情

你可以把 Codex 通过这个网关接入日常协作渠道，然后按岗位给自己配置多个长期在线的数字员工。

## 它可以做什么

你可以让不同 agent 分工协作：

- 开发 agent：写代码、修复问题、审查变更
- 文档 agent：维护 README、方案说明和交付文档
- 搜索 agent：联网查资料、汇总信息、补充上下文
- 执行 agent：通过 skill 打开浏览器、执行页面操作、跑自动化流程
- 助理 agent：创建提醒、安排定时任务、追踪长期待办

例如：

- “检查这个项目里登录流程哪里可能超时”
- “帮我审查当前工作区改动”
- “打开浏览器进入指定页面执行操作”
- “明天上午 10 点提醒我检查发布结果”
- “每周一上午 9 点提醒我整理本周计划”
- “30 分钟后提醒我继续处理这个 bug”

像打开浏览器执行页面操作、做周期提醒、持续跟进任务，本质上都属于给 agent 安装 skill 后获得的能力。包括你自己的业务脚本、运营流程、外部平台动作，也都可以逐步接进来。

当前内置的社媒调研 skills 还可以让 agent 做公开信息研究与沉淀，例如：

- 跨平台收集 `X/Twitter`、小红书、抖音、B 站、公众号的公开内容线索
- 单平台深挖指定账号、关键词、视频、笔记、文章
- 汇总热点、竞品动态、内容素材，并整理成结构化结论
- 将调研结果写入飞书 DocX / Wiki，形成持续更新的情报文档

当前内置的飞书官方操作 skill 还可以让 agent 执行真实的飞书 OpenAPI 动作，例如：

- 读取历史消息、搜索消息
- 读取 DocX / 云文档内容
- 查询多维表格数据表和记录
- 查询日历、日程和忙闲时间
- 创建和查询任务、子任务
- 创建新版飞书文档（DocX）
- 列出知识库空间
- 在知识库里创建节点（例如 DocX 节点）
- 查询知识库节点信息

这类动作不是“回复一段话假装完成”，而是通过飞书官方 OpenAPI 实际执行。

## 环境准备

必须项：

- Node.js 20+
- npm 10+
- 已安装并可执行的 `codex` CLI
- 如果要做真实浏览器自动化，还需要本地可用的 Playwright 浏览器运行环境
- 企业微信自建应用

可选项：

- 飞书应用
- 反向代理或隧道，如 Nginx、frp、ngrok，用于让企业微信访问你的回调地址

## 配置教程

### 1. 安装依赖

```bash
npm install
```

如果你要让 agent 稳定执行网页点击、输入、截图，建议再执行一次：

```bash
npx playwright install chromium
```

如果你部署在没有图形界面的 Linux 服务器上，再安装一次：

```bash
sudo apt-get install -y xvfb
```

启动脚本会自动判断：
- 有可用 `DISPLAY` 时，沿用原来的有头浏览器启动方式
- 没有 `DISPLAY` 时，自动改用 `xvfb-run` 提供虚拟显示

如需强制走虚拟显示，可额外设置：

```bash
GATEWAY_FORCE_XVFB=true
```

可选：安装本地 CLI 命令（安装后可直接用 `codexclaw`）：

```bash
npm link
```

### 2. 复制环境变量模板

```bash
cp .env.example .env
```

Windows PowerShell 可用：

```powershell
Copy-Item .env.example .env
```

### 3. 填写基本配置

至少先填这些：

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

这些配置的含义：

- `WECOM_ENABLED`：是否启用企业微信接入。默认 `true`，如果你不接企业微信，显式设成 `false`
- `WEWORK_CORP_ID`：企业微信企业 ID
- `WEWORK_SECRET`：企业微信应用 Secret
- `WEWORK_AGENT_ID`：企业微信应用 AgentId
- `WEWORK_TOKEN`：企业微信回调校验 Token
- `WEWORK_ENCODING_AES_KEY`：企业微信回调解密密钥
- `CODEX_BIN`：Codex CLI 可执行文件，默认是 `codex`
- `CODEX_WORKDIR`：默认工作目录，建议填写你的主项目绝对路径
- `GATEWAY_ROOT_DIR`：可选。workspace 发布命令运行目录（默认当前进程工作目录）
- `CODEX_AGENTS_DIR`：可选。默认使用当前项目 `.data/agents`
- `CODEX_SANDBOX`：Codex 执行沙箱模式，通常用 `full-auto`
- `CODEX_WORKDIR_ISOLATION`：可选。`off` 或 `bwrap`。设为 `bwrap` 时，gateway 会用 bubblewrap 把 Codex 进程限制在当前 agent 工作目录的可见文件系统视图内，并把 Codex 的运行时 HOME 放到该工作区内的 `.codex-runtime/home`
- `RUNNER_ENABLED`：是否允许网关实际调用 Codex
- `CODEX_SEARCH`：默认是否开启联网搜索
- `BROWSER_MCP_ENABLED`：默认开启；只有你明确不需要浏览器自动化时，才设为 `false`
- `BROWSER_MCP_PORT`：可选。gateway 本地自启动内置 browser MCP 时使用的端口，默认 `8931`
- `BROWSER_MCP_PROFILE_DIR`：可选，共享浏览器登录态目录；默认是 `.data/browser/profile`

浏览器能力说明：

- 默认情况下，gateway 会在第一次需要浏览器工具时懒启动内置 browser MCP 和可见 Chrome 窗口
- 浏览器由 gateway 自己持有共享 context 和持久 profile，所以浏览器窗口不会随着单次 Codex run 结束而关闭
- 运行时只注入 gateway 内置的 `gateway_browser` MCP，外部 browser MCP URL 覆盖不再支持，因此不会受用户自己 `~/.codex/config.toml` 里的浏览器配置影响
- 所有 agent 默认共用同一套浏览器 profile，所以登录态可以复用
- 浏览器窗口只有在手动关闭它或 gateway 退出时才会结束
- 录屏工具已支持：`browser_start_recording` 开始录制、`browser_stop_recording` 停止并产出本地 mp4；宿主机需安装 `ffmpeg`

工作目录隔离说明：

- 仅设置 `CODEX_WORKDIR` 只能决定“默认从哪个目录启动”，不能保证 agent 只能看到该目录。
- 如果你要的是更硬的目录隔离，而又不想退回 `CODEX_SANDBOX=full-auto`，建议开启 `CODEX_WORKDIR_ISOLATION=bwrap`。
- `bwrap` 模式要求宿主机安装 `bubblewrap`（命令通常是 `bwrap`）。
- 在该模式下，Codex 进程只会看到：
  - 当前 agent 工作目录（挂载为 `/workspace`，可写）
  - 必要的系统运行时目录（只读）
  - 工作区内的 `.codex-runtime/home` 作为 Codex 自己的 HOME
- 这样 agent 不会再直接看到宿主机上的其他项目目录、其他 agent 工作区或 gateway 源码目录。

Agent 浏览器操作指南（推荐）：

1. 先定义任务成功标准，再执行页面动作。
2. 默认复用当前标签页，先 `browser_snapshot` 再决定是否 `browser_navigate`。
3. 每次只做一个小动作（点/输/选/等），动作后立刻做一次 `snapshot` 或截图确认。
4. 回报必须包含：执行动作、页面证据、当前结论、下一步。

登录与扫码：

- 遇到登录、OTP、验证码、支付确认时，必须切人工接管，不得伪造完成。
- 扫码流程先输出二维码截图，再等待用户回复“继续”。
- 用户回复“继续”后先校验登录态，再恢复自动化步骤。

失败处理与边界：

- 同一动作最多重试 2 次；仍失败就回报阻塞点并请求用户决策。
- 禁止在页面状态未知时连续点击或连续输入。
- 只允许走 gateway 的 `browser_*` MCP 工具，不允许改走 playwright-cli、`npx @playwright/mcp` 或其他脚本入口。

如果你不接企业微信，可以这样关掉：

```env
WECOM_ENABLED=false
```

如果你要启用飞书，再补充：

```env
FEISHU_ENABLED=true
FEISHU_APP_ID=你的飞书AppID
FEISHU_APP_SECRET=你的飞书AppSecret
FEISHU_LONG_CONNECTION=true
FEISHU_VERIFICATION_TOKEN=你的校验Token
FEISHU_GROUP_REQUIRE_MENTION=true
# 可选：固定的项目迭代 DocX 文档引用（支持 id / token / url）
# FEISHU_ITERATION_DOCX_REF=https://feishu.cn/docx/EChBdybp4oCAf2x6VqqcXQhmnvh
```

说明：

- `FEISHU_LONG_CONNECTION=true`：启用官方 SDK 长连接收事件，不需要公网回调地址
- 开启 `FEISHU_LONG_CONNECTION=true` 后，会关闭 `/feishu/callback` webhook 接口（不再做兜底双通道）
- `FEISHU_VERIFICATION_TOKEN`：仅 webhook 模式需要；长连接模式可留空
- `FEISHU_GROUP_REQUIRE_MENTION=true`：群聊默认要求 `@机器人` 才触发；私聊不受影响。显式设为 `false` 可恢复“群里任何消息都触发”
- DocX 链接默认由系统基于 `document_id` 自动生成，不要求用户额外配置 URL
- `FEISHU_ITERATION_DOCX_REF`：可选。用于把每轮迭代记录追加到固定的项目 DocX 文档；支持 `document_id`、token 或飞书文档 URL
- `FEISHU_ITERATION_DOCX_ID`：兼容旧配置，仍可继续使用，但推荐升级为 `FEISHU_ITERATION_DOCX_REF`

安装建议：

- 优先使用 `codexclaw setup` 完成飞书配置
- 配完后立刻执行 `codexclaw doctor`
- `doctor` 会直接告诉你：当前是长连接还是 webhook、飞书凭据是否缺失、群触发策略是否开启、DocX 链路是否可直接使用

### 飞书能力说明（当前实现）

飞书消息类型支持：

- 入站：`text`、`post`、`image`、`file`、`audio`、`media`、`sticker`、`interactive`、`share_chat`、`share_user`
- 出站：`text`、`post`、`image`、`file`、`audio`、`media`、`sticker`、`interactive`、`share_chat`、`share_user`

附件与本地路径：

- 入站二进制消息会先下载到本地，再把 `local_*_path` 注入给 Codex
- 当模型明确回发非文本且提供 `local_image_path/local_file_path/local_audio_path/local_media_path` 时，网关会先上传到飞书，再发送对应消息类型

推送行为：

- 当前飞书文本回复采用“多条消息推送”模式（分片逐条发送）

群聊触发规则：

- 默认开启 `@` 触发：群消息只有明确 `@机器人` 才会进入 Codex
- 私聊始终直接触发，不要求 `@`
- 文本消息会优先使用 `text_without_at_bot`，避免把 `@机器人` 前缀一并传给模型

### 飞书官方操作 skill（当前实现）

当用户要求 agent 创建飞书文档、知识库节点等真实飞书对象时，agent 可以使用本地 skill：

- `./.codex/skills/feishu-official-ops/SKILL.md`

它当前封装了飞书官方 OpenAPI 的这些能力：

- `im get-message` / `im list-messages` / `im search-messages`：读取历史消息、搜索消息
- `doc get-content` / `doc get-raw-content`：读取 DocX markdown / 纯文本内容
- `bitable list-tables` / `bitable list-records` / `bitable search-records`：查询多维表格结构与记录
- `calendar list-calendars` / `calendar list-events` / `calendar freebusy`：查询日历、日程和忙闲时间
- `task create` / `task list` / `task get` / `task update` / `task create-subtask`：任务与子任务操作
- `docx create`：创建新版文档
- `wiki list-spaces`：列出知识空间
- `wiki get-node`：查询知识空间节点
- `wiki create-node`：在知识空间创建节点

前提：

- 已配置 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
- 飞书应用已开通对应的 IM / Docs / Bitable / Calendar / Task / Wiki OpenAPI 权限

完整配置模板见 [.env.example](./.env.example)。

### 企业微信能力说明（当前实现）

企业微信消息类型支持：

- 入站：`text`、`image`、`voice`、`video`、`file`
- 出站：`text`、`markdown`、`image`、`voice`、`video`、`file`

附件与本地路径：

- 入站非文本消息会把 `media_id` 等关键信息注入给 Codex
- 当模型明确回发企微非文本且提供 `local_image_path/local_file_path/local_audio_path/local_media_path` 时，网关会先上传素材，再发送对应消息类型

如果你希望逐行引导填写，可以直接运行：

```bash
codexclaw setup
```

该命令会按步骤提问并写入 `.env`，结束后自动执行一次 `codexclaw check`。
如果启用了飞书，向导结束前还会额外打印一段“飞书下一步清单”，直接提示你当前模式、群触发策略以及后续该执行的命令。
向导支持先选择平台（仅企业微信 / 仅飞书 / 同时启用），并以彩色步骤提示引导输入。

### 4. 启动服务

推荐单命令启动（会先自动检查配置）：

```bash
codexclaw up
```

如果 `.env` 缺失关键配置，命令会直接提示缺失项并退出，不会盲目启动。

开发模式：

```bash
codexclaw dev
```

生产模式：

```bash
codexclaw build
codexclaw start
```

启动前建议先跑一次配置检查：

```bash
codexclaw check
```

这条命令会读取 `.env`，按当前 WeCom/飞书模式检查必填配置并给出缺失项。

`codexclaw` 命令说明：

- `codexclaw up`：开发模式启动（启动前自动配置检查）
- `codexclaw dev`：同 `up`
- `codexclaw start`：生产模式启动（启动前自动配置检查）
- `codexclaw setup`：逐行交互配置向导，自动写入 `.env`
- `codexclaw check`：仅检查配置，不启动服务
- `codexclaw doctor`：同 `check`，更适合作为安装自检入口
- `codexclaw update`：一键拉取远端最新代码并完成依赖更新与构建
- `codexclaw build`：构建 TypeScript
- `codexclaw test`：执行测试
- `codexclaw help`：查看帮助

推荐流程：

```bash
codexclaw check
codexclaw up
```

### 运行发布（跨平台）

执行：

```bash
npm run publish:workspace
```

该命令现在默认走 Node 脚本（不依赖 bash），在 Windows/Linux 都可运行。

### 5. 健康检查

```bash
curl http://127.0.0.1:3000/healthz
```

现在 `/healthz` 会额外返回渠道状态摘要，例如飞书是否启用、当前是长连接还是 webhook、webhook 是否开放、群聊是否要求 `@`、DocX 链接域名是否已配置、启动 help 是否开启。服务启动日志里也会打印同一份飞书状态摘要，方便不查接口时直接验收。

如果返回 `ok`，说明服务已经启动成功。

### 无公网 IP 部署（重点）

如果你没有服务器公网 IP，推荐用飞书长连接模式：

```env
FEISHU_ENABLED=true
FEISHU_LONG_CONNECTION=true
```

此模式下：

- 不需要配置飞书公网回调地址
- 本机只要能主动访问飞书开放平台（可出网）即可收事件
- 启动后由 SDK 建立 WebSocket 长连接接收 `im.message.receive_v1`

注意：

- 长连接与 webhook 是互斥模式（`FEISHU_LONG_CONNECTION=true` 时 `/feishu/callback` 不启用）
- 企业微信回调仍然需要公网可访问地址；若你只用飞书，可设置 `WECOM_ENABLED=false`

### 6. 配置企业微信回调

在企业微信应用后台填写：

- URL：`https://你的域名/wecom/callback`
- Token：和 `.env` 中的 `WEWORK_TOKEN` 一致
- EncodingAESKey：和 `.env` 中的 `WEWORK_ENCODING_AES_KEY` 一致

企业微信保存回调时会立即做一次验签和解密验证。只有通过后，机器人才能正常收发消息。

## 登录教程

第一次使用前，需要先完成 Codex 登录授权。

在企业微信里给机器人发送：

```text
/login
```

企业微信里，`/login` 仍然会直接返回设备码和授权提示。

飞书里，`/login` 现在会先返回一张登录方式卡片：

- `设备授权登录`：继续走原来的 device auth 流程
- `API URL / Key 登录`：填写表单后，直接写当前项目下的 `.codex/config.toml` 和 `.codex/auth.json`

API 登录模式会写入：

```toml
# .codex/config.toml
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

## 命令使用教程

### 会话管理

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
- `/rename`：给会话改名，方便后续识别

### Agent 管理

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
- `/agent create`：创建一个新的数字员工
- `/agent use`：切换到某个 agent
- `/agent init-memory`：初始化记忆型 agent
- `/skill-agent`：启动技能扩展助手 agent

### 模型与搜索

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

- 查看当前模型
- 切换模型
- 恢复默认模型
- 查看可用模型
- 控制联网搜索开关

### Skill 与执行能力

```text
/skills
/skills global
/skills agent
/review
/review base <分支>
/review commit <SHA>
/help
```

用途：

- 查看当前生效的 skill
- 查看全局 skill
- 查看当前 agent 自己的 skill
- 使用内置社媒调研 skill 做跨平台或单平台公开信息研究
- 在宿主机打开浏览器
- 审查当前工作区变更
- 审查相对某分支或某提交的改动
- 查看完整帮助

### 定时任务

定时任务不需要专门记命令，直接用自然语言描述即可。

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

只要对应的 `reminder-tool` skill 已安装，agent 就可以直接创建提醒任务并持续跟进。

## 典型使用场景

### 1. 把它当开发员工

你在企业微信里直接发：

```text
检查这个项目里登录流程哪里可能超时
```

系统会把消息转给 Codex，在本地工作区分析代码，再把结果回传。

### 2. 把它当多个员工

你可以创建多个 agent：

```text
/agent create 开发负责人
/agent create 文档助理
/agent create 运营执行
```

然后分别切换使用：

```text
/agent use 1
/agent use 2
/agent use 3
```

不同 agent 会保留各自上下文、工作区和记忆，不互相污染。

### 3. 把它当可扩展执行系统

通过 skill，你可以不断给 agent 增加新能力：

- 提醒和定时任务
- 联网搜索
- 浏览器打开和页面操作
- 调用你自己的脚本
- 接第三方平台工作流

这意味着它不只是“会回复”，而是可以逐步变成真正替你干活的系统。

## 常见问题

### `/login` 失败

先检查：

```bash
which codex
```

再确认：

- `.env` 中 `RUNNER_ENABLED=true`
- 机器网络正常
- `codex` CLI 本身可单独启动

如果你在飞书里走的是 `API URL / Key 登录`，再额外检查：

- 当前项目目录下的 `.codex/` 可写
- `base_url` 是合法的 `http/https` URL
- `api_key` 不为空

### 企业微信收不到回复

优先检查：

- 回调 URL 是否公网可访问
- `WEWORK_TOKEN` 是否与后台一致
- `WEWORK_ENCODING_AES_KEY` 是否与后台一致
- 服务日志里是否有签名失败或解密失败

### 命令执行超时

可以调大这些参数：

- `COMMAND_TIMEOUT_MIN_MS`
- `COMMAND_TIMEOUT_MAX_MS`
- `COMMAND_TIMEOUT_PER_CHAR_MS`

## 开发与测试

```bash
npm run build
npm test
```

## 项目协作文档

- 贡献指南：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 行为准则：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- 安全策略：[SECURITY.md](./SECURITY.md)

## 许可证

ISC，见 [LICENSE](./LICENSE)。
