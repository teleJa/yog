# Knowledge Directory Agent Rules

These rules apply only to files under `docs/knowledge/**`.

## Entry Point

- Use the root `AGENTS.md` or `CLAUDE.md` Yog managed block as the primary agent guidance.
- Treat the Yog plugin skill as the complete specification for scripts, indexes, lint rules, and document contracts.
- Use this file only as a short path-scoped reminder for edits inside this directory.

## Retrieval

- For business, architecture, feature, or implementation questions, start from `index.json`, `INDEX.md`, and `CONTEXT-MAP.md`.
- Read candidate documents only when explicitly creating, reviewing, updating, or promoting candidates.
- If the index or map conflicts with current code, use current code facts for the task and recommend marking affected knowledge as `stale` or `needs-review`.

## Code Facts

- Verify implementation facts with CodeGraph, Serena, GitNexus, repository scans, or tests before making code-fact claims.
- To make Yog routing reminders active on every prompt, ask Yog to run `install-hooks`; this step is optional and separate from init.
- Automatic `discover-candidates` requires both Serena and CodeGraph for this repository.
- If either tool is unavailable, stop automatic discovery and tell the user what must be installed or initialized.
- Do not fall back to filename-only or `rg`-only discovery for automatic candidate creation.

## Editing

- Keep `CONTEXT.md` business-language only; put routes, controllers, tables, messages, and call flows in `evidence/*.md`.
- Candidate documents are not formal contexts and must not be listed as confirmed contexts in `CONTEXT-MAP.md`.
- Candidate promotion must create at least one real capability and one real evidence document; do not promote into an empty context shell.
- Business boundaries, terminology, design intent, context split or merge decisions, and candidate promotion require human confirmation.
- After changing source knowledge documents, use Yog to refresh generated indexes and run verification.
