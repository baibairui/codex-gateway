# Memory and Agent Workspace Layout Design

**Date:** 2026-03-15

**Goal:** Simplify the runtime workspace layout under `.data`, reduce duplicated prompt files inside each agent workspace, and collapse long-term memory into one user identity file plus one agent identity file.

## Scope

This design changes both:

- the on-disk runtime layout generated under `.data`
- the scaffold and repair logic that creates and migrates those directories

In scope:

- user directory layout under `.data`
- default agent workspace scaffold
- system memory steward workspace location and role
- long-term memory model
- migration and repair rules for legacy workspaces
- user-facing copy that still exposes old file names or directory names

Out of scope:

- changing the skill registry model itself
- changing the browser or Feishu execution protocol
- introducing a structured config-first workspace format

## Current Problems

The current layout mixes three different concerns in the same user directory:

- user-shared memory: `shared-memory/`
- normal agent workspaces: `<agent-id>/`
- system-only workspace: `_memory-steward/`

Inside a single agent workspace there are too many top-level prompt files:

- `AGENTS.md`
- `agent.md`
- `SOUL.md`
- `TOOLS.md`
- `browser-playbook.md`
- `feishu-ops-playbook.md`
- `memory/*.md` long-term files

This creates three concrete issues:

1. the top-level workspace entry points are noisy and overlapping
2. browser and Feishu operating rules are copied into every workspace instead of living in the skill that owns them
3. long-term memory is over-split into many files, even though the important distinction is really user identity versus agent identity

## Decision

### 1. Runtime root naming

Rename `global-memory/` to `runtime/`.

Reason:

- it contains global rules and shared context, not user memory
- the old name conflicts with `shared-memory/` and makes the system harder to explain

`runtime/` will contain:

- `house-rules.md`
- `shared-context.md`

### 2. User directory layout

Each user directory under `.data/users/` will become:

```text
users/<user-slug-hash>/
  user.md
  agents/
    default/
    <agent-id>/
  internal/
    memory-steward/
```

Reason:

- `user.md` becomes the single long-term user identity entry point
- `agents/` clearly separates normal workspaces from user-level files
- `internal/` makes it obvious that `memory-steward` is not another user-facing agent

### 3. Minimal agent workspace layout

Each agent workspace will become:

```text
agents/<agent-id>/
  AGENTS.md
  README.md
  SOUL.md
  memory/
    daily/
  .codex/
    workspace.json
    agent-skill-policy.json
    skills/
```

Reason:

- `AGENTS.md` stays as the main runtime prompt entry point
- `SOUL.md` stays as the single agent identity file
- `memory/` is reduced to short-term storage only
- operation rules move back into the skills that own them

### 4. Long-term memory model

Long-term memory is reduced to two identity artifacts:

- `users/<user>/user.md`
- `users/<user>/agents/<agent>/SOUL.md`

Meaning:

- `user.md` stores the stable user identity shared across agents
- `SOUL.md` stores the stable role, style, scope, and boundaries of the current agent
- `memory/daily/` stores short-term notes and temporary context only

The previous long-term files:

- `profile.md`
- `preferences.md`
- `projects.md`
- `relationships.md`
- `decisions.md`
- `open-loops.md`

will no longer exist as primary files.

### 5. Skill-owned operating rules

These workspace-local files will be removed:

- `TOOLS.md`
- `browser-playbook.md`
- `feishu-ops-playbook.md`
- `agent.md`

Rules move as follows:

- browser operating rules live in the `gateway-browser` skill
- Feishu operating rules live in the `feishu-official-ops` skill
- agent identity and working style live in `SOUL.md`
- any remaining workspace routing rules live in `AGENTS.md`

Reason:

- browser and Feishu playbooks are capability-specific and should evolve with the skill, not with each workspace copy
- `agent.md` and `SOUL.md` overlap heavily; `SOUL.md` is the better long-term identity artifact

### 6. Internal memory steward

The hidden `_memory-steward` workspace is kept, but moved to:

```text
users/<user>/internal/memory-steward/
```

It remains a system-only agent workspace used to:

- inspect `user.md`
- inspect sibling agents' `SOUL.md`
- inspect sibling agents' `memory/daily/`
- fold stable items into `user.md`
- write sensitive or uncertain items into `steward-log.md`

