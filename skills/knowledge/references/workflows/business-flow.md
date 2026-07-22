# Business Flow Workflow

Confirm the operation and scope. Read `index.json`, `INDEX.md`, the matching Business Flow if present, and `CONTEXT-MAP.md`, then the participating Contexts, Capabilities, Evidence, and accepted ADRs.

Create or update `docs/knowledge/business-flows/*.md` from the existing template. Include entry points, actors, participating Contexts, reading order, state/data flow, cross-system collaboration, limitations, and open questions. Update an existing matching flow instead of duplicating it.

Do not discover or promote Candidates or change Context boundaries. Run `sync.mjs` and `verify.mjs`, then report the path, participants, changes, and real results.
