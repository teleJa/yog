---
name: yog
description: General Yog docs/knowledge business knowledge-base skill and fallback router. Use for broad Yog questions, routing business knowledge, review or promotion workflows, business-flow overviews, calibration, or when a more specific Yog skill does not match. Prefer yog:init for knowledge-base initialization, yog:discover-candidates for candidate discovery, yog:sync-verify for sync or verify requests, and yog:wiki for focused product Wiki generation.
---

# Yog

Use Yog as the general docs/knowledge business knowledge-base skill and fallback router. For stable direct entry points, prefer:

- `yog:init` for repository initialization and the post-init discover question.
- `yog:discover-candidates` for automatic candidate discovery.
- `yog:sync-verify` for sync, verify, build-index, check-index, and lint.
- `yog:wiki` for a focused product Wiki from a confirmed menu scope, optional Record, Requirement or Spec context, and user-provided code paths.

`yog:wiki` exposes only `yog:wiki generate`. Menu descriptions define first-level directories and second-level product features. Record, Requirement, and Spec inputs are optional; only Record may create a user scenario. CodeGraph may enrich the selected implementation path but is not required because exact routes, network paths, and text search may provide partial code evidence. The MVP publishes a complete managed Wiki replacement after deterministic evidence, link, sensitive-content, and output checks; it does not expose refresh, verify, resume, Reader, or Evidence Judge workflows.

Use this general skill when the user asks to route business knowledge, review candidates, promote candidates, create a business-flow overview, test semantic recall, calibrate overlap, or when a more specific Yog skill does not match.

## Entry Rules

- Ask for the business scope before creating candidate, context, capability, or evidence documents.
- Use `docs/knowledge/index.json`, `INDEX.md`, business-flow entries, and `CONTEXT-MAP.md` for routing before scanning code. If a matching business flow exists, read it before individual contexts.
- Read candidate documents only in explicit candidate creation, review, update, or promotion workflows.
- Verify current implementation facts with CodeGraph, repository scans, or tests before making code-fact claims. Prefer CodeGraph for call-chain and symbol evidence.
- Missing CodeGraph never blocks `init`, `create-*`, `build-index`, `check-index`, `lint`, `verify`, `sync`, or `match-scope`.
- After `init`, first tell the user they can run `install-hooks.mjs` to enable the optional per-prompt reminder to read `docs/knowledge/CONTEXT-MAP.md`, then tell them automatic candidate discovery requires CodeGraph to be initialized for the target repository.
- Do not run `discover-candidates` unless CodeGraph is initialized for the target repository.

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

Exit code `0` means completed, P2-only, or a partial-success gate that still allows the next write step, such as `mid-low-scope-required`. Exit code `1` means target repository state or blocking gates. Exit code `2` means caller input error. Exit code `3` means user confirmation is required and no write occurred.

## Scripts

