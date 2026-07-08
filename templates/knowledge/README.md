# Business Knowledge Base

This directory contains a reusable business knowledge base scheme for large repositories. The scheme is intended for multi-service or multi-application codebases in general.

## Goal

The knowledge base captures durable business language, capability boundaries, design intent, architecture decisions, and traceable implementation evidence. It helps agents and engineers route work through business meaning first, then verify current code facts with tools such as CodeGraph, repository scans, and tests.

## Directory Structure

```text
docs/knowledge/
  README.md
  AGENTS.md
  CONTEXT-MAP.md
  INDEX.md
  index.json
  business-flows/
    README.md
    <business-flow-id>.md
  changes/
    README.md
    <timestamp>-change.md
  audits/
    README.md
    YYYY-MM-DD.md
  contexts/
    README.md
    <context-id>/
      CONTEXT.md
      README.md
      capabilities/
        <capability-id>.md
      evidence/
        <capability-id>-routes.md
        <capability-id>-call-flow.md
        <capability-id>-data.md
        <capability-id>-prd.md
        <capability-id>-tests.md
        <capability-id>-ui.md
        <capability-id>-ops.md
  candidates/
    README.md
    <candidate-id>.md
  adr/
    README.md
    0001-*.md
  templates/
    context.md
    context-readme.md
    capability.md
    evidence.md
    business-flow.md
    candidate.md
    adr.md
    change.md
    audit.md
    prd-extraction-checklist.md
```

## Document Types

- `CONTEXT-MAP.md`: confirmed business contexts and their relationships.
- `business-flows/*.md`: end-to-end business operation overviews that connect multiple contexts into a readable flow.
- `INDEX.md`: generated human-readable index.
- `index.json`: generated machine-readable index for agent retrieval.
- `changes/*.md`: generated or semi-generated change impact reports; not authoritative routing documents.
- `audits/*.md`: scheduled or manual knowledge-health reports; not authoritative routing documents.
- `contexts/<context-id>/CONTEXT.md`: confirmed business terminology only.
- `contexts/<context-id>/README.md`: context overview and capability list.
- `capabilities/*.md`: business capability boundaries, workflows, design intent, code evidence links, verification methods, and open questions.
- `evidence/*.md`: generated or semi-automated implementation facts such as routes, call graphs, tables, messages, and entry points.
- `business-flows/*.md`: business-wide overview documents for humans and agents. Use them before reading individual contexts when a request maps to a named business operation.

A formal context requires both a confirmed `CONTEXT-MAP.md` entry and an existing `contexts/<context-id>/CONTEXT.md` with real business-language content. A directory alone is not a formal context.

The first version parses context entries only from top-level bullet lines under `## Contexts`, using `- context-id: Context Name - one sentence summary` format plus indented `Path`, `Responsibilities`, and `Non-responsibilities` fields. `context-id` must match `[a-z][a-z0-9-]*`. `Path` is relative to `docs/knowledge/`, must be `contexts/<context-id>/CONTEXT.md`, and all parsed fields must be non-empty.
- `candidates/*.md`: unconfirmed context candidates awaiting review.
- `adr/*.md`: hard-to-reverse, non-obvious trade-offs.
- `templates/*.md`: reusable skeletons for consistent document creation.

## Incremental Construction

Build the knowledge base only from real work:

- New requirements.
- Archived PRDs or completed changes.
- Repeated questions.
- Cross-module bugs.
- Boundary confusion.
- Conflicts between code facts and existing knowledge.

Do not run a one-time full extraction that creates empty placeholder contexts. New contexts require stable business language, clear boundaries, at least one real capability, and supporting evidence.

## Init And Candidate Discovery

Init creates the knowledge-base skeleton only. It does not require CodeGraph and does not create business contexts, capabilities, evidence, or candidates.

Automatic candidate discovery starts after init and has a stricter gate. It requires:

- CodeGraph initialized for this repository and able to answer code-structure queries.

If CodeGraph is missing or not initialized, stop automatic discovery and initialize CodeGraph first. Do not fall back to filename-only or `rg`-only discovery for automatic candidates.

