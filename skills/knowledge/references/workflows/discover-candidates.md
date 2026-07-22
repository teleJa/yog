# Discover Candidates Workflow

Preconditions: Yog is initialized, `docs/knowledge/templates/candidate.md` exists, and CodeGraph is initialized for the target repository. Missing CodeGraph is a hard stop; do not fall back to filename-, directory-, docs-, or `rg`-only discovery.

1. Confirm business scope and the medium/low candidate threshold.
2. Run three bounded read-only lenses: controller/route, service/call-flow through CodeGraph, and data/contract.
3. A timed-out lens gets one bounded inline fallback in the main agent; do not spawn a replacement. Record `fallback_for`, `timed_out_source`, budget, coverage, candidates, and skipped areas.
4. Every candidate includes stable id, boundary, responsibilities, non-responsibilities, canonical symbols, evidence paths, keywords, possible contexts, confidence, and reason.
5. Pass all lens results to internal `reduce-candidates.mjs`; only a non-blocking result may continue to `write-candidates.mjs`.
6. Duplicate decisions require the user's explicit choice. Never auto-merge.
7. Run `sync.mjs` and `verify.mjs` after writes.

Create only `needs-review` Candidates. Do not promote or create formal Context/Capability/Evidence documents in this workflow.
