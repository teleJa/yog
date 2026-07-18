# Yog

[中文说明](./README.zh-CN.md)

Yog is a business knowledge-base and product Wiki plugin for AI coding agents. It keeps durable project knowledge in `docs/knowledge` and can generate a focused, evidence-backed Chinese product manual under `docs/wiki`.

Yog is designed for agent-first work in Codex. Separate skills guide product questions to `docs/wiki`, engineering questions to `docs/knowledge`, and deterministic Node scripts handle authorized filesystem changes, indexing, linting, verification, and audit persistence.

For a Chinese onboarding prompt that can be pasted directly into Codex agent context, see: [Yog agent onboarding prompt](./docs/yog-agent-onboarding-prompt.zh-CN.md). For the full user manual, see: [Yog user manual](./docs/user-agent-prompts.zh-CN.md).

## What Yog Is For

Large codebases often lose business context faster than they lose code structure. READMEs, PRDs, and one-off notes drift away from implementation, while agents keep rediscovering the same boundaries from scratch.

Yog provides a repository-local knowledge protocol:

- `CONTEXT-MAP.md` gives agents a business routing map.
- `business-flows/` describes cross-context workflows.
- `contexts/<context-id>/CONTEXT.md` defines a business boundary, when to use it, routing rules, common domain-level misjudgments, and validation entry points.
- `capabilities/` records what a context is responsible for and gives agents implementation landing guidance: what to reuse, what not to reuse, when to stop and confirm, and how to verify changes.
- `evidence/` ties business claims back to code, routes, tables, messages, tests, or human-reviewed sources, with generation metadata and development verification suggestions.
- `candidates/` stores unconfirmed business-context candidates before promotion.
- generated `index.json` and `INDEX.md` make the knowledge base easy to route and verify.
- `yog:wiki generate/update/sync/verify` creates and durably maintains the product manual under `docs/wiki`; verified Knowledge may supply current-code evidence through one-way Wiki-to-Knowledge references.

## Current Plugin Surface

Yog exposes five task skills plus a read-only selector:

```text
skills/yog/SKILL.md                 Read-only selector; never reads or writes knowledge
skills/knowledge/SKILL.md           Build and maintain docs/knowledge
skills/wiki/SKILL.md                Generate, update, sync, verify, and audit docs/wiki
skills/wiki-review/SKILL.md         Guide one atomic ReviewItem to a confirmed Decision
skills/knowledge-query/SKILL.md     Read-only engineering query from docs/knowledge
skills/wiki-query/SKILL.md          Read-only product query from docs/wiki
```

The skills call internal Node ESM scripts under:

```text
skills/yog/scripts/
```

`yog:wiki generate/update/sync/verify` forms the durable product-Wiki lifecycle. `yog:wiki audit` is an internal write action used only after verification or query detects invalid structure, sources, or references; it never generates or modifies `docs/wiki`.

`yog:wiki-review` reads only the two-level Catalog and Review indexes plus one Feature review shard and Feature page, handles one atomic product question at a time, persists a tagged Markdown Decision under a confirmed spec/filesystem Source, and hands formal application back to `yog:wiki update`.

`yog:knowledge` owns eight stable actions: `init`, `discover-candidates`, `business-flow`, `sync`, `verify`, `audit`, `install-hooks`, and `upgrade`. Creation, review, promotion, and boundary calibration use explicit natural language under the same entry and preserve their confirmation gates.

Initialization writes `"language": "zh-CN"` to `.yog/config.json`. The current product Wiki contract supports `zh-CN` output.

The first public version intentionally does not expose a standalone CLI, MCP server, HTTP server, or user-visible command set. The scripts are stable internal automation points for the skills and tests.

Yog supports the Codex plugin layout:

```text
.codex-plugin/plugin.json
```

## Installation

Yog is installed as an agent plugin first, then initialized inside each target repository where you want a `docs/knowledge` knowledge base.

Requirements:

- Node.js 20 or newer.
- Codex with plugin support.

