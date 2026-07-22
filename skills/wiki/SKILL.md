---
name: wiki
description: Build and maintain the Chinese Yog product Wiki. Use yog:wiki generate, update, sync, or verify for the managed T16-T21 lifecycle; audit is an internal integrity write outside docs/wiki.
---

# Yog Product Wiki

The user-facing actions are:

```text
yog:wiki generate
yog:wiki update
yog:wiki sync
yog:wiki verify
```

Use the unreleased `schemaVersion: 1` product-Wiki contract directly. Its ownership is exactly `managedBy: yog:wiki`, its canonical kind is `yog-product-wiki-model`, and its Manifest kind is `yog-product-wiki-manifest`. Do not accept a retired ownership contract, migrate an old Wiki, maintain dual protocols, or fall back to the former feature-group directory.

`yog:wiki audit` is an internal write action. It accepts only a structured `invalid-wiki` artifact handed off by `wiki-query`, invokes `skills/yog/scripts/wiki-audit.mjs`, and writes `docs/wiki-audits/YYYY-MM-DD.md`. It must not call a generator, scan Wiki pages, modify `docs/wiki`, or output product conclusions.

## Input And Authorization Gate

Before collecting evidence, require:

1. an absolute output root and the configured Wiki root, normally `docs/wiki`;
2. a user-confirmed Catalog scope that can identify System, Domain, Module, and Feature;
3. one or more user-authorized Code roots;
4. explicit bounded scopes for every remote Requirement or Database source.

Every generate or update run must pass the machine-enforced authorization sequence:

1. `prepare-wiki.mjs` validates the proposed `wiki.sources[]`, normalizes set-like scope fields, marks every Source decision pending, and returns a reviewable collection plan plus Wiki-level `inputFingerprint` and per-Source `scopeFingerprint` values. It performs no collection.
2. Present the output target, enabled and disabled Source set, semantic scopes, transports, and expected degradation behavior to the user. Do not infer approval from a prior Artifact or from collection success.
3. `confirm-wiki-sources.mjs` accepts the exact prepare fingerprints and one decision for every enabled Source. Confirmation binds the absolute `outputRoot`, `wikiRoot`, the complete enabled/disabled Source set, and every semantic scope. Any target, Source, transport, or scope change invalidates confirmation; set reordering does not.
4. Only after confirmation may Provider collection start. Create every Artifact envelope with `createSourceArtifactEnvelope()` so it inherits the confirmed Source identity and scope fingerprint.
5. `stage-wiki-input.mjs` derives `configuredSources`, `wikiRoot`, and `inputConfirmation` only from the confirmed config, cross-checks every Source Result and Artifact payload against the confirmed scope, and accepts only a generic `semanticDraft` beside those inputs. Generate/update invokes the Yog-owned model composer before the independent model validator; direct library calls cannot bypass the authorization gate.

The persisted `inputConfirmation` summary belongs in the canonical model, Source Snapshot, and Manifest. Verify and Wiki Query preflight must recompute it and require all three copies to agree. It contains fingerprints and Source identities only, never credentials or connection details. CLI exit code `3` means confirmation is required; malformed or invalid caller input uses exit code `2`.

Read `<outputRoot>/.yog/config.json` when present. `wiki.sources[]` is the only source configuration contract. Do not read or synthesize `wiki.requirementProvider`, provider-specific top-level aliases, or credentials in configuration.

Each Source has a stable `id`, `kind`, `provider`, `enabled`, `required`, `scope`, optional freshness/limits, and ordered transports. The first-release registry is:

| Kind | Provider | Transport | Purpose |
| --- | --- | --- | --- |
| `catalog` | `menu-json` | `file` | Product hierarchy and identity |
| `code` | `git-worktree` | `file`, optional `codegraph` | Current implementation behavior |
| `requirement` | `tapd` | `mcp` | Expected goals, scope, rules, and acceptance |
| `database` | `postgres`, `mysql` | `ddl-file`, `migration-files`, `schema-dump`, `read-only-introspection` | Metadata-only deployed data structure |
| enhancement | `spec`, `record`, `knowledge` | registered provider transport | Decisions, observations, tests, or verified implementation evidence |

Never infer a remote scope, scan every visible TAPD project, scan personal directories, ask for a pasted token, or store a credential value. A remote or Database scope must contain `confirmedByUser: true` before collection.

## Source Collection Rules

