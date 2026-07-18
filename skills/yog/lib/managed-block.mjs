import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MANAGED_BLOCK_END, MANAGED_BLOCK_START } from './constants.mjs';
import { routingCoreInstruction } from './routing-guidance.mjs';

export function managedBlock(knowledgeRoot = 'docs/knowledge') {
  return `${MANAGED_BLOCK_START}
Yog routing rules:
- ${routingCoreInstruction(knowledgeRoot)}
- For Knowledge implementation facts, use Knowledge-routed symbols/routes as bounded CodeGraph seeds. Do not replace unavailable or uncovered CodeGraph evidence with a whole-repository source scan.
- Query skills are read-only. Only an invalid managed root may hand off to its separate Audit writer; ordinary queries, gaps, or drift do not authorize writes.
- After a change lands, re-check the evidence documents you relied on. If the change made them inaccurate, update them or mark them stale.
- To make this routing reminder automatic on every prompt, ask Yog to run install-hooks. The hook is optional and non-blocking.
- Run automatic discover-candidates only when CodeGraph is initialized for this repository; otherwise ask to initialize CodeGraph first.
${MANAGED_BLOCK_END}`;
}

export function upsertManagedBlock(content, knowledgeRoot) {
  const block = managedBlock(knowledgeRoot);
  const pattern = new RegExp(`${MANAGED_BLOCK_START}[\\s\\S]*?${MANAGED_BLOCK_END}`);
  if (pattern.test(content)) return content.replace(pattern, block);
  return content.trim() ? `${content.trim()}\n\n${block}\n` : `${block}\n`;
}

export function writeRootManagedBlocks(repoRoot, knowledgeRoot) {
  const target = join(repoRoot, 'AGENTS.md');
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  writeFileSync(target, upsertManagedBlock(current, knowledgeRoot));
}
