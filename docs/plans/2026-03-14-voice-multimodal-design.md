# Gateway Voice Multimodal Design

**Date:** 2026-03-14

**Goal:** Add a maintainable first-stage voice capability to the gateway so inbound audio can be transcribed and then either routed through the existing text-agent flow or returned as plain transcript text.

## Context

The gateway already supports binary audio transport on both ingress and egress:

- Feishu inbound `audio` messages are downloaded locally and exposed as `local_audio_path`
- Feishu and WeCom outbound media sending can already upload local audio paths
- `chat-handler` already knows how to surface `local_audio_path` to the model

What is missing is actual speech understanding:

- no speech-to-text provider abstraction
- no audio validation layer
- no explicit policy for whether voice input should only be transcribed or should also trigger agent replies
- no service boundary that can decide whether to continue into the agent or reply directly

## External Reference

This design intentionally borrows from AstrBot's voice architecture rather than copying Python implementation details.

Primary references:

- AstrBot README: lists STT and TTS as independent capability layers alongside messaging platform adapters
- `NickCharlie/Astrbot-Voice-To-Text-Plugin`:
  - `main.py`: voice event listener delegates to services instead of mixing all logic in the message handler
  - `services/voice_processing_service.py`: file validation and format conversion are isolated
  - `voice_file_resolver.py`: voice file acquisition is treated as a separate problem from transcription
  - `services/stt_service.py`: framework STT and plugin STT are abstracted behind one service
  - `_conf_schema.json`: behavior mode and provider configuration are explicit

## Decision

Adopt a layered voice pipeline inside the gateway:

1. platform adapters keep downloading and exposing audio files
2. a new gateway speech service owns validation and transcription
3. successful transcription is turned into plain text query input for the existing agent flow
4. `transcribe_only` returns transcript text directly without invoking the agent
5. the first stage replies with text only; TTS remains a second-stage extension

## Why This Approach

This keeps the current gateway architecture intact:

- platform-specific message decoding stays in the platform layer
- agent orchestration stays in `chat-handler` and `CodexRunner`
- speech processing becomes a self-contained service boundary

It also avoids an overly coupled first patch where STT, TTS, audio conversion, prompt shaping, and platform reply formatting would otherwise be introduced at once.

## Architecture

### Platform Ingress

No major architectural change is required for inbound message adapters.

Responsibilities remain:

- receive audio messages
- download binary content locally where the platform adapter already supports it
- expose stable metadata and `local_audio_path`

The first end-to-end rollout should validate Feishu inbound audio first, because that download path already exists in the gateway today.

The adapter layer must not do:

- transcription
- provider selection

### Speech Orchestration Layer

Add a new `SpeechService` in `src/services/`.

Responsibilities:

- detect whether a message contains processable voice input
- read metadata such as path, MIME type, size, and duration when available
- validate file existence and policy limits
- call an `STTProvider`
- return an explicit control-flow result to the caller

Proposed output shape:

- `type: 'continue' | 'reply'`
- `prompt?`
- `message?`
- `audioMeta`
- `failureReason?`

### Agent Integration

`chat-handler` should treat successful transcription as plain text user input instead of relying on the model to inspect raw audio file paths.

Behavior:

- in `transcribe_and_reply` mode, the agent receives the transcript text itself as the effective query
- in `transcribe_only` mode, the gateway replies with transcript text directly and does not invoke the agent
- raw audio metadata remains internal to the speech layer for logs and future extensions

This keeps the agent input deterministic and avoids introducing a transcript-specific prompt format in stage 1.

### Output Behavior

Stage 1 only returns text responses.

The gateway should not synthesize reply audio in the first patch. Existing ability to send a pre-existing `local_audio_path` remains unchanged, but automatic text-to-speech is out of scope. TTS will be added later behind the same provider-oriented boundary as STT.

## Configuration

Add a `speech` config block with the smallest surface that still supports future TTS:

- `speech.enabled`
- `speech.mode`
- `speech.stt.provider`
- `speech.stt.baseUrl`
- `speech.stt.apiKeyEnv`
- `speech.stt.model`
- `speech.audio.maxSizeMb`
- `speech.audio.maxDurationSec`
- `speech.audio.allowedMimeTypes`

Recommended initial modes:

- `transcribe_only`
- `transcribe_and_reply`

`transcribe_only` is useful for validation, debugging, and cost control.

`transcribe_and_reply` is the main user-facing mode for stage 1.

The current codebase already has `speech.prompt.includeTranscriptMeta`; stage 1 no longer needs that switch and can ignore or remove it in follow-up cleanup.

## Provider Model

Introduce an `STTProvider` interface rather than hard-coding one vendor.

The first implementation may use one provider only, but the contract should support:

- provider name
- base URL override
- model override
- timeout
- normalized error mapping

This follows the AstrBot pattern where speech capability and specific vendor selection are separate concerns.

## Error Handling

Voice failures must not crash the overall message processing pipeline.

Explicit failure classes:

- file missing or unreadable
- unsupported MIME type or format
- file too large or too long
- provider authentication failure
- provider timeout
- empty transcript

Rules:

- return a user-safe failure message
- do not leak local file paths or secrets
- on transcription failure, do not call the agent in either mode
- when there is no processable `local_audio_path`, fall back to the normal text flow instead of treating it as an error

## Testing Strategy

The first implementation should be test-driven around the speech boundary.

Minimum coverage:

1. Feishu audio input enters the speech pipeline
2. missing `local_audio_path` is handled safely
3. successful STT replaces the effective query text sent to the agent
4. STT failure prevents downstream agent execution
5. `transcribe_only` and `transcribe_and_reply` branch correctly
6. config parsing and defaults are stable

## Scope

### In scope

- speech service boundary
- one STT provider abstraction and one concrete implementation
- transcript-to-query handoff into existing text flow
- text-only stage-1 replies
- tests for the new pipeline

### Out of scope for stage 1

- automatic TTS reply synthesis
- real-time duplex voice conversations
- voice persona or timbre controls
- voice history summarization
- UI or card-based voice controls

## File Impact

Likely first-stage touch points:

- `src/config.ts`
- `src/services/chat-handler.ts`
- `src/services/` new speech-related files
- `src/server.ts`
- `tests/chat-handler.test.ts`
- new speech-specific tests
- README capability/config documentation after implementation

## Rollout

1. add configuration and failing tests
2. add speech service and provider contract
3. wire `chat-handler` into the speech service with continue/reply control flow
4. verify transcript-as-query behavior end to end
5. decide whether and how to add TTS in a separate patch