Normalize every provider response to a Source Result with a registered status and deterministic `reasonCode`. A collected source records `capturedAt`, `sourceRevision`, `fingerprint`, artifact count, transport results, and diagnostics. Provider-native payloads do not enter the canonical model or renderer.

Build normalized Artifacts before the product model:

- Catalog Artifact: scope, stable source identities, ordered System/Domain/Module/Feature nodes, parent links, route keys, and Evidence IDs.
- Code Artifact: bounded repositories with a required `surface` of `frontend | backend | infrastructure | database | test | unknown`, plus atomic implementation facts whose locators declare `precision: file | line | symbol`. File precision carries no line range; line/symbol precision requires a real range, and symbol precision also requires the symbol name.
- Requirement Artifact: confirmed scope, layered queries, classified candidates, real provider hierarchy, normalized status, adoption decision, and cross-validation Evidence.
- Database Artifact: provider, transport, environment, engine version, `metadata-only` capture policy, schemas, tables, views, columns, constraints, indexes, sequences, triggers, enums, and access controls.

Catalog is the only authority allowed to create or rename System, Domain, Module, and Feature nodes. Code proves Current product behavior but not original intent. Requirement and Spec support Expected intent but do not prove Current implementation. Database proves deployed structure and constraints but not product meaning or runtime usage. Record and tests support only the Observed scope they actually cover. Verified Knowledge is an alternate route to underlying Code authority and never receives a Wiki back-reference.

Catalog is a hierarchy and identity authority, not a content-discovery whitelist. The semantic workflow runs two bounded discovery tracks: analyze each Catalog Feature for menu functionality, and use authorized Spec goals, actors, system names, MQ/callback terms, and domain vocabulary to discover system-level Flow candidates in authorized Code roots. A non-menu Flow uses a confirmed System subject such as `system:course-system`; it may reference an existing Feature, but must never create, rename, or hide a Feature. A Flow that cannot route to a confirmed Catalog System stays in exclusion diagnostics and never enters the canonical model.

Spec statements create Expected Claims only. Controller, Service, MQ, callback, state persistence, and runtime authorization require Code/Test Current Claims. Never promote Spec into Current merely because a matching implementation name exists.

An Evidence ID is atomic across every Artifact: it identifies exactly one fact, locator, and execution surface. Reusing it across Catalog nodes, Code facts, Database objects, or otherwise incompatible locations fails closed. Database schemas, tables, columns, constraints, indexes, and access controls therefore use distinct Evidence IDs.

For TAPD, require a confirmed workspace/project/item scope, query explicit IDs before exact catalog names and capability terms, restore hierarchy only from provider relations, and classify each candidate. Only a completed product requirement with Requirement Evidence plus Code or Database cross-validation may be adopted as a Current-supporting candidate. Tasks, tests, defects, in-progress or terminated items, weak matches, and out-of-scope items stay excluded or conflicting.

Database collection is metadata-only:

- Live introspection is disabled by default.
- PostgreSQL queries may read only `pg_catalog` and `information_schema`; MySQL queries may read only `information_schema`.
- Use a read-only transaction, configured timeout, object limit, and allowlisted `SELECT` plans.
- Never read business rows, sample values, request data, or query arbitrary business tables/views.
- Reject Artifacts containing `rows`, `sample`, `data`, credentials, connection strings, or customer values.

## Readiness And Authority

Catalog plus Code are global hard gates. Missing, failed, invalid, or stale required Catalog/Code blocks formal generation.

Requirement absence is degradable: generate the page, expose background/scope/acceptance Gaps, and do not mark the affected Feature complete. Database is a per-Feature conditional gate through the single `dataSourceAssessment` contract:

- `applicable`: require usable Database Artifact and Code usage Evidence;
- `not-applicable`: require a reason and Evidence;
- `unknown`: create a product-review Gap.

Do not introduce aliases such as `dataApplicability`. Source readiness, Feature outcomes, source snapshot, expiration, and artifact fingerprints must be persisted in the canonical model and projected to T21.

## Semantic Draft And Canonical Model Composer

Public generate/update input contains only confirmed `config`, absolute `outputRoot`, `runId`, `generatedAt`, normalized `sourceResults`, validated `artifacts`, a Yog-managed `semanticDraft`, and optional explicit confirmation decisions. Do not submit final `catalog`, `objects`, `relationships`, `governance`, Coverage, Publication, Manifest, pages, or files; public staging rejects those fields as P1 caller errors.

