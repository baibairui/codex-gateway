---
name: feishu-official-ops
description: Use when an agent needs to perform real Feishu OpenAPI work, inspect which official Feishu API to use, or fall back to a direct authenticated OpenAPI call for operations such as DocX, Wiki, Drive, Bitable, Calendar, Task, Approval, Contacts, Chat, Cards, and Search.
---

# Feishu Official Ops

Use this skill when the user wants the agent to complete a real Feishu action through the official OpenAPI.

This skill is the Feishu **skill layer**, not the gateway transport layer.

## Boundary

Count as skill coverage:

- creating or editing DocX content
- creating or querying Wiki nodes
- querying or editing Drive, Bitable, Calendar, Task, Approval, Contact, Chat, Card, and Search resources
- discovering official APIs from the Feishu API Explorer catalog
- calling an official OpenAPI directly when no curated command exists yet

Do **not** count as skill coverage:

- gateway reply transport
- chat reply formatting
- sending a model answer back to Feishu through the gateway runtime

If the action only requires sending a reply in the current chat, that is gateway behavior, not this skill.

## Executor

Use the bundled script:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs --help
```

Required environment:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

Optional:

- `FEISHU_DOC_BASE_URL`
- `GATEWAY_ROOT_DIR`

If credentials are missing, stop and report the real blocker.

Personal Feishu commands are available again and use a **device-flow-only** auth bootstrap:

- `auth start-device-auth`
- `auth poll-device-auth`

This follows the same no-public-callback model used by `openclaw-lark`. Do not ask the user to configure `GATEWAY_PUBLIC_BASE_URL` for Feishu user auth.
If a personal command returns `authorization_required`, call `auth start-device-auth`, guide the user through approval, then call `auth poll-device-auth` and retry.

## Command Strategy

Choose commands in this order:

1. Use a **curated command** when the operation already has a stable command surface.
2. Use **catalog search/show** when you need to find the correct official API.
3. Use **api call** when no curated command exists yet.

This is the core rule that makes the skill broad without pretending every Feishu API already has a handwritten wrapper.

## Curated Command Groups

Current first-class groups:

- `auth`
- `im`
- `doc`
- `bitable`
- `calendar`
- `task`
- `docx`
- `wiki`
- `drive`
- `sheets`
- `chat`
- `card`
- `approval`
- `contact`
- `search`

Discovery and fallback:

- `catalog list`
- `catalog search`
- `catalog show`
- `api call`

## When To Use Which Surface

Use curated commands for common work:

- `auth start-device-auth` / `auth poll-device-auth`
- `docx create` / `docx append`
- `wiki list-spaces` / `wiki list-nodes` / `wiki get-node` / `wiki create-node` / `wiki move-node` / `wiki update-title` / `wiki get-task`
- `doc get-content`
- `bitable list-tables` / `bitable search-records` / `bitable create-record` / `bitable update-record`
- `calendar list-calendars` / `calendar create-calendar` / `calendar get-calendar` / `calendar update-calendar` / `calendar delete-calendar` / `calendar list-events` / `calendar create-event` / `calendar list-events-v4` / `calendar get-event` / `calendar update-event` / `calendar delete-event` / `calendar create-personal-event` / `calendar freebusy`
- `task create` / `task update` / `task delete` / `task add-members` / `task remove-members` / `task add-reminders` / `task remove-reminders` / `task add-dependencies` / `task remove-dependencies` / `task list-subtasks` / `task list-tasklists` / `task add-tasklist` / `task remove-tasklist` / `task create-personal-task` / `task list-personal-tasks` / `task get-personal-task` / `task update-personal-task` / `task delete-personal-task`
- `tasklist create` / `tasklist list` / `tasklist get` / `tasklist update` / `tasklist delete` / `tasklist tasks` / `tasklist add-members` / `tasklist remove-members`
- `drive list-files` / `drive create-folder` / `drive get-meta` / `drive copy-file` / `drive move-file` / `drive delete-file` / `drive create-shortcut` / `drive get-public-permission` / `drive patch-public-permission` / `drive list-permission-members` / `drive create-permission-member` / `drive update-permission-member` / `drive delete-permission-member` / `drive check-member-auth` / `drive transfer-owner` / `drive list-comments` / `drive batch-query-comments` / `drive create-comment` / `drive patch-comment`
- `sheets create` / `sheets get` / `sheets query-sheets` / `sheets find` / `sheets replace`
- `chat list` / `chat create` / `chat get` / `chat search` / `chat update` / `chat add-members` / `chat remove-members` / `chat add-managers` / `chat delete-managers` / `chat get-announcement` / `chat update-announcement`
- `card create` / `card update`
- `approval create-instance` / `approval get-definition` / `approval get-instance` / `approval cancel-instance` / `approval search-tasks` / `approval query-tasks` / `approval approve-task` / `approval reject-task` / `approval transfer-task` / `approval resubmit-task` / `approval cc-instance` / `approval search-cc` / `approval list-comments` / `approval create-comment` / `approval delete-comment`
- `contact get-user` / `contact get-department` / `contact list-users` / `contact list-users-by-department` / `contact list-departments` / `contact batch-get-user-id`
- `search doc-wiki`

Use catalog discovery when the user asks for a Feishu capability but the matching command is unclear.

Use `api call` when:

- the API is in the official catalog,
- you know the exact endpoint,
- there is no curated wrapper yet.

## Examples

Create a DocX:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs docx create --title "项目周报"
```

