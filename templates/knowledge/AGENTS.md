# Knowledge Base Agent Rules

These rules apply to `docs/knowledge/**` in large repositories that use this business knowledge base scheme.

## Required Entry Point

Read this file before any task that creates, updates, reviews, or routes work through the business knowledge base.

This includes:

- Creating or editing knowledge documents under `docs/knowledge/**`.
- Extracting durable knowledge from archived PRDs or completed changes.
- Refreshing implementation evidence.
- Updating `CONTEXT-MAP.md`.
- Creating or editing knowledge-base ADRs.
- Deciding which business context or capability a requirement belongs to.

This file is not a required entry point for ordinary code changes, bug fixes, endpoint lookup, or test repair unless the task also updates or relies on the business knowledge base.

## Purpose

Use the knowledge base for business routing, terminology, capability boundaries, design intent, and durable architecture decisions. Do not treat it as the source of truth for current code facts; verify implementation facts with CodeGraph, repository scans, and tests.

## Query Order

1. Extract business terms, identifiers, paths, interfaces, tables, and messages from the user request.
2. Search `docs/knowledge/**` frontmatter, titles, and `CONTEXT-MAP.md`.
3. Read the matching context `CONTEXT.md`, capability document, and related ADRs.
4. Verify current code facts with CodeGraph, repository scans, and tests before changing code or making factual claims.

## Document Boundaries

- `CONTEXT-MAP.md` lists business contexts and relationships.
- `contexts/<context-id>/CONTEXT.md` contains business terminology only. Do not add routes, controllers, tables, MQ topics, call graphs, or implementation notes.
- Treat a context as formal only when `CONTEXT-MAP.md` has a confirmed entry and `contexts/<context-id>/CONTEXT.md` exists with real business-language content. A directory alone is not a formal context.
- Use only top-level `- context-id: Context Name - one sentence summary` bullets under `## Contexts`, with indented `Path`, `Responsibilities`, and `Non-responsibilities` fields. `context-id` must match `[a-z][a-z0-9-]*`; keep all parsed fields non-empty. `Path` is relative to `docs/knowledge/` and must be `contexts/<context-id>/CONTEXT.md`.
- Keep `CONTEXT-MAP.md` relationships between formal contexts only; do not point relationships at candidates, semi-initialized directories, or missing ids.
- Use only directed `- source -> target: summary` bullet lines under `## Relationships` in `CONTEXT-MAP.md`. The summary must be non-empty. Write bidirectional relationships as two directed lines. Do not create self-loops or duplicate `source -> target` edges.
- `contexts/<context-id>/README.md` summarizes the business context and its capability list.
- `contexts/<context-id>/capabilities/*.md` describes business capabilities, boundaries, workflows, design intent, code evidence links, verification methods, and open questions.
- `contexts/<context-id>/evidence/*.md` contains generated or semi-automated implementation facts.
- `adr/*.md` records hard-to-reverse, non-obvious trade-offs.
- `changes/*.md` records change impact reports and is not an authoritative routing source.
- `audits/*.md` records knowledge-health audit reports and is not an authoritative routing source.
- `templates/*.md` defines reusable document skeletons.
- `candidates/*.md` records unconfirmed context candidates for review. Candidate documents are not formal business contexts and must not be listed as confirmed contexts in `CONTEXT-MAP.md`.
- `INDEX.md` and `index.json` are generated indexes for humans and agents. Markdown knowledge documents remain the source of truth.

## Frontmatter

Capability documents must include stable indexing frontmatter:

```yaml
---
domain: ""
capability: ""
name: ""
summary: ""
owners: []
related_contexts: []
keywords: []
evidence: []
confirmation_sources: []
status: draft
updated_at: ""
---
```

Do not put detailed controller, table, MQ, or call-chain lists in capability frontmatter. Put detailed implementation facts in `evidence/*.md`.

`status` is the document confidence signal used by agents during indexing:

- `verified`: confidence is confirmed for the document type. Evidence documents may be verified when `source`, `repo_commit`, `generated_at`, `generator`, and `generation_evidence` are recorded; capability documents additionally require `confirmation_sources` that point to archived PRD conclusions or explicit human confirmation, plus `evidenceCount > 0` in the context index. Prefer these documents during retrieval.
- `draft`: initial knowledge captured from local work or partial evidence.
- `needs-review`: boundary, terminology, or evidence needs human review.
- `stale`: known conflict with current code or newer knowledge.
- `deprecated`: retained for historical context and not used for normal routing.
- `accepted`: ADR status, ranked with `verified`; do not use it for capability, evidence, or candidate documents.