The semantic draft contains evidenced object candidates, candidate fields, candidate relationships, declared conflicts, and exact unknowns. Every Claim or relation candidate uses `evidenceRefs` that must resolve to normalized Artifacts. It cannot create Evidence, create or rename Catalog nodes, select Source Authority, calculate stable IDs, calculate Coverage/Publication, or produce Markdown.

`wiki-model-composer.mjs` deterministically creates Catalog identity, stable object/Claim/Gap/Relationship IDs, reverse references, Evidence registry entries, Authority-separated Claims, precise field Gaps, and the complete next canonical input. It then hands that input to `buildProductWiki()`, which remains the independent and only final validator/Coverage builder/projector.

Every catalog node and knowledge object has a stable ID, registered kind/status, owner/subject/relation refs, Claim/Evidence/Gap refs, version refs, and deterministic order. Each kind must satisfy its frozen field contract. Do not hide a required unknown value: use a linked Gap.

`ownerRefs` is optional governance metadata. An unknown owner is displayed as unassigned, but it must not create a product Gap or block product-baseline publication. A complete Data Entity projection covers every captured column, constraint, and index for its selected Database objects. Every declared Interface Endpoint has non-empty name, Method, Path, auth, request, response, idempotency, and fully defined error condition/meaning; otherwise omit the incomplete Endpoint behind a linked Interface Gap.

An empty governed field is never an implicit unknown. Use `confirmedEmptyFields[]` only when Evidence or a bounded collection proves that the field has no values; otherwise create a routed Gap whose `subjectRefs[]` contains the object and whose `fieldRefs[]` names the exact field, for example `data-entity:course.relationships`. Feature knowledge-object link fields (`pageRefs`, `scenarioRefs`, `flowRefs`, `stateMachineRefs`, `ruleRefs`, `roleRefs`, `permissionRefs`, `dataEntityRefs`, `metricRefs`, `interfaceRefs`, and `versionRefs`) are discovery results rather than mandatory product decisions: an empty link list remains structurally valid and must not create a product-review Gap unless bounded Evidence establishes that the linked object is applicable but missing. Feature purpose, operations, acceptance baseline, and data-source assessment remain governed. A P1 applicable-field Gap, a `partial | needs-review` object, or a `partial | needs-review` Claim prevents the affected page from being `publishable`.

Every product-review Gap is actionable. In addition to its stable internal identity and subject/field refs, it has a product-language `title`, one `question`, confirmed `context`, `decisionImpact`, `resolutionMode`, one shared `responseContract`, suggested Source kinds, `blockingStage`, and observable `resolutionCriteria`. The only statuses are `open | resolved`; an unanswered or insufficient Gap remains open. Do not use accepted, deferred, ignored, postponement reasons, owners, or review dates as a closure bypass.

`resolutionMode` is `product-decision | conflict-resolution | evidence-required`. Product decisions use `responseContract.guidanceMode: pm-answer` with required answer items; evidence gaps use `evidence-request` with bounded evidence items and never ask a product manager to guess technical facts. The Markdown renderer and answer validator consume the same responseContract.

Human decisions are repo-local Markdown under the configured spec/filesystem Source, default `docs/wiki-inputs/decisions/<system-id>/<feature-id>/<target-id>.md`. A tagged target is `gap | review-item`; ReviewItem targets also bind the current `sourceFingerprint`. Drafts do not enter the canonical model. A confirmed Decision binds its normalized semantic content to `decisionFingerprint` and enters collection only as a dedicated `decision-artifact`, which yields `human-confirmation` Evidence. Ordinary `spec-artifact` remains `design-decision` and never upgrades Authority because of its path.

Public `confirmationDecisions[]` must reference one tagged target, one matching confirmed Decision Artifact Evidence, and the exact Decision fingerprint. Gap targets use registered typed resolution; ReviewItem targets use `confirm | modify | reject | defer`. Confirm/modify create only Human Expected knowledge and one Atomic Acceptance Criteria; reject creates no Claim; defer leaves the item out of the next batch. There is no generic JSON Patch.

The first-release semantic depth fields are:

