---
name: knowledge
description: Build and maintain Yog coding-agent business knowledge under docs/knowledge. Use for initialization, candidate discovery, business flows, sync, verify, audit, hook installation, upgrade, document maintenance, candidate review or promotion, and context-boundary calibration. Read-only governance reviews are allowed; writes require explicit intent and existing confirmation gates.
---

# Yog Knowledge

This is the single user-facing maintenance entry for `docs/knowledge`. It may write only when the user explicitly requests a concrete maintenance outcome. A query, Gap, Drift, low-confidence item, or vague “use Yog” request does not authorize writes.

## Stable Actions

Load exactly one matching workflow reference:

| action | workflow |
| --- | --- |
| `init` | `references/workflows/init.md` |
| `discover-candidates` | `references/workflows/discover-candidates.md` |
| `business-flow` | `references/workflows/business-flow.md` |
| `sync` | `references/workflows/sync.md` |
| `verify` | `references/workflows/verify.md` |
| `audit` | `references/workflows/audit.md` |
| `install-hooks` | `references/workflows/install-hooks.md` |
| `upgrade` | `references/workflows/upgrade.md` |

Equivalent explicit natural language is the same action. If the action or write scope remains ambiguous, ask one question and do not write.

## Natural-language Maintenance

- Create or update Context, Capability, Evidence, ADR, Candidate, or Business Flow: load `references/workflows/create-update.md`.
- Review Candidate, `needs-review`, `stale`, or other governance objects: load `references/workflows/review.md`. Listing and review are read-only unless the user separately authorizes changes.
- Promote a confirmed Candidate: load `references/workflows/promote.md` and preserve the existing deep-evidence and confirmation gates.
- Calibrate overlap, split/merge, ownership, terminology, or Context relationships: load `references/workflows/calibrate.md`; only the user may decide formal boundary changes.

Changes to formal business boundaries, terms, status, split/merge decisions, or promotion require explicit human confirmation. After an authorized write, run the applicable `sync` and `verify` workflows and report real results.

Internal Node scripts remain implementation details under `skills/yog/scripts`; do not ask the user to run them manually.