When CodeGraph is available, the agent may run `discover-candidates` through the Yog discovery workflow. Discovery uses code evidence lenses as its truth source; existing business docs, OpenSpec changes, README, and requirement prose may enrich promotion later, but must not be treated as discovery truth. Discovery may write `needs-review` candidate documents under `candidates/*.md`, but candidates remain outside generated routing indexes until a human confirms the boundary and promotes them into formal contexts.

If medium+low confidence candidates exceed `discover.maxMidLowCandidates` (default 10 in `.yog/config.json`), high confidence candidates may still be written, while the blocked medium/low candidates are recorded in `candidates/_gated/gated-candidates.md` for review or scope narrowing. Duplicate candidates must not be overwritten or merged automatically.

### Subagent Timeout Discipline

When agents use subagents for candidate discovery, promotion evidence gathering, semantic recall, or overlap calibration, each subagent task must have an explicit timeout plan.

- Give each subagent a bounded task and state the expected deadline in its prompt.
- When waiting for subagents, use an explicit timeout when the orchestration tool supports one. Use 10-15 minutes for discovery lenses and 5-10 minutes for semantic recall probes unless the user asks otherwise.
- If a subagent times out, record `timed_out: true`, the agent role, elapsed time, and any partial output. Do not silently count it as a failed recall or a successful scan.
- Do not block the main workflow on closing old or completed subagents. If capacity is exhausted, reuse an existing idle/completed agent with a fresh interrupting task, reduce fan-out, or continue locally with a lower-confidence note.
- Never bulk-close many subagents in parallel as a generation or validation gate.
- If too few subagent results return before timeout, report the missing coverage instead of fabricating the missing lens or recall result.

## Minimal Build Flow

1. Route: check `index.json`, `INDEX.md`, business flow matches, and `CONTEXT-MAP.md` to find an existing business flow, context, or capability. Candidate documents are checked only when the user explicitly asks to create, review, update, or promote candidates.
2. Classify: update an existing capability, create a capability under an existing context, create or update a candidate when the boundary is unclear, or create an ADR for hard trade-offs.
3. Gather evidence: use CodeGraph, repository scans, archived PRDs, or verification records to generate or refresh evidence.
4. Write: keep `CONTEXT.md` for confirmed terms, capability documents for durable business knowledge, evidence documents for code facts, and ADRs for long-term trade-offs.
5. Rebuild indexes: ask the Yog skill to refresh generated indexes.

## Agent Usage

Agents use the knowledge base for initial business routing and intent:

1. Extract business terms, identifiers, paths, interfaces, tables, and messages from the request.
2. Search frontmatter, titles, and `CONTEXT-MAP.md`.
3. If a matching business flow exists, read it first to understand the end-to-end operation and recommended context order. Then read the matching `CONTEXT.md`, capability document, and related ADRs.
4. Verify current implementation facts with CodeGraph, repository scans, and tests.

If code facts conflict with the knowledge base, current code facts drive the task. Recommend marking the knowledge document `stale` or `needs-review`; modify frontmatter only after user confirmation or an explicit apply command.

## Post-generation Calibration

After generating or promoting multiple contexts, agents should run an agent semantic recall check and prepare an overlap calibration report when there are overlap signals. Overlap is not an error by itself; it is a calibration candidate.

Agents must not decide context boundaries by themselves. Only the user can decide whether suspected overlap should become a merge, split, rename, explicit relationship, or no-op. The report should provide evidence and options, not a forced conclusion.

Overlap signals include shared business terms, candidate duplicate hints, agent semantic recall results that reasonably select multiple contexts, recurring business-flow adjacency, and missing `CONTEXT-MAP.md` relationships that make agents infer whether contexts are overlapping or upstream/downstream.

For each suspected overlap, report the context ids, triggering signals, example user queries, affected business-flow sections, and decision options:

- keep separate and add explicit `CONTEXT-MAP.md` relationship;
- merge contexts;
- rename or rewrite responsibilities/non-responsibilities;
- mark as `needs-review` and defer;
- gather more code or business evidence before deciding.

Apply changes to `CONTEXT-MAP.md`, context summaries, responsibilities, non-responsibilities, keywords, or business-flow reading order only after the user makes a decision.

## Status And Confidence

Capability, evidence, and candidate documents use `status` as a confidence signal:

