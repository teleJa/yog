// Shared routing-guidance wording source.
// Consumed by managed-block.mjs (root AGENTS.md/CLAUDE.md) and the copied
// UserPromptSubmit hook script, so the routing instruction has one source of truth.

// Two-sentence core instruction reused verbatim inside the managed block's first rules.
export function routingCoreInstruction(knowledgeRoot = 'docs/knowledge') {
  return `Before requirement analysis, solution design, interface changes, or business-rule judgments, first read ${knowledgeRoot}/index.json, ${knowledgeRoot}/INDEX.md, and ${knowledgeRoot}/CONTEXT-MAP.md.
- If a matching business-flow entry exists, read it first as the end-to-end overview. Then select relevant contexts and read their CONTEXT.md, capability, and evidence documents before designing or changing behavior.`;
}

// Compact instruction + routing-table pointer injected every turn by the hook.
// Kept short on purpose: the hook fires on every prompt, so token cost matters.
export function hookAdditionalContext(knowledgeRoot = 'docs/knowledge') {
  return `Yog knowledge base: before business, design, interface, or implementation work, route through ${knowledgeRoot}/index.json, ${knowledgeRoot}/INDEX.md, and ${knowledgeRoot}/CONTEXT-MAP.md. If a matching business-flow exists, read it first as the end-to-end overview, then read the relevant context/capability/evidence documents.`;
}

// Notice injected when the repository has no initialized Yog knowledge base.
export function hookMissingKnowledgeNotice(knowledgeRoot = 'docs/knowledge') {
  return `Yog knowledge base is not initialized in this repository (${knowledgeRoot}/CONTEXT-MAP.md not found). Run the Yog init step to create it before relying on business-context routing.`;
}
