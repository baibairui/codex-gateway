# Browser MCP Persistent Startup Design

**Date:** 2026-03-07

**Goal**

给 gateway 恢复一套稳定、最小、可落地的浏览器自动化能力，让 Codex 拿到真实的 Playwright MCP 工具，而不是只依赖 prompt 和 `browser-playbook.md`。

**Chosen Approach**

- 在 gateway 本地固定安装 `@playwright/mcp`。
- gateway 启动时拉起一个本地常驻 Playwright MCP。
- `CodexRunner` 在每次 `codex exec/review` 时只注入本地 Playwright MCP `url` 配置。
- 所有 agent 共享一个持久化 profile 目录，复用登录态。

**Why This Approach**

- 比纯 prompt/skill-first 稳定得多，因为浏览器工具真正进入了 Codex 运行时。
- 比“每次任务现起 MCP”更快，因为首个浏览器任务不再承担冷启动成本。
- 共享 profile 可以满足“全局共用单一浏览器状态”的目标。

**Non-Goals**

- 不做复杂守护进程、自动重启策略、健康面板。
- 不做浏览器任务并发调度。
- 不重构现有 `/open` 兜底能力。

**Architecture**

- Playwright MCP 默认启用；只有显式设置 `PLAYWRIGHT_MCP_ENABLED=false` 时才关闭。
- gateway 启动时解析本地运行时参数：
  - URL: 默认 `http://127.0.0.1:8931/mcp`
  - Profile: `.data/playwright/profile`
  - Artifacts: `.data/playwright/artifacts`
- 若未指定外部 `PLAYWRIGHT_MCP_URL`，gateway 会直接启动本地 `node_modules/@playwright/mcp/cli.js`，并等待本地端口 ready。
- `buildCodexArgs` / `buildCodexReviewArgs` 在启用时注入：
  - `mcp_servers.playwright.url="<local or external url>"`

**Data Directories**

- Profile: `.data/playwright/profile`
- Artifacts: `.data/playwright/artifacts`

二者分离，避免 profile 和输出目录混用。

**Risks**

- 冷启动成本被转移到了 gateway 启动阶段，服务启动会更重一点。
- 若本地未安装浏览器运行依赖，常驻 MCP 启动可能失败，需要 README 明确说明安装步骤。
- 共享单一 profile 不适合未来多任务并发浏览器自动化，但符合当前稳定优先目标。

**Verification**

- 单元测试覆盖 `buildCodexArgs` / `buildCodexReviewArgs` 的 Playwright 注入逻辑。
- `npm test`
- `npm run build`
