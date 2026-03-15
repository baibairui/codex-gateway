# Memory and Agent Workspace Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current `.data` memory and agent workspace layout with a simpler structure built around one user identity file, one agent identity file, and minimal agent workspaces, while automatically migrating legacy installs forward.

**Architecture:** Keep `AgentWorkspaceManager` as the single owner of workspace paths, scaffold templates, and repair behavior. Move global rules from `global-memory` to `runtime`, move normal workspaces under `users/<user>/agents`, move the steward under `users/<user>/internal/memory-steward`, collapse long-term memory into `user.md` and `SOUL.md`, and let skills own browser and Feishu operating rules instead of duplicating playbooks per workspace.

**Tech Stack:** Node.js, TypeScript, Vitest, filesystem migration logic, managed local skills.

---

### Task 1: Add failing tests for the new directory layout and minimal scaffold

**Files:**
- Modify: `tests/agent-workspace-manager.test.ts`
- Modify: `src/services/agent-workspace-manager.ts`

**Step 1: Write the failing test**

Add or rewrite tests so they expect:

- runtime rules are created in `.data/.../runtime/`, not `global-memory/`
- a user workspace contains `user.md`, `agents/`, and `internal/`
- a normal agent workspace is created at `users/<user>/agents/<agent-id>/`
- a normal agent workspace contains `AGENTS.md`, `README.md`, `SOUL.md`, `memory/daily/`, `.codex/skills/`, and `.codex/workspace.json`
- a normal agent workspace does not contain `agent.md`, `TOOLS.md`, `browser-playbook.md`, `feishu-ops-playbook.md`, or long-term `memory/*.md`
- the system steward workspace is created at `users/<user>/internal/memory-steward/`

Use the existing `creates workspace scaffold and global memory files` and `creates hidden system memory steward workspace` cases as the rewrite starting point.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: FAIL because the current scaffold still creates `global-memory`, top-level agent workspaces, and legacy prompt files.

**Step 3: Write minimal implementation**

In `src/services/agent-workspace-manager.ts`, introduce path helpers like:

```ts
private resolveRuntimeDir(): string {
  return path.join(this.rootDir, 'runtime');
}

private resolveUserIdentityPath(userDir: string): string {
  return path.join(userDir, 'user.md');
}

private resolveUserAgentsDir(userDir: string): string {
  return path.join(userDir, 'agents');
}
```

Update `createWorkspace`, `ensureDefaultWorkspace`, and `ensureSystemMemoryStewardWorkspace` to use the new paths and create only the new minimal file set.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: PASS for the new layout assertions.

**Step 5: Commit**

```bash
git add tests/agent-workspace-manager.test.ts src/services/agent-workspace-manager.ts
git commit -m "feat: simplify agent workspace layout"
```

### Task 2: Rewrite scaffold templates around `user.md`, `SOUL.md`, and skill-owned operating rules

**Files:**
- Modify: `src/services/agent-workspace-manager.ts`
- Modify: `tests/agent-workspace-manager.test.ts`

**Step 1: Write the failing test**

Add assertions that expect:

- `user.md` exists and contains a compact user identity template
- `SOUL.md` contains the current agent role, boundaries, and working style
- `AGENTS.md` references `./SOUL.md`, the user identity file, and runtime rules
- `AGENTS.md` routes browser work to `./.codex/skills/gateway-browser/SKILL.md`
- `AGENTS.md` routes Feishu work to `./.codex/skills/feishu-official-ops/SKILL.md`
- `AGENTS.md` does not inline browser or Feishu playbook text

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: FAIL because the current templates still reference `agent.md`, `TOOLS.md`, and playbook files.

**Step 3: Write minimal implementation**

Replace the legacy template writers with compact renderers such as:

```ts
function renderUserIdentity(): string {
  return [
    '# User Identity',
    '',
    '## Core Identity',
    '- Preferred name:',
    '- Primary role:',
    '- Language style:',
  ].join('\n');
}

function renderWorkspaceAgentsMd(...) {
  return [
    '# AGENTS.md',
    '',
    '开始任务前先读：',
    '- `./SOUL.md`',
    '- `../user.md`',
    '- `../../runtime/house-rules.md`',
  ].join('\n');
}
```

Delete generation of `agent.md`, `TOOLS.md`, `browser-playbook.md`, `feishu-ops-playbook.md`, and long-term `memory/*.md`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: PASS with the new minimal scaffold.

**Step 5: Commit**

```bash
git add src/services/agent-workspace-manager.ts tests/agent-workspace-manager.test.ts
git commit -m "refactor: collapse workspace prompt files"
```

### Task 3: Add migration and idempotent repair tests for legacy workspaces

