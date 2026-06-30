import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function mergeConfig(existing = {}, updates = {}) {
  return {
    ...existing,
    ...updates,
    serena: updates.serena ?? existing.serena,
    codeFactProvider: updates.codeFactProvider ?? existing.codeFactProvider,
  };
}

export function writeConfig(repoRoot, config) {
  mkdirSync(join(repoRoot, '.yog'), { recursive: true });
  writeFileSync(join(repoRoot, '.yog/config.json'), `${JSON.stringify(config, null, 2)}\n`);
}
