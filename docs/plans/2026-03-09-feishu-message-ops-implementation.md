# Feishu Message Ops Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add first-class Feishu message operation support for update and recall, and make those operations expressible through the gateway structured-message protocol.

**Architecture:** Extend the structured gateway message schema with an optional operation layer so agents can request `send`, `update`, or `recall` explicitly. Implement the missing Feishu API methods in `src/services/feishu-api.ts`, then wire server-side dispatch to call those methods for Feishu while rejecting unsupported operations on WeCom.

**Tech Stack:** TypeScript, Vitest, Express, Feishu OpenAPI, `@larksuiteoapi/node-sdk`

---

### Task 1: Extend protocol parsing

**Files:**
- Modify: `src/utils/gateway-message.ts`
- Test: `tests/gateway-message.test.ts`

**Step 1: Write the failing test**

Add tests that require:
- parsing `{"__gateway_message__":true,"op":"update","message_id":"om_1","msg_type":"interactive","content":{"template_id":"tpl_1"}}`
- parsing `{"__gateway_message__":true,"op":"recall","message_id":"om_1"}`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/gateway-message.test.ts`
Expected: FAIL because the parser does not yet recognize `op` / `message_id`.

**Step 3: Write minimal implementation**

Update `parseGatewayStructuredMessage` to:
- default `op` to `send`
- accept `update` with `message_id + msg_type + content`
- accept `recall` with `message_id`

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/gateway-message.test.ts`
Expected: PASS

### Task 2: Add Feishu update and recall operations

**Files:**
- Modify: `src/services/feishu-api.ts`
- Test: `tests/feishu-api.test.ts`

**Step 1: Write the failing test**

Add tests that require:
- updating an `interactive` message using template shorthand
- recalling a message through the Feishu OpenAPI endpoint

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/feishu-api.test.ts`
Expected: FAIL because update is too narrowly typed and recall does not exist.

**Step 3: Write minimal implementation**

Implement:
- a generic `updateMessage(...)` that supports text/post/interactive content normalization
- `recallMessage(messageId)` using tenant access token + Feishu OpenAPI

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/feishu-api.test.ts`
Expected: PASS

### Task 3: Wire protocol to server dispatch and prompts

**Files:**
- Modify: `src/server.ts`
- Modify: `src/services/chat-handler.ts`
- Test: `tests/chat-handler.test.ts`

**Step 1: Write the failing test**

Add a prompt assertion requiring Feishu protocol guidance to mention update/recall operations explicitly.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/chat-handler.test.ts`
Expected: FAIL because the prompt only documents send behavior.

**Step 3: Write minimal implementation**

Update:
- Feishu outbound protocol prompt to document `send/update/recall`
- server outbound dispatch so Feishu structured messages with `op=update` call `feishuApi.updateMessage(...)`
- server outbound dispatch so Feishu structured messages with `op=recall` call `feishuApi.recallMessage(...)`
- return clear errors for unsupported WeCom operations

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/chat-handler.test.ts`
Expected: PASS

### Task 4: Verify targeted regression set

**Files:**
- Test: `tests/gateway-message.test.ts`
- Test: `tests/feishu-api.test.ts`
- Test: `tests/chat-handler.test.ts`

**Step 1: Run focused verification**

Run: `npm test -- tests/gateway-message.test.ts tests/feishu-api.test.ts tests/chat-handler.test.ts`
Expected: PASS

**Step 2: Run build verification**

Run: `npm run build`
Expected: PASS