**Files:**
- Modify: `tests/agent-workspace-manager.test.ts`
- Modify: `src/services/agent-workspace-manager.ts`

**Step 1: Write the failing test**

Add explicit migration cases for:

- a legacy user directory with `shared-memory/identity.md`, `profile.md`, `preferences.md`, `projects.md`, `relationships.md`, `decisions.md`, and `open-loops.md`
- a legacy agent workspace containing `agent.md`, `SOUL.md`, `TOOLS.md`, `browser-playbook.md`, `feishu-ops-playbook.md`, and `memory/identity.md`
- a legacy steward workspace at `_memory-steward`

Assert that after `repairWorkspaceScaffold(...)` and `repairUserSharedMemoryTree(...)`:

- `user.md` exists and contains merged sections from the legacy memory files
- `SOUL.md` contains merged content from `agent.md` and `memory/identity.md`
- the workspace lives under `agents/<agent-id>/`
- the steward lives under `internal/memory-steward/`
- obsolete files are deleted or moved into `_legacy/`
- a second repair run does not change the resulting structure

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: FAIL because repair currently only reinstalls files and does not migrate layout or merge content.

**Step 3: Write minimal implementation**

Add migration helpers in `src/services/agent-workspace-manager.ts` such as:

```ts
private migrateLegacyUserMemory(userDir: string): void { /* merge into user.md */ }
private migrateLegacyAgentWorkspace(workspaceDir: string): string { /* move under agents/ */ }
private migrateLegacyStewardWorkspace(userDir: string): string { /* move into internal/ */ }
```

Rules:

- merge old long-term memory into `user.md`
- merge `agent.md` and `memory/identity.md` into `SOUL.md`
- archive old user memory files under `shared-memory/_legacy/`
- remove old playbook files after the new scaffold is installed
- make every migration step safe to run twice

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: PASS for both fresh scaffold and legacy migration cases.

**Step 5: Commit**

```bash
git add src/services/agent-workspace-manager.ts tests/agent-workspace-manager.test.ts
git commit -m "feat: migrate legacy agent workspaces"
```

### Task 4: Refactor the memory steward to the new identity model

**Files:**
- Modify: `src/services/memory-steward.ts`
- Modify: `tests/memory-steward.test.ts`
- Modify: `src/services/agent-workspace-manager.ts`

**Step 1: Write the failing test**

Rewrite steward tests so they expect:

- steward workdir is `users/<user>/internal/memory-steward`
- the steward prompt references `user.md`, sibling `SOUL.md`, and `memory/daily/`
- the steward prompt does not mention `profile.md`, `preferences.md`, `projects.md`, `relationships.md`, `decisions.md`, or `open-loops.md`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/memory-steward.test.ts`
Expected: FAIL because the current steward still targets `shared-memory` and the old memory file set.

**Step 3: Write minimal implementation**

Update `buildStewardPrompt(...)` to follow the new model:

```ts
return [
  `你正在为用户 ${userId} 执行系统级身份整理任务。`,
  `user identity: ${userIdentityPath}`,
  '检查各 agent 的 `SOUL.md` 与 `memory/daily/`。',
  '只把跨会话稳定的信息整理进 `user.md`。',
].join('\n');
```

Update the steward workspace record if needed so callers can locate `user.md` directly instead of depending on `sharedMemoryDir`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/memory-steward.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/memory-steward.ts tests/memory-steward.test.ts src/services/agent-workspace-manager.ts
git commit -m "refactor: simplify memory steward identity flow"
```

### Task 5: Update workspace discovery and repair scripts to the new hierarchy

**Files:**
- Modify: `src/server.ts`
- Modify: `src/scripts/repair-users.ts`
- Modify: `tests/deploy-scripts.test.ts`
- Modify: `tests/agent-workspace-manager.test.ts`

**Step 1: Write the failing test**

Add coverage for:

- `syncBuiltInSkills(...)` traversing `users/<user>/agents/*`
- ignoring `users/<user>/internal/*`
- `repair-users.ts` repairing/migrating both user-level identity and agent workspaces in the new hierarchy

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/deploy-scripts.test.ts tests/agent-workspace-manager.test.ts`
Expected: FAIL because both code paths still scan direct children under the user root and special-case `shared-memory` / `_memory-steward`.

**Step 3: Write minimal implementation**

Update traversal from:

```ts
for (const workspaceName of fs.readdirSync(userDir)) {
  if (workspaceName === 'shared-memory' || workspaceName === '_memory-steward') continue;
}
```

to:

```ts
const agentsDir = path.join(userDir, 'agents');
for (const workspaceName of fs.readdirSync(agentsDir)) {
  // install and repair only agent workspaces
}
```

Keep a compatibility pre-pass that migrates legacy direct-child workspaces before the new traversal runs.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/deploy-scripts.test.ts tests/agent-workspace-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server.ts src/scripts/repair-users.ts tests/deploy-scripts.test.ts tests/agent-workspace-manager.test.ts
git commit -m "refactor: traverse new user workspace hierarchy"
```

