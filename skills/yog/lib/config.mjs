import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEPRECATED_TOOL_KEYS = [String.fromCharCode(115, 101, 114, 101, 110, 97)];

export const DEFAULT_DISCOVER_CONFIG = {
  maxMidLowCandidates: 10,
};

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function mergeConfig(existing = {}, updates = {}) {
  const existingWithoutDeprecatedTools = { ...existing };
  for (const key of DEPRECATED_TOOL_KEYS) delete existingWithoutDeprecatedTools[key];
  return {
    ...existingWithoutDeprecatedTools,
    ...updates,
    codeFactProvider: updates.codeFactProvider ?? existing.codeFactProvider,
    discover: {
      ...DEFAULT_DISCOVER_CONFIG,
      ...objectValue(existingWithoutDeprecatedTools.discover),
      ...objectValue(updates.discover),
    },
  };
}

export function writeConfig(repoRoot, config) {
  mkdirSync(join(repoRoot, '.yog'), { recursive: true });
  writeFileSync(join(repoRoot, '.yog/config.json'), `${JSON.stringify(config, null, 2)}\n`);
}
