---
name: yog
description: Maintain docs/knowledge business knowledge bases through one agent-facing skill and internal Node scripts.
---

# Yog

Use Yog when a user asks to initialize, route, create, verify, or maintain a `docs/knowledge` business knowledge base.

## Entry Rules

- Ask for the business scope before creating candidate, context, capability, or evidence documents.
- Use `docs/knowledge/index.json`, `INDEX.md`, and `CONTEXT-MAP.md` for routing before scanning code.
- Read candidate documents only in explicit candidate creation, review, update, or promotion workflows.
- Verify current implementation facts with CodeGraph, Serena, GitNexus, repository scans, or tests before making code-fact claims.
- Missing CodeGraph, GitNexus, or Serena never blocks `init`, `create-*`, `build-index`, `check-index`, `lint`, `verify`, `sync`, or `match-scope`.
- After `init`, first tell the user they can run `install-hooks.mjs` to enable the optional per-prompt reminder to read `docs/knowledge/CONTEXT-MAP.md`, then tell them automatic candidate discovery requires both Serena and CodeGraph to be installed and initialized for the target repository.
- Do not run `discover-candidates` unless Serena is available to the agent and CodeGraph is initialized for the target repository.

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

Exit code `0` means completed or P2-only. Exit code `1` means target repository state or gate blockers. Exit code `2` means caller input error. Exit code `3` means user confirmation is required and no write occurred.

## Scripts

- `init.mjs`: copy `templates/knowledge` into the target repository, write `.yog/config.json`, and update root `AGENTS.md` and `CLAUDE.md` managed blocks.
- `upgrade-guidance.mjs`: compare or replace target `docs/knowledge/AGENTS.md` and `README.md`, and refresh the root `AGENTS.md` and `CLAUDE.md` Yog managed blocks, with the current Yog templates.
- `install-hooks.mjs`: copy the `UserPromptSubmit` hook script into the target repository's `.claude/hooks/` and `.codex/hooks/`, upsert the Claude `.claude/settings.json` hook entry, and return a manual-enable hint for Codex `config.toml`. `payload.platforms` limits which platforms are installed.
- `create-candidate.mjs`: create a `needs-review` candidate after receiving `candidateId`, `name`, `summary`, and real body content.
- `create-context.mjs`: create a formal context after receiving confirmed boundary fields.
- `promote-candidate.mjs`: promote an existing candidate to a formal context, create real capability and evidence documents, remove the candidate, and write a change record.
- `create-capability.mjs`: create a `draft` capability under an existing context.
- `create-evidence.mjs`: create a `draft` evidence document under an existing capability.
- `build-index.mjs`: rebuild global and context indexes.
- `check-index.mjs`: compare generated indexes without writing.
- `lint.mjs`: report P0/P1/P2 knowledge-base issues.
- `verify.mjs`: run `check-index` and `lint` without writing.
- `sync.mjs`: run `build-index` and `lint`.
- `match-scope.mjs`: return deterministic context, ADR, capability, and evidence matches.

## Prompt Hook Integration

`install-hooks.mjs` is optional and separate from `init`. It wires a `UserPromptSubmit` hook that, on every user prompt, injects a short instruction pointing the agent at `docs/knowledge/CONTEXT-MAP.md` to self-select relevant contexts before designing.

- The hook is an enhancement, not a gate. The root managed block SOP is the baseline and works without any hook.
- After a successful `init.mjs` run, proactively offer this step before moving on to `discover-candidates`; do not leave it discoverable only through the scripts list.
- The hook script is copied into the repository (`.claude/hooks/` and `.codex/hooks/`) so it travels with the repo and is invoked by relative path.
- Claude Code is configured automatically via `.claude/settings.json`. Codex is not: `install-hooks.mjs` only copies the script and returns a manual `config.toml` hint (`[features] hooks = true` plus a `[hooks]` entry), because the exact Codex TOML syntax is version-dependent and must not overwrite a user's existing config.
- The copied hook script always emits single-line JSON and exits `0`; it never blocks a prompt. When `CONTEXT-MAP.md` is absent it injects a notice that the knowledge base is not initialized.
- `install-hooks.mjs` is the single entry point for both installing and updating the hook. It is idempotent: it overwrites the copied script with the current plugin version every run and de-duplicates the Claude settings entry. To refresh an outdated hook script in a repository, rerun `install-hooks.mjs`; `upgrade-guidance.mjs` does not touch hook scripts.

## Init And Candidate Discovery

