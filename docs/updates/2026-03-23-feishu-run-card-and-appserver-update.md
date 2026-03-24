# 2026-03-23 更新说明

## 本次更新包含什么

这次更新主要集中在 Feishu 运行卡片体验、Codex 运行链路和停止任务能力上。

包含以下 4 组改动：

1. Feishu 运行卡片刷新
2. Feishu 卡片更新接口修正
3. Codex 运行链路切换到 App-Server
4. 停止任务链路修复

## 1. Feishu 运行卡片刷新

运行卡片整体改成更轻的产品型风格。

当前状态文案：

- 运行中：`处理中`
- 停止中：`正在停止`
- 已停止：`已停止`
- 已完成：`已完成`
- 停止失败：`停止未完成`

交互规则：

- 运行中只保留一个主按钮：`结束`
- 已完成 / 已停止 / 停止失败状态不再显示按钮

文案方向：

- 运行中摘要：`正在为你处理当前请求`
- 已完成摘要：`当前任务已处理完成`
- 已停止摘要：`当前任务已停止`
- 停止中摘要：`正在结束当前任务`

## 2. Feishu 卡片更新接口修正

之前运行卡片更新使用了错误的消息更新路径，线上会命中 `230001 invalid msg_type`。

这次修正后：

- `text` / `post` 继续走普通消息更新
- `interactive` 卡片改走官方卡片更新接口
- 卡片显式启用 `update_multi`

结果是：

- 运行卡可以原地更新状态
- 不再依赖撤回重发兜底
- 不再误报“本次回复中断了”

## 3. Codex 运行链路切换到 App-Server

原来的主链路是：

- `gateway -> spawn codex exec --json -> 读取 stdout JSONL`

现在主链路改成：

- `gateway -> codex app-server -> thread / turn 协议事件`

带来的变化：

- 能拿到更明确的线程和 turn 级状态
- stop 不再只依赖外层进程信号
- 后续扩展中断、状态同步、任务控制会更稳

当前保守策略：

- 普通 Codex 请求默认走 App-Server
- 带 `search=true` 的请求暂时保留旧链路，避免静默回归

## 4. 停止任务链路修复

这次把“看起来停了，但实际任务还继续跑”的几个关键点都补上了。

修复内容：

- stop 请求不再排队到当前任务后面执行
- stop 后即使子进程最终 `close(0)`，也不会再被误判成完成
- App-Server 模式下优先使用 Codex 官方 `turn/interrupt`
- 增量消息只在完成时输出最终结果，不再重复吐半截内容

现在预期行为：

- 运行中点击 `结束`
- 当前任务应进入 `正在停止`
- 最终卡片落到 `已停止`
- 不再继续回剩余正文

## 涉及的主要文件

- `src/services/chat-handler.ts`
- `src/services/codex-runner.ts`
- `src/services/codex-app-server-client.ts`
- `src/services/active-run-manager.ts`
- `src/services/feishu-api.ts`
- `src/services/feishu-command-cards.ts`
- `src/server.ts`
- `src/utils/feishu-outgoing.ts`

测试文件：

- `tests/chat-handler.test.ts`
- `tests/codex-runner.test.ts`
- `tests/feishu-api.test.ts`
- `tests/active-run-manager.test.ts`
- `tests/user-command.test.ts`

## 实际验证

本次改动实际跑过的验证包括：

- `node /usr/lib/node_modules/npm/bin/npm-cli.js exec -- vitest run tests/chat-handler.test.ts -t "renders a feishu run card with stop button while running|patches the same feishu run card to stopped after stop|does not append interruption warning after visible feishu output|does not send a not-running warning when stop arrives after a completed feishu run"`
- `node /usr/lib/node_modules/npm/bin/npm-cli.js exec -- vitest run tests/codex-runner.test.ts -t "emits the final app-server agent message once after deltas are aggregated|interrupts the active turn through app-server and rejects the run"`
- `node /usr/lib/node_modules/npm/bin/npm-cli.js exec -- vitest run tests/chat-handler.test.ts tests/feishu-api.test.ts -t "renders a feishu run card with stop button while running|patches the same feishu run card to stopped after stop|does not append interruption warning after visible feishu output|does not send a not-running warning when stop arrives after a completed feishu run|patches interactive messages using template shorthand without msg_type"`
- `node ./node_modules/typescript/bin/tsc --noEmit`
- `node ./node_modules/typescript/bin/tsc -p tsconfig.json`

线上实际验证：

- `pm2 restart gateway-b`
- `pm2 describe gateway-b`
- 真实 Feishu 场景下验证：
  - 运行卡可以正常更新
  - stop 后不再误报
  - stop 可以真正中断当前 turn
  - 不再重复回复 delta 内容

## 备注

这次变更同时包含运行链路升级和交互体验刷新，属于同一条 Feishu 运行态能力的连续修复，不建议拆成多个零散 PR。

## 2026-03-24 补充修复

在 App-Server 链路切换后，又补了一组会话恢复保护，针对的是历史脏数据导致的非法 `threadId` 问题。

### 现象

部分旧会话里会存下非法的 `threadId`，例如：

- `"<编号|threadId>"`

这类值在旧链路里不一定马上暴露，但在 App-Server 恢复线程时会直接失败，典型报错是：

- `invalid thread id`

表现上会看到：

- 进程在线
- 飞书消息能收到
- 但一进入当前会话恢复，就直接失败并回错误卡

### 这次补了什么

1. 会话恢复保护

- 读取当前 session 时，不再直接信任持久化的 `threadId`
- 如果值明显非法，会先清掉这条 session
- 然后自动降级为新会话继续处理

2. `/switch` 输入保护

- `/switch <编号|threadId>` 这类占位符文本，不再允许写回 session
- 会直接提示用户使用 `/sessions` 中的编号或真实 `threadId`

### 修复结果

- 非法历史 `threadId` 不再导致整次消息失败
- 旧脏 session 会在恢复前被自动清理
- `/switch` 不再继续制造同类脏数据

### 本次涉及文件

- `src/services/chat-handler.ts`
- `tests/chat-handler.test.ts`

### 本次实际验证

- `node /usr/lib/node_modules/npm/bin/npm-cli.js exec -- vitest run tests/chat-handler.test.ts -t "drops an invalid persisted thread id and starts a fresh session instead of failing|rejects placeholder switch targets instead of persisting them as sessions"`
- `node /usr/lib/node_modules/npm/bin/npm-cli.js exec -- vitest run tests/chat-handler.test.ts -t "drops an invalid persisted thread id and starts a fresh session instead of failing|rejects placeholder switch targets instead of persisting them as sessions|renders a feishu run card with stop button while running|patches the same feishu run card to stopped after stop|does not append interruption warning after visible feishu output|does not send a not-running warning when stop arrives after a completed feishu run"`
- `node ./node_modules/typescript/bin/tsc --noEmit`

线上实际验证：

- `node ./node_modules/typescript/bin/tsc -p tsconfig.json`
- `pm2 restart gateway-b`
- `pm2 describe gateway-b`

结果：

- `gateway-b` 保持 `online`
- 旧非法 session 会自动清理
- 同类非法 `threadId` 不再导致恢复失败
