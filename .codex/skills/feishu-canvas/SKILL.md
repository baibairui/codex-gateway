---
name: feishu-canvas
description: Use when a Feishu conversation needs a Gemini-Canvas-like document workspace. Creates a fresh DocX every time and lets the agent continue editing the same workspace through follow-up actions.
---

# Feishu Canvas

Use this skill when the user wants a persistent document workspace rather than a one-shot chat answer.

## What it does

- Creates a **new Feishu DocX** for every canvas creation
- Stores the latest canvas session locally so follow-up actions can continue on the same document
- Supports document-first actions:
  - `create`
  - `rewrite`
  - `expand`
  - `compress`
  - `outline`
  - `restructure`
  - `show`
  - `reset`

## Rules

- Always create a **new** document for `create`
- Follow-up actions operate on the latest canvas document unless `--document` is provided
- Stay on public DocX APIs; do not claim any private Feishu Canvas API usage
- If the document creation/write fails, report the failure honestly

## Workflow

1. Decide whether the user needs a workspace instead of a normal reply
2. Generate the initial or transformed markdown content yourself
3. Run the canvas script:

```bash
node ./.codex/skills/feishu-canvas/scripts/feishu-canvas.mjs create --title "需求方案" --markdown-file ./draft.md
```

4. For follow-up actions, run:

```bash
node ./.codex/skills/feishu-canvas/scripts/feishu-canvas.mjs rewrite --markdown-file ./rewrite.md
node ./.codex/skills/feishu-canvas/scripts/feishu-canvas.mjs expand --markdown-file ./expanded.md
node ./.codex/skills/feishu-canvas/scripts/feishu-canvas.mjs outline --markdown-file ./outline.md
node ./.codex/skills/feishu-canvas/scripts/feishu-canvas.mjs show
node ./.codex/skills/feishu-canvas/scripts/feishu-canvas.mjs reset
```

5. Reply with the returned document URL and a concise note about what changed

## Notes

- `rewrite/expand/compress/outline/restructure` in v1 append a new section to the same document workspace
- Use `show` to inspect the active workspace and `reset` to clear local session state
- The script reuses `feishu-official-ops` DocX writes under the hood
