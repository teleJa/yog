---
name: wiki-review
description: Guide a product manager through one atomic Yog product-Wiki ReviewItem, persist a confirmed Decision, and hand off deterministic application to yog:wiki update.
---

# Yog Wiki Review

Use this thin workflow when the user invokes `yog:wiki-review` or asks to confirm, modify, reject, or defer one product behavior proposed by a Yog-managed Wiki. This Skill guides one atomic review; it does not generate the Wiki, scan code, invent product intent, or publish files.

## Ownership And Read Boundary

Require an absolute output root and a Yog-managed `docs/wiki`. Read `_meta/manifest.json` first and continue only for `schemaVersion: 1`, `managedBy: yog:wiki`, and `kind: yog-product-wiki-manifest`.

Use only this read set:

1. `_meta/catalog.json` and the target `_meta/catalog/<system-id>.json`;
2. `_meta/reviews.json` and the target `_meta/reviews/<system-id>.json`;
3. one `质量治理/产品审核/<system-id>/<feature-id>.md` shard;
4. the target Feature Markdown and `_meta/coverage.json`.

Never read or summarize the complete `_meta/model.json`; never bulk-load Claims, Evidence, Relationships, other Systems, code, databases, TAPD, `docs/knowledge`, or remote providers. A pending ReviewItem is a Reverse Baseline Proposal, not a product fact.

## Source Preflight

Before writing a Decision draft, read `<outputRoot>/.yog/config.json` and require an enabled, confirmed `spec/filesystem` Source whose scope covers the configured Decision root, normally `docs/wiki-inputs/decisions`. If it is missing, return `decision-source-not-configured` and hand off Source prepare/confirm. Do not edit configuration or broaden scope.

## One-Item Workflow

1. Resolve exactly one target Feature and one ReviewItem through the two Review indexes. Process at most one item per Decision.
2. Show only its question, Current observation, evidence level, execution surfaces, priority/reasons, and proposed Given/When/Then. Clearly label the proposal as unapproved.
3. Accept exactly one outcome: `confirm | modify | reject | defer`.
   - `confirm`: accept the displayed proposal and include that exact proposal as the immutable Decision answer snapshot.
   - `modify`: collect one complete atomic `criterionType + given[] + when + then[]` replacement.
   - `reject`: record why this is not a product requirement; do not create Expected knowledge.
   - `defer`: record the reason and a concrete review condition; do not return it to the next batch.
4. Build a tagged Decision target with `kind: review-item`, the exact ReviewItem ID, and its current `sourceFingerprint`. Do not use locator, Evidence ID, or file path as identity.
5. Invoke `skills/yog/scripts/draft-wiki-decision.mjs`. It writes exactly one Markdown Decision under `docs/wiki-inputs/decisions/<system-id>/<feature-id>/<review-item-id>.md`.
6. Show the complete outcome, answer, rationale, scope, non-scope, behavior fingerprint, and proposed Decision fingerprint. Only after explicit confirmation invoke `skills/yog/scripts/confirm-wiki-decision.mjs` with confirmer identity, role, timestamp, and the ReviewItem's current source fingerprint.
7. Hand the confirmed Decision to `yog:wiki update`. Never edit `docs/wiki`, `_meta/model.json`, ReviewItem status, Claim, Acceptance Criteria, Gap, Coverage, or Manifest directly.

## Deterministic Safety

- If the current ReviewItem fingerprint differs from the draft target, stop with `wiki-review-source-fingerprint-mismatch`; the old draft cannot be confirmed.
- `confirm` and `modify` may materialize only Human Confirmation Evidence, Expected Claim, and one Atomic Acceptance Criteria. They never upgrade Current behavior.
- A modified proposal that differs from Current produces an explicit baseline/current conflict.
- `reject` produces no Expected Claim. The same semantic item and behavior fingerprint must not be asked again.
- `defer` remains traceable but does not occupy the next P0/P1 batch.
- A transaction/lock failure after valid confirmation is `confirmed-pending-apply`; retry the same Decision ID and fingerprint instead of asking again.

## Thin-Skill Boundary

Do not copy canonical schemas, fingerprint algorithms, ranking rules, validators, renderers, impact closure, or publisher logic into this Skill. Those stay in `skills/yog/lib` and the `yog:wiki` lifecycle.
