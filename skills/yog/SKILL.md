---
name: yog
description: Maintain docs/knowledge business knowledge bases through one agent-facing skill and internal Node scripts.
---

# Yog

Use Yog when a user asks to initialize, route, create, verify, or maintain a `docs/knowledge` business knowledge base.

## Entry Rules

- Ask for the business scope before creating candidate, context, capability, or evidence documents.
- Use `docs/knowledge/index.json`, `INDEX.md`, and `CONTEXT-MAP.md` for routing before scanning code.
- Read candidate documents only in explicit candidate creation, review, update, or promotion workflows.
- Verify current implementation facts with CodeGraph, Serena, GitNexus, repository scans, or tests before making code-fact claims.
- Missing CodeGraph, GitNexus, or Serena never blocks `init`, `create-*`, `build-index`, `check-index`, `lint`, `verify`, `sync`, or `match-scope`.

## Script Protocol

All write and match scripts read JSON from stdin:

```json
{
  "repoRoot": "/path/to/repo",
  "knowledgeRoot": "docs/knowledge",
  "payload": {}
}
```

All scripts write JSON to stdout. Normal business issues are not written to stderr.

Exit code `0` means completed or P2-only. Exit code `1` means target repository state or gate blockers. Exit code `2` means caller input error. Exit code `3` means user confirmation is required and no write occurred.

## Scripts

- `init.mjs`: copy `templates/knowledge` into the target repository, write `.yog/config.json`, and update root `AGENTS.md` and `CLAUDE.md` managed blocks.
- `create-candidate.mjs`: create a `needs-review` candidate after receiving `candidateId`, `name`, `summary`, and real body content.
- `create-context.mjs`: create a formal context after receiving confirmed boundary fields.
- `create-capability.mjs`: create a `draft` capability under an existing context.
- `create-evidence.mjs`: create a `draft` evidence document under an existing capability.
- `build-index.mjs`: rebuild global and context indexes.
- `check-index.mjs`: compare generated indexes without writing.
- `lint.mjs`: report P0/P1/P2 knowledge-base issues.
- `verify.mjs`: run `check-index` and `lint` without writing.
- `sync.mjs`: run `build-index` and `lint`.
- `match-scope.mjs`: return deterministic context, ADR, capability, and evidence matches.

## Candidate Duplicate Confirmation

When `create-candidate.mjs` exits with code `3`, stdout contains:

```json
{
  "code": "candidate-duplicates-found",
  "duplicates": [
    {
      "path": "docs/knowledge/candidates/refund.md",
      "candidateId": "refund",
      "name": "Refund",
      "status": "needs-review",
      "matchedFields": ["slug"]
    }
  ]
}
```

Show `path`, `name`, `status`, and `matchedFields` to the user. Continue only after the user chooses to update the existing candidate or create a separate candidate with explicit confirmation.
