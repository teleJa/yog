# Yog

[中文说明](./README.zh-CN.md)

Yog is a business knowledge-base and product Wiki plugin for AI coding agents. It keeps durable project knowledge in `docs/knowledge` and can generate a focused, evidence-backed Chinese product manual under `docs/wiki`.

Yog is designed for agent-first work. The user talks to Codex or Claude Code, the Yog skill guides the agent to read the right knowledge files before design or implementation work, and deterministic Node scripts handle filesystem changes, indexing, linting, and verification.

For a Chinese onboarding prompt that can be pasted directly into Codex or Claude Code agent context, see: [Yog agent onboarding prompt](./docs/yog-agent-onboarding-prompt.zh-CN.md). For the full user manual, see: [Yog user manual](./docs/user-agent-prompts.zh-CN.md).

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
- `yog:wiki generate` turns a confirmed menu scope, optional business sources, and selected code paths into product feature and Record-backed scenario pages under `docs/wiki`.

## Current Plugin Surface

Yog exposes a small set of agent-facing skills:

```text
skills/yog/SKILL.md                 General fallback and shared workflow rules
skills/init/SKILL.md                Initialize docs/knowledge in a repository
skills/discover-candidates/SKILL.md Discover needs-review candidate contexts
skills/business-flow/SKILL.md       Create cross-context business-flow overviews
skills/sync-verify/SKILL.md         Sync, verify, build-index, check-index, and lint
skills/wiki/SKILL.md                Generate a focused product Wiki under docs/wiki
```

The skills call internal Node ESM scripts under:

```text
skills/yog/scripts/
```

Repo Wiki exposes one agent command, `yog:wiki generate`. It generates a focused Chinese product Wiki from a user-confirmed menu scope, optional Record business flows, optional Requirement or Spec context, and user-provided code paths. First-level menus become directories and second-level menus become product feature pages; only Record inputs may create user scenario pages. CodeGraph can enrich selected code relationships but is not required. The MVP validates evidence, internal links, sensitive output, and the complete generated tree before replacing a Wiki already managed by `yog:wiki-mvp`; unmanaged `docs/wiki` content is never adopted or overwritten.

Initialization writes `"language": "zh-CN"` to `.yog/config.json`. The product Wiki MVP currently supports only `zh-CN`.

The first public version intentionally does not expose a standalone CLI, MCP server, HTTP server, or user-visible command set. The scripts are stable internal automation points for the skills and tests.

Yog supports both Codex and Claude Code plugin layouts:

```text
.codex-plugin/plugin.json
.claude-plugin/plugin.json
```

Both manifests point at the same `./skills/` directory so the two agent surfaces receive the same guidance.

## Installation

Yog is installed as an agent plugin first, then initialized inside each target repository where you want a `docs/knowledge` knowledge base.

Requirements:

- Node.js 20 or newer.
- Codex or Claude Code with plugin support.

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

### Claude Code

Clone the GitHub repository first:

```bash
git clone https://github.com/teleJa/yog.git /path/to/yog
```

Validate the plugin manifest:

```bash
claude plugin validate /path/to/yog
```

If you use a Claude Code marketplace, add a marketplace that exposes the cloned Yog repository as the `yog` plugin, then install `yog@yog` and restart Claude Code.

### Initialize Yog In A Repository

After the plugin is installed, ask the agent in the target repository to initialize Yog:

```text
Use Yog to initialize the current repository with knowledgeRoot docs/knowledge.
```

For script-level debugging or CI automation, you can also run the internal init script directly:

```bash
node /path/to/yog/skills/yog/scripts/init.mjs <<'JSON'
{"repoRoot":"/path/to/target-repo","knowledgeRoot":"docs/knowledge","payload":{}}
JSON
```

This creates `docs/knowledge`, writes `.yog/config.json`, and upserts Yog managed guidance into root `AGENTS.md` and `CLAUDE.md`. It does not overwrite existing `docs/knowledge/**` files.

## Core Workflows

### Generate A Product Wiki

Ask the agent to run `yog:wiki generate`. The agent collects and echoes the authorized scope before reading sources or writing the Wiki.

Required inputs:

- a menu description that can be parsed as first-level menu groups and second-level features;
- an absolute Wiki output root;
- one or more absolute code paths supplied by the user.

Optional inputs:

- Record Skill directories produced from recorded product operations;
- Requirement work item IDs, links, or a user-confirmed bounded project scope;
- explicit Spec file or directory paths.

Example request:

```text
Use yog:wiki to generate the full supplied menu scope.
Menu: Client Decoration -> Client Pages, Page Management, Popup Ads, Client Settings
Output root: /absolute/path/to/product
Code paths: /absolute/path/to/frontend, /absolute/path/to/backend
Requirement scope: TAPD workspace 12345678
No Record or Spec is available for this run.
```

The menu is the only source allowed to create feature names. First-level menus become directories and second-level menus become Markdown feature pages. Requirement and Spec sources may enrich those features but cannot expand the menu. Record is the only source allowed to create user scenario pages. When a Record covers only part of the supplied menu and the user has not selected a scope, the agent stops and asks whether to generate only Record-related features or the complete menu scope.

When `<outputRoot>/.yog/config.json` exists, Yog reads the optional Requirement Provider routing metadata:

```json
{
  "language": "zh-CN",
  "wiki": {
    "requirementProvider": {
      "provider": "tapd",
      "transport": "mcp",
      "serverRef": "tapd"
    }
  }
}
```

The MVP currently supports Chinese output and TAPD over an already configured MCP server. The config stores references only, never tokens. If Requirement or Spec context is unavailable, menu plus code generation continues with reduced evidence coverage.

Generated structure:

```text
docs/wiki/
  目录.md
  产品功能/
    <一级菜单>/
      <二级菜单>.md
  用户场景/
    <一级菜单>/
      <Record 场景名称>.md
  待确认问题.md              # only when product-review gaps exist
  _meta/
    catalog.json
    claims.json
    evidence.json
    manifest.json
```

The MVP does not generate first-level menu index pages, acceptance pages, third-level feature pages, business-flow pages, or separate architecture, module, API, and data-model directories. Technical associations remain concise sections inside product pages; detailed evidence stays in `_meta`.

Publication is all-or-nothing. A missing target is created. An existing target is replaced only when its manifest declares `managedBy: yog:wiki-mvp`; an unmanaged `docs/wiki` blocks publication. The MVP does not expose refresh, verify, resume, or automatic menu monitoring.

### Initialize A Knowledge Base

`init.mjs` creates the `docs/knowledge` skeleton, writes `.yog/config.json`, and upserts Yog managed guidance into root `AGENTS.md` and `CLAUDE.md`.

It does not overwrite existing `docs/knowledge/**` files.

### Install Prompt Hooks

`install-hooks.mjs` is optional and separate from init. It copies a `UserPromptSubmit` hook into `.claude/hooks/` and `.codex/hooks/` so future prompts can remind the agent to route through `docs/knowledge/CONTEXT-MAP.md` before business, design, interface, or rule changes.

Claude Code settings are updated automatically. Codex config is not overwritten; the script returns a manual `config.toml` hint instead.

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

The tests use temporary repositories and cover initialization, document creation, candidate reduction, hook installation, indexing, linting, verification, sync, routing, the product Wiki MVP, script contracts, and non-goals.

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
- product Wiki refresh, resume, automatic menu monitoring, or Reader/Evidence Judge workflows;
- product Wiki output languages other than `zh-CN` in the MVP;
- publication as an npm package.

## License

MIT. See [LICENSE](./LICENSE).
