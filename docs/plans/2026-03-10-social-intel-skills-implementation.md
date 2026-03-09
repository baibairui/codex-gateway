# Social Intel Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add built-in social media research and Feishu document writing skills so new agent workspaces can collect public social signals and turn them into Feishu documents using existing gateway capabilities.

**Architecture:** Implement the new skills as agent-local workspace assets, not new runtime services. Reuse the existing install pattern from `gateway-browser`, keep platform-specific research logic in separate skill directories, and wire workspace bootstrap plus tests so every new agent gets the skills automatically.

**Tech Stack:** Node.js ESM, Vitest, filesystem-based skill installation

---

### Task 1: Lock the expected skill inventory with failing tests

**Files:**
- Modify: `tests/agent-workspace-manager.test.ts`
- Modify: `tests/gateway-browser-skill.test.ts`

**Step 1: Write the failing test**

Add assertions that a fresh workspace includes:
- `social-intel`
- `social-doc-writer`
- `x-research`
- `xiaohongshu-research`
- `douyin-research`
- `bilibili-research`
- `wechat-article-research`

Add assertions that key `SKILL.md` files contain their expected `name:` frontmatter and core workflow phrases.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-workspace-manager.test.ts tests/gateway-browser-skill.test.ts`
Expected: FAIL because none of the new skills exist or install yet.

**Step 3: Write minimal implementation**

Create placeholder install/render helpers or static asset copies so those directories appear in the workspace skill root.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-workspace-manager.test.ts tests/gateway-browser-skill.test.ts`
Expected: PASS

### Task 2: Add a reusable installer for the social intelligence skills

**Files:**
- Create: `src/services/social-intel-skill.ts`
- Modify: `src/services/agent-workspace-manager.ts`

**Step 1: Write the failing test**

Add tests that require:
- `installSocialIntelSkills(workspaceDir)` to create all seven skill directories under `workspace/.codex/skills`
- repeated installation to be idempotent
- the installer to patch `AGENTS.md` with a managed “社媒调研职责” section if the file exists

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: FAIL because the installer and managed section do not exist.

**Step 3: Write minimal implementation**

Implement:
- exported skill name constants
- render helpers for the seven `SKILL.md` files
- optional `agents/openai.yaml` generation for implicit invocation
- AGENTS rule upsert logic
- workspace bootstrap call inside `createWorkspace(...)`
- repair path support in `repairWorkspaceScaffold(...)` if needed by existing scaffold repair flow

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: PASS

### Task 3: Write the actual skill content for cross-platform orchestration

**Files:**
- Modify: `src/services/social-intel-skill.ts`

**Step 1: Write the failing test**

Add tests that require `social-intel` and `social-doc-writer` content to mention:
- public-page-only / no private data assumptions
- evidence-first workflow
- required result fields
- reuse of `gateway-browser`
- reuse of `feishu-official-ops`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: FAIL because placeholder content is incomplete.

**Step 3: Write minimal implementation**

Render concise but specific `SKILL.md` content for:
- `social-intel`
- `social-doc-writer`

Make the docs clearly separate:
- when to use
- what tool to invoke
- failure modes
- output expectations

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: PASS

### Task 4: Add the five platform-specific research skills

**Files:**
- Modify: `src/services/social-intel-skill.ts`
- Modify: `tests/agent-workspace-manager.test.ts`

**Step 1: Write the failing test**

Add assertions that each platform skill includes platform-specific instructions:
- `x-research`: post/account/search terminology
- `xiaohongshu-research`: 笔记/作者主页
- `douyin-research`: 视频/账号页
- `bilibili-research`: 视频/UP 主
- `wechat-article-research`: 公众号文章链接与正文提取

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: FAIL because the platform-specific guidance is missing.

**Step 3: Write minimal implementation**

Implement render helpers for each platform skill with:
- trigger conditions
- search/extract workflow
- evidence requirements
- ambiguity and login boundary rules

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: PASS

### Task 5: Surface the new capabilities in workspace bootstrap docs

**Files:**
- Modify: `src/services/agent-workspace-manager.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

Add assertions that workspace bootstrap docs mention the new skills in:
- `TOOLS.md`
- generated `AGENTS.md`

If there are no existing snapshot-style tests for README, add focused string assertions where practical; otherwise verify manually in the final verification step.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: FAIL because bootstrap docs do not mention the new skills.

**Step 3: Write minimal implementation**

Update workspace bootstrap text so agents are told:
- use `social-intel` for cross-platform public research
- use platform skills for single-platform deep dives
- use `social-doc-writer` for Feishu write-back

Update README capability sections to reflect the new built-in skills.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/agent-workspace-manager.test.ts`
Expected: PASS

### Task 6: Run focused verification and full build

**Files:**
- Test: `tests/agent-workspace-manager.test.ts`
- Test: `tests/gateway-browser-skill.test.ts`

**Step 1: Run focused tests**

Run: `npm test -- tests/agent-workspace-manager.test.ts tests/gateway-browser-skill.test.ts`
Expected: PASS

**Step 2: Run build verification**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add docs/plans/2026-03-10-social-intel-skills-design.md docs/plans/2026-03-10-social-intel-skills-implementation.md src/services/social-intel-skill.ts src/services/agent-workspace-manager.ts README.md tests/agent-workspace-manager.test.ts tests/gateway-browser-skill.test.ts
git commit -m "feat: add social intelligence workspace skills"
```