When multiple documents match a request, prefer `verified` documents and accepted ADRs first, then `draft`, then `needs-review`. `stale` and `deprecated` entries may remain discoverable in generated indexes for audit and history, but do not use them as authoritative routing decisions.

Status rank is fixed as `accepted` / `verified`, then `draft`, then `needs-review`, then `stale`, then `deprecated`. `accepted` applies only to ADRs and `adr-link` entries; `verified` applies only to capability and evidence entries.

## Generated Indexes

- Generate the global `INDEX.md`, the global `index.json`, and context-level `contexts/<context-id>/index.json` files from Markdown frontmatter and titles.
- Use two-level generated indexes and a three-stage retrieval path: global index -> context index -> source Markdown.
- ADR global matches may go directly to their source Markdown; context matches should go through the context index first.
- Treat a global context entry with missing or broken `indexPath` as unavailable; do not return a context match that cannot route to its context index.
- Do not hand-maintain generated indexes.
- Commit generated `INDEX.md` and `index.json` with knowledge-base source changes.
- After changing source knowledge documents, refresh the generated indexes before delivery.
- Refresh generated indexes through the Yog skill; target repositories do not store Yog executable scripts.
- The global index is a lightweight routing index. It includes context entries and ADRs; it excludes candidates, capability, and evidence entries.
- The global `INDEX.md` mirrors only the lightweight global index.
- Context indexes include local `capability`, `evidence`, and `adr-link` entries.
- Context index entries must be flat `entries[]`; do not nest evidence under capability objects.
- Context index top-level fields are fixed to `schemaVersion`, `kind`, `context`, `generated_at`, and `entries`; do not add top-level `stats`, `capabilityCount`, or `evidenceCountTotal`.
- Context index top-level `context` must match the path context id, and every entry `context` must match the top-level `context`; treat mismatches as gate failures and do not route through that context.
- Context index `capability` and `evidence` entry paths must stay inside the same context directory; `adr-link` paths must point to global `docs/knowledge/adr/*.md`.
- Keep top-level `generated_at` in both global and context indexes as generated artifact audit metadata, but ignore `generated_at` differences in index freshness checks.
- Sort context index entries by type bucket first: `capability`, then `evidence`, then `adr-link`; sort entries inside each bucket by the fixed status rank and stable path.
- Compute global context `docsCount` as `capabilityCount + evidenceCountTotal`, counting only context index `type: "capability"` and `type: "evidence"` entries. Do not count `adr-link`, and do not store `capabilityCount` or `evidenceCountTotal` in the global context entry.
- Generate `adr-link` entries only from explicit ADR frontmatter `related_contexts`; do not infer ADR-context relationships.
- Treat ADR frontmatter `related_contexts` as context ids from `CONTEXT-MAP.md`, not context paths.
- Allow ADR frontmatter `related_contexts: []`; generate the global ADR entry but no context `adr-link` entries.
- Deduplicate context ids when writing ADR frontmatter `related_contexts`. Treat duplicate ids found by `lint` as document quality issues, and deduplicate generated `adr-link` entries.
- Fail index generation when `related_contexts` references a missing context id. Report the missing id instead of skipping it or generating partial ADR reverse links.
- Report context directories that lack confirmed `CONTEXT-MAP.md` entries during `lint`; do not treat them as valid `related_contexts` targets.
- Fail index generation when a confirmed `CONTEXT-MAP.md` entry lacks `contexts/<context-id>/CONTEXT.md`, that file is empty, or that file is still a template shell.
- Keep `adr-link` entries as reverse links only. Do not copy ADR `keywords` into `adr-link`; keyword retrieval for ADRs should use the global ADR entry.
- Align global ADR entries and context `adr-link` entries by `path`. Use `name` only for display and diagnostics.
- Global ADR `keywords` come only from explicit ADR frontmatter `keywords`; do not infer them from body text.
- Candidate `keywords` are for explicit candidate workflows only; do not copy candidate fields into generated routing indexes.
- Do not generate context-level `INDEX.md` files in the first version.
- Exclude `changes/*.md`, `audits/*.md`, directory README files, `templates/*.md`, root `README.md`, `AGENTS.md`, `BUILD-PLAN.md`, and context `CONTEXT.md` files from the default machine index.
- The global `index.json` should include enough lightweight fields for routing: `path`, `type`, `context`, `name`, `summary`, `keywords`, `status`, `indexPath`, and `docsCount` when available.
- Global context `path`, `readmePath`, and `indexPath` must stay in the same context directory: `docs/knowledge/contexts/<context-id>/CONTEXT.md`, `docs/knowledge/contexts/<context-id>/README.md`, and `docs/knowledge/contexts/<context-id>/index.json`.
- `CONTEXT-MAP.md` `Path` values are relative to `docs/knowledge/`; generated global index entries must use target repository root-relative paths with the `docs/knowledge/` prefix.
- Global context `path` must point to an existing `docs/knowledge/contexts/<context-id>/CONTEXT.md` with real business-language content; missing, broken, empty, or template-shell `path` targets are gate failures.
- Global context `readmePath` must point to an existing `docs/knowledge/contexts/<context-id>/README.md` with real overview content; missing, broken, empty, or template-shell `readmePath` targets are gate failures.
- Context `CONTEXT.md` and README files must not be empty or template shells. A template shell has no real business content after ignoring whitespace, Markdown headings, empty section headings, skeleton guidance, and placeholders, or still contains `{...}` placeholders.
- Capability, evidence, candidate, and ADR source Markdown files must not be empty or template shells, and must not retain `{...}` placeholders. Candidate documents still never enter generated routing indexes.
- `{...}` placeholders are always gate failures. `TODO`, `TBD`, `待补充`, and `待确认` are allowed only under `未确认问题` / `Open Questions`; never put them in index fields or core body sections.
- `verified` documents and `accepted` ADRs must not keep `TODO`, `TBD`, `待补充`, or `待确认` even under `未确认问题` / `Open Questions`.
- Global context `indexPath` must point to an existing `docs/knowledge/contexts/<context-id>/index.json`; missing or broken `indexPath` is a gate failure.
- The context index reached by `indexPath` must have matching path context id, top-level `context`, and entry `context` values.
- The context index reached by `indexPath` must not route `capability` or `evidence` entries to another context directory.
- Use target repository root-relative paths for all index path fields, including `path`, `readmePath`, and `indexPath`; do not use paths relative to the context index file location.
- Context entries do not use `status`; candidate, ADR, capability, and evidence entries do.
- Global context `keywords` are derived from capability entries in the matching context index. Prefer maintaining routing terms on capability documents.
- Capability entry `keywords` come only from explicit capability frontmatter `keywords`; do not infer them from body text.
- Context index capability entries include `evidenceCount`, counting local `type: "evidence"` entries bound to that capability. Do not count `adr-link`.
- `evidenceCount: 0` is allowed for non-verified capability entries; verified capability entries require `evidenceCount > 0`.
- Evidence entry `keywords` come only from explicit evidence frontmatter `keywords`; do not inherit capability keywords.
- Evidence entries must include `capability`, and that capability must exist in the same context index.
- Capability ids must match `[a-z][a-z0-9-]*` and stay consistent across file names, capability frontmatter, context index entries, and evidence `capability` bindings.
- Evidence files use the file name as the stable identifier: `<capability-id>-<evidence-kind>.md`. `evidence-kind` must match `[a-z][a-z0-9-]*`, and the file-name prefix must match evidence frontmatter `capability`.
- Evidence kind describes the evidence slice, not the generation method. Use only `routes`, `call-flow`, `data`, `prd`, `tests`, `ui`, or `ops`; frontmatter `evidence_kind` must equal the file-name evidence kind.
- Context index evidence entries must include `evidenceKind`, generated from frontmatter `evidence_kind`.
- Keep generation details such as `source`, `repo_commit`, `generated_at`, `generator`, and `generation_evidence` out of context index evidence entries; read the source Markdown when needed.
- Context `index.json` files should include enough local fields for capability and evidence retrieval.
- Agent retrieval should prefer `status: verified` entries and accepted ADRs, and avoid using `stale` or `deprecated` entries as authoritative routing sources.

