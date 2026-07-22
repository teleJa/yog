# Knowledge Audit Workflow

This internal write workflow persists structured Knowledge Drift or deterministic `invalid-knowledge` findings to `docs/knowledge/audits/YYYY-MM-DD.md` through `knowledge-audit.mjs`.

- Drift persistence requires an explicit user request to record it.
- `invalid-knowledge` may be handed off automatically by the orchestrator after a read-only Query.
- Upsert by stable SHA-256 fingerprint within the day; preserve first-detected fields and update last-detected fields and occurrence count.
- Never change Capability, Evidence, Business Flow, Context, status, or frontmatter; never run sync/verify as a repair.
- Historical Audit files are immutable. Only an explicit recheck may add an idempotent resolution to today's Audit.
- On persistence failure, return the same structured artifact with `persisted: false` and the reason.