- `verified`: confidence is confirmed for the document type. Evidence documents may be verified when `source`, `repo_commit`, `generated_at`, `generator`, and `generation_evidence` are recorded; capability documents additionally require `confirmation_sources` that point to archived PRD final conclusions or human confirmation, plus `evidenceCount > 0` in the context index.
- `draft`: initial knowledge from local work or partial evidence.
- `needs-review`: boundary, terminology, or evidence needs human review.
- `stale`: known conflict with current code or newer knowledge.
- `deprecated`: retained for historical context and not used for normal routing.
- `accepted`: ADR status; ranked with `verified` during retrieval. Do not use it for capability, evidence, or candidate documents.

Agents prefer `verified` documents during indexing. ADRs may use `accepted`, which is ranked with `verified`. `stale` and `deprecated` entries may remain discoverable in generated indexes for audit and history, but they are not authoritative routing sources.

Status rank is fixed as `accepted` / `verified`, then `draft`, then `needs-review`, then `stale`, then `deprecated`. `accepted` applies only to ADRs and `adr-link` entries; `verified` applies only to capability and evidence entries.

## Generated Indexes

`INDEX.md` and `index.json` are generated from Markdown frontmatter and titles. They are retrieval aids, not source documents.

Yog uses two-level generated indexes and a three-stage retrieval path: global index -> context index -> source Markdown. The third stage is the Markdown source document, not another generated index.

Global ADR matches can go directly to their source Markdown. Context and capability matches should go through the matching context index first.

If a global context entry has no `indexPath`, or its `indexPath` points to a missing context index, treat that context as unavailable. Do not degrade to returning the context without local capability or evidence routing.

Generated indexes are committed with the knowledge base. After changing source Markdown documents, refresh and include the generated `INDEX.md` and `index.json` outputs.

Refresh them through the Yog skill, which calls plugin-packaged scripts. Target repositories do not store Yog executable scripts.

The global `docs/knowledge/index.json` is a lightweight routing index. It lists business flows, confirmed contexts, and ADRs, but it does not include candidate, capability, or evidence entries. The global `INDEX.md` is only the human-readable mirror of this lightweight global index.

Each context has its own generated `contexts/<context-id>/index.json` with `kind: "context"`. Context indexes contain local `capability`, `evidence`, and non-countable `adr-link` entries. Context index entries are flat `entries[]`; do not nest evidence under capability objects.

Context index top-level fields are fixed to `schemaVersion`, `kind`, `context`, `generated_at`, and `entries`. Do not add top-level `stats`, `capabilityCount`, or `evidenceCountTotal`; compute those values from entries when needed.

The context index top-level `context` must match the `<context-id>` in its file path, and every entry `context` must match the top-level `context`. Treat mismatches as gate failures and do not use that context for routing.

Context index `capability` and `evidence` entry paths must stay inside the same `docs/knowledge/contexts/<context-id>/` directory. An `adr-link` path must point to global `docs/knowledge/adr/*.md`.

Keep top-level `generated_at` in both global and context indexes as generated artifact audit metadata. Index freshness checks should ignore `generated_at` differences.

Context index entries are sorted by type bucket first: `capability`, then `evidence`, then `adr-link`. Entries inside each bucket are sorted by the fixed status rank and stable path.

The first version does not generate context-level `INDEX.md` files.

Global index sources include:

- `business-flows/*.md`
- `contexts/**/capabilities/*.md`
- `adr/*.md`

Candidate documents under `candidates/*.md` are intentionally excluded from generated routing indexes. Read them only in explicit candidate create, review, update, or promotion workflows.

Context index sources include:

- `contexts/<context-id>/capabilities/*.md`
- `contexts/<context-id>/evidence/*.md`

Context `adr-link` entries are generated only from explicit ADR frontmatter `related_contexts`. Do not infer ADR-context relationships from titles, body text, or keywords.

ADR frontmatter `related_contexts` contains context ids from `CONTEXT-MAP.md`, such as `[order]`. Do not put context paths in `related_contexts`.

ADR frontmatter may use `related_contexts: []`. The ADR still appears in the global ADR index, but it does not generate context `adr-link` entries.

When writing `related_contexts`, deduplicate context ids. If duplicate ids are found later, `lint` should report them and generated context `adr-link` entries should still be deduplicated.

