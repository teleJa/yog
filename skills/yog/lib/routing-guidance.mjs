// Shared routing-guidance wording source.
// Consumed by managed-block.mjs (root AGENTS.md) and the copied
// UserPromptSubmit hook script, so the routing instruction has one source of truth.

// Two-sentence core instruction reused verbatim inside the managed block's first rules.
export function routingCoreInstruction(knowledgeRoot = 'docs/knowledge') {
  return `Explicit Yog skill invocation is authoritative.
- yog:wiki-query reads docs/wiki; yog:knowledge-query reads ${knowledgeRoot}.
- Without an explicit query skill, select by the question's required knowledge perspective, never by user role. If ambiguous, query Wiki first and Knowledge second and label both source sets.
- Without an explicit Yog query skill, only concrete coding, debugging, refactoring, interface implementation, or code-impact work routes through ${knowledgeRoot}/index.json, INDEX.md, matching business-flow, and CONTEXT-MAP.md as supporting context.`;
}

// Compact instruction + routing-table pointer injected every turn by the hook.
// Kept short on purpose: the hook fires on every prompt, so token cost matters.
export function hookAdditionalContext(knowledgeRoot = 'docs/knowledge') {
  return `Explicit Yog skill invocation is authoritative. yog:wiki-query reads docs/wiki; yog:knowledge-query reads ${knowledgeRoot}. Without an explicit query skill, choose by the question's required knowledge perspective, never by user role. If ambiguous, query Wiki first and Knowledge second and label both source sets. Only concrete coding, debugging, refactoring, interface implementation, or code-impact work defaults to ${knowledgeRoot}/index.json, INDEX.md, matching business-flow, and CONTEXT-MAP.md as supporting context.`;
}

// Notice injected when the repository has no initialized Yog knowledge base.
export function hookMissingKnowledgeNotice(knowledgeRoot = 'docs/knowledge') {
  return `Explicit Yog skill invocation is authoritative. Yog Knowledge is not initialized (${knowledgeRoot}/CONTEXT-MAP.md missing), but this never blocks yog:wiki-query. Query selection follows the question's knowledge perspective, never user role; if ambiguous, query Wiki first, mark Knowledge unavailable, and label sources. Run yog:knowledge init only when initialization is explicitly requested.`;
}