### Codex

Install Yog directly from the GitHub plugin marketplace:

```bash
codex plugin marketplace add https://github.com/teleJa/yog.git
codex plugin add yog@yog
```

Restart Codex after installation so the `yog` skill is loaded in new sessions.

To update an existing GitHub marketplace install:

```bash
codex plugin marketplace upgrade yog
codex plugin add yog@yog
```

Verify the plugin is visible:

```bash
codex plugin list | rg yog
```

### Initialize Yog In A Repository

After the plugin is installed, ask the agent in the target repository to initialize Yog:

```text
Use yog:knowledge init in the current repository with knowledgeRoot docs/knowledge.
```

For script-level debugging or CI automation, you can also run the internal init script directly:

```bash
node /path/to/yog/skills/yog/scripts/init.mjs <<'JSON'
{"repoRoot":"/path/to/target-repo","knowledgeRoot":"docs/knowledge","payload":{}}
JSON
```

This creates `docs/knowledge`, writes `.yog/config.json`, and upserts Yog managed guidance into root `AGENTS.md`. It does not overwrite existing `docs/knowledge/**` files.

## Core Workflows

### Generate And Maintain A Product Wiki

Ask the agent to run `yog:wiki generate`. Yog builds a Mode-4 product knowledge model and projects T16-T21 after validating the authorized Source scopes.

Required inputs:

- a confirmed Catalog that identifies System, Domain, Module, and Feature;
- an absolute Wiki output root;
- one or more authorized Code roots.

Conditional or enhancing inputs:

- a bounded Requirement scope, with TAPD as the first provider;
- Database metadata from PostgreSQL or MySQL for features that persist, calculate, or authorize through data structures;
- explicit Spec, Record, test, or verified Knowledge sources.

Example request:

```text
Use yog:wiki to generate the confirmed catalog scope.
Catalog: Commerce -> Orders -> Order Management -> Refund
Output root: /absolute/path/to/product
Code paths: /absolute/path/to/frontend, /absolute/path/to/backend
Requirement scope: TAPD workspace 12345678
Database: PostgreSQL metadata dump at /absolute/path/to/schema.json
```

Catalog is the only authority allowed to create or rename the product hierarchy. Code proves Current behavior, Requirement/Spec supports Expected intent, Database proves deployed structure, and Record/test supports only its Observed scope. Catalog plus Code are hard generation gates. Missing Requirement degrades background/scope/acceptance coverage. Database is a per-Feature conditional gate through `dataSourceAssessment`.

When `<outputRoot>/.yog/config.json` exists, `wiki.sources[]` is the only Source configuration contract:

```json
{
  "language": "zh-CN",
  "wiki": {
    "root": "docs/wiki",
    "sources": [
      { "id": "product-catalog", "kind": "catalog", "provider": "menu-json", "enabled": true, "required": true },
      { "id": "current-code", "kind": "code", "provider": "git-worktree", "enabled": true, "required": true },
      { "id": "primary-requirements", "kind": "requirement", "provider": "tapd", "enabled": true, "required": false },
      { "id": "primary-database", "kind": "database", "provider": "postgres", "enabled": false, "required": false, "capturePolicy": "metadata-only" }
    ]
  }
}
```

Remote and Database scopes must be explicitly confirmed. Configuration stores routing and credential references only, never secrets. Live Database introspection is disabled by default and permits only allowlisted metadata `SELECT` queries against PostgreSQL system catalogs or MySQL `information_schema`; business rows and sample values are forbidden.

Generated structure:

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
    页面与操作/
    业务规则/
    数据字典/
    指标口径/
    接口集成/
    角色权限/
  质量治理/
    目录覆盖与质量报告.md
    待确认问题.md
    版本与变更/
  _meta/
    model.json
    catalog.json
    catalog/
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