If `related_contexts` references a missing context id, index generation must fail and report the missing id. Do not skip the missing context or generate partial ADR reverse links.

If a context directory exists without a matching confirmed `CONTEXT-MAP.md` entry, `lint` should report it as a semi-initialized or leftover context instead of treating it as valid.

If `CONTEXT-MAP.md` contains a context entry but `contexts/<context-id>/CONTEXT.md` is missing, empty, or still a template shell, index generation must fail because the global context entry would point to an invalid file.

`CONTEXT-MAP.md` relationships must point only to formal contexts. `lint` should report relationships that point to candidates, semi-initialized directories, or missing ids.

The first version parses only bullet lines under `## Relationships`, using `- source -> target: summary` format. `summary` is required and must describe the relationship meaning. Write bidirectional relationships as two directed lines. Self-loops and duplicate `source -> target` edges are not allowed; merge multiple meanings into one summary. Explanatory text is allowed but is not structurally validated.

Global ADR `keywords` come only from explicit ADR frontmatter `keywords`.

Global ADR entries and context `adr-link` entries use `path` as the machine alignment key. Use `name` only for display and diagnostics.

Context `adr-link` entries are reverse links. They do not copy global ADR `keywords`; keyword retrieval for ADRs should use the global ADR entry.

Candidate `keywords` and `possible_contexts` are for explicit candidate workflows only. They may be used with the filename slug and candidate `name` for deterministic deduplication during explicit candidate workflows. Candidate duplicate checks are limited to normalized slug equality, normalized `name` equality, `keywords` overlap, and `possible_contexts` overlap. Normalization only trims, lowercases, converts whitespace and `_` to `-`, collapses repeated `-`, and strips leading or trailing `-`. Do not use Chinese tokenization, pinyin, synonyms, translation, fuzzy matching, LLMs, embeddings, or semantic similarity for candidate deduplication. If a candidate create workflow finds likely duplicates, do not merge or overwrite automatically; ask whether to update an existing candidate or create a separate candidate. They are not copied into global routing indexes.

`lint` may report likely duplicate candidate documents as P2 maintenance warnings. These warnings do not block because candidates are not default routing entries; blocking confirmation happens in `create-candidate` before a new candidate is written. Put duplicate items under the P2 issue `details.duplicates[]` using the same `path`, `candidateId`, `name`, `status`, and `matchedFields[]` shape.

`lint` issues use a stable structure: `severity`, `message`, conditionally required `path`, and optional `details`. `severity` must be `P0`, `P1`, or `P2`. Include `path` for every document-level issue and for global structure issues that can point to a file, such as `docs/knowledge/CONTEXT-MAP.md`; omit it only for repository-level issues such as missing `docs/knowledge`. Machine-readable fields belong in `details`; `details` must be a JSON-serializable object and must not contain long body text or copied source document content. Do not parse `message` for workflow decisions. `line` is not a top-level issue field; put it in `details.line` only when the line number is stable. Sort `issues[]` by severity order `P0`, `P1`, `P2`, then by `path` and `message`; issues without `path` sort first within the same severity. `lint` issues do not require `code`. `lint` stdout must always include an `issues` array; emit `"issues": []` when no issues are found.

Script success and blocking state are expressed by exit code; do not require a generic `ok` field in script JSON. Use `0` for completed or P2-only results, `1` for repository-state or gate blockers, `2` for caller input errors, and `3` only when user confirmation is required and no write occurred. All internal script stdout must be valid JSON. Human-readable explanations belong in structured fields such as `message` or should be rendered by the Yog skill. Use stderr only for non-structured crashes or debugging output; normal business issues and gate results must not be written to stderr.

`match-scope` is a deterministic smoke and diagnostic helper, not the primary retrieval path. The primary path is agent semantic routing through `index.json`, `INDEX.md`, business-flow documents, `CONTEXT-MAP.md`, and then the selected context/capability/evidence documents. `match-scope` stdout must always include `query`, `matches`, and `issues`. No deterministic match is not an error; emit `"matches": []` and `"issues": []` with exit code `0`. Broken indexes, missing context indexes, unreadable paths, or inconsistent retrieval links are repository-state blockers; report them through `issues[]` and exit `1`. Invalid input JSON or invalid fields exit `2`.