- `init.mjs`: copy `templates/knowledge` into the target repository, write `.yog/config.json` with default `language: "zh-CN"` and `discover.maxMidLowCandidates`, and update root `AGENTS.md` and `CLAUDE.md` managed blocks.
- `upgrade-guidance.mjs`: compare or replace target `docs/knowledge/AGENTS.md` and `README.md`, and refresh the root `AGENTS.md` and `CLAUDE.md` Yog managed blocks, with the current Yog templates.
- `install-hooks.mjs`: copy the `UserPromptSubmit` hook script into the target repository's `.claude/hooks/` and `.codex/hooks/`, upsert the Claude `.claude/settings.json` hook entry, and return a manual-enable hint for Codex `config.toml`. `payload.platforms` limits which platforms are installed.
- `reduce-candidates.mjs`: reduce 3 lens subagent JSON outputs into JOINed candidate payloads, gate on medium+low confidence count, and precheck disk duplicates without writing candidate files.
- `write-candidates.mjs`: write an allowed `reduce-candidates.mjs` result to `docs/knowledge/candidates/`, write `_gated/gated-candidates.md` when mid/low candidates are gated, and apply explicit batch duplicate decisions such as `acceptDistinct` or `updateExisting`.
- `create-candidate.mjs`: create or update a `needs-review` candidate after receiving `candidateId`, `name`, `summary`, and real body content. New discover payloads may also include `triggerSignals`, `businessMeaning`, `possibleContexts`, `keywords`, `code_symbols`, `evidence`, `notFormalReason`, and `openQuestions`.
- `create-context.mjs`: create a formal context after receiving confirmed boundary fields.
- `deep-promote-candidate.mjs`: default orchestration entry for promoting a selected candidate into a formal deep context. It materializes or validates anchors and capability plan, blocks missing `call-flow` / `data` / `external` evidence, calls `promote-candidate.mjs`, and returns `promotionMode`, `shallowDraft`, `qualityIssues`, `statusDecisions`, and `evidenceDepth`.
- `promote-candidate.mjs`: lower-level write entry that promotes an existing candidate after the caller has already assembled `capabilities[]` and `capabilityPlan`. Routes-only promotion is blocked unless `payload.allowShallowDraft: true` is passed explicitly; that output is marked `promotionMode: shallow-draft`.
- `create-capability.mjs`: create a `draft` capability under an existing context.
- `create-evidence.mjs`: create a `draft` evidence document under an existing capability.
- `build-index.mjs`: rebuild global and context indexes.
- `check-index.mjs`: compare generated indexes without writing.
- `lint.mjs`: report P0/P1/P2 knowledge-base issues.
- `verify.mjs`: run `check-index` and `lint` without writing.
- `sync.mjs`: run `build-index` and `lint`.
- `match-scope.mjs`: return deterministic business-flow, context, ADR, capability, and evidence matches for smoke checks and diagnostics. It is not the primary semantic retrieval path; normal agent routing should read `index.json`, `INDEX.md`, business-flow documents, and `CONTEXT-MAP.md`.

## Optional: Multi-repo Router Extension

`generate-router.mjs` is an **optional extension, not part of the core single-repo protocol**. Every core script above takes a single-repo `{repoRoot}` input and serves one knowledge base; `generate-router` instead takes a *manifest of repositories* and serves aggregate workflows that orchestrate many repos. Aggregate workflows use it on demand; single-repo Yog usage never needs it.

