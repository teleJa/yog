export function createPrdExtractionChecklist({ sourcePath, context, capability }) {
  return `# Archived PRD Knowledge Extraction Checklist

## Source

- PRD / change path: ${sourcePath}
- Related context: ${context}
- Related capability: ${capability}

## Extract

- Stable business terms:
- Final business boundary:
- Final workflow:
- Upstream / downstream relationship:
- Durable constraints:
- Implementation evidence to refresh:
- Open questions that remain valid:

## Exclude

- Temporary task breakdown:
- One-time verification logs:
- Deprecated alternatives:
- Delivery status details:

## ADR Candidates

- Hard-to-reverse decision:
- Non-obvious trade-off:
- Rejected alternatives worth remembering:
`;
}