When `create-candidate` finds likely duplicates, its structured output must use `code: "candidate-duplicates-found"` and `duplicates[]` items with `path`, `candidateId`, `name`, `status`, and `matchedFields[]`. `matchedFields[]` may contain only `slug`, `name`, `keywords`, or `possible_contexts`.

Reports under `changes/*.md` and `audits/*.md` are intentionally excluded from the default machine index. Directory README files, root guidance files such as `README.md` and `AGENTS.md`, reusable templates, and context `CONTEXT.md` files are also excluded.

The global machine-readable index should stay lightweight and include routing fields such as `path`, `type`, `context`, `name`, `summary`, `keywords`, `status`, `indexPath`, and `docsCount` when available. Context entries do not use `status`; ADR entries do. Agents should prefer accepted ADRs and verified local entries during retrieval where status exists.

Global context `path`, `readmePath`, and `indexPath` must stay in the same context directory: `docs/knowledge/contexts/<context-id>/CONTEXT.md`, `docs/knowledge/contexts/<context-id>/README.md`, and `docs/knowledge/contexts/<context-id>/index.json`.

`CONTEXT-MAP.md` keeps `Path` relative to `docs/knowledge/` for human editing. Generated global index entries must convert that value to target repository root-relative paths by adding the `docs/knowledge/` prefix.

Global context `path` must point to an existing `docs/knowledge/contexts/<context-id>/CONTEXT.md` with real business-language content. Missing, broken, empty, or template-shell `path` targets are gate failures, not soft warnings.

Global context `readmePath` must point to an existing `docs/knowledge/contexts/<context-id>/README.md` with real overview content. Missing, broken, empty, or template-shell `readmePath` targets are gate failures, not soft warnings.

Context `CONTEXT.md` and `README.md` files must not be empty or template shells. A file is a template shell when, after ignoring whitespace, Markdown headings, empty section headings, skeleton guidance, and placeholders, no real business content remains, or when it still contains `{...}` placeholders. The README should include at least a title and purpose or overview summary.

Capability, evidence, candidate, and ADR source Markdown files must also not be empty or template shells. They must not keep `{...}` placeholders. Template-shell capability, evidence, and ADR source documents are gate failures and must not enter generated indexes. Candidate documents are gate-checked for explicit create, review, update, and promotion workflows, but they still never enter generated routing indexes.

`{...}` placeholders are always gate failures. Common placeholder text such as `TODO`, `TBD`, `待补充`, and `待确认` is allowed only under `未确认问题` / `Open Questions`. It must not appear in index fields such as `name`, `summary`, `keywords`, `status`, `context`, `capability`, `evidence_kind`, `related_contexts`, `possible_contexts`, or `confirmation_sources`, and must not appear in core body sections.

Those placeholder texts may remain under `未确认问题` / `Open Questions` for `draft`, `needs-review`, `stale`, and `deprecated` documents. They are not allowed in `verified` documents or `accepted` ADRs.

Global context `indexPath` must point to an existing `docs/knowledge/contexts/<context-id>/index.json`. Missing or broken `indexPath` is a gate failure, not a soft warning.

The context index reached from `indexPath` must also be internally consistent: its top-level `context` and all entry `context` fields must match the path context id.

The context index reached from `indexPath` must not route local capability or evidence entries to another context directory. Cross-context links should be expressed through explicit context relationships or global ADR links, not by pointing entry paths across context directories.

Global context `docsCount` is `capabilityCount + evidenceCountTotal`, counting context index `type: "capability"` and `type: "evidence"` entries only. Do not count `adr-link`, `CONTEXT.md`, context `README.md`, directory README files, templates, or generated index files. Keep only `docsCount` in the global context entry; do not store `capabilityCount` or `evidenceCountTotal` there.

All index path fields, including `path`, `readmePath`, and `indexPath`, use paths relative to the target repository root, such as `docs/knowledge/adr/0001-refund-event-log.md`. Do not use paths relative to the context index file location.

Global context `keywords` are derived from local capability entries in the matching context index. Prefer adding synonyms and routing terms to capability `keywords`; do not maintain a separate context keyword list.

Global context `name` and `summary` come from the confirmed context entry in `CONTEXT-MAP.md`.

