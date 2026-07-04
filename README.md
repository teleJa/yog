# Yog

[中文说明](./README.zh-CN.md)

Yog is a business knowledge-base plugin for AI coding agents. It helps a repository keep durable project knowledge in `docs/knowledge`, organized by business context, capability, evidence, business flow, candidate, and ADR documents.

Yog is designed for agent-first work. The user talks to Codex or Claude Code, the Yog skill guides the agent to read the right knowledge files before design or implementation work, and deterministic Node scripts handle filesystem changes, indexing, linting, and verification.

## What Yog Is For

Large codebases often lose business context faster than they lose code structure. READMEs, PRDs, and one-off notes drift away from implementation, while agents keep rediscovering the same boundaries from scratch.

Yog provides a repository-local knowledge protocol:

- `CONTEXT-MAP.md` gives agents a business routing map.
- `business-flows/` describes cross-context workflows.
- `contexts/<context-id>/CONTEXT.md` defines a business boundary.
- `capabilities/` records what a context is responsible for.
- `evidence/` ties business claims back to code, routes, tables, messages, tests, or human-reviewed sources.
- `candidates/` stores unconfirmed business-context candidates before promotion.
- generated `index.json` and `INDEX.md` make the knowledge base easy to route and verify.

## Current Plugin Surface

Yog currently exposes one agent-facing skill:

```text
skills/yog/SKILL.md
```

The skill calls internal Node ESM scripts under:

```text
skills/yog/scripts/
```

The first public version intentionally does not expose a standalone CLI, MCP server, HTTP server, or user-visible command set. The scripts are stable internal automation points for the skill and tests.

Yog supports both Codex and Claude Code plugin layouts:

```text
.codex-plugin/plugin.json
.claude-plugin/plugin.json
```

Both manifests point at the same `./skills/` directory so the two agent surfaces receive the same guidance.

## Core Workflows

### Initialize A Knowledge Base

`init.mjs` creates the `docs/knowledge` skeleton, writes `.yog/config.json`, and upserts Yog managed guidance into root `AGENTS.md` and `CLAUDE.md`.

It does not overwrite existing `docs/knowledge/**` files.

### Install Prompt Hooks

`install-hooks.mjs` is optional and separate from init. It copies a `UserPromptSubmit` hook into `.claude/hooks/` and `.codex/hooks/` so future prompts can remind the agent to route through `docs/knowledge/CONTEXT-MAP.md` before business, design, interface, or rule changes.

Claude Code settings are updated automatically. Codex config is not overwritten; the script returns a manual `config.toml` hint instead.

### Discover Candidates

`discover-candidates` is an agent workflow, not a standalone Node script. It requires both:

- Serena available to the agent.
- CodeGraph initialized for the target repository.

If either tool is missing, Yog stops automatic discovery instead of guessing from filenames or prose. Discovery uses focused code-evidence lenses, reduces overlapping outputs through `reduce-candidates.mjs`, then writes reviewable candidate documents through `write-candidates.mjs`.

### Promote Candidates

Candidate promotion turns a reviewed candidate into a formal context with at least one real capability and one real evidence document. Empty context shells are treated as invalid.

### Sync And Verify

Yog keeps generated indexes deterministic:

- `sync.mjs` rebuilds indexes and runs lint.
- `verify.mjs` checks indexes and lint without writing.
- `check-index.mjs` compares generated output without modifying files.
- `lint.mjs` validates structure, required sections, paths, and routing safety.

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

The tests use temporary repositories and cover initialization, document creation, candidate reduction, hook installation, indexing, linting, verification, sync, routing, script contracts, and non-goals.

## Non-Goals

For the current version, Yog does not provide:

- a public CLI surface for users to memorize;
- an MCP server;
- a web service or daemon;
- automatic discovery without Serena and CodeGraph;
- publication as an npm package.

## License

MIT. See [LICENSE](./LICENSE).
