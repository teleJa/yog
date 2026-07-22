---
name: wiki-query
description: Read-only product query over a Yog-managed docs/wiki. Use for product hierarchy, features, rules, states, permissions, data, interfaces, metrics, quality, and user scenarios.
---

# Yog Wiki Query

This Skill is read-only. It never generates, updates, syncs, verifies by mutation, or modifies Wiki content. The only write-side exception is an orchestrator handoff after deterministic `invalid-wiki`; the separate internal `yog:wiki audit` action persists the integrity report outside `docs/wiki`.

## Root And Ownership Preflight

Locate the Wiki from a user-provided root or current `docs/wiki`. If an explicit product query has no discoverable root, ask once. In an automatic dual query, mark Wiki `unavailable` and let the independent Knowledge query continue.

Read `_meta/manifest.json` first. Continue only when it has `schemaVersion: 1`, exact `managedBy: yog:wiki`, and `kind: yog-product-wiki-manifest`. Any old or unknown ownership is `not-managed`; do not read Catalog/pages, suggest takeover, or attempt migration.

Before product facts, require valid and matching:

1. Manifest and `_meta/model.json` with `kind: yog-product-wiki-model`;
2. the lightweight `_meta/catalog.json`, `_meta/flows.json`, and `_meta/reviews.json` System indexes, their referenced System shards, `claims.json`, `evidence.json`, `relationships.json`, `coverage.json`, and `state-machines.json`;
3. Manifest/model/page/projection hashes and page frontmatter identity;
4. System/Domain/Module/Feature and Object references;
5. Relationship endpoints plus Claim/Evidence refs;
6. source snapshot and publication metadata.

Structural failure returns `invalid-wiki`, emits no product conclusion, does not scan additional pages or suggest regeneration, and hands one integrity artifact to `yog:wiki audit`.

`_meta/model.json` is reserved for deterministic integrity, update, and sync machinery. Never load or quote the complete canonical model into the conversational context. Perform integrity checks programmatically and navigate product queries through the two-level Catalog projections.

Then evaluate `docs/wiki-audits` as a deterministic query gate. Use only unresolved P0/P1 findings whose `wikiRunId + manifestHash` exactly match the current snapshot. A whole-Wiki finding, malformed managed Audit block, or findings covering every Claim returns `invalid-wiki`. A finding covering some Claims filters them and forces `partial`. A matching idempotent resolution releases the finding. Never output a blocked Claim.

Apply the same Claim-level gate to expired Source Snapshot entries. Filter every Claim whose Evidence comes from an expired Source; return `partial` when fresh Claims still answer part of the question and `invalid-wiki` when all Claims are blocked. Report the stale Source IDs and never use an expired Claim as a product conclusion.

## Read Order And Scope

Read in this order:

1. read only the required Manifest ownership/identity fields, the first-level `_meta/catalog.json`, Coverage, and source freshness summary;
2. select one System and read only its referenced `_meta/catalog/<system-id>.json` shard;
3. for a Flow question, read `_meta/flows.json`, only the selected `_meta/flows/<system-id>.json` shard, `知识对象/业务流程/目录.md`, and one target Flow page; do not read another System Flow shard unless the question crosses that boundary;
4. for product review or approved-baseline impact, read `_meta/reviews.json`, only the selected `_meta/reviews/<system-id>.json`, one Feature review shard, and its Feature page; pending proposals are low-confidence candidates, while only Requirement/Human-confirmed Expected Claims are approved baseline;
5. use its stable ref and page path to locate the relevant Feature or Object, then filter Relationships by that ref;
6. filter Claims by `subjectRef` and allow only `factLevel: confirmed | partial`;
7. read only the matched Markdown pages, then filter State Machines or Evidence by referenced IDs when needed for boundaries or provenance.

For Flow answers, preserve the page's three independent conclusions: Current overview path, State applicability/projection, and Sequence applicability/projection. Do not turn an unknown view into a product fact, combine mutually exclusive sequence groups into one global order, or present Expected-only nodes/messages/transitions as Current.

Supported product subjects include System, Domain, Module, Feature, Page, Operation, Scenario, Flow, State Machine, Rule, Role, Permission, Data Entity, Metric, Interface, Requirement, Acceptance Criteria, and Version. T16-T21 are projections, not extra truth sources.

Do not read, cite, or display `needs-review` Claims, Gap, Conflict, pending-question content, or internal diagnostics as product facts. Mark a partial Claim with its confirmed and missing scope. If filtering leaves no permitted facts, return `not-found`.

Never read `docs/knowledge`, call CodeGraph, scan code, call TAPD, query a database, read provider payloads, access the network, or invoke Wiki maintenance. If the user asks for implementation evidence, recommend explicit `yog:knowledge-query`.

## Result Contract

Return:

1. `result_status: ok | partial | not-found | not-managed | unavailable | invalid-wiki`;
2. concise product conclusions and relevant T16-T21 page references;
3. subject kind and stable ref, plus roles, operations, rules, states, permissions, data, metrics, or interfaces used;
4. each used `fact_level`, preserving Expected/Current/Observed boundaries;
5. generation time, source snapshot ID/status/revision or freshness limitation, confirmed scope, missing scope, and Wiki file references.

Use `partial` if any used Claim is partial, an Audit blocks only part of the answer, source coverage is degraded, or only part of the question is answerable. Terminal statuses take precedence. Use `ok` only when all conclusions use unblocked confirmed Claims and the requested scope is fully covered.