Append markdown into an existing DocX:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs docx append --document "https://feishu.cn/docx/doccnxxxxxxxx" --markdown-file ./weekly.md
```

Create a Wiki node:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs wiki create-node --space-id 123456789 --obj-type docx --title "需求评审记录"
```

Move an existing Wiki node into an archive branch:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs wiki move-node --space-id 123456789 --node-token wikicnxxxxxxxx --target-parent-token wikiarchivexxxx
```

Move a Drive DocX into Wiki:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs wiki move-docs-to-wiki --space-id 123456789 --obj-type docx --obj-token doccnxxxxxxxx --parent-wiki-token wikicnparentxxxx --apply true
```

Start Feishu device auth without a public callback URL:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs auth start-device-auth --gateway-user-id ou_bind_1
```

Poll the device auth until the binding is created:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs auth poll-device-auth --gateway-user-id ou_bind_1 --device-code dev_xxx
```

These commands stay in the skill layer, use Feishu device flow, and write the resulting binding into the gateway SQLite store without any browser callback endpoint.

Create a personal calendar event after user authorization is available:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar create-personal-event --gateway-user-id ou_bind_1 --summary "一对一沟通" --start-time "2026-03-13T10:00:00+08:00" --end-time "2026-03-13T10:30:00+08:00"
```

Create or list personal tasks:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs task create-personal-task --gateway-user-id ou_bind_1 --summary "整理个人待办"
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs task list-personal-tasks --gateway-user-id ou_bind_1 --page-size 20
```

Create or manage a shared calendar through the official application API:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar create-calendar --body-json '{"summary":"项目协同","description":"跨团队共享日历","permissions":"private","color":5}'
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar get-calendar --calendar-id cal_shared_1
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar update-calendar --calendar-id cal_shared_1 --body-json '{"summary":"项目协同-更新","color":7}'
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar delete-calendar --calendar-id cal_shared_1
```

These commands stay in the skill layer and use the official calendar application APIs with the app or tenant token already configured for the gateway.

Create or manage a shared calendar event through the official application API:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar create-event --calendar-id cal_shared_1 --body-json '{"summary":"架构评审","start_time":{"timestamp":"1741850400","timezone":"Asia/Shanghai"},"end_time":{"timestamp":"1741854000","timezone":"Asia/Shanghai"}}'
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar list-events-v4 --calendar-id cal_shared_1 --time-min "2026-03-13T00:00:00Z" --time-max "2026-03-14T00:00:00Z"
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar get-event --calendar-id cal_shared_1 --event-id evt_xxx
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar update-event --calendar-id cal_shared_1 --event-id evt_xxx --body-json '{"summary":"架构评审-更新"}'
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar delete-event --calendar-id cal_shared_1 --event-id evt_xxx
```

These commands stay in the skill layer and use the official calendar application APIs with the app or tenant token already configured for the gateway.

Search the official catalog:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs catalog search --query "approval"
```

Show one official API entry:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs catalog show --project wiki --version v2 --resource space --api-name list
```