`init.mjs` is the init step. It must succeed without Serena or CodeGraph because it only creates `docs/knowledge`, `.yog/config.json`, and managed guidance blocks.

`init.mjs` must not overwrite existing `docs/knowledge/**` files. When an existing repository needs the current Yog guidance text, run `upgrade-guidance.mjs` explicitly. Without `payload.apply: true`, it reports P2 differences and does not write. With `payload.apply: true`, it replaces `docs/knowledge/AGENTS.md` and `docs/knowledge/README.md` from the current templates, and rewrites the Yog managed block inside the root `AGENTS.md` and `CLAUDE.md` while preserving the rest of those files. This is allowed because these files and blocks are guidance, not business knowledge source documents.

After init, recommend `install-hooks.mjs` as the optional next step that makes Yog context routing active on every prompt. Continue to `discover-candidates` only when both conditions are true:

- Serena is available in the current Codex session for the target repository.
- CodeGraph is initialized for the target repository and can answer code-structure queries.

If either condition is missing, stop discovery and tell the user exactly which tool must be installed or initialized. Do not fall back to filename-only or `rg`-only discovery for automatic candidates.

If the user only asks for init, stop after `init.mjs`, report that `install-hooks.mjs` was not executed, and report that `discover-candidates` was not executed. If the user asks to test whether init can generate business documents, discover candidates, scan business boundaries, or otherwise produce candidate knowledge, init alone is not complete. First offer the hook step, then continue through the discovery workflow when the required tools are available and report candidate results.

Before discovery, verify that the target repository has `docs/knowledge/templates/candidate.md`. If it is missing, stop and ask to rerun `init.mjs`.

`discover-candidates` is an agent workflow, not a standalone Node script. Use Serena and CodeGraph to inspect existing business docs, OpenSpec changes, controllers, services, mappers, routes, and call paths. Then call `create-candidate.mjs` for each discovered item that has a stable business signal and evidence-backed body content.

Candidate discovery may automatically write `needs-review` documents under `docs/knowledge/candidates/`. These candidates never enter generated routing indexes. If discovery finds more than 10 candidates, stop before writing and ask the user to narrow the scope. If duplicate candidates are found, do not overwrite or merge them; show the duplicate report and skip those writes until the user decides.

Each auto-discovered candidate body must include:

- discovery sources, such as docs, OpenSpec, Serena, and CodeGraph;
- evidence references, such as files, symbols, routes, services, mappers, or archived requirement paths;
- a confidence note, normally `low` or `medium`, explaining why it remains `needs-review`.

After discovery, run `sync.mjs` and `verify.mjs`. The final report must include `candidate_count`, candidate paths, candidate status values, confidence notes, and whether candidates entered generated indexes. Candidates should not enter `index.json` or `INDEX.md`. If discovery writes no candidates, report `candidate_count: 0` and the reason, such as missing tools, no stable business signal, more than 10 candidates requiring a narrower scope, or duplicate candidates awaiting confirmation.

## Candidate Promotion

Promoting a candidate to a formal context must not create an empty context shell. Before calling `promote-candidate.mjs`, gather enough real business boundary and code evidence to create at least one capability and at least one evidence document.

For large repositories, spawn focused subagents in parallel when useful:

- one subagent verifies business boundary, terms, responsibilities, and non-responsibilities from existing docs, PRDs, OpenSpec, and candidate notes;
- one subagent uses Serena to locate symbols, entry files, and code ownership boundaries;
- one subagent uses CodeGraph to verify routes, services, mappers, call paths, and related code facts.

Do not promote if Serena or CodeGraph is required for the repository but unavailable. Stop and report the missing tool or initialization step instead of creating placeholder capability or evidence documents.

Call `promote-candidate.mjs` only after assembling a payload with `capabilities[]`. Each capability must include real `capabilityId`, `name`, `summary`, `responsibilities`, `nonResponsibilities`, and `body`. Each capability must include at least one `evidence[]` item with real `evidenceKind`, `name`, `summary`, `source`, `generator`, `generation_evidence`, and `body`; include structured sections such as `entryPaths`, `routes`, `callRelations`, `dataMessages`, `frontendEntries`, and `limitations` when available.

After promotion, run `sync.mjs` and `verify.mjs`. The final report must include `contextPath`, `capabilityPaths`, `evidencePaths`, `changePath`, `docsCount`, and `candidateRemoved`. If `docsCount` is 0, treat the promotion as failed and investigate before reporting completion.

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
