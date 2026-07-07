---
name: sync-verify
description: Sync and verify a Yog docs/knowledge knowledge base. Use when users ask to sync Yog indexes, verify docs/knowledge, build index, check index, lint Yog knowledge docs, or diagnose stale generated indexes.
---

# Sync Verify

Use this skill when the user asks to sync, verify, build indexes, check indexes, lint, or diagnose the current Yog knowledge base.

## Operations

- `sync`: run `build-index.mjs` and `lint.mjs`, writing generated indexes.
- `verify`: run `check-index.mjs` and `lint.mjs`, without writing files.
- `build-index`: rebuild generated indexes.
- `check-index`: compare generated indexes without writing.
- `lint`: report P0/P1/P2 knowledge-base issues.

## Workflow

1. Confirm `repoRoot` and `knowledgeRoot` (`docs/knowledge` by default).
2. If the user asks for sync, run `sync.mjs`.
3. If the user asks for verify, run `verify.mjs`.
4. If the user asks for build-index, check-index, or lint specifically, run the matching internal script.
5. Report command status, generated files changed, and issues by severity.
6. If verification fails, classify the failure as stale index, structure issue, missing file, invalid relationship, empty content, or content quality issue when possible.

## Boundaries

- Do not create, promote, merge, split, or rename contexts.
- Do not discover candidates.
- Do not change business boundaries.
- Do not mark documents verified or stale unless the user explicitly asks.
- Do not ask the user to run internal Node scripts manually.
- Do not claim sync or verify passed without actual command results.
