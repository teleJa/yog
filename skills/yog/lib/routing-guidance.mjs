// Shared routing-guidance wording source.
// Consumed by managed-block.mjs (root AGENTS.md/CLAUDE.md) and the copied
// UserPromptSubmit hook script, so the routing instruction has one source of truth.

// Two-sentence core instruction reused verbatim inside the managed block's first rules.
export function routingCoreInstruction(knowledgeRoot = 'docs/knowledge') {
  return `Before requirement analysis, solution design, interface changes, or business-rule judgments, first read ${knowledgeRoot}/CONTEXT-MAP.md.
- Select relevant contexts yourself by matching the current request against each context's summary, responsibilities, and non-responsibilities. Then read the full CONTEXT.md and related capability and evidence documents before designing or changing behavior.`;
}

// Compact instruction + routing-table pointer injected every turn by the hook.
// Kept short on purpose: the hook fires on every prompt, so token cost matters.
export function hookAdditionalContext(knowledgeRoot = 'docs/knowledge') {
  return `Yog knowledge base: before requirement analysis, solution design, interface changes, or business-rule judgments, first read ${knowledgeRoot}/CONTEXT-MAP.md, select relevant contexts by matching the request against each context's summary, responsibilities, and non-responsibilities, then read the full CONTEXT.md and related capability and evidence documents before designing or changing behavior. If nothing matches, use ${knowledgeRoot}/INDEX.md for routing.`;
}

// Notice injected when the repository has no initialized Yog knowledge base.
export function hookMissingKnowledgeNotice(knowledgeRoot = 'docs/knowledge') {
  return `Yog knowledge base is not initialized in this repository (${knowledgeRoot}/CONTEXT-MAP.md not found). Run the Yog init step to create it before relying on business-context routing.`;
}
