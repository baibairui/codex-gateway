---
name: feishu-official-ops
description: Use when the user wants real Feishu official operations such as creating DocX documents or Wiki nodes. Calls the bundled CLI that uses Feishu OpenAPI instead of pretending to do the action.
---

# Feishu Official Ops

Use this skill when the user wants the agent to perform real Feishu operations through the official OpenAPI, especially:

- Create a DocX document
- Create a Wiki node in a knowledge space
- List Wiki spaces
- Query a Wiki node

Do not claim the action is done unless you actually run the CLI and verify success from the returned payload.

## Environment

The CLI uses these environment variables:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`

If either is missing, stop and tell the user the app credentials are not configured.

The app also needs the corresponding Feishu OpenAPI permissions for DocX and Wiki operations.

## Official docs

- Tenant access token: `https://open.feishu.cn/api-explorer?project=auth&resource=tenant_access_token&apiName=internal&version=v3`
- Create DocX document: `https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/create`
- Create Wiki node: `https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/wiki-v2/space-node/create`
- List Wiki spaces: `https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/wiki-v2/space/list`
- Get Wiki node: `https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/wiki-v2/space/get_node`

## CLI

Use the bundled CLI:

```bash
node ./.codex/skills/feishu-official-ops/scripts/feishu-openapi.mjs --help
```

### Examples

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
2. If location is unclear, ask for the minimal missing identifier.
3. Run the CLI.
4. Read the returned JSON and report the real result back to the user.
5. If the API returns a permission error, say that the Feishu app lacks the required OpenAPI permission instead of inventing success.

## Location rules

- To create a standalone document, prefer `docx create`.
- To create content inside a knowledge space, prefer `wiki create-node`.
- If the user only says "建一个飞书文档" and does not specify a knowledge space or folder, create a standalone DocX document first.