## Maintenance Rules

- Build knowledge incrementally from real work: new requirements, archived PRDs, repeated questions, cross-module bugs, boundary confusion, or stale-code conflicts.
- Do not run a one-time full extraction that creates empty placeholder contexts.
- Reuse or update existing contexts before creating new ones.
- Create a new context only when there is stable business language, clear boundaries, at least one real capability, and supporting evidence.
- Use `candidates/*.md` when a recurring business term or domain appears important but its boundary is not confirmed yet.
- Do not treat candidate documents as confirmed terminology, ownership, or architecture decisions.
- In explicit candidate workflows, use only deterministic duplicate checks: normalized filename slug equality, normalized `name` equality, `keywords` overlap, or `possible_contexts` overlap. Normalization only trims, lowercases, converts whitespace and `_` to `-`, collapses repeated `-`, and strips leading or trailing `-`. Do not use Chinese tokenization, pinyin, synonyms, translation, fuzzy matching, LLMs, embeddings, or semantic similarity for candidate deduplication. Do not merge or overwrite candidates automatically; ask the user whether to update an existing candidate or create a separate candidate.
- When `create-candidate` reports duplicates, expect structured output with `code: "candidate-duplicates-found"` and `duplicates[]` items containing `path`, `candidateId`, `name`, `status`, and `matchedFields[]`.
- Treat likely duplicate candidate documents reported by `lint` as P2 maintenance warnings, not blockers. Read duplicate items from the P2 issue `details.duplicates[]` using the same duplicate item shape as `create-candidate`.
- Read `lint` issues from stable fields: `severity`, `message`, conditionally required `path`, and optional `details`. Use `severity` for gate decisions and `details` for machine decisions; treat `message` as human-readable text only. Require `path` for document-level issues and file-locatable global issues; omit it only for repository-level issues such as missing `docs/knowledge`. `details` must be JSON-serializable and must not contain long body text or copied source document content. If a stable line number is available, read it from `details.line`; do not require top-level `line`. `lint` issues do not require `code`.
- Expect `lint` stdout to always include an `issues` array. No findings must be represented as `"issues": []`, not empty stdout, `null`, or a generic `ok` field.
- Expect `lint` issues sorted by `P0`, `P1`, `P2`, then by `path` and `message`; issues without `path` sort first within the same severity.
- Use script exit codes for success or blocking state; do not require a generic `ok` field in script JSON. Interpret `0` as completed or P2-only, `1` as repository-state or gate blocker, `2` as caller input error, and `3` as user confirmation required with no write performed.
- Treat internal script stdout as JSON-only. Do not rely on stderr for normal business issues or gate results; stderr is only for non-structured crashes or debugging output.
- Expect `match-scope` stdout to include `query`, `matches`, and `issues`. Treat empty `matches[]` with empty `issues[]` as a normal no-match result, not a failure. Treat index corruption, missing context indexes, unreadable paths, or inconsistent retrieval links as `issues[]` with exit code `1`; invalid script input is exit code `2`.
- Archived PRDs may trigger or supplement knowledge documents, but only durable final conclusions belong in the knowledge base.
- Keep requirement tasks, delivery reports, one-time verification logs, and deprecated implementation details out of capability documents.

