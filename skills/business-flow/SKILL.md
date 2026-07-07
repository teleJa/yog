---
name: business-flow
description: Create or update Yog business-flow overview documents under docs/knowledge/business-flows. Use when users ask to generate a business flow, create an end-to-end business operation overview, connect multiple contexts into one workflow, document cross-context reading order, or update business-flows/*.md.
---

# Business Flow

Use this skill to create or update an end-to-end business operation overview from existing Yog knowledge.

## Scope

- Create or update `docs/knowledge/business-flows/*.md`.
- Connect multiple existing contexts into a readable business operation overview.
- Use existing contexts, capabilities, evidence, ADRs, `index.json`, `INDEX.md`, and `CONTEXT-MAP.md`.
- Prefer business-flow documents as the overview layer when a workflow spans multiple contexts.

Do not discover candidates, promote candidates, create formal contexts, change context boundaries, or rewrite responsibilities/non-responsibilities unless the user explicitly asks for that separate workflow.

## Workflow

1. Confirm the business operation name and scope.
2. Read `docs/knowledge/index.json`, `INDEX.md`, and `CONTEXT-MAP.md`.
3. Identify participating contexts and read their `CONTEXT.md`, `README.md`, relevant capabilities, evidence, and ADR links.
4. If a matching `business-flows/*.md` already exists, update it instead of creating a duplicate.
5. Use `docs/knowledge/templates/business-flow.md` when creating a new file.
6. Write the business flow with entry points, actors, participating contexts, reading order, state/data flow, cross-system collaboration, known limitations, and open questions.
7. Run `sync.mjs` and `verify.mjs`.
8. Report the business-flow path, participating contexts, changed files, and sync/verify results.

## Gates

- Do not create empty overview shells.
- Do not use candidate documents unless the user explicitly asks to include unconfirmed candidates.
- Do not duplicate detailed evidence bodies in the business-flow document; link or summarize them.
- Do not claim sync or verify passed without command results.
