# Browser MCP Persistent Startup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove first browser-task cold start by launching one local Playwright MCP server when the gateway starts and wiring Codex to its local URL.

**Architecture:** Keep the implementation minimal. Start a single local `@playwright/mcp` process at gateway boot, wait for the local port to become reachable, and inject `mcp_servers.playwright.url` into every Codex run/review. Reuse one shared browser profile and one artifact directory for all agents.

**Tech Stack:** TypeScript, Vitest, Node.js child process management, local `@playwright/mcp`

---

### Task 1: Replace runner tests with URL-based expectations

**Files:**
- Modify: `tests/codex-runner.test.ts`

**Step 1: Write the failing test**

Replace the stdio MCP expectations with URL injection expectations for both `buildCodexArgs` and `buildCodexReviewArgs`.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/codex-runner.test.ts`
Expected: FAIL because the runner still injects stdio command/args config.

**Step 3: Write minimal implementation**

Update `src/services/codex-runner.ts` to accept a Playwright MCP URL and inject `mcp_servers.playwright.url`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/codex-runner.test.ts`
Expected: PASS

### Task 2: Add persistent local MCP startup

**Files:**
- Create: `src/services/playwright-mcp-server.ts`
- Test: `tests/playwright-mcp-server.test.ts`
- Modify: `src/server.ts`
- Modify: `src/config.ts`

**Step 1: Write the failing test**

Add unit tests for resolving the local MCP URL and CLI args from default/shared directories.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/playwright-mcp-server.test.ts`
Expected: FAIL because the service file does not exist yet.

**Step 3: Write minimal implementation**

- Add helper functions to derive the local URL and CLI args
- Start one child process with host/port at server boot when no external URL override is provided
- Wait for the local port to be reachable before considering startup complete
- Pass the resolved URL into `CodexRunner`

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/playwright-mcp-server.test.ts`
Run: `npm run build`
Expected: PASS

### Task 3: Update docs and config defaults

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

**Step 1: Update docs**

Document:
- browser MCP now starts with the gateway by default
- optional port/profile/output/url overrides
- first browser interaction is pre-warmed at service startup instead of first task time

**Step 2: Verify**

Run: `npm test`
Run: `npm run build`
Expected: PASS