Capability entry `keywords` come only from explicit capability frontmatter `keywords`; do not infer them from body text.

Context index capability entries include `evidenceCount`, the number of local evidence entries bound to that capability. Count only `type: "evidence"` entries; do not count `adr-link`.

`evidenceCount: 0` is valid for non-verified capability entries. `status: verified` capability entries must have `evidenceCount > 0`.

Evidence entry `keywords` come only from explicit evidence frontmatter `keywords`; do not inherit capability keywords.

Evidence entries must include `capability`, and that capability must exist in the same context index.

Capability ids use the same rule as context ids: `[a-z][a-z0-9-]*`. The capability id must match `capabilities/<capability-id>.md`, the capability frontmatter `capability`, context index capability entries, and evidence frontmatter `capability` bindings.

Evidence files do not have a separate evidence id. The file name is the stable identifier and must use `<capability-id>-<evidence-kind>.md`, where `evidence-kind` also matches `[a-z][a-z0-9-]*`. The file-name prefix must match evidence frontmatter `capability`.

`evidence-kind` describes the evidence slice, not how it was generated. Use only `routes`, `call-flow`, `data`, `external`, `prd`, `tests`, `ui`, or `ops`. `call-flow` `调用关系` must use directed `Class#method -> Class#method` chains. Use `external` for boundary-out dependencies such as RPC/HTTP downstream calls, MQ, cache, object storage, file services, third-party SDKs, or downstream services; external evidence must include dependency anchors, callers, downstream interfaces, dependency type, trigger conditions, failure/timeout handling, boundary notes, and limitations. Store generation method details in `source`, `generator`, and `generation_evidence`; frontmatter `evidence_kind` must equal the file-name `evidence-kind`.

Context index evidence entries include `evidenceKind`, generated from Markdown frontmatter `evidence_kind`. `evidenceKind` must also match the file-name evidence kind.

Context index evidence entries stay lightweight and do not copy generation details such as `source`, `repo_commit`, `generated_at`, `generator`, or `generation_evidence`; read the source Markdown when those details are needed.

## Portability

This scheme is designed to be copied into another large repository as a small knowledge-base starter pack.

Minimum migration package:

- `docs/knowledge/README.md`
- `docs/knowledge/AGENTS.md`
- `docs/knowledge/CONTEXT-MAP.md`
- `docs/knowledge/templates/*.md`
- `docs/knowledge/adr/README.md`

Optional files:

- `docs/knowledge/INDEX.md`
- `docs/knowledge/index.json`
- `docs/knowledge/contexts/knowledge-base/CONTEXT.md`

After migration, ask the Yog skill to refresh generated indexes.

## Plugin Boundary

The first plugin version should focus on knowledge-base maintenance and retrieval:

- Initialize the `docs/knowledge` skeleton.
- Provide `README.md`, `AGENTS.md`, templates, and ADR guidance.
- Generate `INDEX.md` and `index.json`.
- Route requests by frontmatter, status, context, capability, and keywords.
- Provide archived PRD checklist guidance for future extraction workflows.
- Enforce document boundaries, status rules, and human confirmation gates.

Code-fact extraction is an evidence adapter, not the plugin core. Tools such as CodeGraph, ripgrep, tests, OpenSpec, and Git can provide evidence, but the plugin should not directly own call-graph construction, automatic business-boundary decisions, or business-code changes.

## Archived PRD Checklist

Archived PRDs may trigger or supplement knowledge documents. The first plugin phase provides checklist guidance only; automated PRD extraction belongs to a later phase. When reviewing archived PRDs, extract only durable final conclusions:

- Final business terms.
- Final boundaries.
- Final workflows.
- Upstream and downstream relationships.
- Durable constraints.
- Implementation evidence to refresh.
- Open questions that remain valid.

Do not copy requirement tasks, delivery reports, one-time verification logs, deprecated alternatives, or full PRD content into capability documents. Important long-term trade-offs may become ADRs.

## Code Facts

Implementation evidence should be generated or semi-automatically refreshed. Humans maintain summaries, business boundaries, design intent, and open questions rather than hand-maintaining long call chains.

Code evidence can be refreshed automatically. Business boundaries, terminology, design intent, and context split or merge decisions require human confirmation.
