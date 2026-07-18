---
name: yog
description: Read-only Yog entry selector. Use only when a user asks to use Yog without choosing whether to build or query product Wiki or coding-agent Knowledge. It never reads a knowledge base, runs scripts, or writes files.
---

# Yog Entry Selector

Yog has five task entry points:

- `yog:knowledge`: build or maintain coding-agent business knowledge in `docs/knowledge`.
- `yog:wiki`: generate or audit the product Wiki in `docs/wiki`.
- `yog:wiki-review`: guide a product manager through one atomic ReviewItem and persist a tagged Decision before handing off to `yog:wiki update`.
- `yog:knowledge-query`: answer engineering questions from `docs/knowledge`.
- `yog:wiki-query`: answer product questions from `docs/wiki`.

If the user has not selected a task, ask at most one question:

> Do you want to build or maintain knowledge, query existing knowledge, or review one product behavior; is the target the product Wiki or the coding-agent Knowledge base?

Do not inspect either knowledge root, call internal scripts, infer a write action, or execute a fallback workflow from this selector.
