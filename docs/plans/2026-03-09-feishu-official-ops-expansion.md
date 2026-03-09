# Feishu Official Ops Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand `feishu-official-ops` into a grouped Feishu OpenAPI CLI that adds high-value `im`, `doc`, `bitable`, `calendar`, and `task` commands without regressing existing `docx/wiki` behavior.

**Architecture:** Keep the current single-entry script but split new work into shared auth/client helpers, domain-specific command handlers, and stable output normalizers. Preserve existing `docx/wiki` raw-fetch flows, while new command groups use `@larksuiteoapi/node-sdk` behind a small wrapper so tests can inject fake clients.

**Tech Stack:** Node.js ESM, `@larksuiteoapi/node-sdk`, Vitest

---

### Task 1: Lock the new CLI surface with failing tests

**Files:**
- Modify: `tests/feishu-openapi-cli.test.ts`

**Step 1: Write the failing test**

Add tests that require:
- `printHelp()` output to mention the new `im/doc/bitable/calendar/task` commands
- `parseArgs()` and helper-level parsing to support:
  - JSON filter/sort payloads for bitable and task update
  - `--doc-token` / `--document` style locators
  - calendar time range arguments

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: FAIL because the help output and new helpers do not exist yet.

**Step 3: Write minimal implementation**

Update `./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs` with:
- exported help text builder
- exported JSON/time parsing helpers
- placeholder routing for new command groups

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: PASS

### Task 2: Add shared client/auth and IM + Doc read handlers

**Files:**
- Modify: `./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs`
- Modify: `tests/feishu-openapi-cli.test.ts`

**Step 1: Write the failing test**

Add tests that require:
- `im get-message` to map `message_id` lookup results into stable JSON
- `im list-messages` to preserve `items / has_more / page_token`
- `im search-messages` to return matched message ids
- `doc get-content` to read markdown content via `docs.v1.content.get`
- `doc get-raw-content` to read plain text via `docx.document.rawContent`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: FAIL because there is no SDK-backed client path or domain handlers.

**Step 3: Write minimal implementation**

Implement:
- `createFeishuSdkClient(...)`
- `resolveFeishuSdkDeps(...)`
- `handleImCommand(...)`
- `handleDocCommand(...)`
- stable normalizers for IM and Doc outputs

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: PASS

### Task 3: Add Bitable and Calendar handlers

**Files:**
- Modify: `./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs`
- Modify: `tests/feishu-openapi-cli.test.ts`

**Step 1: Write the failing test**

Add tests that require:
- `bitable list-tables`
- `bitable list-records`
- `bitable search-records`
- `calendar list-calendars`
- `calendar list-events`
- `calendar freebusy`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: FAIL because those command handlers and output normalizers do not exist.

**Step 3: Write minimal implementation**

Implement:
- `handleBitableCommand(...)`
- `handleCalendarCommand(...)`
- JSON payload parsing for bitable search filters and sort definitions
- time-range argument resolution for calendar queries

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: PASS

### Task 4: Add Task handlers and unified error shaping

**Files:**
- Modify: `./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs`
- Modify: `tests/feishu-openapi-cli.test.ts`

**Step 1: Write the failing test**

Add tests that require:
- `task create`
- `task list`
- `task get`
- `task update`
- `task create-subtask`
- error shaping to classify permission and auth failures

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: FAIL because task handlers and unified error formatting are missing.

**Step 3: Write minimal implementation**

Implement:
- `handleTaskCommand(...)`
- update-field parsing for task patch requests
- `normalizeFeishuApiError(...)`
- a top-level JSON error response path that preserves `operation`

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: PASS

### Task 5: Refresh skill docs and verify regression set

**Files:**
- Modify: `./.codex/skills/feishu-official-ops/SKILL.md`
- Modify: `README.md`
- Test: `tests/feishu-openapi-cli.test.ts`

**Step 1: Write the failing test**

Add assertions that the help text includes the new command groups and that existing docx helpers still behave as before.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: FAIL if docs/help text are stale or old helpers regressed.

**Step 3: Write minimal implementation**

Update:
- skill usage examples to include the new grouped commands
- README Feishu capability section to describe the expanded official ops surface

**Step 4: Run focused verification**

Run: `npm test -- tests/feishu-openapi-cli.test.ts`
Expected: PASS

**Step 5: Run build verification**

Run: `npm run build`
Expected: PASS
