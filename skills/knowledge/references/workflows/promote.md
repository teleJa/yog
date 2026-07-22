# Promote Candidate Workflow

Promotion must create a real Context with at least one Capability and one Evidence document; empty shells are invalid.

1. Confirm the Candidate and formal boundary decision.
2. Extract entry, service, data, external, and operation anchors.
3. Build a traceable capability plan before writes.
4. Deepen evidence with CodeGraph; routes-only evidence is insufficient unless the user explicitly accepts a shallow draft.
5. Prefer internal `deep-promote-candidate.mjs`; direct `promote-candidate.mjs` requires an already deepened plan.
6. Inspect `promotionMode`, `qualityIssues`, status decisions, evidence depth, repo commit, document paths, and `docsCount`; zero documents is failure.
7. Run sync and verify.

Do not fabricate CodeGraph evidence. Missing required CodeGraph coverage blocks deep promotion.