## Minimal Build Flow

1. Route: check `index.json`, `INDEX.md`, and `CONTEXT-MAP.md` to find an existing context or capability. Check `candidates/*.md` only when explicitly creating, reviewing, updating, or promoting candidates.
2. Classify: update an existing capability, create a capability under an existing context, create or update a candidate when the boundary is unclear, or create an ADR for hard trade-offs.
3. Gather evidence: use CodeGraph, repository scans, archived PRDs, or verification records to generate or refresh evidence.
4. Write: keep `CONTEXT.md` for confirmed terms, capability documents for durable business knowledge, evidence documents for code facts, and ADRs for long-term trade-offs.
5. Rebuild indexes: ask the Yog skill to refresh generated indexes.

## Change Control

- Evidence documents and code fact summaries may be refreshed when code changes.
- Generated indexes may be refreshed automatically after source Markdown changes.
- Business boundaries, terminology, design intent, and context split or merge decisions require human confirmation.
- If code facts conflict with the knowledge base, use current code facts for the task and recommend marking the related knowledge document as `stale` or `needs-review`. Modify frontmatter only after user confirmation or an explicit apply command.
- Mark documents `verified` only when the document-specific confirmation fields are traceable and the relevant business boundary has no unresolved blocker.
- `evidence/*.md` may be marked `verified` by an agent when `source`, `repo_commit`, `generated_at`, `generator`, and `generation_evidence` are recorded.
- `capabilities/*.md` must not be marked `verified` from code facts alone. It requires current code evidence plus `confirmation_sources` that point to archived PRD final conclusions or explicit human confirmation of the business boundary.
- `candidates/*.md` must not use `verified`; candidates remain `needs-review` until they are marked `deprecated` after promotion or rejection.
- `CONTEXT.md` has no status frontmatter. Add terms only after the business terminology is confirmed.

## ADR Rules

Create an ADR only when all conditions are true:

1. The decision is hard to reverse.
2. The decision is surprising or unclear from code alone.
3. The decision reflects a real trade-off.

Default design notes belong in capability documents, not ADRs.
