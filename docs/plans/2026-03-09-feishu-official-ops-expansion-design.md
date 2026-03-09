# Feishu Official Ops Expansion Design

## Goal

把现有 `feishu-official-ops` 从 `docx/wiki` 定向脚本扩成一个分组清晰、返回稳定、适合 agent 调用的飞书官方操作 CLI，优先补齐高价值的 `im`、`doc`、`bitable`、`calendar`、`task` 能力。

## Scope

- 保留现有 `docx/wiki` 命令、参数和返回结构，避免破坏已落地能力。
- 在同一个 CLI 入口下新增能力组：
  - `im get-message`
  - `im list-messages`
  - `im search-messages`
  - `doc get-content`
  - `doc get-raw-content`
  - `bitable list-tables`
  - `bitable list-records`
  - `bitable search-records`
  - `calendar list-calendars`
  - `calendar list-events`
  - `calendar freebusy`
  - `task create`
  - `task list`
  - `task get`
  - `task update`
  - `task create-subtask`
- 统一分页、时间范围、错误格式和 JSON 输出风格。

## Recommended Approach

采用“能力包式扩展，统一 CLI 契约”的方案：

1. 保持单入口 `feishu-openapi.mjs`，继续使用 `resource action` 的命令形态。
2. 引入共享的 SDK client 构建与鉴权入口，让新增域复用同一套 `tenant_access_token` 和 `@larksuiteoapi/node-sdk` 客户端。
3. 每个业务域单独实现 handler，避免把 `im/docs/bitable/calendar/task` 的参数和分页逻辑混在一起。
4. 所有命令输出标准 JSON，顶层统一包含 `ok`、`operation`，成功结果再按域补充 `items/task/document/...`。
5. 对参数错误、权限错误、资源不存在、限流错误做统一错误分类，让 agent 能稳定决定下一步动作。

## Architecture

脚本内部拆成四层：

1. `main + help`
   - 负责命令路由、帮助文案和顶层异常出口。
2. `auth/client`
   - 负责 `tenant_access_token` 获取、SDK client 构建和共享请求配置。
3. `domain handlers`
   - `handleImCommand`
   - `handleDocCommand`
   - `handleBitableCommand`
   - `handleCalendarCommand`
   - `handleTaskCommand`
4. `normalizers`
   - 负责把 SDK 原始响应整理成稳定输出，并附加统一元数据。

`docx/wiki` 现有 raw fetch 流程先保留；新增域优先走官方 SDK，避免为每个接口重复手写 HTTP path。

## Command Contract

新命令遵循以下约定：

- 参数名尽量与飞书原始语义对齐，但统一成 CLI 可读形式，例如 `--calendar-id`、`--table-id`、`--page-size`、`--page-token`。
- 时间参数统一接受字符串原样透传，但在本地做必填和空串校验。
- 成功返回统一包含：
  - `ok: true`
  - `operation`
  - 关键资源标识，如 `calendar_id`、`table_id`、`task_id`
  - 数据体，如 `items`、`task`、`document`
  - 分页字段，如 `has_more`、`page_token`
- 失败返回统一包含：
  - `ok: false`
  - `operation`
  - `error.type`
  - `error.code`
  - `error.message`

## Auth Boundary

首轮扩展仍以应用身份和 `tenant_access_token` 为主，避免把 token 体系一次扩散到整套 CLI。设计上保留后续扩展 `user_access_token` 的接口，但本轮不把它作为前置目标。

对可能受身份限制的命令，帮助文案和错误输出必须明确说明：

- 当前命令使用的是应用身份
- 某些接口需要应用具备对应 OpenAPI scope
- 某些资源在当前身份下可能只返回应用可见范围

## Error Handling

统一三类本地错误：

- 参数缺失，例如 `missing --task-id`
- 参数非法，例如 `invalid --filter-json`
- 组合冲突，例如同时传了不兼容参数

统一四类远端错误：

- `auth_error`
- `permission_denied`
- `not_found`
- `rate_limited`

其余错误归并到 `api_error`，保留真实飞书错误码和消息。

## Testing Strategy

测试分三层：

1. 纯 helper 测试
   - locator 解析
   - JSON 参数解析
   - 错误分类
2. domain handler 测试
   - mock SDK client
   - 校验参数映射和返回整形
3. 回归测试
   - 现有 `docx/wiki` 相关测试继续通过
   - 新 help 文案包含新增命令

首轮不做真正联网集成测试，避免把环境依赖绑进单测。

## Non-Goals

- 不在本轮把所有 Feishu OpenAPI 全量暴露出来。
- 不在本轮引入 `user_access_token` 登录流。
- 不改造 gateway 运行时消息处理链路；这次只扩 `feishu-official-ops`。
- 不重写现有 `docx/wiki` 成 SDK 版本，除非为共享基础设施必须做最小调整。