- `generate-router.mjs`: pure list transformation. Reads a `router-input` (`{schemaVersion, repositories:[{repo,path,remote,knowledgeRoot,yogInitialized}]}`) on stdin, writes a thin repository-location index (`{schemaVersion, kind:"router", generated_at, entries:[{type:"repository",...}], issues}`) on stdout. It **never reads any repository's internals** — it does not require repos to be mounted and does not touch the single-repo boundary. This is the first layer of a two-layer router: it locates *which repo* a need belongs to; the second layer (reading contexts/capabilities/evidence) is each repo's own Yog index. `repo` must match `ID_PATTERN`; each entry needs at least one of `path`/`remote`; `yogInitialized:false` repos still appear (so consumers can degrade); duplicate `repo` and missing fields are reported as P1 issues. The caller (workflow adapter) is responsible for probing `yogInitialized` (via the target repo's `.yog/config.json`) and for user confirmation before writing the output. See the integration guide for the full contract.

## Prompt Hook Integration

`install-hooks.mjs` is optional and separate from `init`. It wires a `UserPromptSubmit` hook that, on every user prompt, injects a short instruction pointing the agent at `docs/knowledge/index.json`, `INDEX.md`, and `CONTEXT-MAP.md`, with business-flow matches as the preferred end-to-end overview before context drill-down.

- The hook is an enhancement, not a gate. The root managed block SOP is the baseline and works without any hook.
- After a successful `init.mjs` run, proactively offer this step before moving on to `discover-candidates`; do not leave it discoverable only through the scripts list.
- The hook script is copied into the repository (`.claude/hooks/` and `.codex/hooks/`) so it travels with the repo and is invoked by relative path.
- Claude Code is configured automatically via `.claude/settings.json`. Codex is not: `install-hooks.mjs` only copies the script and returns a manual `config.toml` hint (`[features] hooks = true` plus a `[hooks]` entry), because the exact Codex TOML syntax is version-dependent and must not overwrite a user's existing config.
- The copied hook script always emits single-line JSON and exits `0`; it never blocks a prompt. When `CONTEXT-MAP.md` is absent it injects a notice that the knowledge base is not initialized.
- `install-hooks.mjs` is the single entry point for both installing and updating the hook. It is idempotent: it overwrites the copied script with the current plugin version every run and de-duplicates the Claude settings entry. To refresh an outdated hook script in a repository, rerun `install-hooks.mjs`; `upgrade-guidance.mjs` does not touch hook scripts.

## Init And Candidate Discovery

`init.mjs` is the init step. It must succeed without CodeGraph because it only creates `docs/knowledge`, `.yog/config.json`, and managed guidance blocks.

`init.mjs` must not overwrite existing `docs/knowledge/**` files. It initializes `business-flows/` and `templates/business-flow.md` so a business operation overview can connect multiple contexts. When an existing repository needs the current Yog guidance text, run `upgrade-guidance.mjs` explicitly. Without `payload.apply: true`, it reports P2 differences and does not write. With `payload.apply: true`, it replaces `docs/knowledge/AGENTS.md` and `docs/knowledge/README.md` from the current templates, and rewrites the Yog managed block inside the root `AGENTS.md` and `CLAUDE.md` while preserving the rest of those files. This is allowed because these files and blocks are guidance, not business knowledge source documents.

`init.mjs` writes `.yog/config.json` with `discover.maxMidLowCandidates: 10` by default. Existing repositories that do not have this field fall back to 10 during discovery. `payload.maxCandidates` on `reduce-candidates.mjs` is an explicit per-run override for the same medium+low threshold and must be a positive integer.

After init, recommend `install-hooks.mjs` as the optional next step that makes Yog context routing active on every prompt. Continue to `discover-candidates` only when this condition is true:

- CodeGraph is initialized for the target repository and can answer code-structure queries.

If CodeGraph is missing, stop discovery and tell the user to initialize CodeGraph. Do not fall back to filename-only or `rg`-only discovery for automatic candidates.

If the user only asks for init, stop after `init.mjs`, report that `install-hooks.mjs` was not executed, and report that `discover-candidates` was not executed. If the user asks to test whether init can generate business documents, discover candidates, scan business boundaries, or otherwise produce candidate knowledge, init alone is not complete. First offer the hook step, then continue through the discovery workflow when the required tools are available and report candidate results.

Before discovery, verify that the target repository has `docs/knowledge/templates/candidate.md`. If it is missing, stop and ask to rerun `init.mjs`.

`discover-candidates` is an agent workflow, not a standalone Node script. It has three stages:

1. Stage A, preflight and task split: verify CodeGraph is initialized for the target repository and `docs/knowledge/templates/candidate.md` exists.
2. Stage B, parallel read-only fan-out: run 3 code evidence lenses against the same repository. `controller-route-agent` scans controllers, Feign/Dubbo services, HTTP routes, and client entries. `service-flow-agent` uses CodeGraph to scan service call chains, core business services, and cross-service dependencies. `data-contract-agent` scans mappers, entities, DTOs, XML, table contracts, cache, states, and messages. Do not include a docs-scan-agent in discover; docs, OpenSpec, PRD, README, and requirement prose are promote/enrich references, not discover truth sources.
3. Stage C, deterministic reduce and write: pass the 3 subagent JSON outputs to `reduce-candidates.mjs`; when it returns `gate: ok` or `gate: mid-low-scope-required` with exit code `0`, pass the reduce output to `write-candidates.mjs`. Stop before write on input errors, blocking gates, or duplicate confirmation exits. Do not loop over `create-candidate.mjs` directly for automatic discovery batches.

If a Stage B subagent times out, the main agent must run one bounded inline fallback for that same lens before reducing. Do not start another subagent for the retry. Keep the fallback narrow, usually 5 minutes or a small file/symbol budget, and record it as `<agent>-inline-fallback` with the same JSON schema plus `fallback_for`, `timed_out_source: true`, `fallback_budget`, and any partial timed-out output. For `controller-route-agent`, the inline fallback scans only controllers, Feign/Dubbo interfaces, route mappings, and client entry points. For `service-flow-agent`, use CodeGraph to inspect only the most central service symbols and direct call edges. For `data-contract-agent`, scan only mapper/entity/DTO/XML/table/message contracts. If inline fallback also cannot produce evidence, report missing coverage and lower the confidence of the discover result; do not fabricate a lens result. Inline fallback must not bypass the CodeGraph precondition.

Each subagent final message must be a JSON object with `agent`, `scan_scope`, `tools_used`, `candidates[]`, and `skipped[]`. Each candidate must include `candidateId`, `name`, `summary`, `business_boundary`, `responsibilities_hint`, `non_responsibilities_hint`, `code_symbols`, `evidence_paths`, `keywords`, `possible_contexts`, `confidence`, `confidence_reason`, and `skip_reason`. `code_symbols` is required and must use canonical forms such as `Class#method`, `Class`, `MapperClass#statementId`, or `InterfaceClass#method`; paths, routes, table names, cache keys, and prose are evidence, not strong JOIN symbols. For better JOIN precision, candidates may also provide `identity_symbols` and `supporting_symbols`: `identity_symbols` are the narrow object identity used for automatic JOIN, while `supporting_symbols` are preserved as evidence but do not JOIN clusters. When `identity_symbols` is omitted, `code_symbols` is treated as the identity set for backward compatibility.

`reduce-candidates.mjs` is the only allowed aggregation path. Automatic JOIN uses only canonical `identity_symbols` intersections. `candidateId`, `name`, `keywords`, and `possible_contexts` similarities must only appear as `possibleDuplicates` hints; they must not merge candidates. Two candidates from the same subagent are not automatically JOINed even when they share an identity symbol, unless both explicitly set `allow_same_agent_join: true`; otherwise the reduce output records a `joinConflicts[]` entry for review. The reduce report must include `raw`, `afterFormat`, `clusters`, `writable`, `lowConfidence`, `high`, `midLow`, `threshold`, `thresholdSource`, `possibleDuplicates`, `joinConflicts`, `rejected`, and `diskDuplicates` statistics, plus each written candidate's hit agents, canonical identity/supporting/code symbols, evidence sources, and normalized confidence. Normalized confidence is a review priority.

### Subagent Timeout Discipline

Any Yog workflow that starts subagents must include an explicit timeout discipline before fan-out begins. This applies to discover lenses, promotion evidence gathering, semantic recall tests, and post-generation calibration.

- Give each subagent a bounded task and state the expected deadline in its prompt.
- When waiting for subagents, use an explicit timeout when the orchestration tool supports one. Recommended defaults are 10-15 minutes for code discovery lenses and 5-10 minutes for semantic recall probes.
- If a subagent times out, record `timed_out: true`, the agent role, elapsed time, and any partial output. Do not silently count it as a failed recall or a successful scan.
- For discover-candidates, run one bounded inline fallback in the main agent for the timed-out lens before reducing results. Do not spawn a replacement subagent. If fallback fails, report missing coverage and reduced confidence.
- Do not block the critical path on closing old or completed subagents. If subagent capacity is exhausted, prefer reusing an existing idle/completed agent with a fresh interrupting task, reduce fan-out, or continue the remaining work locally.
- Never bulk-close many subagents in parallel as part of the main Yog workflow. Closing agents is cleanup, not a generation or validation gate.
- If too few subagent results return before timeout, either continue with a clearly marked reduced-confidence result or stop and report the missing coverage; do not fabricate the missing lens or recall result.

Candidate discovery may automatically write `needs-review` documents under `docs/knowledge/candidates/`. These candidates never enter generated routing indexes. If medium+low confidence candidates exceed `discover.maxMidLowCandidates` (default 10), `reduce-candidates.mjs` returns `gate: mid-low-scope-required` with exit code `0`; high confidence candidates remain in `writable`, medium/low candidates are listed in `gatedCandidates[]`, and `write-candidates.mjs` writes `docs/knowledge/candidates/_gated/gated-candidates.md` with the blocked medium/low list and threshold stats. High confidence candidates must still pass `diskDuplicates` and `batchDuplicates`; do not bypass duplicate confirmation. If `write-candidates.mjs` reports duplicate candidates, provide explicit `payload.duplicateDecisions.acceptDistinct` for candidates confirmed to be separate business objects, or `payload.duplicateDecisions.updateExisting` to update an existing candidate. The write result records `confirmedDuplicates[]` and `gatedReportPath` for audit.

Each auto-discovered candidate body must include:

- discovery sources, such as the 3 code evidence lenses and CodeGraph;
- execution-structure evidence references, such as files, canonical symbols, routes, services, mappers, DTOs, entities, or message contracts;
- a confidence note, normally `low` or `medium`, explaining why it remains `needs-review`.

Candidate frontmatter must persist canonical `code_symbols`. Candidate body sections must not be empty: `触发信号`, `可能的业务含义`, `可能归属的上下文`, `相关证据`, `为什么暂不创建正式 Context`, `需要确认的问题`, and `处理结果` must contain either real content or an explicit `[待补充：...]` fallback.

After discovery, run `sync.mjs` and `verify.mjs`. The final report must include `candidate_count`, candidate paths, candidate status values, confidence notes, `gatedReportPath` when present, and whether candidates entered generated indexes. Candidates should not enter `index.json` or `INDEX.md`. If discovery writes no candidates, report `candidate_count: 0` and the reason, such as missing tools, no stable business signal, only medium/low candidates exceeded the threshold, or duplicate candidates awaiting confirmation.

## Candidate Promotion

Promoting a candidate to a formal context must not create an empty context shell. Before calling `promote-candidate.mjs`, gather enough real business boundary and code evidence to create at least one capability and at least one evidence document.

Promotion is now a staged workflow. For a user-selected candidate, prefer `deep-promote-candidate.mjs` as the default entry point. Use `promote-candidate.mjs` directly only for already-deepened payloads, or for an explicit shallow draft with `allowShallowDraft: true`.

1. Run `extract-promote-anchors.mjs` or assemble the same structure from candidate notes and discover lens outputs. Keep entry paths, service roots, data objects, external dependencies, operations, source lenses, and unassigned anchors separate.
2. Run `plan-capabilities.mjs` before writing documents. Do not write when the plan has no capability, a capability has no traceable anchor, or unassigned anchors lack an explicit decision.
3. Deepen evidence for each planned capability. Prefer `call-flow`, `data`, and `external` evidence in addition to `routes`; routes-only is shallow evidence and must be reported as a quality issue.
4. If the agent writes prescriptive guidance, provide structured guidance arrays with concrete anchors. The script validates schema and anchors; rejected guidance is not rendered and does not stamp `guidance_reviewed_at`.
5. Call `deep-promote-candidate.mjs` for normal promotion. It will materialize the same capability plan when possible and block before writing when deep evidence is incomplete.
6. Call `promote-candidate.mjs` directly only after the plan and evidence are assembled. The payload must include `capabilityPlan` (or `planOutput` / `plan`) from `plan-capabilities.mjs`; direct candidate-to-doc promotion without a plan is rejected. Routes-only payloads must not be written unless the caller passes `allowShallowDraft: true`, and then the result is an explicit shallow draft rather than a deep promotion. The promote output must be treated as machine-readable: inspect `promotionMode`, `shallowDraft`, `qualityIssues[]`, `statusDecisions[]`, `evidenceDepth`, `guidanceIssues[]`, `repoCommit`, and `unknownRepoCommitEvidence[]` in addition to document paths.

For large repositories, spawn focused subagents in parallel when useful:

- one subagent verifies business boundary, terms, responsibilities, and non-responsibilities from existing docs, PRDs, OpenSpec, and candidate notes;
- one subagent uses CodeGraph to locate symbols, entry files, code ownership boundaries, routes, services, mappers, call paths, and related code facts.

Apply the Subagent Timeout Discipline above whenever these subagents are used. Record timed-out or missing subagent evidence in the final report instead of waiting indefinitely or blocking on agent cleanup.

Do not deep-promote if CodeGraph is required for the repository but unavailable. Stop and report the missing initialization step instead of creating placeholder capability or evidence documents. If the user explicitly wants a partial artifact for review, use `promote-candidate.mjs` with `allowShallowDraft: true` and report `promotionMode: shallow-draft`.

Call `promote-candidate.mjs` only after assembling a payload with `capabilities[]` and the matching `capabilityPlan`. Each capability must include real `capabilityId`, `name`, `summary`, `responsibilities`, `nonResponsibilities`, and `body`. Each capability must include at least one `evidence[]` item with real `evidenceKind`, `name`, `summary`, `source`, `generator`, `generation_evidence`, and `body`; include structured sections such as `entryPaths`, `routes`, `callRelations`, `dataMessages`, `externalDependencies`, `frontendEntries`, and `limitations` when available. `call-flow` evidence must use directed `Class#method -> Class#method` chains in `callRelations`. `external` is a first-class evidence kind for boundary-out dependencies and must record dependency anchors, callers, downstream interfaces, dependency type (`rpc`, `http-api`, `mq`, `cache`, `object-storage`, `file-service`, `third-party-sdk`, or `downstream-service`), trigger conditions, failure/timeout handling, boundary notes, and limitations.

After promotion, run `sync.mjs` and `verify.mjs`. The final report must include `contextPath`, `capabilityPaths`, `evidencePaths`, `changePath`, `docsCount`, `candidateRemoved`, `promotionMode`, `shallowDraft`, `qualityIssues[]`, `statusDecisions[]`, `evidenceDepth`, `guidanceIssues[]`, `repoCommit`, and `unknownRepoCommitEvidence[]`. If `docsCount` is 0, treat the promotion as failed and investigate before reporting completion. When `promotionMode` is `shallow-draft`, do not report deep promotion as complete; tell the user which evidence kinds are missing. When git HEAD is available, explicit `repo_commit: unknown` is a write blocker; when git HEAD is unavailable, `unknownRepoCommitEvidence[]` lists the affected evidence paths and reason.

## Post-generation Calibration

After generating or promoting multiple contexts, run an agent semantic recall check and prepare an overlap calibration report when there are overlap signals. Overlap is not an error by itself; it is a calibration candidate.

Yog must not decide context boundaries on its own. Only the user can decide whether suspected overlap should become a merge, split, rename, relationship, or no-op. The report should list evidence and options, not a forced conclusion.

Overlap signals include:

- shared business terms in `name`, `summary`, responsibilities, non-responsibilities, keywords, or business-flow reading order;
- `possibleDuplicates[]`, `confirmedDuplicates[]`, or duplicate decisions from candidate reduce/write flows;
- agent semantic recall results where the same query reasonably selects multiple contexts;
- recurring business-flow adjacency between the same contexts;
- missing `CONTEXT-MAP.md` relationships that force agents to infer whether contexts are overlapping or merely upstream/downstream.

For each suspected overlap, report the context ids, triggering signals, example user queries, affected business-flow sections, and decision options:

- keep separate and add explicit `CONTEXT-MAP.md` relationship;
- merge contexts;
- rename or rewrite responsibilities/non-responsibilities;
- mark as `needs-review` and defer;
- gather more code or business evidence before deciding.

Apply changes to `CONTEXT-MAP.md`, context summaries, responsibilities, non-responsibilities, keywords, or business-flow reading order only after the user makes a decision.

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