- Requirement `scopeType`: `baseline | enhancement | bugfix | migration`.
- Atomic Acceptance Criteria: one `criterionType` (`normal | boundary | failure`), `given[]`, `when`, `then[]`, covered `operationRefs[]`, and at least one authority link from `requirementRef | decisionId`.
- Interface `endpoints[]`: stable endpoint ID, name, HTTP Method, exact Path, auth, Request DTO, Response DTO, errors, idempotency, Claim IDs, and Evidence IDs.
- Data Entity: `storageName`, Database object IDs, complete fields with Database column IDs/type/nullability/defaults, constraints, indexes, `fieldCoverage`, relationships, readers, and writers.
- Metric `metricType`: `product-success | business-observation | implementation-count`; a product-success Metric requires a baseline, target, and statistical boundary. An accountable owner may be recorded as governance metadata but is not part of product completeness. Only this metric type enters the T17 success-metric section.
- Role: responsibilities, `scopeRefs[]`, and `operationRefs[]`.
- Permission row `enforcementLayer`: `product | ui | api | data`. UI visibility never proves API or data authorization.
- Flow: product-language `goal/scope/nonScope/trigger/entryRefs`, explicit ordered phases and lanes, typed nodes and edges, optional State Machine refs, and one Interaction containing independent sequence groups, lane-backed participants, and evidenced messages. Every phase/lane/node/edge/group/participant/message selects its own candidate Claim keys and Artifact Evidence refs; never copy all candidate proof into every element. `calls` Relationships are retrieval hints only and never create ordered messages. State and sequence views use `applicable | not-applicable | unknown`; unknown creates no fake node, state, or message.

Create a Flow candidate only when Evidence supports one product-language goal, a user/operation/system trigger, at least two ordered business steps or one explicit lifecycle, and the connecting facts. It must also satisfy at least one business-depth signal: an evidenced interaction between two non-actor system lanes; a branch, exception, asynchronous step, callback, or schedule; an evidenced Current state transition; or at least four Current business nodes supported by two independent precise Code locations. Do not create a Flow from one Controller, Interface, DTO, method, table, Topic constant, unordered `calls` set, or the linear template “receive request → process → return result”. Three-node cross-system callback flows remain eligible; node count alone is not a rejection rule. Merge frontend, backend, MQ, Job, callback, and external interaction fragments when they serve the same core business object, goal, trigger, and result; split candidates when goals, independent triggers/results, or State Machines differ. The semantic workflow performs this merge before emitting the single Flow candidate; the deterministic composer and final validator both enforce the closed graph and never guess missing joins.

Claims use exactly one `subjectRef`, a `layer` of `expected | current | observed`, a `factLevel` of `confirmed | partial | needs-review`, text, and only `evidenceIds` as proof links. Keep the layers separate:

- Expected comes from adopted Requirement, Spec, or human confirmation.
- Current comes from Code, test verification, or Database structural Evidence.
- Observed comes from bounded Record, runtime observation, or a directly covering test.

Never present Expected as Current, one Observed case as a complete Current graph, or enum order/UI text/method names as a transition. Conflicts and unknowns become Gaps; they are not silently reconciled.

Permission Evidence additionally declares `permissionLayers` from `product | ui | api | data`. A Permission row may reference only Evidence registered for its own `enforcementLayer`; one Evidence ID must not be reused across different enforcement layers. The row Claim must be confirmed, apply to the Permission or row resource, and share supporting Evidence with the row. Frontend visibility Evidence therefore cannot satisfy API authorization or data-scope coverage.

Canonical Evidence preserves `factKind`, `precision`, `repositorySurface`, and Database `artifactObjectRef`, and the final validator independently compares those values with normalized Artifacts. File-level Code Evidence proves only file existence and cannot be the sole support for a confirmed Current/Observed behavior Claim. Frontend route/page/operation Evidence supports UI only; backend api/validation/operation supports API; backend `database-usage` or Database access-control metadata supports data enforcement. Ordinary Database metadata never proves runtime authorization. Every Data Entity field, constraint, and index must cite Evidence whose `artifactObjectRef` exactly matches its own Database reference.

Relationships use only the registered types and directions: `contains`, `exposes`, `applies-to`, `performed-by`, `reads`, `writes`, `calls`, `measures`, `specified-by`, `depends-on`, and `supersedes`. The ID is `rel-` plus the first 16 lowercase SHA-256 hex characters of `from + "\\0" + type + "\\0" + to`. Duplicate edges, invalid directions, missing Claim/Evidence refs, and containment/ownership/supersedes cycles block publication.

