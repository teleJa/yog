---
name: init
description: Initialize Yog in the current repository after the Yog plugin is installed. Use when users ask to initialize Yog, enable docs/knowledge, create the knowledge base skeleton, configure .yog/config.json, or ask whether to discover candidates after init. Does not install or update the Yog plugin.
---

# Init

Use this skill when the user asks to initialize Yog in the current repository. This skill does not install or update the Yog plugin; plugin installation must happen before this skill is available.

## Scope

- Initialize `docs/knowledge`.
- Write or update `.yog/config.json`, including `discover.maxMidLowCandidates`.
- Upsert Yog managed blocks in root `AGENTS.md` and `CLAUDE.md`.
- Preserve existing `docs/knowledge/**` files.
- Run read-only verification after initialization.
- Ask whether to run `discover-candidates` after initialization.

Do not promote candidates, create formal contexts, create business flows, run semantic recall tests, or perform overlap calibration unless the user explicitly asks after init completes.

## Workflow

1. Confirm the current repository path and use it as `repoRoot`.
2. Use `knowledgeRoot: "docs/knowledge"` unless the user explicitly gives another root.
3. Call the Yog internal `init.mjs` script with the standard JSON protocol.
4. Report created, updated, and skipped files. Skipped existing `docs/knowledge/**` files are P2 advisory results, not failures.
5. Inspect `.yog/config.json` and report `knowledgeRoot`, `codeFactProvider`, and `discover.maxMidLowCandidates`.
6. Run `verify.mjs` after init and report `check-index` / `lint` results. If the repository has just been initialized and only has empty indexes or P2 advisory issues, say that explicitly.
7. Report whether `docs/knowledge/templates/candidate.md` exists and whether CodeGraph is initialized for the repository.
8. Stop and ask the user whether to run `discover-candidates` now.

## Gates

- Missing CodeGraph must not block init.
- Default `discover.maxMidLowCandidates` is 10. Preserve existing `discover` config when re-running init.
- Do not run `discover-candidates` during init unless the user confirms after the init report.
- Do not ask the user to run internal Node scripts manually.
- Do not claim init or verify passed without actual command results.

## Final Report

Include:

- `repoRoot`
- `knowledgeRoot`
- created / updated / skipped files
- `.yog/config.json` summary
- `verify` result
- `discover-candidates` readiness
- the explicit question asking whether to run `discover-candidates`
