---
name: knowledge-query
description: Read-only engineering query over Yog docs/knowledge. Use for business boundaries, implementation context, call chains, interfaces, data, code impact, and current-implementation verification. Route through structured Knowledge first and use bounded CodeGraph evidence for implementation facts.
---

# Yog Knowledge Query

This Skill is read-only. It never creates or modifies Knowledge, indexes, status, Candidates, Audit files, or the worktree. The only write-side exception is an orchestrator handoff after a deterministic `invalid-knowledge` result; the separate `yog:knowledge audit` workflow performs that write.

## Root And Ownership Preflight

1. Resolve the current repository and `.yog/config.json`; default to `docs/knowledge` only within that repository.
2. A missing root returns `result_status: not-initialized`.
3. Confirm Yog ownership from a matching config and/or recognizable Yog `schemaVersion` plus `kind: global` index. A directory name alone is insufficient. Unknown ownership returns `not-managed` without scanning, answering, auditing, or suggesting takeover.
4. If the user explicitly identifies the directory as the Yog root, missing ownership artifacts are structural damage.
5. After ownership, require valid `index.json`, `INDEX.md`, `CONTEXT-MAP.md`, supported schema, non-stale indexes, and valid references. Failure returns `invalid-knowledge`, stops all content/code reads, emits an integrity artifact, and hands it to the Audit workflow without asking again.

## Structured Read Order

Read `index.json` and `INDEX.md`, then a matching Business Flow, `CONTEXT-MAP.md`, Context, Capability, Evidence, and accepted ADR. Do not perform an unbounded repository scan.

Allowed answer sources:

- `verified` Capability/Evidence, confirmed routable Context, and `accepted` ADR as primary facts;
- `draft` Capability/Evidence/Business Flow only with an explicit “not fully confirmed” label and never as the sole formal-boundary authority.

Do not read or cite `stale`, `needs-review`, or `candidates/**`. If the user asks about these governance objects, route to `yog:knowledge` review instead. No allowed facts returns `not-found`.

## CodeGraph Verification

Only verify current implementation when the question needs it:

1. Require `.yog/config.json` to configure `codeFactProvider.type: codegraph` and `status: configured`.
2. Run a minimal read-only query and confirm repository identity/root.
3. If CodeGraph exposes revision, it must equal Git HEAD. Unknown revision/coverage is `unknown`.
4. Related dirty paths are covered only when CodeGraph explicitly proves live-worktree indexing.
5. Only `coverage_status: covered` may support `confirmed-conflict`.
6. Seed queries from symbols/routes already found in the selected Business Flow, Context, Capability, or Evidence. Start with direct relations and expand only as required along declared Context relationships or user-authorized scope.
7. No seed, unavailable CodeGraph, identity/revision mismatch, unknown coverage, or uncovered dirty paths returns `result_status: partial` plus `mismatch_type: insufficient-evidence`; never replace it with a whole-repository source/test scan.
8. Source/config/schema snippets may only explain CodeGraph-hit symbols. They cannot overrule CodeGraph.

An undeclared direct cross-Context edge may be reported, but stop at the target Context boundary. If Knowledge explicitly denies it and CodeGraph is covered, classify `confirmed-conflict`; if Knowledge merely omits it, classify `possible-stale`. Never promote an implementation edge into a formal business relationship.

## Result Contract

Return:

1. `result_status: ok | partial | not-found | not-initialized | not-managed | unavailable | invalid-knowledge`;
2. conclusions and source document status;
3. matched Business Flow/Context/Capability;
4. when applicable: provider/query status, repository identity, graph/head revision, dirty paths, coverage, seed symbols, allowed/actual query scope, expansion, and `mismatch_type`;
5. risks, boundaries, and local file references.

Use `partial` whenever any conclusion uses `draft`, any mismatch exists, CodeGraph is not covered, scope stops at a boundary, or only part of the question is answered. Terminal statuses take precedence. Use `ok` only when all conclusions are high-confidence and unrestricted.

For Drift, include a structured finding with a stable fingerprint, Knowledge source, CodeGraph coverage/scope, local hit evidence or explicit empty/unavailable fields, worktree state, mismatch type, impact, and recommendation. Do not persist it unless the user explicitly asks to record it.