Call an official API directly:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs api call --method POST --path /open-apis/approval/v4/instances --body-json '{"approval_code":"leave","user_id":"ou_xxx"}'
```

List Drive files in a folder:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs drive list-files --folder-token fldcnxxxxxxxx --page-size 50
```

Copy a DocX into another Drive folder:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs drive copy-file --file-token doccnxxxxxxxx --name "项目周报-副本" --folder-token fldtargetxxxx --type docx
```

List comments on a Drive file:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs drive list-comments --file-token doccnxxxxxxxx --file-type docx --page-size 20
```

Grant edit access on a Drive DocX:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs drive create-permission-member --token doccnxxxxxxxx --type docx --need-notification true --body-json '{"member_type":"userid","member_id":"ou_xxx","perm":"edit"}'
```

Check whether the current user can edit a Drive DocX:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs drive check-member-auth --token doccnxxxxxxxx --type docx --action edit
```

Transfer a Drive DocX to a new owner while keeping the old owner as editor:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs drive transfer-owner --token doccnxxxxxxxx --type docx --need-notification true --remove-old-owner false --old-owner-perm edit --body-json '{"member_type":"userid","member_id":"ou_new_owner"}'
```

Create a spreadsheet workspace:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs sheets create --title "项目台账" --folder-token fldcnxxxxxxxx
```

Add an assignee to a task directly from the skill layer:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs task add-members --task-guid taskguidcnxxxxxxxx --user-id-type open_id --body-json '{"members":[{"id":"ou_xxx","role":"assignee"}]}'
```

Search pending approval tasks for a user:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs approval search-tasks --page-size 50 --body-json '{"user_id":"ou_xxx","task_status":"PENDING"}'
```

Approve an approval task directly from the skill layer:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs approval approve-task --user-id-type open_id --body-json '{"approval_code":"leave","instance_code":"ins_xxx","user_id":"ou_xxx","task_id":"task_xxx","comment":"同意"}'
```

CC an approval instance directly from the skill layer:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs approval cc-instance --user-id-type open_id --body-json '{"approval_code":"leave","instance_code":"ins_xxx","user_id":"ou_xxx","cc_user_ids":["ou_cc_1","ou_cc_2"],"comment":"请同步关注"}'
```

Search unread approval CC items for a user:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs approval search-cc --page-size 50 --user-id-type open_id --body-json '{"user_id":"ou_xxx","read_status":"UNREAD"}'
```

Find cells inside a sheet:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs sheets find --spreadsheet-token spshcnxxxxxxxx --sheet-id sheetcnxxxxxxxx --body-json '{"find":"风险","find_condition":{"range":"A1:D200"}}'
```

Create a Bitable record:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs bitable create-record --app-token appcnxxxxxxxx --table-id tblcnxxxxxxxx --fields-json '{"标题":"新需求"}'
```

Create or update a group directly from the skill layer:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs chat create --body-json '{"name":"项目群","user_id_list":["ou_xxx"]}'
```

Update the group announcement directly from the skill layer:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs chat update-announcement --chat-id oc_xxx --body-json '{"revision":"7","requests":["{\"insert\":\"本周提测冻结到周四 18:00\"}"]}'
```

Create a card entity:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs card create --body-json '{"schema":"2.0","header":{"title":{"tag":"plain_text","content":"状态卡片"}}}'
```

## Workflow

1. Confirm whether the user wants a real Feishu operation, not just a chat reply.
2. Prefer the narrowest curated command that can finish the work.
3. If the API is unclear, run `catalog search`.
4. If the API is known but not curated, run `api call`.
5. Read the returned JSON before reporting success.
6. If the API returns a permission error, say the Feishu app lacks the required OpenAPI scope.

## Rules

- Do not claim success unless the CLI returned a real successful payload.
- For DocX and Wiki writes, success means the payload contains a real document or node identifier.
- For DocX and Wiki writes, a chat markdown answer is not a successful write.
- If the user provides a DocX URL, Wiki URL, or raw ID, parse it and continue; only ask when the target is genuinely unknown.
- For local images in DocX writes, prefer `--image-file`.
- After a real DocX or Wiki write succeeds, do not bounce the user into personal auth.
- Keep responses factual: report the real document URL, node token, or API result.
