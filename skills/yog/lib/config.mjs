import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEPRECATED_TOOL_KEYS = [String.fromCharCode(115, 101, 114, 101, 110, 97)];

export const DEFAULT_DISCOVER_CONFIG = {
  maxMidLowCandidates: 10,
};

export const DEFAULT_LANGUAGE = 'zh-CN';
export const SUPPORTED_LANGUAGES = ['zh-CN'];
export const DEFAULT_WIKI_CONFIG = {
  root: 'docs/wiki',
  sources: [
    {
      id: 'product-catalog',
      kind: 'catalog',
      provider: 'menu-json',
      enabled: true,
      required: true,
      scope: { confirmedByUser: false },
      transports: [{
        id: 'catalog-file',
        type: 'file',
        enabled: true,
        priority: 10,
        paths: ['.yog/sources/catalog.json'],
      }],
    },
    {
      id: 'current-code',
      kind: 'code',
      provider: 'git-worktree',
      enabled: true,
      required: true,
      scope: { roots: ['.'], exclude: ['docs/wiki'] },
      transports: [
        { id: 'worktree-files', type: 'file', enabled: true, priority: 10 },
        { id: 'symbol-graph', type: 'codegraph', enabled: true, priority: 20 },
      ],
    },
    {
      id: 'primary-requirements',
      kind: 'requirement',
      provider: 'tapd',
      enabled: true,
      required: false,
      scope: {
        confirmedByUser: false,
        workspaceId: null,
        projectId: null,
        workItemIds: [],
      },
      transports: [{
        id: 'tapd-mcp',
        type: 'mcp',
        enabled: true,
        priority: 10,
        serverRef: 'tapd',
      }],
    },
    {
      id: 'primary-database',
      kind: 'database',
      provider: 'postgres',
      enabled: false,
      required: false,
      capturePolicy: 'metadata-only',
      scope: {
        confirmedByUser: false,
        environment: null,
        includeSchemas: [],
        excludeSchemas: ['pg_catalog', 'information_schema'],
      },
      freshness: { maxAgeHours: 24 },
      limits: { statementTimeoutMs: 10000, maxObjects: 50000 },
      transports: [{
        id: 'database-introspection',
        type: 'read-only-introspection',
        enabled: false,
        priority: 10,
        credentialRef: 'database:primary',
      }],
    },
    {
      id: 'context-specs',
      kind: 'spec',
      provider: 'filesystem',
      enabled: false,
      required: false,
      scope: { paths: [] },
      transports: [{
        id: 'spec-files',
        type: 'file',
        enabled: false,
        priority: 10,
        paths: [],
      }],
    },
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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
  const requestedWiki = updates.wiki ?? existingWithoutDeprecatedTools.wiki;
  const normalizedWiki = Array.isArray(objectValue(requestedWiki).sources)
    ? {
        root: objectValue(requestedWiki).root ?? DEFAULT_WIKI_CONFIG.root,
        sources: clone(objectValue(requestedWiki).sources),
        ...(objectValue(requestedWiki).confirmation ? { confirmation: clone(objectValue(requestedWiki).confirmation) } : {}),
      }
    : clone(DEFAULT_WIKI_CONFIG);
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
    wiki: normalizedWiki,
  };
}

export function writeConfig(repoRoot, config) {
  mkdirSync(join(repoRoot, '.yog'), { recursive: true });
  writeFileSync(join(repoRoot, '.yog/config.json'), `${JSON.stringify(config, null, 2)}\n`);
}
