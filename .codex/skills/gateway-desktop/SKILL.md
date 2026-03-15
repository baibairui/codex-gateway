---
name: gateway-desktop
description: Use when tasks require operating desktop applications on macOS and need screenshot-guided GUI actions.
---

# Gateway Desktop Skill

When the user asks for desktop application operations, run the bundled script in this skill for local macOS execution.
Use the script path relative to this skill directory so any agent client that loads the skill can call it directly.

Workflow:
1. Start with `node ./scripts/gateway-desktop.mjs observe` to collect visual evidence.
2. Build one `act` bundle with `2-5` small GUI actions only when the next steps are obvious from the screenshot.
3. Run `observe` again immediately after the bundle to confirm the result.
4. Use the loop `observe -> act -> observe` until the task is complete.
5. Do not start with `run-shell` or `run-applescript`; keep them only as escape hatches after repeated visual ambiguity or explicit user instruction.

Runtime:
- local macOS execution from the current workspace
- the host terminal needs Accessibility and Screen Recording permission
- AppleScript-based app activation may also prompt Automation permission
- screenshots are stored under `./.codex/artifacts/desktop/`

Examples:
- `node ./scripts/gateway-desktop.mjs observe --label inbox --show-cursor true`
- `node ./scripts/gateway-desktop.mjs act --steps '[{"type":"activate-app","appName":"Finder"},{"type":"hotkey","keys":["Meta","n"]}]'`
- `node ./scripts/gateway-desktop.mjs click --x 640 --y 420 --button left`
- `node ./scripts/gateway-desktop.mjs screenshot --filename desktop-step.png --show-cursor true`
- `node ./scripts/gateway-desktop.mjs run-applescript --script 'tell application "Finder" to activate'`
- `node ./scripts/gateway-desktop.mjs run-shell --command 'open -a "System Settings"'`

Rules:
- Operate the frontmost visible application only.
- Treat every `observe` result as visual evidence. Do not guess the UI state from stale memory.
- Use `act` for the default path. Each bundle should stay inside one obvious focus chain and contain only GUI actions.
- If the host window steals focus between invocations, `observe` and `act` restore the remembered target app before continuing.
- Do not start with `run-shell` or `run-applescript`. If shell or AppleScript is required, use them only after repeated visual ambiguity or explicit user instruction.
- If a search box or command palette keeps focus, dismiss it with `press-key --key Esc`, verify it closed, and only then type into the main surface.
- If the next action is ambiguous, stop and ask for user direction.
- Before send/delete/submit/payment or other irreversible actions, request confirmation if the user did not state it explicitly.
- If an action fails twice, stop and report the current frontmost app and latest screenshot path.
