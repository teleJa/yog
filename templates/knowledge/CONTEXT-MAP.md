# Context Map

This file records confirmed business contexts and their relationships.

## Contexts

Context entries must use the exact structure below. Keep name, summary, Path, Responsibilities, and Non-responsibilities non-empty. `context-id` must match `[a-z][a-z0-9-]*`. Path is relative to `docs/knowledge/`.

- `{context-id}`: `{Context Name}` - `{one sentence summary}`
  - Path: `contexts/{context-id}/CONTEXT.md`
  - Responsibilities: `{short responsibility summary}`
  - Non-responsibilities: `{short non-responsibility summary}`

## Relationships

Relationships must reference confirmed context ids listed above. Do not point relationships at candidates, semi-initialized directories, missing ids, or the same source and target. Use directed `- source -> target: summary` bullet lines with non-empty summaries; write bidirectional relationships as two directed lines. Do not repeat the same `source -> target` edge.

- `{source-context} -> {target-context}`: `{relationship summary}`

## Open Questions

- `{question}`
