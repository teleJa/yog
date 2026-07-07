import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MANAGED_BLOCK_END, MANAGED_BLOCK_START } from './constants.mjs';
import { routingCoreInstruction } from './routing-guidance.mjs';

export function managedBlock(knowledgeRoot = 'docs/knowledge') {
  return `${MANAGED_BLOCK_START}
Yog knowledge routing rules:
- ${routingCoreInstruction(knowledgeRoot)}
- If no context matches, use ${knowledgeRoot}/INDEX.md for routing, then explore code and docs directly.
- Use CodeGraph, repository scans, or tests to verify current code facts. Prefer CodeGraph for call-chain and symbol evidence. If code facts conflict with ${knowledgeRoot}, use current code facts for the task and recommend marking the stale knowledge.
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
  for (const fileName of ['AGENTS.md', 'CLAUDE.md']) {
    const target = join(repoRoot, fileName);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    writeFileSync(target, upsertManagedBlock(current, knowledgeRoot));
  }
}