`_meta/model.json` is the only canonical Wiki model. Markdown and all other `_meta` documents are deterministic projections. Never parse edited Markdown back into the model.

## Output Contract

The default output is:

```text
docs/wiki/
  AGENTS.md
  目录.md
  产品目录/
    <系统>/
      系统总览.md
      <业务域>/<模块>/<功能>.md
  知识对象/
    用户场景/
    业务流程/
      目录.md
    状态模型/
    业务规则/
    数据字典/
    指标口径/
    接口集成/
    角色权限/
  质量治理/
    目录覆盖与质量报告.md
    待确认问题.md
    待确认问题/<system-id>/<feature-id>.md
    版本与变更/
  _meta/
    model.json
    catalog.json
    catalog/
      <system-id>.json
    gaps.json
    gaps/
      <system-id>.json
    flows.json
    flows/
      <system-id>.json
    claims.json
    evidence.json
    relationships.json
    coverage.json
    state-machines.json
    manifest.json
```

`AGENTS.md` is a deterministic managed page and the directory-level reader contract. It instructs agents to read the first-level Catalog, one matching System shard, and the target Markdown in that order. Flow questions additionally use `_meta/flows.json`, one `_meta/flows/<system-id>.json` shard, the Flow directory, and one Flow page. Relationships, Claims, and Evidence are filtered only when traceability is needed. It forbids full reads of `model.json` and bulk loading of traceability projections.

`_meta/catalog.json` is a lightweight first-level System index. Each entry routes to exactly one `_meta/catalog/<system-id>.json` second-level index containing lightweight Domain, Module, Feature, and knowledge-object entries with stable refs and page paths. Do not copy complete Feature or knowledge-object models into either level. An object referenced by multiple Systems keeps one canonical page and may appear as a `shared: true` pointer in each relevant System index. Every Catalog index file is a deterministic Manifest projection with its own content hash.

`_meta/flows.json` is the first-level Flow index and contains only System pointers and counts. Each `_meta/flows/<system-id>.json` shard contains lightweight Flow refs, names, goals, page paths, Feature/entry refs, status, and shared flags. `_meta/reviews.json` and `_meta/reviews/<system-id>.json` provide the equivalent lightweight ReviewItem locator without copying proposal bodies. `知识对象/业务流程/目录.md` and `质量治理/产品审核.md` are PM-readable locators.

The projections are:

- T16: one System Overview per System.
- T17: one conditional Feature view covering the product overview, Current implementation, approved Atomic Acceptance Criteria, rules/state/permissions, change-impact map, and the next batch of at most five pending P0/P1 ReviewItems. Feature-scoped Page and Operation objects are inline tables, never standalone files.
- T18: reusable Rule objects.
- T19: reusable Data Entity, Metric, and Interface objects.
- T20: Role and Permission Matrix objects with role/resource/action/data-scope/condition/decision evidence. Publication-level permission coverage requires every declared Role plus product, UI, API, and data enforcement layers; one layer never proves another.
- T21: source readiness, object/Claim/Evidence coverage, independent Flow-overview/State-applicability/Sequence-applicability coverage, blocking gaps, tasks, and publication conclusion.

T17 aggregates concise links; do not duplicate complete shared Rule, Interface, Entity, Permission, State, or Metric definitions into every feature page. It renders stable `page-<id>` and `operation-<id>` anchors and a fixed Operation table containing action, path, role, preconditions, normal outcome, error outcome, and evidence status. A Page/Operation without a Feature routes first to a referencing Flow, then to a direct System subject, and otherwise fails with `wiki-object-projection-route-missing`. Internal routes are `{pagePath, anchor}`: Manifest lists only real Markdown files, Catalog shards keep a readable `pagePath` plus optional `anchor`, and Markdown links include the anchor. Aggregated frontmatter includes every inline subject, Claim, and Evidence.

Only `product-success` Metrics keep standalone pages. `business-observation` and `implementation-count` are inline tables marked “非产品成功指标”; they remain canonical objects and use the same deterministic routing rules.

