import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MANAGED_BLOCK_END, MANAGED_BLOCK_START } from './constants.mjs';

export function managedBlock(knowledgeRoot = 'docs/knowledge') {
  return `${MANAGED_BLOCK_START}
Yog knowledge routing rules:
- Before answering business, architecture, feature, or implementation questions, read ${knowledgeRoot}/index.json when it exists.
- If a context matches, read its context index and source Markdown before making knowledge claims.
- Use CodeGraph, Serena, GitNexus, repository scans, or tests to verify current code facts.
- If code facts conflict with ${knowledgeRoot}, use current code facts for the task and recommend marking stale knowledge.
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