`AGENTS.md` defines the minimum-context read path: open the first-level `catalog.json`, then one System shard and the target Markdown, and filter Relationships, Claims, and Evidence only when traceability is needed. Flow questions use `flows.json`, one System Flow shard, the readable Flow directory, and one Flow page. It explicitly forbids loading the complete canonical `model.json`. `_meta/catalog.json` and `_meta/flows.json` are lightweight first-level System indexes; their second-level shards contain pointers, not complete object bodies.

T16 is the System Overview, T17 is a conditional Feature view for Current implementation, approved baseline, impact map, and the next five atomic ReviewItems, T18-T20 are reusable Rule/Data/Interface/Role/Permission objects, and T21 is the multidimensional quality report. Each Flow can project a Current swimlane overview, an applicable Current state view, and explicit per-path sequence views. `_meta/model.json` is the only canonical model; Markdown and all other metadata are deterministic projections.

`generate` creates the first `managedBy: yog:wiki` snapshot. Public generate/update input contains only confirmed Sources, normalized Artifacts, and the Yog semantic workflow's `semanticDraft`; the Yog-owned composer constructs the complete next model internally. `update` propagates shared-object changes through Relationships and preserves unrelated page bytes. `sync` rebuilds machine projections without changing any Markdown byte. `verify` is read-only and checks ownership, model/page/projection hashes, source freshness, hierarchy, objects, relationships, and T16-T21 consistency.

Publication uses a repository-level writer lock, a `prepared/backed-up/committed` transaction journal, complete staging validation, and run-local backup recovery. Old or unmanaged Wiki roots are rejected; Yog does not migrate or take them over. Claims retain only `evidenceIds`, and `wiki-query` reads only unblocked `confirmed` or `partial` product facts.

### Initialize A Knowledge Base

`yog:knowledge init` creates the `docs/knowledge` skeleton, writes `.yog/config.json`, and upserts Yog managed guidance into root `AGENTS.md`.

It does not overwrite existing `docs/knowledge/**` files.

### Install Prompt Hooks

`yog:knowledge install-hooks` is optional and separate from init. It copies a `UserPromptSubmit` hook into `.codex/hooks/` and idempotently upserts the unique Yog handler in `.codex/hooks.json`, preserving unrelated hooks. It never modifies `.codex/config.toml`; new or changed definitions must be reviewed and trusted through `/hooks`.

### Discover Candidates

`discover-candidates` is an agent workflow, not a standalone Node script. It requires:

- CodeGraph initialized for the target repository.

If CodeGraph is missing, Yog stops automatic discovery instead of guessing from filenames or prose. Discovery uses focused code-evidence lenses, reduces overlapping outputs through `reduce-candidates.mjs`, then writes reviewable candidate documents through `write-candidates.mjs`.

### Promote Candidates

Candidate promotion turns a reviewed candidate into a formal context with at least one real capability and one real evidence document. Empty context shells are treated as invalid.

Formal knowledge is intended to guide implementation, not just archive conclusions:

- Context documents carry business boundaries, "when to use" triggers, routing rules, capability matrices, domain-level common misjudgments, and review timestamps for prescriptive guidance.
- Capability documents carry capability-level responsibilities plus agent development guidance: reuse paths, non-reuse boundaries, confirmation checkpoints, task breakdown, verification, and capability-level common misjudgments.
- Evidence documents carry code-fact anchors such as entry paths, routes, call relations, data/messages, frontend entries, generation evidence, and development verification suggestions.

Prescriptive sections such as common misjudgments and agent development guidance are reviewed by people, not judged by code diffs. `guidance_reviewed_at` records the last human review date. Lint emits `[review-due]` P2 reminders when guidance is missing a review date in non-verified documents or when the review interval has elapsed; verified capability guidance without a review date is a P1 gate.

### Sync And Verify

Yog keeps generated indexes deterministic:

- `sync.mjs` rebuilds indexes and runs lint.
- `verify.mjs` checks indexes and lint without writing.
- `check-index.mjs` compares generated output without modifying files.
- `lint.mjs` validates structure, required sections, paths, routing safety, evidence metadata, and guidance review reminders.

## Script Protocol