It is not a memory store itself.

## File Responsibilities

### `user.md`

Contains only stable, cross-agent, long-lived user identity information such as:

- preferred name
- role or background
- language style
- communication preferences
- durable principles or recurring preferences

It should not become a generic dumping ground for transient project notes.

### `SOUL.md`

Contains only stable agent identity information such as:

- agent name and ID
- role
- primary goals
- boundaries
- working style
- success criteria

It replaces both `agent.md` and `memory/identity.md` as the agent-facing long-term identity source.

### `memory/daily/`

Contains short-lived notes such as:

- today's context
- temporary discoveries
- pending notes awaiting triage
- notes that may later become durable identity updates

The `memory-steward` process is responsible for periodic cleanup and promotion.

### `AGENTS.md`

Becomes a minimal routing file. It should:

- point the agent to `SOUL.md`, `../user.md`, and `../../runtime/*.md`
- point browser tasks to the `gateway-browser` skill
- point Feishu tasks to the `feishu-official-ops` skill
- point reminder tasks to the `reminder-tool` skill
- avoid embedding long duplicated operating manuals

## Migration Rules

### Runtime root

- move `.data/.../global-memory/` to `.data/.../runtime/`
- preserve file contents

### User long-term memory

Create `user.md` from legacy files:

- `shared-memory/identity.md` is the primary seed
- `profile.md`, `preferences.md`, `projects.md`, `relationships.md`, `decisions.md`, and `open-loops.md` are merged into named sections

Suggested structure:

```md
# User Identity

## Core Identity
...

## Stable Preferences
...

## Ongoing Context
...
```

Legacy files should then move to `shared-memory/_legacy/` during the transition period, not remain active.

### Agent identity

Create or rewrite `SOUL.md` by merging:

- existing `SOUL.md`
- `agent.md`
- meaningful parts of `memory/identity.md`

After merge:

- `agent.md` is removed
- `memory/identity.md` is removed

### Agent workspace location

Move each normal workspace:

- from `users/<user>/<agent-id>/`
- to `users/<user>/agents/<agent-id>/`

Move the steward workspace:

- from `users/<user>/_memory-steward/`
- to `users/<user>/internal/memory-steward/`

### Operation files

Delete these after successful migration:

- `TOOLS.md`
- `browser-playbook.md`
- `feishu-ops-playbook.md`

Their guidance must already exist in the owning skill before deletion.

## Repair Behavior

`repairWorkspaceScaffold` will become an upgrade entry point, not just a bootstrap fixer.

Expected behavior:

1. detect legacy layout and files
2. create new target directories if missing
3. migrate or merge content forward
4. rewrite `AGENTS.md` to the new minimal template
5. reinstall managed skills
6. remove or archive obsolete files
7. remain idempotent across repeated runs

`repair-users.ts` should call the same migration logic so old installations converge automatically.

## Memory Steward Behavior After Migration

The steward prompt must stop referencing the old long-term file set.

New behavior:

- read `user.md`
- inspect sibling agents' `SOUL.md`
- inspect sibling agents' `memory/daily/`
- update `user.md` only
- record uncertain or sensitive promotions in `steward-log.md`

It should suggest `SOUL.md` changes in the log when an agent identity drift is detected, but it should not silently rewrite agent identity unless the rules explicitly allow that.

## User-Facing Copy Changes

User-visible copy must stop exposing:

- `shared-memory`
- `global-memory`
- `_memory-steward`
- `agent.md`
- `profile.md`
- `preferences.md`
- `projects.md`
- `relationships.md`
- `decisions.md`
- `open-loops.md`

When the system needs to explain the model to the user, it should use:

- user identity
- current agent identity
- short-term memory

## Testing Requirements

Automated coverage should verify:

1. new workspaces are created in the new directory layout
2. new workspaces only contain the minimal top-level files
3. legacy workspaces migrate forward correctly
4. migration is idempotent
5. `memory-steward` reads and writes the new identity artifacts only
6. discovery and repair scripts traverse `agents/` and `internal/` correctly

## Tradeoffs

Accepted tradeoffs:

- less file-level structure for long-term memory
- more merging logic during migration
- tighter coupling between capability rules and the owning skill

These tradeoffs are acceptable because the main problem to solve is workspace clarity, not maximum taxonomy depth.
