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

1. Confirm business scope before scanning. If scope is broad and likely to produce more than 10 candidates, ask the user to narrow it.
2. Start 3 read-only subagents with 10-15 minute timeouts:
   - `controller-route-agent`: controllers, Feign/Dubbo services, HTTP routes, client entries.
   - `service-flow-agent`: service call chains, core business services, cross-service dependencies.
   - `data-contract-agent`: mappers, entities, DTOs, XML, table contracts, cache, states, messages.
3. Subagents must not write `docs/knowledge`.
4. Each subagent must return JSON with `agent`, `scan_scope`, `tools_used`, `candidates[]`, and `skipped[]`.
5. Each candidate must include `candidateId`, `name`, `summary`, `business_boundary`, `responsibilities_hint`, `non_responsibilities_hint`, `code_symbols`, `evidence_paths`, `keywords`, `possible_contexts`, `confidence`, `confidence_reason`, and `skip_reason`.
6. `code_symbols` must use canonical forms such as `Class#method`, `Class`, `MapperClass#statementId`, or `InterfaceClass#method`.
7. Pass the 3 subagent outputs to `reduce-candidates.mjs`.
8. Only when reduce returns `gate: ok`, pass the reduce output to `write-candidates.mjs`.
9. If reduce or write reports duplicates, stop and ask for the user's duplicate decision. Do not auto-merge.
10. Run `sync.mjs` and `verify.mjs` after candidates are written.

## Reporting

Report:

- raw candidate count
- post-JOIN candidate count
- written candidate count and paths
- rejected / lowConfidence / possibleDuplicates / joinConflicts / diskDuplicates
- candidate status values
- whether candidates entered `index.json` or `INDEX.md` (expected: no)
- timed-out or missing subagent coverage
- `sync` and `verify` results

## Boundaries

- Do not promote candidates.
- Do not create formal contexts, capabilities, evidence, or business flows.
- Do not use docs, PRD, OpenSpec, README, or requirement prose as discover truth sources. They may be used later during promotion or enrichment.
- Do not fabricate subagent results, CodeGraph evidence, command exit codes, or verification results.
