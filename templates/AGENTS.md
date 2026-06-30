## Yog Business Knowledge Retrieval Order

When working in this repository, Yog controls the first pass for business understanding:

1. For business, architecture, feature, workflow, or implementation questions, read `docs/knowledge/index.json` first when it exists.
2. Match the user request against `context`, `domain`, `capability`, `keywords`, `name`, `summary`, and `status`.
3. Prefer `verified` capability and evidence documents, plus accepted ADRs. Treat `candidate` and `needs-review` matches as unconfirmed.
4. Read `docs/knowledge/CONTEXT-MAP.md`, the matched context `CONTEXT.md`, matched capability documents, linked evidence, and related ADRs before broad code search.
5. If no confident match exists, inspect `docs/knowledge/INDEX.md` and `CONTEXT-MAP.md`; then ask a clarifying question or use the Yog skill's internal scripts to create or update a candidate.
6. Use Serena, CodeGraph, GitNexus, repository scans, and tests after the Markdown pass to verify current code facts.
7. If code facts conflict with `docs/knowledge`, use current code facts for the task and recommend marking the affected knowledge document `stale` or `needs-review`; modify frontmatter only after user confirmation or an explicit apply command.
8. If `docs/knowledge` is missing, use the Yog skill's `init` script or ask the user before assuming the repository has no business knowledge base.
9. Do not copy full call graphs or broad implementation inventories into capability documents; put implementation facts in `evidence/*.md` and keep business documents focused on boundaries, workflows, design intent, decisions, constraints, and validation.
