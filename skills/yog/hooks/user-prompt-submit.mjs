#!/usr/bin/env node
// Yog UserPromptSubmit hook — copied into a repository's .claude/hooks/ and .codex/hooks/
// by the Yog install-hooks step. Self-contained on purpose: this runs on EVERY user
// prompt, so it must never crash and never block. It imports nothing from the Yog plugin.
//
// Contract (shared by Claude Code and Codex CLI):
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
  return `Yog knowledge base: before requirement analysis, solution design, interface changes, or business-rule judgments, first read ${knowledgeRoot}/CONTEXT-MAP.md, select relevant contexts by matching the request against each context's summary, responsibilities, and non-responsibilities, then read the full CONTEXT.md and related capability and evidence documents before designing or changing behavior. If nothing matches, use ${knowledgeRoot}/INDEX.md for routing.`;
}

function hookMissingKnowledgeNotice(knowledgeRoot) {
  return `Yog knowledge base is not initialized in this repository (${knowledgeRoot}/CONTEXT-MAP.md not found). Run the Yog init step to create it before relying on business-context routing.`;
}

function emit(additionalContext) {
  // Single-line JSON: Claude Code silently drops multi-line hook output.
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
