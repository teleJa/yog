#!/usr/bin/env node
// Yog UserPromptSubmit hook — copied into a repository's .codex/hooks/
// by the Yog install-hooks step. Self-contained on purpose: this runs on EVERY user
// prompt, so it must never crash and never block. It imports nothing from the Yog plugin.
//
// Codex contract:
// - reads platform JSON on stdin (structure not relied upon)
// - writes a SINGLE-LINE JSON object with hookSpecificOutput.additionalContext
// - always exits 0; it is an enhancement, never a gate on the user's prompt
//
// The wording below is intentionally duplicated from skills/yog/lib/routing-guidance.mjs.
// A test asserts the two stay identical, so drift turns the suite red.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const KNOWLEDGE_ROOT_DEFAULT = 'docs/knowledge';

function findUp(startDir, marker) {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, marker))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveKnowledgeRoot() {
  const repoRoot = findUp(process.cwd(), '.yog/config.json') ?? findUp(process.cwd(), '.git');
  if (!repoRoot) return { repoRoot: process.cwd(), knowledgeRoot: KNOWLEDGE_ROOT_DEFAULT };
  try {
    const config = JSON.parse(readFileSync(join(repoRoot, '.yog/config.json'), 'utf8'));
    return { repoRoot, knowledgeRoot: config.knowledgeRoot ?? KNOWLEDGE_ROOT_DEFAULT };
  } catch {
    return { repoRoot, knowledgeRoot: KNOWLEDGE_ROOT_DEFAULT };
  }
}

function hookAdditionalContext(knowledgeRoot) {
  return `Explicit Yog skill invocation is authoritative. yog:wiki-query reads docs/wiki; yog:knowledge-query reads ${knowledgeRoot}. Without an explicit query skill, choose by the question's required knowledge perspective, never by user role. If ambiguous, query Wiki first and Knowledge second and label both source sets. Only concrete coding, debugging, refactoring, interface implementation, or code-impact work defaults to ${knowledgeRoot}/index.json, INDEX.md, matching business-flow, and CONTEXT-MAP.md as supporting context.`;
}

function hookMissingKnowledgeNotice(knowledgeRoot) {
  return `Explicit Yog skill invocation is authoritative. Yog Knowledge is not initialized (${knowledgeRoot}/CONTEXT-MAP.md missing), but this never blocks yog:wiki-query. Query selection follows the question's knowledge perspective, never user role; if ambiguous, query Wiki first, mark Knowledge unavailable, and label sources. Run yog:knowledge init only when initialization is explicitly requested.`;
}

function emit(additionalContext) {
  // Keep output to one JSON line for predictable Codex hook parsing.
  const payload = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } };
  process.stdout.write(JSON.stringify(payload));
}

async function main() {
  // Drain stdin so the platform does not see a broken pipe; content is not needed.
  try {
    for await (const _chunk of process.stdin) { /* ignore */ }
  } catch { /* ignore */ }

  const { repoRoot, knowledgeRoot } = resolveKnowledgeRoot();
  const contextMap = join(repoRoot, knowledgeRoot, 'CONTEXT-MAP.md');
  if (existsSync(contextMap)) emit(hookAdditionalContext(knowledgeRoot));
  else emit(hookMissingKnowledgeNotice(knowledgeRoot));
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