Generate `质量治理/待确认问题.md` and its Feature shards only for product-visible open product-review Gaps. When a Feature already has pending or drifted concrete ReviewItems, its generic `acceptanceCriteriaRefs` Gap stays canonical for completeness but is suppressed from PM Gap pages and `_meta/gaps*.json`; the Review queue is the single product-facing action. The root page is a lightweight index; each shard uses the fixed PM Markdown sections “当前情况、需要你确认、请按以下内容回答、为什么需要确认、什么时候算补齐”, while evidence gaps use “需要补充的证据”. Gap Markdown is the only PM reading artifact: do not generate YAML Gap files, YAML frontmatter, raw IDs, JSON, or schema dumps in these files. Stable linkage remains only in canonical and `_meta/gaps*.json` projections. Other pages use stable routing frontmatter including `pageId`, `pageType`, `title`, `status`, `generatedBy: yog:wiki`, `subjectRefs`, `claimIds`, `evidenceIds`, related refs, and source snapshot ID.

The quality report does not project a global PRD behavior-coverage ratio when no complete historical baseline exists. Current Implementation completeness, Historical Requirement Readiness, product-visible baseline questions, concrete ReviewItems, data Gaps, engineering-evidence Gaps, Baseline Drift, Freshness, and task-level readiness are independent dimensions. Publication blockers are a subset of those Gap queues and must never be presented as an additional additive workload count. Approved Atomic Acceptance Criteria remain linked to Operations in the canonical model and Feature page.

Markdown is a reader projection, not a schema dump. Role, Permission, Data Entity, Interface, Flow, and State Machine use dedicated Chinese renderers. Permission/Data/Interface render tables. A Flow renders a Current-only phased swimlane overview, optional Current State Machine projection, and independent sequence diagrams per explicit path group; Expected-only changes are listed separately. All diagrams have canonical tables using the same selected elements. Unknown empty fields with Gaps do not render empty sections; confirmed empties are summarized once, while Data/Interface completeness tables retain required rows. The Markdown body must not contain generic JSON fenced blocks, full canonical objects, or raw `claimIds`/`evidenceIds` arrays. Resolve object refs to readable names and internal links. Within one page, Evidence is referenced as stable `[E1]` entries and expanded once at the bottom; file precision shows the path plus “文件级证据” and never fabricates `:1-1`.

## Lifecycle

- `generate`: stage confirmed Sources and Artifacts, compose and validate the complete next model internally, render T16-T21, validate links/sensitive content, then publish one transaction.
- `update`: stage and compose a complete next model internally, calculate transitive impact from Relationships, rebuild changed objects plus referencing T17, owning T16, and T21, and preserve unrelated page bytes.
- `sync`: read the current canonical model and page bytes, rebuild only deterministic `_meta` projections and Manifest, and fail if any Markdown byte changes.
- `verify`: perform no writes; independently render the current deterministic Markdown projection, then validate exact ownership, model/page/projection hashes, frontmatter identity, hierarchy, objects, relationships, coverage, source snapshot/freshness, and T16-T21 byte consistency. Never use the existing Markdown as the expected renderer output.

The separate `yog:wiki-review` Skill owns the one-ReviewItem PM conversation and invokes the deterministic Decision draft/confirm scripts. `yog:wiki` owns Source collection, Decision Artifact normalization, composition, validation, update, and publication. A confirmed Decision followed by a runtime update failure remains `confirmed-pending-apply`; retry the same `decisionId + decisionFingerprint` idempotently.

Write actions share a repository lock, transaction journal, validated staging snapshot, run-local backup, and recovery path. A missing Wiki root may be created. Any existing root without the exact current Manifest ownership and kind is unmanaged and must not be overwritten. Do not migrate or take over an old Wiki.

Formal pages and metadata must not contain machine-local absolute paths, tokens, cookies, passwords, connection strings, request bodies, business rows, or customer data. Broken references, invalid authority, sensitive content, source drift, or P0/P1 integrity findings fail closed.

## Completion

Before claiming completion:

1. run focused Source, model, renderer, query, lifecycle, and publisher tests;
2. run the repository test suite;
3. verify T16-T21 paths, exact ownership, Claim/Evidence boundaries, and source readiness;
4. verify update impact, unaffected-page byte equality, sync byte equality, read-only verify, transaction recovery, Database metadata-only plans, and old-contract rejection;
5. run a bounded Reader Agent task against generated Markdown: answer the target business Flow's actors, entry points, owning/collaborating systems, Current states, sequence, interfaces, data, permissions, exceptions, Expected/Current differences, and open questions, then compare each answer with the authorized Spec;
6. return written paths, source statuses, publication status, affected pages, open product-review Gaps, Reader result, and Manifest path.
