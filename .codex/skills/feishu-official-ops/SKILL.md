---
name: feishu-official-ops
description: Use when the user wants real Feishu official operations such as creating DocX documents or Wiki nodes. Uses the bundled script inside this skill, backed by Feishu OpenAPI, instead of pretending to do the action.
---

# Feishu Official Ops

Use this skill when the user wants the agent to perform real Feishu operations through the official OpenAPI, especially:

- Read IM history or search messages
- Read DocX / cloud document content
- Query Bitable tables or records
- Read calendar lists, events, or freebusy windows
- Create or inspect tasks / subtasks
- Create a DocX document
- Create a Wiki node in a knowledge space
- List Wiki spaces
- Query a Wiki node

Do not claim the action is done unless you actually run the skill's bundled script and verify success from the returned payload.

## Executor

Use the bundled script inside this skill:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs --help
```

The script reads these environment variables:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_DOC_BASE_URL` (optional)

If either credential is missing, stop and report the real blocker instead of inventing success.

## Official docs

- Tenant access token: `https://open.feishu.cn/api-explorer?project=auth&resource=tenant_access_token&apiName=internal&version=v3`
- Create DocX document: `https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/create`
- Create Wiki node: `https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/wiki-v2/space-node/create`
- List Wiki spaces: `https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/wiki-v2/space/list`
- Get Wiki node: `https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/wiki-v2/space/get_node`

### Examples

Read a single IM message:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs im get-message --message-id om_xxx
```

List IM history:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs im list-messages --container-id-type chat --container-id oc_xxx --page-size 50
```

Search IM messages:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs im search-messages --query "发布"
```

Read DocX markdown content:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs doc get-content --doc-token doccnxxxxxxxx
```

Read DocX raw text:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs doc get-raw-content --document "https://feishu.cn/docx/doccnxxxxxxxx"
```

List Bitable tables:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs bitable list-tables --app-token appcnxxxxxxxx
```

Search Bitable records:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs bitable search-records --app-token appcnxxxxxxxx --table-id tblxxxxxxxx --filter-json '{"conjunction":"and","conditions":[]}'
```

List calendars:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar list-calendars
```

Read calendar freebusy:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs calendar freebusy --time-min 2026-03-09T00:00:00Z --time-max 2026-03-10T00:00:00Z --user-id ou_xxx
```

Create a task:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs task create --summary "整理周报"
```

Create a task subtask:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs task create-subtask --task-guid task_guid_xxx --summary "补齐风险项"
```

Create a DocX document:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs docx create --title "项目周报"
```

Create a DocX document in a folder:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs docx create --title "项目周报" --folder-token fldcnxxxxxxxx
```

Create a DocX document and write markdown content:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs docx create --title "项目周报" --markdown-file ./weekly.md
```

Create a DocX document and insert a local image:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs docx create --title "架构图" --image-file ./topology.png --image-caption "系统拓扑图"
```

Append markdown content into an existing DocX document:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs docx append --document "https://feishu.cn/docx/doccnxxxxxxxx" --markdown-file ./iteration.md
```

Append a local image into an existing DocX document:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs docx append --document "https://feishu.cn/docx/doccnxxxxxxxx" --image-file ./diagram.png --image-width 960 --image-caption "调用链路图"
```

List Wiki spaces:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs wiki list-spaces
```

Create a DocX node in a Wiki space:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs wiki create-node --space-id 123456789 --obj-type docx --title "需求评审记录"
```

Create a child node under a parent node:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs wiki create-node --space-id 123456789 --parent-node-token wikinodecnxxxx --obj-type docx --title "接口设计"
```

## Workflow

1. Confirm the target object type and destination.
2. 如果用户给了飞书文档链接、wiki 链接或 document_id，直接解析并继续；只有目标对象完全不明确时才追问。
3. Run the matching command from this skill.
4. Read the returned JSON and report the real result back to the user.
5. If the API returns a permission error, say that the Feishu app lacks the required OpenAPI permission instead of inventing success.
6. If the user wants to insert a local image or the message already contains `local_image_path=...`, prefer `--image-file` instead of trying to stuff the image into markdown.
7. 优先选最小命令面：读取就用 `im/doc/bitable/calendar/task`，写文档或知识库才用 `docx/wiki`。

## Location rules

- To create a standalone document, prefer `docx create`.
- To create content inside a knowledge space, prefer `wiki create-node`.
- If the user only says "建一个飞书文档" and does not specify a knowledge space or folder, create a standalone DocX document first.
- For appending content, accept either a full Feishu document URL, a wiki URL, or a raw `document_id`; do not insist on a user-provided URL format config.
- For read-only queries, prefer the narrowest command: `im` for messages, `doc` for document content, `bitable` for records, `calendar` for calendars/freebusy, `task` for tasks.
