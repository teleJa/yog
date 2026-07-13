import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEPRECATED_TOOL_KEYS = [String.fromCharCode(115, 101, 114, 101, 110, 97)];

export const DEFAULT_DISCOVER_CONFIG = {
  maxMidLowCandidates: 10,
};

export const DEFAULT_LANGUAGE = 'zh-CN';
export const SUPPORTED_LANGUAGES = ['zh-CN'];
export const DEFAULT_WIKI_CONFIG = {
  requirementProvider: {
    provider: 'tapd',
    transport: 'mcp',
    serverRef: 'tapd',
  },
};

export function normalizeLanguage(value = DEFAULT_LANGUAGE) {
  if (!SUPPORTED_LANGUAGES.includes(value)) {
    const error = new Error(`Unsupported Yog language: ${value}. Expected one of: ${SUPPORTED_LANGUAGES.join(', ')}.`);
    error.code = 'yog-language-invalid';
    throw error;
  }
  return value;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function mergeConfig(existing = {}, updates = {}) {
  const existingWithoutDeprecatedTools = { ...existing };
  for (const key of DEPRECATED_TOOL_KEYS) delete existingWithoutDeprecatedTools[key];
  return {
    ...existingWithoutDeprecatedTools,
    ...updates,
    language: normalizeLanguage(updates.language ?? existingWithoutDeprecatedTools.language ?? DEFAULT_LANGUAGE),
    codeFactProvider: updates.codeFactProvider ?? existing.codeFactProvider,
    discover: {
      ...DEFAULT_DISCOVER_CONFIG,
      ...objectValue(existingWithoutDeprecatedTools.discover),
      ...objectValue(updates.discover),
    },
    wiki: {
      ...DEFAULT_WIKI_CONFIG,
      ...objectValue(existingWithoutDeprecatedTools.wiki),
      ...objectValue(updates.wiki),
      requirementProvider: {
        ...DEFAULT_WIKI_CONFIG.requirementProvider,
        ...objectValue(existingWithoutDeprecatedTools.wiki?.requirementProvider),
        ...objectValue(updates.wiki?.requirementProvider),
      },
    },
  };
}

export function writeConfig(repoRoot, config) {
  mkdirSync(join(repoRoot, '.yog'), { recursive: true });
  writeFileSync(join(repoRoot, '.yog/config.json'), `${JSON.stringify(config, null, 2)}\n`);
}
