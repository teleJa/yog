---
name: discover-candidates
description: Discover Yog candidate contexts for docs/knowledge. Use when users ask to discover candidates, find candidate contexts, scan business boundaries, generate needs-review candidates, or run Yog candidate discovery.
---

# Discover Candidates

Use this skill when the user asks to discover candidate business contexts. This skill discovers `needs-review` candidates only; it does not promote candidates into formal contexts.

## Preconditions

- Confirm the repository has already been initialized with Yog.
- Confirm `docs/knowledge/templates/candidate.md` exists.
- Confirm CodeGraph is initialized for the target repository and can answer code-structure queries.
- If CodeGraph is missing, stop and ask the user to initialize CodeGraph. Do not fall back to filename-only, directory-only, or `rg`-only discovery.

## Workflow

1. Confirm business scope before scanning. If scope is broad and likely to produce many medium/low confidence candidates, tell the user the default `discover.maxMidLowCandidates` threshold is 10 and can be overridden per run with `payload.maxCandidates`.
2. Start 3 read-only subagents with 10-15 minute timeouts:
   - `controller-route-agent`: controllers, Feign/Dubbo services, HTTP routes, client entries.
   - `service-flow-agent`: service call chains, core business services, cross-service dependencies.
   - `data-contract-agent`: mappers, entities, DTOs, XML, table contracts, cache, states, messages.
3. Subagents must not write `docs/knowledge`.
4. If a subagent times out: Do not spawn a replacement subagent. The main agent must run one bounded inline fallback for that same lens before reduce:
   - keep the fallback narrow, usually 5 minutes or a small file/symbol budget;
   - `controller-route-agent` fallback scans only controllers, Feign/Dubbo interfaces, route mappings, and client entry points;
   - `service-flow-agent` fallback uses CodeGraph for the most central service symbols and direct call edges only;
   - `data-contract-agent` fallback scans only mapper/entity/DTO/XML/table/message contracts;
   - return JSON as `<agent>-inline-fallback` with `fallback_for`, `timed_out_source: true`, `fallback_budget`, `candidates[]`, and `skipped[]`;
   - if fallback cannot produce evidence, report missing coverage and lower confidence; do not fabricate results.
5. Each subagent or inline fallback must return JSON with `agent`, `scan_scope`, `tools_used`, `candidates[]`, and `skipped[]`.
6. Each candidate must include `candidateId`, `name`, `summary`, `business_boundary`, `responsibilities_hint`, `non_responsibilities_hint`, `code_symbols`, `evidence_paths`, `keywords`, `possible_contexts`, `confidence`, `confidence_reason`, and `skip_reason`.
7. `code_symbols` must use canonical forms such as `Class#method`, `Class`, `MapperClass#statementId`, or `InterfaceClass#method`.
8. Pass the 3 lens outputs, including inline fallback output when used, to `reduce-candidates.mjs`.
9. When reduce returns `gate: ok` or `gate: mid-low-scope-required` with exit code `0`, pass the reduce output to `write-candidates.mjs`. Stop before writing on input errors, blocking gates, or duplicate confirmation exits.
10. If reduce or write reports duplicates, stop and ask for the user's duplicate decision. Do not auto-merge.
11. Run `sync.mjs` and `verify.mjs` after candidates are written.

## Reporting

Report:

- raw candidate count
- post-JOIN candidate count
- written candidate count and paths
- rejected / lowConfidence / possibleDuplicates / joinConflicts / diskDuplicates
- high / midLow / threshold / thresholdSource
- gatedReportPath and gatedCandidates count when medium/low candidates are gated
- candidate status values
- whether candidates entered `index.json` or `INDEX.md` (expected: no)
- timed-out subagents, inline fallback coverage, and remaining missing coverage
- `sync` and `verify` results

## Boundaries

- Do not promote candidates.
- Do not create formal contexts, capabilities, evidence, or business flows.
- Do not use docs, PRD, OpenSpec, README, or requirement prose as discover truth sources. They may be used later during promotion or enrichment.
- Do not fabricate subagent results, CodeGraph evidence, command exit codes, or verification results.
- Do not bypass `diskDuplicates` or `batchDuplicates` for high confidence candidates under `mid-low-scope-required`.