### Task 6: Update chat-facing memory summaries and sanitization to the new terminology

**Files:**
- Modify: `src/services/chat-handler.ts`
- Modify: `tests/chat-handler.test.ts`
- Modify: `src/features/user-command.ts`

**Step 1: Write the failing test**

Add or rewrite tests so they expect:

- onboarding suggestions mention user identity and current agent identity, not `shared-memory`
- sanitized text removes `user.md`, `SOUL.md`, and other internal path details
- `/memory` help text describes the new model
- memory summaries describe user identity and agent identity instead of the old multi-file breakdown

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chat-handler.test.ts tests/user-command.test.ts`
Expected: FAIL because current copy still references `shared-memory`, `agent.md`, and old memory files.

**Step 3: Write minimal implementation**

Update helper text like:

```ts
return [
  '检测到用户身份尚未初始化。',
  '检测到当前 agent 身份尚未初始化。',
].join('\n');
```

Update sanitization rules to strip the new path terms and stop exposing legacy file names in user-visible text.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/chat-handler.test.ts tests/user-command.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/chat-handler.ts tests/chat-handler.test.ts src/features/user-command.ts
git commit -m "refactor: update memory terminology in chat flow"
```

### Task 7: Remove playbook references from managed skills and workspace bootstrap

**Files:**
- Modify: `src/services/feishu-official-ops-skill.ts`
- Modify: `src/services/gateway-browser-skill.ts`
- Modify: `src/services/gateway-desktop-skill.ts`
- Modify: `tests/feishu-official-ops-skill.test.ts`
- Modify: `tests/gateway-browser-skill.test.ts`
- Modify: `tests/gateway-desktop-skill.test.ts`

**Step 1: Write the failing test**

Add assertions that expect:

- no skill text points agents back to `./browser-playbook.md` or `./feishu-ops-playbook.md`
- managed skills remain self-sufficient and contain the needed operating rules
- workspace bootstrap tests no longer expect playbook file generation

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-official-ops-skill.test.ts tests/gateway-browser-skill.test.ts tests/gateway-desktop-skill.test.ts`
Expected: FAIL because some skill guidance still points to workspace-local playbooks.

**Step 3: Write minimal implementation**

Update the generated skill docs so capability-specific rules live entirely in the skill package. Remove any residual references to deleted workspace playbooks.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/feishu-official-ops-skill.test.ts tests/gateway-browser-skill.test.ts tests/gateway-desktop-skill.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/feishu-official-ops-skill.ts src/services/gateway-browser-skill.ts src/services/gateway-desktop-skill.ts tests/feishu-official-ops-skill.test.ts tests/gateway-browser-skill.test.ts tests/gateway-desktop-skill.test.ts
git commit -m "refactor: move playbook guidance into managed skills"
```

### Task 8: Run focused verification and refresh docs

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-03-15-memory-agent-layout-design.md` if implementation drift needs a design note

**Step 1: Write the failing doc/test expectation**

List the exact places that must reflect the new model:

- README sections describing agent workspaces and memory
- any examples that still mention `global-memory`, `shared-memory`, or old top-level workspace files

**Step 2: Run verification before editing docs**

Run:

```bash
npm test -- tests/agent-workspace-manager.test.ts tests/memory-steward.test.ts tests/chat-handler.test.ts tests/deploy-scripts.test.ts tests/feishu-official-ops-skill.test.ts tests/gateway-browser-skill.test.ts tests/gateway-desktop-skill.test.ts
```

Expected: PASS for all focused suites before the docs are finalized.

**Step 3: Write minimal documentation updates**

Update README examples and terminology so they match:

- `runtime/`
- `user.md`
- `agents/<agent-id>/SOUL.md`
- `agents/<agent-id>/memory/daily/`
- `internal/memory-steward/`

Keep the docs high-level; do not re-document every migration detail already captured in the design doc.

**Step 4: Run verification again**

Run:

```bash
npm test -- tests/agent-workspace-manager.test.ts tests/memory-steward.test.ts tests/chat-handler.test.ts tests/deploy-scripts.test.ts tests/feishu-official-ops-skill.test.ts tests/gateway-browser-skill.test.ts tests/gateway-desktop-skill.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add README.md docs/plans/2026-03-15-memory-agent-layout-design.md
git commit -m "docs: refresh workspace and memory model"
```