Internal write and match scripts read JSON from stdin:

```json
{
  "repoRoot": "/path/to/repo",
  "knowledgeRoot": "docs/knowledge",
  "payload": {}
}
```

Scripts write JSON to stdout. Normal business issues are reported in stdout, not stderr.

Exit codes:

- `0`: completed, or only P2 advisory issues were found.
- `1`: repository state or quality gate blocker.
- `2`: caller input error.
- `3`: user confirmation is required and no write occurred.

Example:

```bash
node skills/yog/scripts/verify.mjs <<'JSON'
{"repoRoot":"/path/to/repo","knowledgeRoot":"docs/knowledge","payload":{}}
JSON
```

## Repository Layout

```text
skills/yog/
  SKILL.md                 Agent-facing workflow contract
  hooks/                   Prompt hook template copied into target repos
  lib/                     Shared implementation
  scripts/                 Internal deterministic script entry points
templates/knowledge/       docs/knowledge skeleton and document templates
test/yog/                  Node test suite
docs/changes/              Design notes, test plans, and change records
docs/adr/                  Architecture decision records
docs/knowledge-base/       Build plan and protocol details
```

## Development

Requirements:

- Node.js 20 or newer.

Run the test suite:

```bash
npm test
```

The tests use temporary repositories and cover initialization, document creation, candidate reduction, hook installation, indexing, linting, verification, sync, routing, the Mode-4 product Wiki, script contracts, and non-goals.

## Why index.json Instead Of RAG

A common challenge: why route through a generated `index.json` instead of embedding every document into a vector store and retrieving with RAG? Three reasons, in order of bluntness:

1. **The scale never reaches RAG's threshold.** RAG exists to retrieve from corpora too large to enumerate — tens of thousands of documents, millions of chunks. Business knowledge derived from a single repository's code is a different order of magnitude: typically a few dozen contexts, with a global `index.json` an agent reads in one pass. When the whole index fits in context and the agent can judge relevance directly, RAG solves a problem that does not exist here. Do not add machinery for a problem you do not have.

2. **RAG would flatten the structure Yog builds.** Yog's documents are not an undifferentiated corpus waiting to be searched — they are already modeled into a directed structure: `CONTEXT-MAP.md` is a routing graph, business flows link contexts, evidence is tied to specific code. Chunking that into vectors discards the boundaries and relationships Yog works to maintain, then tries to approximate them back with similarity scores. It also breaks two core principles: **determinism** (vector recall is probabilistic — swap the embedding model or chunk strategy and results shift, which conflicts with "files are facts, diffable, verifiable, lintable") and the **business-language / code-evidence separation** (blind chunking mixes business definitions and implementation details into one vector space).

3. **The consumer already has semantic ability.** Yog's retrieval is done by the agent's own semantic understanding — it reads `CONTEXT-MAP.md` / `index.json` / summaries and judges which context to enter. RAG is a middle layer built for retrieval systems that *lack* semantic ability; an LLM agent does not need one bolted on to do what it already does well. Yog only needs to hand the agent a clean routing map, not a fuzzy recall engine. Reading a complete, structured, sourced context beats stitching understanding from context-stripped fragments.

In short: Yog's problem is never "too many documents to search" — it is "business knowledge has no structure and drifts." RAG solves the former; Yog solves the latter. The `keywords` fields are semantic anchors for the agent, not inputs for machine similarity scoring. If a knowledge base ever grew to hundreds or thousands of contexts, a semantic pre-filter could sit *on top of* the structure as an optional accelerator — never as a replacement for it, and the final locate-and-read always follows the structured path.

## Non-Goals

For the current version, Yog does not provide:

- a public CLI surface for users to memorize;
- an MCP server;
- a web service or daemon;
- automatic discovery without CodeGraph;
- automatic product-Wiki menu monitoring or Reader/Evidence Judge workflows;
- product Wiki output languages other than `zh-CN` in the current contract;
- publication as an npm package.

## License

MIT. See [LICENSE](./LICENSE).
