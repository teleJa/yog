import { createHash } from 'node:crypto';
import { isAbsolute, posix, resolve } from 'node:path';
import { assertDecisionContentHash, normalizeDecisionRecord } from './wiki-decision.mjs';

export const SOURCE_KINDS = new Set(['catalog', 'code', 'requirement', 'database', 'spec', 'record', 'knowledge']);
export const SOURCE_STATUSES = new Set([
  'collected',
  'partial',
  'skipped-disabled',
  'skipped-no-input',
  'skipped-unavailable',
  'skipped-unauthenticated',
  'failed',
]);
export const SOURCE_REASON_CODES = new Set([
  'source-partial',
  'source-config-invalid',
  'source-scope-unconfirmed',
  'source-unavailable',
  'source-unauthenticated',
  'source-collect-failed',
  'source-artifact-invalid',
  'source-sensitive-data-detected',
]);

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SHA_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CODE_REPOSITORY_SURFACES = new Set(['frontend', 'backend', 'infrastructure', 'database', 'test', 'unknown']);
const CODE_LOCATOR_PRECISIONS = new Set(['file', 'line', 'symbol']);
const ARTIFACT_KINDS = new Map([
  ['catalog', 'catalog-artifact'],
  ['code', 'code-artifact'],
  ['requirement', 'requirement-artifact'],
  ['database', 'database-artifact'],
  ['spec', 'spec-artifact'],
  ['record', 'record-artifact'],
  ['knowledge', 'knowledge-artifact'],
]);
const ARTIFACT_SOURCE_KINDS = new Map([
  ...[...ARTIFACT_KINDS].map(([sourceKind, artifactKind]) => [artifactKind, sourceKind]),
  ['decision-artifact', 'spec'],
]);

function artifactKindMatchesSource(artifactKind, sourceKind) {
  return ARTIFACT_SOURCE_KINDS.get(artifactKind) === sourceKind;
}
const PROVIDERS = new Map([
  ['catalog:menu-json', new Set(['file'])],
  ['code:git-worktree', new Set(['file', 'codegraph'])],
  ['requirement:tapd', new Set(['mcp'])],
  ['database:postgres', new Set(['ddl-file', 'migration-files', 'schema-dump', 'read-only-introspection'])],
  ['database:mysql', new Set(['ddl-file', 'migration-files', 'schema-dump', 'read-only-introspection'])],
  ['spec:filesystem', new Set(['file'])],
  ['record:record-skill', new Set(['file'])],
  ['knowledge:managed-root', new Set(['file'])],
]);
const SOURCE_COMMON_KEYS = new Set([
  'id', 'kind', 'provider', 'enabled', 'required', 'scope', 'transports', 'freshness', 'limits', 'capturePolicy', 'confirmation',
]);
const SOURCE_CONFIRMATION_KEYS = new Set(['status', 'scopeFingerprint', 'confirmedAt']);
const SOURCE_CONFIRMATION_STATUSES = new Set(['pending', 'confirmed']);
const WIKI_CONFIRMATION_KEYS = new Set(['status', 'inputFingerprint', 'confirmedAt']);
const WIKI_INPUT_CONFIRMATION_KEYS = new Set(['status', 'inputFingerprint', 'confirmedAt', 'sources']);
const WIKI_INPUT_CONFIRMATION_SOURCE_KEYS = new Set(['sourceId', 'kind', 'provider', 'enabled', 'required', 'scopeFingerprint']);
const SOURCE_SCOPE_KEYS = new Map([
  ['catalog', new Set(['confirmedByUser', 'rootNodeIds'])],
  ['code', new Set(['roots', 'exclude'])],
  ['requirement', new Set(['confirmedByUser', 'workspaceId', 'projectId', 'workItemIds'])],
  ['database', new Set(['confirmedByUser', 'environment', 'includeSchemas', 'excludeSchemas'])],
  ['spec', new Set(['paths'])],
  ['record', new Set(['skillRefs', 'artifactPaths'])],
  ['knowledge', new Set(['root', 'verifiedOnly'])],
]);
const TRANSPORT_COMMON_KEYS = new Set([
  'id', 'type', 'enabled', 'priority', 'paths', 'serverRef', 'credentialRef',
]);
const SENSITIVE_KEY_PATTERN = /(?:token|password|passwd|secret|cookie|authorization|dsn|certificate|privateKey|host)$/i;
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:postgres(?:ql)?|mysql):\/\/[^\s]+/i,
  /\b(?:token|password|passwd|secret)\s*[:=]\s*["']?(?!redacted|unknown|missing)[A-Za-z0-9_+/.=-]{8,}/i,
  /\/Users\/[A-Za-z0-9._-]+\//,
];
const DATABASE_COLLECTIONS = new Map([
  ['schemas', ['id', 'name', 'environment', 'evidenceId']],
  ['tables', ['id', 'schemaId', 'name', 'kind', 'comment', 'evidenceId']],
  ['views', ['id', 'schemaId', 'name', 'definitionHash', 'dependencyIds', 'evidenceId']],
  ['columns', ['id', 'ownerId', 'name', 'dataType', 'nullable', 'defaultExpression', 'ordinal', 'comment', 'evidenceId']],
  ['constraints', ['id', 'ownerId', 'type', 'columnIds', 'referencedObjectId', 'referencedColumnIds', 'expression', 'evidenceId']],
  ['indexes', ['id', 'ownerId', 'unique', 'columnIds', 'expression', 'predicate', 'evidenceId']],
  ['sequences', ['id', 'schemaId', 'name', 'ownedByColumnId', 'evidenceId']],
  ['triggers', ['id', 'ownerId', 'name', 'event', 'timing', 'definitionHash', 'evidenceId']],
  ['enums', ['id', 'schemaId', 'name', 'labels', 'evidenceId']],
  ['accessControls', ['id', 'subject', 'objectId', 'privilege', 'policyExpression', 'evidenceId']],
]);

function contractError(code, message, path = '$', issues = null) {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  if (issues) error.issues = issues;
  return error;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function assertObject(value, path) {
  const result = objectValue(value);
  if (!result) throw contractError('yog-config-schema-invalid', `${path} must be an object.`, path);
  return result;
}

function assertArray(value, path) {
  if (!Array.isArray(value)) throw contractError('yog-config-schema-invalid', `${path} must be an array.`, path);
  return value;
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') throw contractError('yog-config-schema-invalid', `${path} must be a boolean.`, path);
  return value;
}

function assertText(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw contractError('yog-config-schema-invalid', `${path} must be a non-empty string.`, path);
  }
  return value;
}

function assertId(value, path) {
  const result = assertText(value, path);
  if (!ID_PATTERN.test(result)) throw contractError('yog-config-schema-invalid', `${path} must match ${ID_PATTERN}.`, path);
  return result;
}

function assertInteger(value, path, { minimum = 0 } = {}) {
  if (!Number.isInteger(value) || value < minimum) {
    throw contractError('yog-config-schema-invalid', `${path} must be an integer >= ${minimum}.`, path);
  }
  return value;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function optionalText(value, path) {
  return value === null || value === undefined ? null : assertText(value, path);
}

function assertKnownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw contractError('yog-config-schema-invalid', `Unknown field ${path}.${key}.`, `${path}.${key}`);
  }
}

function safeRelativePath(value, path, { allowDot = false } = {}) {
  const text = assertText(value, path).replaceAll('\\', '/');
  if (isAbsolute(value) || (!allowDot && text === '.') || text === '..' || text.startsWith('../') || text.includes('/../') || text.includes('\0')) {
    throw contractError('yog-config-schema-invalid', `${path} must be a safe repository-relative path.`, path);
  }
  return posix.normalize(text.replace(/^\.\//, ''));
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!objectValue(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function fingerprint(value) {
  const copy = structuredClone(value);
  if (objectValue(copy)) {
    delete copy.capturedAt;
    delete copy.fingerprint;
  }
  return sha256(JSON.stringify(canonical(copy)));
}

function sourceFingerprintValue(source) {
  const value = structuredClone(source);
  delete value.confirmation;
  if (objectValue(value.scope)) delete value.scope.confirmedByUser;
  return value;
}

export function sourceScopeFingerprint(source) {
  return sha256(JSON.stringify(canonical(sourceFingerprintValue(source))));
}

function confirmationSource(source, path = '$.sources[]') {
  const value = assertObject(source, path);
  const configuredSource = 'id' in value;
  const sourceId = assertId(value.sourceId ?? value.id, `${path}.sourceId`);
  const kind = assertText(value.kind, `${path}.kind`);
  const provider = assertText(value.provider, `${path}.provider`);
  if (!SOURCE_KINDS.has(kind) || !PROVIDERS.has(`${kind}:${provider}`)) {
    throw contractError('wiki-source-scope-unconfirmed', `Unsupported confirmation Source ${kind}:${provider}.`, path);
  }
  const scopeFingerprint = configuredSource ? sourceScopeFingerprint(value) : value.scopeFingerprint;
  if (typeof scopeFingerprint !== 'string' || !SHA_PATTERN.test(scopeFingerprint)) {
    throw contractError('wiki-source-scope-unconfirmed', `Source ${sourceId} has an invalid scope fingerprint.`, `${path}.scopeFingerprint`);
  }
  return {
    sourceId,
    kind,
    provider,
    enabled: assertBoolean(value.enabled, `${path}.enabled`),
    required: assertBoolean(value.required, `${path}.required`),
    scopeFingerprint,
  };
}

function normalizedConfirmationSources(sources) {
  const values = assertArray(sources, '$.sources').map((source, index) => confirmationSource(source, `$.sources[${index}]`));
  const ids = new Set();
  for (const source of values) {
    if (ids.has(source.sourceId)) throw confirmationError(`Duplicate confirmation Source ${source.sourceId}.`, source.sourceId);
    ids.add(source.sourceId);
  }
  return values.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function wikiInputFingerprint({ outputRoot, wikiRoot, sources }) {
  if (typeof outputRoot !== 'string' || !isAbsolute(outputRoot)) {
    throw contractError('yog-config-schema-invalid', 'outputRoot must be an absolute path.', '$.outputRoot');
  }
  const root = safeRelativePath(wikiRoot, '$.wiki.root');
  return sha256(JSON.stringify(canonical({
    outputRoot: resolve(outputRoot),
    wikiRoot: root,
    sources: normalizedConfirmationSources(sources),
  })));
}

function pendingConfirmation(source) {
  return {
    status: 'pending',
    scopeFingerprint: sourceScopeFingerprint(source),
    confirmedAt: null,
  };
}

function normalizeConfirmation(raw, source, path) {
  if (raw === undefined) return pendingConfirmation(source);
  const confirmation = assertObject(raw, `${path}.confirmation`);
  assertKnownKeys(confirmation, SOURCE_CONFIRMATION_KEYS, `${path}.confirmation`);
  const status = assertText(confirmation.status, `${path}.confirmation.status`);
  if (!SOURCE_CONFIRMATION_STATUSES.has(status)) {
    throw contractError('yog-config-schema-invalid', `Unsupported Source confirmation status: ${status}.`, `${path}.confirmation.status`);
  }
  const scopeFingerprint = assertText(confirmation.scopeFingerprint, `${path}.confirmation.scopeFingerprint`);
  if (!SHA_PATTERN.test(scopeFingerprint)) {
    throw contractError('yog-config-schema-invalid', 'Source confirmation scopeFingerprint must be sha256.', `${path}.confirmation.scopeFingerprint`);
  }
  const confirmedAt = confirmation.confirmedAt ?? null;
  if (confirmedAt !== null && (typeof confirmedAt !== 'string' || Number.isNaN(Date.parse(confirmedAt)))) {
    throw contractError('yog-config-schema-invalid', 'Source confirmation confirmedAt must be an ISO timestamp or null.', `${path}.confirmation.confirmedAt`);
  }
  if (status === 'pending' && confirmedAt !== null) {
    throw contractError('yog-config-schema-invalid', 'Pending Source confirmation cannot have confirmedAt.', `${path}.confirmation.confirmedAt`);
  }
  if (status === 'confirmed' && confirmedAt === null) {
    throw contractError('yog-config-schema-invalid', 'Confirmed Source confirmation requires confirmedAt.', `${path}.confirmation.confirmedAt`);
  }
  return { status, scopeFingerprint, confirmedAt };
}

function normalizeWikiConfirmation(raw) {
  if (raw === undefined) return null;
  const confirmation = assertObject(raw, '$.wiki.confirmation');
  assertKnownKeys(confirmation, WIKI_CONFIRMATION_KEYS, '$.wiki.confirmation');
  const status = assertText(confirmation.status, '$.wiki.confirmation.status');
  if (!SOURCE_CONFIRMATION_STATUSES.has(status)) {
    throw contractError('yog-config-schema-invalid', `Unsupported Wiki confirmation status: ${status}.`, '$.wiki.confirmation.status');
  }
  const inputFingerprint = assertText(confirmation.inputFingerprint, '$.wiki.confirmation.inputFingerprint');
  if (!SHA_PATTERN.test(inputFingerprint)) {
    throw contractError('yog-config-schema-invalid', 'Wiki confirmation inputFingerprint must be sha256.', '$.wiki.confirmation.inputFingerprint');
  }
  const confirmedAt = confirmation.confirmedAt ?? null;
  if (confirmedAt !== null && (typeof confirmedAt !== 'string' || Number.isNaN(Date.parse(confirmedAt)))) {
    throw contractError('yog-config-schema-invalid', 'Wiki confirmation confirmedAt must be an ISO timestamp or null.', '$.wiki.confirmation.confirmedAt');
  }
  if (status === 'pending' && confirmedAt !== null) {
    throw contractError('yog-config-schema-invalid', 'Pending Wiki confirmation cannot have confirmedAt.', '$.wiki.confirmation.confirmedAt');
  }
  if (status === 'confirmed' && confirmedAt === null) {
    throw contractError('yog-config-schema-invalid', 'Confirmed Wiki confirmation requires confirmedAt.', '$.wiki.confirmation.confirmedAt');
  }
  return { status, inputFingerprint, confirmedAt };
}

function assertNoSensitive(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitive(item, `${path}[${index}]`));
    return;
  }
  if (objectValue(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && !['credentialRef', 'serverRef'].includes(key)) {
        throw contractError('source-sensitive-data-detected', `Sensitive key is forbidden: ${path}.${key}.`, `${path}.${key}`);
      }
      assertNoSensitive(item, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw contractError('source-sensitive-data-detected', `Sensitive value is forbidden at ${path}.`, path);
  }
}

function validateTransport(raw, source, index) {
  const path = `$.wiki.sources.${source.id}.transports[${index}]`;
  const transport = assertObject(raw, path);
  assertKnownKeys(transport, TRANSPORT_COMMON_KEYS, path);
  const id = assertId(transport.id, `${path}.id`);
  const type = assertText(transport.type, `${path}.type`);
  const allowed = PROVIDERS.get(`${source.kind}:${source.provider}`);
  if (!allowed?.has(type)) throw contractError('yog-config-schema-invalid', `Transport ${type} is invalid for ${source.kind}:${source.provider}.`, `${path}.type`);
  const enabled = assertBoolean(transport.enabled, `${path}.enabled`);
  const priority = assertInteger(transport.priority, `${path}.priority`, { minimum: 1 });
  const result = { id, type, enabled, priority };
  if (transport.paths !== undefined) result.paths = sortedUnique(assertArray(transport.paths, `${path}.paths`).map((item, itemIndex) => safeRelativePath(item, `${path}.paths[${itemIndex}]`)));
  if (transport.serverRef !== undefined) result.serverRef = assertText(transport.serverRef, `${path}.serverRef`);
  if (transport.credentialRef !== undefined) result.credentialRef = assertText(transport.credentialRef, `${path}.credentialRef`);
  if (type === 'file' && source.kind === 'catalog' && result.paths?.length !== 1) {
    throw contractError('yog-config-schema-invalid', 'Catalog file transport requires exactly one path.', `${path}.paths`);
  }
  if (['ddl-file', 'migration-files', 'schema-dump'].includes(type) && (!result.paths || result.paths.length === 0)) {
    throw contractError('yog-config-schema-invalid', `${type} requires non-empty paths.`, `${path}.paths`);
  }
  if (type === 'mcp' && !result.serverRef) throw contractError('yog-config-schema-invalid', 'MCP transport requires serverRef.', `${path}.serverRef`);
  if (type === 'read-only-introspection' && enabled && !result.credentialRef) {
    throw contractError('yog-config-schema-invalid', 'Enabled live database introspection requires credentialRef.', `${path}.credentialRef`);
  }
  return result;
}

function validateSource(raw, index, { allowUnconfirmed = false } = {}) {
  const path = `$.wiki.sources[${index}]`;
  const source = assertObject(raw, path);
  assertKnownKeys(source, SOURCE_COMMON_KEYS, path);
  const id = assertId(source.id, `${path}.id`);
  const kind = assertText(source.kind, `${path}.kind`);
  if (!SOURCE_KINDS.has(kind)) throw contractError('yog-config-schema-invalid', `Unsupported source kind: ${kind}.`, `${path}.kind`);
  const provider = assertText(source.provider, `${path}.provider`);
  if (!PROVIDERS.has(`${kind}:${provider}`)) {
    throw contractError('yog-config-schema-invalid', `Unsupported source provider: ${kind}:${provider}.`, `${path}.provider`);
  }
  const enabled = assertBoolean(source.enabled, `${path}.enabled`);
  const required = assertBoolean(source.required, `${path}.required`);
  const scope = assertObject(source.scope ?? {}, `${path}.scope`);
  assertKnownKeys(scope, SOURCE_SCOPE_KEYS.get(kind), `${path}.scope`);
  const result = { id, kind, provider, enabled, required, scope: {} };
  const transports = assertArray(source.transports, `${path}.transports`).map((item, transportIndex) => validateTransport(item, result, transportIndex));
  const transportIds = new Set();
  for (const transport of transports) {
    if (transportIds.has(transport.id)) throw contractError('yog-config-schema-invalid', `Duplicate transport ID: ${transport.id}.`, `${path}.transports`);
    transportIds.add(transport.id);
  }
  result.transports = transports.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));

  if (kind === 'catalog') {
    if (typeof scope.confirmedByUser !== 'boolean') throw contractError('yog-config-schema-invalid', 'Catalog scope requires confirmedByUser.', `${path}.scope.confirmedByUser`);
    result.scope.confirmedByUser = scope.confirmedByUser;
    if (scope.rootNodeIds !== undefined) {
      result.scope.rootNodeIds = sortedUnique(assertArray(scope.rootNodeIds, `${path}.scope.rootNodeIds`).map((item, itemIndex) => assertId(item, `${path}.scope.rootNodeIds[${itemIndex}]`)));
    }
    if (result.transports.filter((transport) => transport.enabled).length !== 1) {
      throw contractError('yog-config-schema-invalid', 'Catalog source requires exactly one enabled file transport.', `${path}.transports`);
    }
  } else if (kind === 'code') {
    result.scope.roots = sortedUnique(assertArray(scope.roots, `${path}.scope.roots`).map((item, itemIndex) => safeRelativePath(item, `${path}.scope.roots[${itemIndex}]`, { allowDot: true })));
    result.scope.exclude = sortedUnique(assertArray(scope.exclude, `${path}.scope.exclude`).map((item, itemIndex) => safeRelativePath(item, `${path}.scope.exclude[${itemIndex}]`)));
    if (result.scope.roots.length === 0 || result.scope.exclude.length === 0) throw contractError('yog-config-schema-invalid', 'Code scope requires non-empty roots and exclude.', `${path}.scope`);
  } else if (kind === 'requirement') {
    if (typeof scope.confirmedByUser !== 'boolean') throw contractError('yog-config-schema-invalid', 'Requirement scope requires confirmedByUser.', `${path}.scope.confirmedByUser`);
    result.scope = {
      confirmedByUser: scope.confirmedByUser,
      workspaceId: optionalText(scope.workspaceId, `${path}.scope.workspaceId`),
      projectId: optionalText(scope.projectId, `${path}.scope.projectId`),
      workItemIds: sortedUnique(assertArray(scope.workItemIds ?? [], `${path}.scope.workItemIds`).map((item, itemIndex) => assertText(item, `${path}.scope.workItemIds[${itemIndex}]`))),
    };
    const bounded = [result.scope.workspaceId, result.scope.projectId].some(Boolean) || result.scope.workItemIds.length > 0;
    if (enabled && scope.confirmedByUser === true && !bounded) throw contractError('yog-config-schema-invalid', 'Confirmed Requirement scope must be bounded.', `${path}.scope`);
  } else if (kind === 'database') {
    if (source.capturePolicy !== 'metadata-only') throw contractError('yog-config-schema-invalid', 'Database capturePolicy must equal metadata-only.', `${path}.capturePolicy`);
    result.capturePolicy = 'metadata-only';
    if (typeof scope.confirmedByUser !== 'boolean') throw contractError('yog-config-schema-invalid', 'Database scope requires confirmedByUser.', `${path}.scope.confirmedByUser`);
    result.scope = {
      confirmedByUser: scope.confirmedByUser,
      environment: optionalText(scope.environment, `${path}.scope.environment`),
      includeSchemas: sortedUnique(assertArray(scope.includeSchemas ?? [], `${path}.scope.includeSchemas`).map((item, itemIndex) => assertText(item, `${path}.scope.includeSchemas[${itemIndex}]`))),
      excludeSchemas: sortedUnique(assertArray(scope.excludeSchemas ?? [], `${path}.scope.excludeSchemas`).map((item, itemIndex) => assertText(item, `${path}.scope.excludeSchemas[${itemIndex}]`))),
    };
    if (enabled) {
      if ((!allowUnconfirmed && scope.confirmedByUser !== true) || !result.scope.environment || result.scope.includeSchemas.length === 0) {
        throw contractError('yog-config-schema-invalid', 'Enabled Database source requires a bounded environment and includeSchemas; generation also requires user confirmation.', `${path}.scope`);
      }
      const freshness = assertObject(source.freshness, `${path}.freshness`);
      const limits = assertObject(source.limits, `${path}.limits`);
      result.freshness = { maxAgeHours: assertInteger(freshness.maxAgeHours, `${path}.freshness.maxAgeHours`, { minimum: 1 }) };
      result.limits = {
        statementTimeoutMs: assertInteger(limits.statementTimeoutMs, `${path}.limits.statementTimeoutMs`, { minimum: 1 }),
        maxObjects: assertInteger(limits.maxObjects, `${path}.limits.maxObjects`, { minimum: 1 }),
      };
    } else {
      if (source.freshness !== undefined) result.freshness = structuredClone(source.freshness);
      if (source.limits !== undefined) result.limits = structuredClone(source.limits);
    }
  } else if (kind === 'spec') {
    result.scope.paths = sortedUnique(assertArray(scope.paths, `${path}.scope.paths`).map((item, itemIndex) => safeRelativePath(item, `${path}.scope.paths[${itemIndex}]`)));
    if (enabled && result.scope.paths.length === 0) throw contractError('yog-config-schema-invalid', 'Enabled Spec source requires paths.', `${path}.scope.paths`);
  } else if (kind === 'record') {
    const skillRefs = sortedUnique(assertArray(scope.skillRefs ?? [], `${path}.scope.skillRefs`).map((item, itemIndex) => safeRelativePath(item, `${path}.scope.skillRefs[${itemIndex}]`)));
    const artifactPaths = sortedUnique(assertArray(scope.artifactPaths ?? [], `${path}.scope.artifactPaths`).map((item, itemIndex) => safeRelativePath(item, `${path}.scope.artifactPaths[${itemIndex}]`)));
    result.scope = { skillRefs, artifactPaths };
  } else if (kind === 'knowledge') {
    result.scope.root = safeRelativePath(scope.root, `${path}.scope.root`);
    if (scope.verifiedOnly !== true) throw contractError('yog-config-schema-invalid', 'Knowledge source requires verifiedOnly: true.', `${path}.scope.verifiedOnly`);
    result.scope.verifiedOnly = true;
  }
  result.confirmation = normalizeConfirmation(source.confirmation, result, path);
  assertNoSensitive(result, path);
  return result;
}

export function validateWikiConfig(config, options = {}) {
  const value = assertObject(config, '$');
  if (value.schemaVersion !== 1) throw contractError('yog-config-schema-invalid', 'schemaVersion must equal 1.', '$.schemaVersion');
  if (value.language !== 'zh-CN') throw contractError('yog-config-schema-invalid', 'language must equal zh-CN.', '$.language');
  if ('sources' in value) throw contractError('yog-config-schema-invalid', 'Grouped top-level sources are not supported.', '$.sources');
  const wiki = assertObject(value.wiki, '$.wiki');
  assertKnownKeys(wiki, new Set(['root', 'sources', 'confirmation']), '$.wiki');
  if ('requirementProvider' in wiki) throw contractError('yog-config-schema-invalid', 'wiki.requirementProvider is not supported.', '$.wiki.requirementProvider');
  const root = safeRelativePath(wiki.root, '$.wiki.root');
  const sources = assertArray(wiki.sources, '$.wiki.sources').map((source, index) => validateSource(source, index, options))
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set();
  for (const source of sources) {
    if (ids.has(source.id)) throw contractError('yog-config-schema-invalid', `Duplicate source ID: ${source.id}.`, '$.wiki.sources');
    ids.add(source.id);
  }
  const confirmation = normalizeWikiConfirmation(wiki.confirmation);
  assertNoSensitive({ root, sources }, '$.wiki');
  return { root, sources, confirmation };
}

export function validateConfiguredWikiSources({ wikiRoot, sources }) {
  return validateWikiConfig({
    schemaVersion: 1,
    language: 'zh-CN',
    wiki: { root: wikiRoot, sources },
  }).sources;
}

function cloneConfigWithWiki(config, root, sources, confirmation = null) {
  const result = structuredClone(config);
  result.wiki = { root, sources, ...(confirmation ? { confirmation } : {}) };
  return result;
}

export function prepareWikiConfig(config, { outputRoot } = {}) {
  const { root, sources } = validateWikiConfig(config, { allowUnconfirmed: true });
  const pendingSources = sources.map((source) => {
    const prepared = structuredClone(source);
    if (objectValue(prepared.scope) && 'confirmedByUser' in prepared.scope) prepared.scope.confirmedByUser = false;
    prepared.confirmation = pendingConfirmation(prepared);
    return prepared;
  });
  const confirmation = {
    status: 'pending',
    inputFingerprint: wikiInputFingerprint({ outputRoot, wikiRoot: root, sources: pendingSources }),
    confirmedAt: null,
  };
  return cloneConfigWithWiki(config, root, pendingSources, confirmation);
}

function confirmationError(message, sourceId = null) {
  const path = sourceId ? `$.wiki.sources.${sourceId}.confirmation` : '$.wiki.sources';
  return contractError('wiki-source-scope-unconfirmed', message, path);
}

export function assertWikiSourceConfirmations(sources) {
  for (const source of sources.filter((item) => item.enabled)) {
    const confirmation = source.confirmation;
    const expectedFingerprint = sourceScopeFingerprint(source);
    if (confirmation?.status !== 'confirmed'
      || confirmation.scopeFingerprint !== expectedFingerprint
      || typeof confirmation.confirmedAt !== 'string'
      || Number.isNaN(Date.parse(confirmation.confirmedAt))) {
      throw confirmationError(`Source ${source.id} is not confirmed for its current scope.`, source.id);
    }
    if (['catalog', 'requirement', 'database'].includes(source.kind) && source.scope?.confirmedByUser !== true) {
      throw confirmationError(`Source ${source.id} requires explicit user scope confirmation.`, source.id);
    }
    if (source.kind === 'catalog' && (!Array.isArray(source.scope?.rootNodeIds) || source.scope.rootNodeIds.length === 0)) {
      throw confirmationError(`Catalog Source ${source.id} requires confirmed rootNodeIds.`, source.id);
    }
  }
  return sources;
}

export function confirmWikiConfig(config, {
  outputRoot,
  inputFingerprint,
  decisions = [],
  confirmedAt = new Date().toISOString(),
} = {}) {
  if (typeof confirmedAt !== 'string' || Number.isNaN(Date.parse(confirmedAt))) {
    throw contractError('yog-config-schema-invalid', 'confirmedAt must be an ISO timestamp.', '$.confirmedAt');
  }
  const { root, sources, confirmation } = validateWikiConfig(config, { allowUnconfirmed: true });
  const reviewedFingerprint = wikiInputFingerprint({ outputRoot, wikiRoot: root, sources });
  if (confirmation?.status !== 'pending'
    || confirmation.inputFingerprint !== reviewedFingerprint
    || inputFingerprint !== reviewedFingerprint) {
    throw confirmationError('Wiki inputs differ from the prepared collection plan. Prepare and review the inputs again.');
  }
  const decisionById = new Map();
  for (const decision of assertArray(decisions, '$.decisions')) {
    const value = assertObject(decision, '$.decisions[]');
    assertKnownKeys(value, new Set(['sourceId', 'decision', 'scopeFingerprint']), '$.decisions[]');
    const sourceId = assertId(value.sourceId, '$.decisions[].sourceId');
    if (decisionById.has(sourceId)) throw contractError('yog-config-schema-invalid', `Duplicate Source decision: ${sourceId}.`, '$.decisions');
    if (!['confirm', 'disable'].includes(value.decision)) throw contractError('yog-config-schema-invalid', `Unsupported Source decision: ${value.decision}.`, '$.decisions[].decision');
    const scopeFingerprint = assertText(value.scopeFingerprint, '$.decisions[].scopeFingerprint');
    if (!SHA_PATTERN.test(scopeFingerprint)) throw contractError('yog-config-schema-invalid', 'Decision scopeFingerprint must be sha256.', '$.decisions[].scopeFingerprint');
    decisionById.set(sourceId, { decision: value.decision, scopeFingerprint });
  }
  const knownIds = new Set(sources.map((source) => source.id));
  for (const sourceId of decisionById.keys()) {
    if (!knownIds.has(sourceId)) throw contractError('yog-config-schema-invalid', `Unknown Source decision: ${sourceId}.`, '$.decisions');
  }
  const confirmedSources = sources.map((source) => {
    const result = structuredClone(source);
    if (!source.enabled) return result;
    const decision = decisionById.get(source.id);
    if (!decision) throw confirmationError(`Enabled Source ${source.id} requires an explicit confirm or disable decision.`, source.id);
    const expectedScopeFingerprint = sourceScopeFingerprint(source);
    if (source.confirmation?.status !== 'pending'
      || source.confirmation.scopeFingerprint !== expectedScopeFingerprint
      || decision.scopeFingerprint !== expectedScopeFingerprint) {
      throw confirmationError(`Source ${source.id} differs from the prepared collection plan.`, source.id);
    }
    if (decision.decision === 'disable') {
      if (source.required) throw confirmationError(`Required Source ${source.id} cannot be disabled.`, source.id);
      result.enabled = false;
      if (objectValue(result.scope) && 'confirmedByUser' in result.scope) result.scope.confirmedByUser = false;
      result.confirmation = pendingConfirmation(result);
      return result;
    }
    if (objectValue(result.scope) && 'confirmedByUser' in result.scope) result.scope.confirmedByUser = true;
    result.confirmation = {
      status: 'confirmed',
      scopeFingerprint: sourceScopeFingerprint(result),
      confirmedAt,
    };
    return result;
  });
  assertWikiSourceConfirmations(confirmedSources);
  const finalConfirmation = {
    status: 'confirmed',
    inputFingerprint: wikiInputFingerprint({ outputRoot, wikiRoot: root, sources: confirmedSources }),
    confirmedAt,
  };
  return cloneConfigWithWiki(config, root, confirmedSources, finalConfirmation);
}

export function buildWikiCollectionPlan(config, { outputRoot } = {}) {
  const { root, sources, confirmation } = validateWikiConfig(config, { allowUnconfirmed: true });
  const calculatedFingerprint = wikiInputFingerprint({ outputRoot, wikiRoot: root, sources });
  let status = 'ready';
  try {
    assertWikiSourceConfirmations(sources);
    if (confirmation?.status !== 'confirmed' || confirmation.inputFingerprint !== calculatedFingerprint) {
      throw confirmationError('Wiki inputs are not confirmed for the current output target.');
    }
  } catch (error) {
    if (error.code !== 'wiki-source-scope-unconfirmed') throw error;
    status = 'confirmation-required';
  }
  return {
    schemaVersion: 1,
    status,
    outputRoot: resolve(outputRoot),
    wikiRoot: root,
    inputFingerprint: calculatedFingerprint,
    sources: sources.map((source) => ({
      sourceId: source.id,
      kind: source.kind,
      provider: source.provider,
      enabled: source.enabled,
      required: source.required,
      scope: structuredClone(source.scope),
      transports: structuredClone(source.transports.filter((transport) => transport.enabled)),
      confirmationStatus: source.confirmation.status,
      scopeFingerprint: sourceScopeFingerprint(source),
      failurePolicy: !source.enabled ? 'skip' : source.required ? 'block' : 'degrade',
    })),
  };
}

function normalizeInputConfirmation(raw, { outputRoot, wikiRoot }) {
  const value = objectValue(raw);
  if (!value) throw confirmationError('Wiki input confirmation is required.');
  assertKnownKeys(value, WIKI_INPUT_CONFIRMATION_KEYS, '$.inputConfirmation');
  if (value.status !== 'confirmed') throw confirmationError('Wiki input confirmation must have status confirmed.');
  const inputFingerprint = assertText(value.inputFingerprint, '$.inputConfirmation.inputFingerprint');
  if (!SHA_PATTERN.test(inputFingerprint)) throw confirmationError('Wiki input confirmation fingerprint must be sha256.');
  const confirmedAt = assertText(value.confirmedAt, '$.inputConfirmation.confirmedAt');
  if (Number.isNaN(Date.parse(confirmedAt))) throw confirmationError('Wiki input confirmation timestamp is invalid.');
  const sourceInputs = assertArray(value.sources, '$.inputConfirmation.sources');
  sourceInputs.forEach((source, index) => assertKnownKeys(assertObject(source, `$.inputConfirmation.sources[${index}]`), WIKI_INPUT_CONFIRMATION_SOURCE_KEYS, `$.inputConfirmation.sources[${index}]`));
  const sources = normalizedConfirmationSources(sourceInputs);
  const expectedFingerprint = wikiInputFingerprint({ outputRoot, wikiRoot, sources });
  if (inputFingerprint !== expectedFingerprint) {
    throw confirmationError('Wiki input confirmation does not match the current output target or Source set.');
  }
  return { status: 'confirmed', inputFingerprint, confirmedAt, sources };
}

export function buildWikiInputConfirmation({ outputRoot, wikiRoot, sources, confirmation }) {
  assertWikiSourceConfirmations(sources);
  const normalizedSources = normalizedConfirmationSources(sources);
  const inputFingerprint = wikiInputFingerprint({ outputRoot, wikiRoot, sources: normalizedSources });
  if (confirmation?.status !== 'confirmed'
    || confirmation.inputFingerprint !== inputFingerprint
    || typeof confirmation.confirmedAt !== 'string'
    || Number.isNaN(Date.parse(confirmation.confirmedAt))) {
    throw confirmationError('Wiki inputs are not confirmed for the current output target.');
  }
  return normalizeInputConfirmation({
    status: 'confirmed',
    inputFingerprint,
    confirmedAt: confirmation.confirmedAt,
    sources: normalizedSources,
  }, { outputRoot, wikiRoot });
}

export function assertWikiGenerationAuthorization({ outputRoot, wikiRoot, configuredSources, inputConfirmation }) {
  assertWikiSourceConfirmations(configuredSources);
  const normalized = normalizeInputConfirmation(inputConfirmation, { outputRoot, wikiRoot });
  const expectedSources = normalizedConfirmationSources(configuredSources);
  if (JSON.stringify(normalized.sources) !== JSON.stringify(expectedSources)) {
    throw confirmationError('Wiki input confirmation Source set differs from configured Sources.');
  }
  return normalized;
}

export function assertPersistedWikiInputConfirmation({ outputRoot, wikiRoot, inputConfirmation }) {
  return normalizeInputConfirmation(inputConfirmation, { outputRoot, wikiRoot });
}

export function normalizeSourceResult(raw, configuredSource = null) {
  const value = assertObject(raw, '$.sourceResult');
  const sourceId = assertId(value.sourceId, '$.sourceResult.sourceId');
  const kind = assertText(value.kind, '$.sourceResult.kind');
  const provider = assertText(value.provider, '$.sourceResult.provider');
  if (!SOURCE_KINDS.has(kind) || !PROVIDERS.has(`${kind}:${provider}`)) throw contractError('source-result-invalid', `Unsupported source result ${kind}:${provider}.`, '$.sourceResult');
  if (configuredSource && (configuredSource.id !== sourceId || configuredSource.kind !== kind || configuredSource.provider !== provider)) {
    throw contractError('source-result-invalid', 'Source result identity does not match configured source.', '$.sourceResult');
  }
  const status = assertText(value.status, '$.sourceResult.status');
  if (!SOURCE_STATUSES.has(status)) throw contractError('source-result-invalid', `Unsupported source status: ${status}.`, '$.sourceResult.status');
  const reasonCode = value.reasonCode ?? null;
  if (status !== 'collected') {
    if (!SOURCE_REASON_CODES.has(reasonCode)) throw contractError('source-result-invalid', 'Non-collected source result requires a registered reasonCode.', '$.sourceResult.reasonCode');
  } else if (reasonCode !== null) {
    throw contractError('source-result-invalid', 'Collected source result must have reasonCode: null.', '$.sourceResult.reasonCode');
  }
  const capturedAt = value.capturedAt === null && status !== 'collected' ? null : assertText(value.capturedAt, '$.sourceResult.capturedAt');
  if (capturedAt !== null && Number.isNaN(Date.parse(capturedAt))) throw contractError('source-result-invalid', 'capturedAt must be an ISO timestamp.', '$.sourceResult.capturedAt');
  const result = {
    sourceId,
    kind,
    provider,
    status,
    required: value.required === true,
    capturedAt,
    sourceRevision: value.sourceRevision ?? null,
    fingerprint: value.fingerprint ?? null,
    artifactCount: assertInteger(value.artifactCount ?? 0, '$.sourceResult.artifactCount'),
    reasonCode,
    transportResults: assertArray(value.transportResults ?? [], '$.sourceResult.transportResults'),
    gapIds: [...new Set(assertArray(value.gapIds ?? [], '$.sourceResult.gapIds'))].sort(),
    diagnostics: assertArray(value.diagnostics ?? [], '$.sourceResult.diagnostics').map((item, index) => assertText(item, `$.sourceResult.diagnostics[${index}]`)),
  };
  if (result.fingerprint !== null && !SHA_PATTERN.test(result.fingerprint)) throw contractError('source-result-invalid', 'fingerprint must be sha256.', '$.sourceResult.fingerprint');
  if (configuredSource) {
    if (configuredSource.required !== result.required) throw contractError('source-result-invalid', 'Source result required flag does not match configuration.', '$.sourceResult.required');
    if (configuredSource.enabled === false && status !== 'skipped-disabled') throw contractError('source-result-invalid', 'Disabled source must return skipped-disabled.', '$.sourceResult.status');
    if (configuredSource.enabled === true && status === 'skipped-disabled') throw contractError('source-result-invalid', 'Enabled source cannot return skipped-disabled.', '$.sourceResult.status');
    if (status === 'collected' && ['catalog', 'requirement', 'database'].includes(kind) && configuredSource.scope?.confirmedByUser !== true) {
      throw contractError('source-result-invalid', `Collected ${kind} source requires user-confirmed scope.`, '$.sourceResult.status');
    }
    if (result.capturedAt !== null
      && configuredSource.confirmation?.status === 'confirmed'
      && Date.parse(result.capturedAt) < Date.parse(configuredSource.confirmation.confirmedAt)) {
      throw contractError(
        'wiki-source-scope-unconfirmed',
        `Source Result ${sourceId} was captured before its scope was confirmed.`,
        '$.sourceResult.capturedAt',
      );
    }
  }
  if (status === 'collected' || status === 'partial') {
    if (typeof result.sourceRevision !== 'string' || result.sourceRevision.length === 0 || !SHA_PATTERN.test(result.fingerprint ?? '') || result.artifactCount < 1) {
      throw contractError('source-result-invalid', 'Collected or partial source requires revision, fingerprint, and at least one Artifact.', '$.sourceResult');
    }
  } else if (result.capturedAt !== null || result.sourceRevision !== null || result.fingerprint !== null || result.artifactCount !== 0) {
    throw contractError('source-result-invalid', 'Non-collected source cannot report a captured snapshot or Artifacts.', '$.sourceResult');
  }
  assertNoSensitive(result, '$.sourceResult');
  return result;
}

function normalizeArtifactEnvelope(raw, expectedKind = null) {
  const artifact = assertObject(raw, '$.artifact');
  if (artifact.schemaVersion !== 1) throw contractError('source-artifact-invalid', 'Artifact schemaVersion must equal 1.', '$.artifact.schemaVersion');
  const kind = assertText(artifact.kind, '$.artifact.kind');
  const sourceKind = ARTIFACT_SOURCE_KINDS.get(kind);
  if (!sourceKind || (expectedKind && sourceKind !== expectedKind)) throw contractError('source-artifact-invalid', `Unsupported artifact kind: ${kind}.`, '$.artifact.kind');
  const sourceId = assertId(artifact.sourceId, '$.artifact.sourceId');
  const capturedAt = assertText(artifact.capturedAt, '$.artifact.capturedAt');
  if (Number.isNaN(Date.parse(capturedAt))) throw contractError('source-artifact-invalid', 'Artifact capturedAt must be an ISO timestamp.', '$.artifact.capturedAt');
  const provenance = assertObject(artifact.provenance, '$.artifact.provenance');
  const normalized = structuredClone(artifact);
  normalized.schemaVersion = 1;
  normalized.kind = kind;
  normalized.sourceId = sourceId;
  normalized.capturedAt = capturedAt;
  normalized.sourceRevision = assertText(artifact.sourceRevision, '$.artifact.sourceRevision');
  normalized.provenance = {
    provider: assertText(provenance.provider, '$.artifact.provenance.provider'),
    transportIds: assertArray(provenance.transportIds, '$.artifact.provenance.transportIds').map((item, index) => assertId(item, `$.artifact.provenance.transportIds[${index}]`)).sort(),
    scopeFingerprint: assertText(provenance.scopeFingerprint, '$.artifact.provenance.scopeFingerprint'),
  };
  if (!SHA_PATTERN.test(normalized.provenance.scopeFingerprint)) {
    throw contractError('source-artifact-invalid', 'Artifact scopeFingerprint must be sha256.', '$.artifact.provenance.scopeFingerprint');
  }
  const calculated = fingerprint(normalized);
  if (artifact.fingerprint !== calculated) throw contractError('source-artifact-invalid', 'Artifact fingerprint does not match canonical content.', '$.artifact.fingerprint');
  normalized.fingerprint = calculated;
  assertNoSensitive(normalized, '$.artifact');
  return { artifact: normalized, sourceKind };
}

function normalizeCatalogArtifact(artifact) {
  const scope = assertObject(artifact.scope, '$.artifact.scope');
  if (scope.confirmedByUser !== true) throw contractError('source-artifact-invalid', 'Catalog scope must be user-confirmed.', '$.artifact.scope.confirmedByUser');
  const nodes = assertArray(artifact.nodes, '$.artifact.nodes').map((raw, index) => {
    const path = `$.artifact.nodes[${index}]`;
    const node = assertObject(raw, path);
    const kind = assertText(node.kind, `${path}.kind`);
    if (!['system', 'domain', 'module', 'feature'].includes(kind)) throw contractError('source-artifact-invalid', `Invalid Catalog node kind: ${kind}.`, `${path}.kind`);
    return {
      id: assertId(node.id, `${path}.id`),
      kind,
      parentId: node.parentId === null ? null : assertId(node.parentId, `${path}.parentId`),
      name: assertText(node.name, `${path}.name`),
      order: assertInteger(node.order, `${path}.order`),
      enabled: assertBoolean(node.enabled, `${path}.enabled`),
      sourceIdentity: assertObject(node.sourceIdentity, `${path}.sourceIdentity`),
      routeKeys: assertArray(node.routeKeys ?? [], `${path}.routeKeys`).map((item, itemIndex) => assertText(item, `${path}.routeKeys[${itemIndex}]`)),
      evidenceIds: assertArray(node.evidenceIds, `${path}.evidenceIds`).map((item, itemIndex) => assertId(item, `${path}.evidenceIds[${itemIndex}]`)),
    };
  });
  const byId = new Map();
  const identity = new Set();
  const evidenceOwners = new Map();
  const parentKind = { domain: 'system', module: 'domain', feature: 'module' };
  for (const node of nodes) {
    if (byId.has(node.id)) throw contractError('source-artifact-invalid', `Duplicate Catalog node: ${node.id}.`, '$.artifact.nodes');
    const identityKey = JSON.stringify(canonical(node.sourceIdentity));
    if (identity.has(identityKey)) throw contractError('source-artifact-invalid', `Duplicate Catalog sourceIdentity: ${identityKey}.`, '$.artifact.nodes');
    byId.set(node.id, node);
    identity.add(identityKey);
    for (const evidenceId of node.evidenceIds) {
      const prior = evidenceOwners.get(evidenceId);
      if (prior && prior !== node.id) throw contractError('source-artifact-invalid', `Catalog Evidence ID ${evidenceId} is reused by ${prior} and ${node.id}.`, `catalog:${node.id}.evidenceIds`);
      evidenceOwners.set(evidenceId, node.id);
    }
  }
  for (const node of nodes) {
    if (node.kind === 'system' && node.parentId !== null) throw contractError('source-artifact-invalid', 'System node parentId must be null.', `catalog:${node.id}`);
    if (node.kind !== 'system') {
      const parent = byId.get(node.parentId);
      if (!parent || parent.kind !== parentKind[node.kind]) throw contractError('source-artifact-invalid', `Catalog node ${node.id} has an invalid parent.`, `catalog:${node.id}`);
    }
    const seen = new Set([node.id]);
    let current = node;
    while (current.parentId) {
      if (seen.has(current.parentId)) throw contractError('source-artifact-invalid', `Catalog cycle detected at ${node.id}.`, `catalog:${node.id}`);
      seen.add(current.parentId);
      current = byId.get(current.parentId);
      if (!current) break;
    }
  }
  artifact.scope = { confirmedByUser: true, rootNodeIds: assertArray(scope.rootNodeIds ?? [], '$.artifact.scope.rootNodeIds').sort() };
  artifact.nodes = nodes.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return artifact;
}

function normalizeCodeArtifact(artifact) {
  artifact.repositories = assertArray(artifact.repositories, '$.artifact.repositories').map((raw, index) => {
    const path = `$.artifact.repositories[${index}]`;
    const repository = assertObject(raw, path);
    const scope = assertObject(repository.scope, `${path}.scope`);
    return {
      id: assertId(repository.id, `${path}.id`),
      sourceRoot: safeRelativePath(repository.sourceRoot, `${path}.sourceRoot`, { allowDot: true }),
      rootRef: assertText(repository.rootRef, `${path}.rootRef`),
      commit: assertText(repository.commit, `${path}.commit`),
      dirty: assertBoolean(repository.dirty, `${path}.dirty`),
      surface: (() => {
        const surface = assertText(repository.surface, `${path}.surface`);
        if (!CODE_REPOSITORY_SURFACES.has(surface)) throw contractError('source-artifact-invalid', `Invalid Code repository surface: ${surface}.`, `${path}.surface`);
        return surface;
      })(),
      scope: {
        include: sortedUnique(assertArray(scope.include, `${path}.scope.include`).map((item, itemIndex) => safeRelativePath(item, `${path}.scope.include[${itemIndex}]`, { allowDot: true }))),
        exclude: sortedUnique(assertArray(scope.exclude, `${path}.scope.exclude`).map((item, itemIndex) => safeRelativePath(item, `${path}.scope.exclude[${itemIndex}]`))),
      },
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const repositoryIds = new Set(artifact.repositories.map((repository) => repository.id));
  if (repositoryIds.size !== artifact.repositories.length) throw contractError('source-artifact-invalid', 'Code Artifact repository IDs must be unique.', '$.artifact.repositories');
  const factKinds = new Set(['route', 'page', 'operation', 'validation', 'rule', 'state', 'api', 'task', 'integration', 'database-usage', 'test']);
  const evidenceIds = new Set();
  artifact.facts = assertArray(artifact.facts, '$.artifact.facts').map((raw, index) => {
    const path = `$.artifact.facts[${index}]`;
    const fact = assertObject(raw, path);
    const locator = assertObject(fact.locator, `${path}.locator`);
    const factKind = assertText(fact.factKind, `${path}.factKind`);
    if (!factKinds.has(factKind)) throw contractError('source-artifact-invalid', `Invalid Code factKind: ${factKind}.`, `${path}.factKind`);
    const precision = assertText(locator.precision, `${path}.locator.precision`);
    if (!CODE_LOCATOR_PRECISIONS.has(precision)) throw contractError('source-artifact-invalid', `Invalid Code locator precision: ${precision}.`, `${path}.locator.precision`);
    const repositoryId = assertId(locator.repositoryId, `${path}.locator.repositoryId`);
    if (!repositoryIds.has(repositoryId)) throw contractError('source-artifact-invalid', 'Code fact references an unknown repository.', `${path}.locator.repositoryId`);
    let startLine = null;
    let endLine = null;
    let symbol = null;
    if (precision !== 'file') {
      startLine = assertInteger(locator.startLine, `${path}.locator.startLine`, { minimum: 1 });
      endLine = assertInteger(locator.endLine, `${path}.locator.endLine`, { minimum: startLine });
    }
    if (precision === 'symbol') symbol = assertText(locator.symbol, `${path}.locator.symbol`);
    else if (locator.symbol !== undefined && locator.symbol !== null) throw contractError('source-artifact-invalid', `${precision} Code locator cannot declare a symbol.`, `${path}.locator.symbol`);
    const evidenceId = assertId(fact.evidenceId, `${path}.evidenceId`);
    if (evidenceIds.has(evidenceId)) throw contractError('source-artifact-invalid', `Code Evidence ID must identify exactly one atomic fact: ${evidenceId}.`, `${path}.evidenceId`);
    evidenceIds.add(evidenceId);
    return {
      id: assertId(fact.id, `${path}.id`),
      factKind,
      locator: {
        repositoryId,
        path: safeRelativePath(locator.path, `${path}.locator.path`),
        precision,
        startLine,
        endLine,
        symbol,
      },
      text: assertText(fact.text, `${path}.text`),
      candidateRefs: assertArray(fact.candidateRefs ?? [], `${path}.candidateRefs`).map((item, itemIndex) => assertText(item, `${path}.candidateRefs[${itemIndex}]`)).sort(),
      evidenceId,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return artifact;
}

function normalizeRequirementArtifact(artifact) {
  const scope = assertObject(artifact.scope, '$.artifact.scope');
  if (scope.confirmedByUser !== true) throw contractError('source-artifact-invalid', 'Requirement scope must be user-confirmed.', '$.artifact.scope.confirmedByUser');
  assertKnownKeys(scope, SOURCE_SCOPE_KEYS.get('requirement'), '$.artifact.scope');
  artifact.scope = {
    confirmedByUser: true,
    workspaceId: optionalText(scope.workspaceId, '$.artifact.scope.workspaceId'),
    projectId: optionalText(scope.projectId, '$.artifact.scope.projectId'),
    workItemIds: sortedUnique(assertArray(scope.workItemIds ?? [], '$.artifact.scope.workItemIds').map((item, index) => assertText(item, `$.artifact.scope.workItemIds[${index}]`))),
  };
  artifact.queries = assertArray(artifact.queries, '$.artifact.queries').map((raw, index) => {
    const path = `$.artifact.queries[${index}]`;
    const query = assertObject(raw, path);
    const tier = assertText(query.tier, `${path}.tier`);
    if (!['explicit', 'menu', 'capability', 'hierarchy'].includes(tier)) throw contractError('source-artifact-invalid', `Invalid query tier: ${tier}.`, `${path}.tier`);
    const terms = assertArray(query.terms, `${path}.terms`).map((item, itemIndex) => assertText(item, `${path}.terms[${itemIndex}]`));
    if (terms.length === 0) throw contractError('source-artifact-invalid', 'Requirement query terms cannot be empty.', `${path}.terms`);
    return { id: assertId(query.id, `${path}.id`), tier, terms, featureRefs: assertArray(query.featureRefs ?? [], `${path}.featureRefs`).sort() };
  });
  if (artifact.queries.length === 0) throw contractError('source-artifact-invalid', 'Collected Requirement Artifact requires a query.', '$.artifact.queries');
  const itemTypes = new Set(['product-requirement', 'development-task', 'test', 'defect']);
  const statuses = new Set(['completed', 'in-progress', 'terminated', 'unknown']);
  const relevance = new Set(['direct', 'supporting', 'out-of-scope', 'weak']);
  const decisions = new Set(['adopted', 'excluded', 'conflict']);
  artifact.items = assertArray(artifact.items, '$.artifact.items').map((raw, index) => {
    const path = `$.artifact.items[${index}]`;
    const item = assertObject(raw, path);
    if (!itemTypes.has(item.itemType) || !statuses.has(item.normalizedStatus) || !relevance.has(item.relevance) || !decisions.has(item.decision)) {
      throw contractError('source-artifact-invalid', 'Requirement item contains an unsupported enum.', path);
    }
    const normalized = structuredClone(item);
    normalized.externalId = assertText(item.externalId, `${path}.externalId`);
    normalized.featureRefs = assertArray(item.featureRefs ?? [], `${path}.featureRefs`).sort();
    normalized.codeEvidenceIds = assertArray(item.codeEvidenceIds ?? [], `${path}.codeEvidenceIds`).sort();
    if (item.decision === 'adopted') {
      if (item.itemType !== 'product-requirement' || item.normalizedStatus !== 'completed' || item.relationshipVerified !== true || !['direct', 'supporting'].includes(item.relevance) || normalized.featureRefs.length === 0 || normalized.codeEvidenceIds.length === 0 || !item.evidenceId) {
        throw contractError('source-artifact-invalid', 'Adopted Requirement item failed the current-evidence gate.', path);
      }
    }
    return normalized;
  }).sort((left, right) => left.externalId.localeCompare(right.externalId));
  return artifact;
}

function normalizeSupportingArtifact(artifact, sourceKind) {
  const allowedLayer = { spec: 'expected', record: 'observed', knowledge: 'current' }[sourceKind];
  artifact.documents = assertArray(artifact.documents, '$.artifact.documents').map((raw, index) => {
    const path = `$.artifact.documents[${index}]`;
    const document = assertObject(raw, path);
    const contentHash = assertText(document.contentHash, `${path}.contentHash`);
    if (!SHA_PATTERN.test(contentHash)) throw contractError('source-artifact-invalid', 'Supporting document contentHash must be sha256.', `${path}.contentHash`);
    return {
      id: assertId(document.id, `${path}.id`),
      path: safeRelativePath(document.path, `${path}.path`),
      title: assertText(document.title, `${path}.title`),
      contentHash,
      evidenceId: assertId(document.evidenceId, `${path}.evidenceId`),
    };
  }).sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id));
  const documentIds = new Set(artifact.documents.map((document) => document.id));
  const statementKinds = new Set(['scope', 'rule', 'flow', 'term', 'ownership', 'acceptance', 'metric', 'other']);
  artifact.statements = assertArray(artifact.statements ?? [], '$.artifact.statements').map((raw, index) => {
    const path = `$.artifact.statements[${index}]`;
    const statement = assertObject(raw, path);
    const documentId = assertId(statement.documentId, `${path}.documentId`);
    if (!documentIds.has(documentId)) throw contractError('source-artifact-invalid', 'Supporting statement documentId is unknown.', `${path}.documentId`);
    const statementKind = assertText(statement.statementKind, `${path}.statementKind`);
    if (!statementKinds.has(statementKind)) throw contractError('source-artifact-invalid', `Unsupported statementKind: ${statementKind}.`, `${path}.statementKind`);
    if (statement.layer !== allowedLayer) throw contractError('source-artifact-invalid', `${sourceKind} statements must use layer ${allowedLayer}.`, `${path}.layer`);
    return {
      id: assertId(statement.id, `${path}.id`),
      documentId,
      statementKind,
      layer: allowedLayer,
      text: assertText(statement.text, `${path}.text`),
      candidateRefs: assertArray(statement.candidateRefs ?? [], `${path}.candidateRefs`).map((item, itemIndex) => assertText(item, `${path}.candidateRefs[${itemIndex}]`)).sort(),
      evidenceId: assertId(statement.evidenceId, `${path}.evidenceId`),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (artifact.documents.length === 0) throw contractError('source-artifact-invalid', `Collected ${sourceKind} Artifact requires documents.`, '$.artifact.documents');
  return artifact;
}

function normalizeDecisionArtifact(artifact) {
  const document = assertObject(artifact.document, '$.artifact.document');
  artifact.document = {
    path: safeRelativePath(document.path, '$.artifact.document.path'),
    title: assertText(document.title, '$.artifact.document.title'),
    contentHash: assertDecisionContentHash(document.contentHash),
  };
  artifact.decision = normalizeDecisionRecord(artifact.decision, { requireConfirmed: true });
  artifact.evidenceId = assertId(artifact.evidenceId, '$.artifact.evidenceId');
  if (!artifact.document.path.endsWith(`/${artifact.decision.target.id}.md`) && artifact.document.path !== `${artifact.decision.target.id}.md`) {
    throw contractError('source-artifact-invalid', 'Decision document filename must equal its tagged target ID.', '$.artifact.document.path');
  }
  return artifact;
}

export function databaseObjectId(sourceId, collection, qualifiedName) {
  const digest = createHash('sha256').update(`${sourceId}\0${collection}\0${qualifiedName}`).digest('hex').slice(0, 16);
  return `db-${digest}`;
}

function normalizeDatabaseArtifact(artifact) {
  const provider = assertText(artifact.provider ?? artifact.provenance?.provider, '$.artifact.provider');
  if (!['postgres', 'mysql'].includes(provider)) throw contractError('source-artifact-invalid', 'Database provider must be postgres or mysql.', '$.artifact.provider');
  const transport = assertText(artifact.transport, '$.artifact.transport');
  if (!PROVIDERS.get(`database:${provider}`).has(transport)) throw contractError('source-artifact-invalid', `Invalid Database transport: ${transport}.`, '$.artifact.transport');
  if (artifact.capturePolicy !== 'metadata-only') throw contractError('source-artifact-invalid', 'Database Artifact capturePolicy must be metadata-only.', '$.artifact.capturePolicy');
  const environment = assertText(artifact.environment, '$.artifact.environment');
  const expectedTransport = ['ddl-file', 'migration-files'].includes(transport);
  if (expectedTransport && environment !== 'expected') {
    throw contractError('source-artifact-invalid', `${transport} Database Artifact environment must be expected.`, '$.artifact.environment');
  }
  if (!expectedTransport && environment === 'expected') {
    throw contractError('source-artifact-invalid', `${transport} Database Artifact requires a deployed environment.`, '$.artifact.environment');
  }
  const forbidden = ['rows', 'records', 'samples', 'sampleValues', 'data', 'queryResults'];
  for (const key of forbidden) if (key in artifact) throw contractError('source-sensitive-data-detected', `Database Artifact cannot contain ${key}.`, `$.artifact.${key}`);
  for (const [collection, requiredFields] of DATABASE_COLLECTIONS) {
    artifact[collection] = assertArray(artifact[collection] ?? [], `$.artifact.${collection}`).map((raw, index) => {
      const path = `$.artifact.${collection}[${index}]`;
      const item = assertObject(raw, path);
      for (const field of requiredFields) if (!(field in item)) throw contractError('source-artifact-invalid', `${path} requires ${field}.`, `${path}.${field}`);
      if (!/^db-[a-f0-9]{16}$/.test(item.id)) throw contractError('source-artifact-invalid', `${path}.id must be a stable Database ID.`, `${path}.id`);
      if (collection === 'tables' && !['table', 'partitioned-table', 'foreign-table'].includes(item.kind)) throw contractError('source-artifact-invalid', 'Invalid Database table kind.', `${path}.kind`);
      return structuredClone(item);
    }).sort((left, right) => left.id.localeCompare(right.id));
  }
  const evidenceOwners = new Map();
  for (const collection of DATABASE_COLLECTIONS.keys()) {
    for (const item of artifact[collection]) {
      const prior = evidenceOwners.get(item.evidenceId);
      if (prior) {
        throw contractError('source-artifact-invalid', `Database Evidence ID ${item.evidenceId} is reused by ${prior} and ${collection}:${item.id}.`, `$.artifact.${collection}.${item.id}.evidenceId`);
      }
      evidenceOwners.set(item.evidenceId, `${collection}:${item.id}`);
    }
  }
  assertDatabaseReferenceClosure(artifact);
  const artifactCount = [...DATABASE_COLLECTIONS.keys()].reduce((total, collection) => total + artifact[collection].length, 0);
  if (artifact.limits?.maxObjects && artifactCount > artifact.limits.maxObjects) throw contractError('source-artifact-invalid', 'Database Artifact exceeds maxObjects.', '$.artifact');
  return artifact;
}

function assertDatabaseReferenceClosure(artifact) {
  const byCollection = new Map([...DATABASE_COLLECTIONS.keys()].map((collection) => [
    collection,
    new Map(artifact[collection].map((item) => [item.id, item])),
  ]));
  const seenIds = new Map();
  for (const collection of DATABASE_COLLECTIONS.keys()) {
    for (const { id } of artifact[collection]) {
      if (seenIds.has(id)) {
        throw contractError('source-artifact-invalid', `Database ID ${id} is duplicated across ${seenIds.get(id)} and ${collection}.`, `$.artifact.${collection}`);
      }
      seenIds.set(id, collection);
    }
  }

  const schemaIds = new Set(byCollection.get('schemas').keys());
  for (const collection of ['tables', 'views', 'sequences', 'enums']) {
    for (const item of artifact[collection]) {
      if (!schemaIds.has(item.schemaId)) {
        throw contractError('source-artifact-invalid', `${collection} object ${item.id} references an unknown schemaId.`, `$.artifact.${collection}.${item.id}.schemaId`);
      }
    }
  }

  const ownerIds = new Set([
    ...byCollection.get('tables').keys(),
    ...byCollection.get('views').keys(),
  ]);
  for (const collection of ['columns', 'constraints', 'indexes', 'triggers']) {
    for (const item of artifact[collection]) {
      if (!ownerIds.has(item.ownerId)) {
        throw contractError('source-artifact-invalid', `${collection} object ${item.id} references an unknown ownerId.`, `$.artifact.${collection}.${item.id}.ownerId`);
      }
    }
  }

  const columns = byCollection.get('columns');
  const assertOwnedColumns = (ids, ownerId, path) => {
    for (const [index, columnId] of assertArray(ids, path).entries()) {
      const column = columns.get(columnId);
      if (!column || column.ownerId !== ownerId) {
        throw contractError('source-artifact-invalid', `Column ${columnId} is not owned by ${ownerId}.`, `${path}[${index}]`);
      }
    }
  };
  for (const constraint of artifact.constraints) {
    assertOwnedColumns(constraint.columnIds, constraint.ownerId, `$.artifact.constraints.${constraint.id}.columnIds`);
    if (constraint.referencedObjectId === null) {
      if (assertArray(constraint.referencedColumnIds, `$.artifact.constraints.${constraint.id}.referencedColumnIds`).length > 0) {
        throw contractError('source-artifact-invalid', 'referencedColumnIds require referencedObjectId.', `$.artifact.constraints.${constraint.id}.referencedObjectId`);
      }
    } else {
      if (!ownerIds.has(constraint.referencedObjectId)) {
        throw contractError('source-artifact-invalid', `Constraint ${constraint.id} references an unknown object.`, `$.artifact.constraints.${constraint.id}.referencedObjectId`);
      }
      assertOwnedColumns(constraint.referencedColumnIds, constraint.referencedObjectId, `$.artifact.constraints.${constraint.id}.referencedColumnIds`);
    }
  }
  for (const index of artifact.indexes) {
    assertOwnedColumns(index.columnIds, index.ownerId, `$.artifact.indexes.${index.id}.columnIds`);
  }
  for (const sequence of artifact.sequences) {
    if (sequence.ownedByColumnId !== null && !columns.has(sequence.ownedByColumnId)) {
      throw contractError('source-artifact-invalid', `Sequence ${sequence.id} references an unknown ownedByColumnId.`, `$.artifact.sequences.${sequence.id}.ownedByColumnId`);
    }
  }

  const structuralIds = new Set([...seenIds].filter(([, collection]) => collection !== 'accessControls').map(([id]) => id));
  for (const view of artifact.views) {
    for (const [index, dependencyId] of assertArray(view.dependencyIds, `$.artifact.views.${view.id}.dependencyIds`).entries()) {
      if (!structuralIds.has(dependencyId)) {
        throw contractError('source-artifact-invalid', `View ${view.id} references an unknown dependency.`, `$.artifact.views.${view.id}.dependencyIds[${index}]`);
      }
    }
  }
  for (const accessControl of artifact.accessControls) {
    if (!structuralIds.has(accessControl.objectId)) {
      throw contractError('source-artifact-invalid', `Access control ${accessControl.id} references an unknown objectId.`, `$.artifact.accessControls.${accessControl.id}.objectId`);
    }
  }
}

export function normalizeArtifact(raw, expectedKind = null) {
  const { artifact, sourceKind } = normalizeArtifactEnvelope(raw, expectedKind);
  let normalized;
  if (artifact.kind === 'decision-artifact') normalized = normalizeDecisionArtifact(artifact);
  else if (sourceKind === 'catalog') normalized = normalizeCatalogArtifact(artifact);
  else if (sourceKind === 'code') normalized = normalizeCodeArtifact(artifact);
  else if (sourceKind === 'requirement') normalized = normalizeRequirementArtifact(artifact);
  else if (sourceKind === 'database') normalized = normalizeDatabaseArtifact(artifact);
  else normalized = normalizeSupportingArtifact(artifact, sourceKind);
  normalized.fingerprint = fingerprint(normalized);
  return normalized;
}

function sameTextSet(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function pathWithin(path, root) {
  return root === '.' || path === root || path.startsWith(`${root}/`);
}

export function assertArtifactWithinSource(artifact, source) {
  if (artifact.sourceId !== source.id
    || artifact.provenance.provider !== source.provider
    || !artifactKindMatchesSource(artifact.kind, source.kind)) {
    throw contractError('source-artifact-invalid', `Artifact identity does not match Source ${source.id}.`, '$.artifacts');
  }
  const enabledTransportIds = new Set(source.transports.filter((transport) => transport.enabled).map((transport) => transport.id));
  if (artifact.provenance.transportIds.length === 0
    || artifact.provenance.transportIds.some((transportId) => !enabledTransportIds.has(transportId))) {
    throw confirmationError(`Artifact transport is outside confirmed Source ${source.id}.`, source.id);
  }
  if (source.confirmation?.status === 'confirmed'
    && Date.parse(artifact.capturedAt) < Date.parse(source.confirmation.confirmedAt)) {
    throw contractError(
      'wiki-source-scope-unconfirmed',
      `Artifact for Source ${source.id} was captured before its scope was confirmed.`,
      '$.artifact.capturedAt',
    );
  }

  if (source.kind === 'catalog') {
    if (!sameTextSet(artifact.scope.rootNodeIds, source.scope.rootNodeIds)) {
      throw confirmationError(`Catalog Artifact roots differ from confirmed Source ${source.id}.`, source.id);
    }
    const nodeById = new Map(artifact.nodes.map((node) => [node.id, node]));
    const rootIds = new Set(source.scope.rootNodeIds);
    if ([...rootIds].some((rootId) => !nodeById.has(rootId))) {
      throw confirmationError(`Catalog Artifact is missing a confirmed root for Source ${source.id}.`, source.id);
    }
    for (const node of artifact.nodes) {
      let current = node;
      while (current && !rootIds.has(current.id)) current = current.parentId ? nodeById.get(current.parentId) : null;
      if (!current) throw confirmationError(`Catalog node ${node.id} is outside confirmed roots for Source ${source.id}.`, source.id);
    }
  } else if (source.kind === 'code') {
    if (!sameTextSet(artifact.repositories.map((repository) => repository.sourceRoot), source.scope.roots)) {
      throw confirmationError(`Code Artifact roots differ from confirmed Source ${source.id}.`, source.id);
    }
    for (const repository of artifact.repositories) {
      if (repository.scope.include.length === 0) throw confirmationError(`Code repository ${repository.id} has no bounded include scope.`, source.id);
      for (const excluded of source.scope.exclude) {
        if (!pathWithin(excluded, repository.sourceRoot)) continue;
        const relativeExcluded = repository.sourceRoot === '.' ? excluded : posix.relative(repository.sourceRoot, excluded);
        if (!repository.scope.exclude.includes(relativeExcluded)) {
          throw confirmationError(`Code repository ${repository.id} does not preserve confirmed exclusion ${excluded}.`, source.id);
        }
      }
    }
    const repositoryById = new Map(artifact.repositories.map((repository) => [repository.id, repository]));
    for (const fact of artifact.facts) {
      const repository = repositoryById.get(fact.locator.repositoryId);
      if (!repository.scope.include.some((include) => pathWithin(fact.locator.path, include))) {
        throw confirmationError(`Code fact ${fact.id} is outside its confirmed repository include scope.`, source.id);
      }
      if (repository.scope.exclude.some((exclude) => pathWithin(fact.locator.path, exclude))) {
        throw confirmationError(`Code fact ${fact.id} is inside an excluded repository path.`, source.id);
      }
    }
  } else if (source.kind === 'requirement') {
    for (const key of ['workspaceId', 'projectId']) {
      if ((artifact.scope[key] ?? null) !== (source.scope[key] ?? null)) {
        throw confirmationError(`Requirement Artifact ${key} differs from confirmed Source ${source.id}.`, source.id);
      }
    }
    if (!sameTextSet(artifact.scope.workItemIds, source.scope.workItemIds)) {
      throw confirmationError(`Requirement Artifact work items differ from confirmed Source ${source.id}.`, source.id);
    }
    if (source.scope.workItemIds.length > 0) {
      const workItemIds = new Set(source.scope.workItemIds);
      const outsideItem = artifact.items.find((item) => !workItemIds.has(item.externalId));
      if (outsideItem) throw confirmationError(`Requirement item ${outsideItem.externalId} is outside confirmed Source ${source.id}.`, source.id);
    }
  } else if (source.kind === 'database') {
    const transportById = new Map(source.transports.filter((transport) => transport.enabled).map((transport) => [transport.id, transport]));
    if (artifact.provenance.transportIds.some((transportId) => transportById.get(transportId)?.type !== artifact.transport)) {
      throw confirmationError(`Database Artifact transport type differs from confirmed Source ${source.id}.`, source.id);
    }
    const expectedEnvironment = ['ddl-file', 'migration-files'].includes(artifact.transport) ? 'expected' : source.scope.environment;
    if (artifact.environment !== expectedEnvironment) {
      throw confirmationError(`Database Artifact environment differs from confirmed Source ${source.id}.`, source.id);
    }
    const schemaNames = artifact.schemas.map((schema) => schema.name);
    if (schemaNames.some((schema) => !source.scope.includeSchemas.includes(schema) || source.scope.excludeSchemas.includes(schema))) {
      throw confirmationError(`Database Artifact schemas exceed confirmed Source ${source.id}.`, source.id);
    }
  } else if (['spec', 'record', 'knowledge'].includes(source.kind)) {
    const roots = source.kind === 'spec' ? source.scope.paths
      : source.kind === 'record' ? [...source.scope.skillRefs, ...source.scope.artifactPaths]
        : [source.scope.root];
    const documents = artifact.kind === 'decision-artifact' ? [artifact.document] : artifact.documents;
    if (documents.some((document) => !roots.some((root) => pathWithin(document.path, root)))) {
      throw confirmationError(`${source.kind} Artifact documents exceed confirmed Source ${source.id}.`, source.id);
    }
  }
  return artifact;
}

export function createArtifact(envelope, payload) {
  const value = { schemaVersion: 1, ...structuredClone(envelope), ...structuredClone(payload) };
  value.fingerprint = fingerprint(value);
  return value;
}

export function validateDatabaseMetadataText(content, { provider, transport } = {}) {
  if (!['postgres', 'mysql'].includes(provider)) throw contractError('database-provider-invalid', `Unsupported Database provider: ${provider}.`, '$.provider');
  if (!['ddl-file', 'migration-files', 'schema-dump'].includes(transport)) throw contractError('database-transport-invalid', `Unsupported offline Database transport: ${transport}.`, '$.transport');
  if (typeof content !== 'string' || content.trim().length === 0) throw contractError('source-artifact-invalid', 'Database metadata input must be non-empty text.', '$.content');
  const forbidden = /\b(?:INSERT|UPDATE|DELETE|MERGE|REPLACE|TRUNCATE)\b|\bCOPY\b[\s\S]{0,120}\bFROM\b|\bLOAD\s+DATA\b/i;
  const match = content.match(forbidden);
  if (match) throw contractError('source-sensitive-data-detected', `Offline Database metadata contains a forbidden data statement: ${match[0]}.`, '$.content');
  return { provider, transport, capturePolicy: 'metadata-only', contentHash: sha256(content) };
}

function comparableDatabaseCollections(artifact) {
  return Object.fromEntries([...DATABASE_COLLECTIONS.keys()].map((collection) => [
    collection,
    artifact[collection].map((item) => {
      const comparable = structuredClone(item);
      delete comparable.evidenceId;
      delete comparable.environment;
      return canonical(comparable);
    }),
  ]));
}

export function reconcileDatabaseArtifacts(rawArtifacts) {
  const artifacts = rawArtifacts.map((artifact) => normalizeArtifact(artifact, 'database'));
  const bySource = new Map();
  for (const artifact of artifacts) {
    if (!bySource.has(artifact.sourceId)) bySource.set(artifact.sourceId, []);
    bySource.get(artifact.sourceId).push(artifact);
  }
  return [...bySource].map(([sourceId, sourceArtifacts]) => {
    const expected = sourceArtifacts.filter((artifact) => ['ddl-file', 'migration-files'].includes(artifact.transport));
    const deployed = sourceArtifacts.filter((artifact) => ['schema-dump', 'read-only-introspection'].includes(artifact.transport));
    const shapes = (values) => [...new Set(values.map((artifact) => JSON.stringify(comparableDatabaseCollections(artifact))))];
    const expectedShapes = shapes(expected);
    const deployedShapes = shapes(deployed);
    const conflictCollections = [];
    if (expectedShapes.length > 0 && deployedShapes.length > 0) {
      const left = comparableDatabaseCollections(expected[0]);
      const right = comparableDatabaseCollections(deployed[0]);
      for (const collection of DATABASE_COLLECTIONS.keys()) {
        if (JSON.stringify(left[collection]) !== JSON.stringify(right[collection])) conflictCollections.push(collection);
      }
    }
    const conflict = expectedShapes.length > 1 || deployedShapes.length > 1 || conflictCollections.length > 0;
    return {
      sourceId,
      status: conflict ? 'conflict' : expected.length > 0 && deployed.length > 0 ? 'aligned' : 'single-layer',
      expectedArtifactFingerprints: expected.map((artifact) => artifact.fingerprint).sort(),
      deployedArtifactFingerprints: deployed.map((artifact) => artifact.fingerprint).sort(),
      conflictCollections: [...new Set(conflictCollections)].sort(),
    };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export function buildDatabaseMetadataQueries(provider, { includeSchemas, excludeSchemas, statementTimeoutMs }) {
  if (!['postgres', 'mysql'].includes(provider)) throw contractError('database-provider-invalid', `Unsupported Database provider: ${provider}.`, '$.provider');
  if (!Array.isArray(includeSchemas) || includeSchemas.length === 0) throw contractError('database-scope-invalid', 'includeSchemas must be non-empty.', '$.includeSchemas');
  const systemSchemas = provider === 'postgres'
    ? new Set(['pg_catalog', 'information_schema'])
    : new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
  const forbiddenSchemas = includeSchemas.filter((schema) => systemSchemas.has(String(schema).toLowerCase()));
  if (forbiddenSchemas.length > 0) throw contractError('database-scope-invalid', `System schemas cannot be included: ${forbiddenSchemas.join(', ')}.`, '$.includeSchemas');
  const excluded = Array.isArray(excludeSchemas) ? excludeSchemas : [];
  const timeout = Number.isInteger(statementTimeoutMs) && statementTimeoutMs > 0 ? statementTimeoutMs : 10000;
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const include = includeSchemas.map(quote).join(', ');
  const exclude = excluded.length ? ` AND table_schema NOT IN (${excluded.map(quote).join(', ')})` : '';
  if (provider === 'postgres') {
    const statements = [
      `SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name IN (${include}) ORDER BY schema_name`,
      `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema IN (${include})${exclude} ORDER BY table_schema, table_name`,
      `SELECT table_schema, table_name, view_definition FROM information_schema.views WHERE table_schema IN (${include})${exclude} ORDER BY table_schema, table_name`,
      `SELECT table_schema, table_name, column_name, ordinal_position, is_nullable, data_type, column_default FROM information_schema.columns WHERE table_schema IN (${include})${exclude} ORDER BY table_schema, table_name, ordinal_position`,
      `SELECT tc.constraint_schema, tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name, kcu.ordinal_position FROM information_schema.table_constraints tc LEFT JOIN information_schema.key_column_usage kcu ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name WHERE tc.constraint_schema IN (${include}) ORDER BY tc.constraint_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`,
      `SELECT ns.nspname AS table_schema, tbl.relname AS table_name, idx.relname AS index_name, ind.indisunique AS is_unique, att.attname AS column_name, key.ordinality AS seq_in_index, pg_catalog.pg_get_indexdef(ind.indexrelid) AS indexdef, pg_catalog.pg_get_expr(ind.indpred, ind.indrelid) AS predicate FROM pg_catalog.pg_index ind JOIN pg_catalog.pg_class idx ON idx.oid = ind.indexrelid JOIN pg_catalog.pg_class tbl ON tbl.oid = ind.indrelid JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace LEFT JOIN LATERAL unnest(ind.indkey) WITH ORDINALITY AS key(attnum, ordinality) ON true LEFT JOIN pg_catalog.pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = key.attnum WHERE ns.nspname IN (${include}) ORDER BY ns.nspname, tbl.relname, idx.relname, key.ordinality`,
    ];
    return {
      provider,
      readOnly: true,
      statementTimeoutMs: timeout,
      transaction: { begin: 'BEGIN TRANSACTION READ ONLY', rollback: 'ROLLBACK' },
      queries: ['schemas', 'tables', 'views', 'columns', 'constraints', 'indexes'].map((name, index) => ({ name, statement: statements[index] })),
      statements,
    };
  }
  const statements = [
    `SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name IN (${include}) ORDER BY schema_name`,
    `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema IN (${include})${exclude} ORDER BY table_schema, table_name`,
    `SELECT table_schema, table_name, view_definition FROM information_schema.views WHERE table_schema IN (${include})${exclude} ORDER BY table_schema, table_name`,
    `SELECT table_schema, table_name, column_name, ordinal_position, is_nullable, data_type, column_default FROM information_schema.columns WHERE table_schema IN (${include})${exclude} ORDER BY table_schema, table_name, ordinal_position`,
    `SELECT tc.constraint_schema, tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name, kcu.ordinal_position, kcu.referenced_table_schema, kcu.referenced_table_name, kcu.referenced_column_name FROM information_schema.table_constraints tc LEFT JOIN information_schema.key_column_usage kcu ON kcu.constraint_schema = tc.constraint_schema AND kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name WHERE tc.constraint_schema IN (${include}) ORDER BY tc.constraint_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`,
    `SELECT table_schema, table_name, index_name, non_unique, column_name, seq_in_index FROM information_schema.statistics WHERE table_schema IN (${include})${exclude} ORDER BY table_schema, table_name, index_name, seq_in_index`,
  ];
  return {
    provider,
    readOnly: true,
    statementTimeoutMs: timeout,
    transaction: { begin: 'START TRANSACTION READ ONLY', rollback: 'ROLLBACK' },
    queries: ['schemas', 'tables', 'views', 'columns', 'constraints', 'indexes'].map((name, index) => ({ name, statement: statements[index] })),
    statements,
  };
}

function metadataEvidenceId(sourceId, collection, qualifiedName) {
  return `evidence-${createHash('sha256').update(`${sourceId}\0${collection}\0${qualifiedName}`).digest('hex').slice(0, 16)}`;
}

function metadataValue(row, ...keys) {
  for (const key of keys) if (row?.[key] !== undefined) return row[key];
  return undefined;
}

export function normalizeDatabaseMetadataSnapshot({
  sourceId,
  provider,
  environment,
  engineVersion,
  includeSchemas,
  maxObjects = 10000,
  snapshot,
}) {
  if (!ID_PATTERN.test(sourceId ?? '')) throw contractError('database-snapshot-invalid', 'sourceId must be a stable ID.', '$.sourceId');
  if (!['postgres', 'mysql'].includes(provider)) throw contractError('database-provider-invalid', `Unsupported Database provider: ${provider}.`, '$.provider');
  if (typeof environment !== 'string' || environment.length === 0 || environment === 'expected') throw contractError('database-snapshot-invalid', 'Live metadata environment must identify a deployed environment.', '$.environment');
  if (!Array.isArray(includeSchemas) || includeSchemas.length === 0) throw contractError('database-scope-invalid', 'includeSchemas must be non-empty.', '$.includeSchemas');
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw contractError('database-snapshot-invalid', 'snapshot must be an object.', '$.snapshot');
  for (const key of ['rows', 'records', 'samples', 'sampleValues', 'data', 'queryResults']) {
    if (key in snapshot) throw contractError('source-sensitive-data-detected', `Database snapshot cannot contain ${key}.`, `$.snapshot.${key}`);
  }
  const allowedSchemas = new Set(includeSchemas);
  const schemaNames = sortedUnique([
    ...(snapshot.schemas ?? []).map((row) => metadataValue(row, 'name', 'schema_name')),
    ...(snapshot.tables ?? []).map((row) => metadataValue(row, 'schema', 'table_schema')),
  ].filter((name) => allowedSchemas.has(name)));
  const schemas = schemaNames.map((name) => ({
    id: databaseObjectId(sourceId, 'schemas', name),
    name,
    environment,
    evidenceId: metadataEvidenceId(sourceId, 'schemas', name),
  }));
  const schemaIdByName = new Map(schemas.map((item) => [item.name, item.id]));
  const tables = (snapshot.tables ?? []).filter((row) => allowedSchemas.has(metadataValue(row, 'schema', 'table_schema'))
    && !String(metadataValue(row, 'kind', 'table_type') ?? '').toLowerCase().includes('view')).map((row) => {
    const schemaName = metadataValue(row, 'schema', 'table_schema');
    const name = metadataValue(row, 'name', 'table_name');
    const qualifiedName = `${schemaName}.${name}`;
    const rawKind = String(metadataValue(row, 'kind', 'table_type') ?? '').toLowerCase();
    return {
      id: databaseObjectId(sourceId, 'tables', qualifiedName),
      schemaId: schemaIdByName.get(schemaName),
      name,
      kind: rawKind.includes('foreign') ? 'foreign-table' : rawKind.includes('partition') ? 'partitioned-table' : 'table',
      comment: metadataValue(row, 'comment') ?? null,
      evidenceId: metadataEvidenceId(sourceId, 'tables', qualifiedName),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const views = (snapshot.views ?? []).filter((row) => allowedSchemas.has(metadataValue(row, 'schema', 'table_schema'))).map((row) => {
    const schemaName = metadataValue(row, 'schema', 'table_schema');
    const name = metadataValue(row, 'name', 'table_name');
    const qualifiedName = `${schemaName}.${name}`;
    return {
      id: databaseObjectId(sourceId, 'views', qualifiedName),
      schemaId: schemaIdByName.get(schemaName),
      name,
      definitionHash: `sha256:${createHash('sha256').update(String(metadataValue(row, 'definition', 'view_definition') ?? '')).digest('hex')}`,
      dependencyIds: [],
      evidenceId: metadataEvidenceId(sourceId, 'views', qualifiedName),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const ownerByQualifiedName = new Map([...tables, ...views].map((owner) => {
    const schemaName = schemas.find((schema) => schema.id === owner.schemaId)?.name;
    return [`${schemaName}.${owner.name}`, owner];
  }));
  const columns = (snapshot.columns ?? []).map((row) => {
    const schemaName = metadataValue(row, 'schema', 'table_schema') ?? schemaNames[0];
    const tableName = metadataValue(row, 'table', 'table_name');
    const owner = ownerByQualifiedName.get(`${schemaName}.${tableName}`);
    if (!owner) return null;
    const name = metadataValue(row, 'name', 'column_name');
    const qualifiedName = `${schemaName}.${tableName}.${name}`;
    return {
      id: databaseObjectId(sourceId, 'columns', qualifiedName),
      ownerId: owner.id,
      name,
      dataType: metadataValue(row, 'dataType', 'data_type'),
      nullable: typeof row.nullable === 'boolean' ? row.nullable : String(metadataValue(row, 'is_nullable')).toUpperCase() === 'YES',
      defaultExpression: metadataValue(row, 'defaultExpression', 'column_default') ?? null,
      ordinal: Number(metadataValue(row, 'ordinal', 'ordinal_position')),
      comment: metadataValue(row, 'comment') ?? null,
      evidenceId: metadataEvidenceId(sourceId, 'columns', qualifiedName),
    };
  }).filter(Boolean).sort((left, right) => left.id.localeCompare(right.id));
  const columnByQualifiedName = new Map(columns.map((column) => {
    const owner = [...tables, ...views].find((item) => item.id === column.ownerId);
    const schemaName = schemas.find((schema) => schema.id === owner.schemaId)?.name;
    return [`${schemaName}.${owner.name}.${column.name}`, column];
  }));
  const constraintGroups = new Map();
  for (const row of snapshot.constraints ?? []) {
    const schemaName = metadataValue(row, 'schema', 'constraint_schema') ?? schemaNames[0];
    const tableName = metadataValue(row, 'table', 'table_name');
    const name = metadataValue(row, 'name', 'constraint_name');
    const owner = ownerByQualifiedName.get(`${schemaName}.${tableName}`);
    if (!owner || !tables.some((table) => table.id === owner.id)) continue;
    const key = `${schemaName}.${tableName}.${name}`;
    if (!constraintGroups.has(key)) constraintGroups.set(key, { schemaName, tableName, name, owner, rows: [] });
    constraintGroups.get(key).rows.push(row);
  }
  const constraints = [...constraintGroups.entries()].map(([qualifiedName, group]) => {
    const orderedRows = group.rows.sort((left, right) => Number(metadataValue(left, 'ordinal', 'ordinal_position') ?? 0) - Number(metadataValue(right, 'ordinal', 'ordinal_position') ?? 0));
    const explicitColumns = orderedRows.flatMap((row) => row.columns ?? []);
    const columnNames = explicitColumns.length > 0 ? explicitColumns : orderedRows.map((row) => metadataValue(row, 'column', 'column_name')).filter(Boolean);
    const referencedSchema = metadataValue(orderedRows[0], 'referencedSchema', 'referenced_table_schema');
    const referencedTable = metadataValue(orderedRows[0], 'referencedTable', 'referenced_table_name');
    const referencedObject = referencedSchema && referencedTable ? ownerByQualifiedName.get(`${referencedSchema}.${referencedTable}`) : null;
    return {
      id: databaseObjectId(sourceId, 'constraints', qualifiedName),
      ownerId: group.owner.id,
      type: String(metadataValue(orderedRows[0], 'type', 'constraint_type')).toLowerCase().replaceAll(' ', '-'),
      columnIds: sortedUnique(columnNames.map((columnName) => columnByQualifiedName.get(`${group.schemaName}.${group.tableName}.${columnName}`)?.id).filter(Boolean)),
      referencedObjectId: referencedObject?.id ?? null,
      referencedColumnIds: referencedObject ? sortedUnique(orderedRows.map((row) => metadataValue(row, 'referencedColumn', 'referenced_column_name')).filter(Boolean)
        .map((columnName) => columnByQualifiedName.get(`${referencedSchema}.${referencedTable}.${columnName}`)?.id).filter(Boolean)) : [],
      expression: metadataValue(orderedRows[0], 'expression') ?? null,
      evidenceId: metadataEvidenceId(sourceId, 'constraints', qualifiedName),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const indexGroups = new Map();
  for (const row of snapshot.indexes ?? []) {
    const schemaName = metadataValue(row, 'schema', 'table_schema') ?? schemaNames[0];
    const tableName = metadataValue(row, 'table', 'table_name');
    const name = metadataValue(row, 'name', 'index_name');
    const owner = ownerByQualifiedName.get(`${schemaName}.${tableName}`);
    if (!owner) continue;
    const key = `${schemaName}.${tableName}.${name}`;
    if (!indexGroups.has(key)) indexGroups.set(key, { schemaName, tableName, name, owner, rows: [] });
    indexGroups.get(key).rows.push(row);
  }
  const indexes = [...indexGroups.entries()].map(([qualifiedName, group]) => ({
    id: databaseObjectId(sourceId, 'indexes', qualifiedName),
    ownerId: group.owner.id,
    unique: group.rows.every((row) => {
      const direct = metadataValue(row, 'unique', 'is_unique');
      return typeof direct === 'boolean' ? direct : Number(metadataValue(row, 'non_unique')) === 0;
    }),
    columnIds: group.rows.sort((left, right) => Number(metadataValue(left, 'sequence', 'seq_in_index') ?? 0) - Number(metadataValue(right, 'sequence', 'seq_in_index') ?? 0))
      .map((row) => columnByQualifiedName.get(`${group.schemaName}.${group.tableName}.${metadataValue(row, 'column', 'column_name')}`)?.id).filter(Boolean),
    expression: group.rows[0].expression ?? group.rows[0].indexdef ?? null,
    predicate: group.rows[0].predicate ?? null,
    evidenceId: metadataEvidenceId(sourceId, 'indexes', qualifiedName),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const objectCount = schemas.length + tables.length + views.length + columns.length + constraints.length + indexes.length;
  if (!Number.isInteger(maxObjects) || maxObjects <= 0 || objectCount > maxObjects) throw contractError('database-object-limit-exceeded', 'Database snapshot exceeds maxObjects.', '$.snapshot');
  return {
    provider,
    transport: 'read-only-introspection',
    environment,
    engineVersion: String(engineVersion ?? 'unknown'),
    capturePolicy: 'metadata-only',
    schemas,
    tables,
    views,
    columns,
    constraints,
    indexes,
    sequences: [],
    triggers: [],
    enums: [],
    accessControls: [],
    limits: { maxObjects },
  };
}

export async function collectDatabaseMetadata({ execute, ...options }) {
  if (typeof execute !== 'function') throw contractError('database-collector-invalid', 'execute must be a function.', '$.execute');
  const plan = buildDatabaseMetadataQueries(options.provider, options);
  const snapshot = {};
  let began = false;
  try {
    await execute(plan.transaction.begin, { phase: 'begin', readOnly: true, statementTimeoutMs: plan.statementTimeoutMs });
    began = true;
    for (const query of plan.queries) {
      const result = await execute(query.statement, { phase: 'metadata', name: query.name, readOnly: true, statementTimeoutMs: plan.statementTimeoutMs });
      if (!Array.isArray(result)) throw contractError('database-collector-invalid', `Metadata query ${query.name} must return an array.`, `$.snapshot.${query.name}`);
      snapshot[query.name] = result;
    }
  } finally {
    if (began) await execute(plan.transaction.rollback, { phase: 'rollback', readOnly: true, statementTimeoutMs: plan.statementTimeoutMs });
  }
  return normalizeDatabaseMetadataSnapshot({ ...options, snapshot });
}

function sourceFresh(result, configuredSource, now) {
  const maxAgeHours = configuredSource?.freshness?.maxAgeHours;
  if (!maxAgeHours || result.status !== 'collected' || !result.capturedAt) return result.status === 'collected';
  return Date.parse(result.capturedAt) + maxAgeHours * 60 * 60 * 1000 >= now.getTime();
}

export function buildSourceReadiness({ configuredSources = [], sourceResults, artifacts, features, issues = [], now = new Date() }) {
  const configById = new Map(configuredSources.map((source) => [source.id, source]));
  assertWikiSourceConfirmations(configuredSources);
  const results = sourceResults.map((result) => normalizeSourceResult(result, configById.get(result.sourceId) ?? null));
  const normalizedArtifacts = artifacts.map((artifact) => normalizeArtifact(artifact));
  const artifactBySource = new Map();
  for (const artifact of normalizedArtifacts) {
    if (!artifactBySource.has(artifact.sourceId)) artifactBySource.set(artifact.sourceId, []);
    artifactBySource.get(artifact.sourceId).push(artifact);
  }
  const resultIds = new Set();
  for (const result of results) {
    if (resultIds.has(result.sourceId)) throw contractError('source-result-invalid', `Duplicate Source Result: ${result.sourceId}.`, '$.sourceResults');
    resultIds.add(result.sourceId);
    const sourceArtifacts = artifactBySource.get(result.sourceId) ?? [];
    if (result.artifactCount !== sourceArtifacts.length) throw contractError('source-result-invalid', `Source Result artifactCount does not match ${result.sourceId} Artifacts.`, '$.sourceResults');
    for (const artifact of sourceArtifacts) {
      if (artifact.provenance.provider !== result.provider || !artifactKindMatchesSource(artifact.kind, result.kind)) {
        throw contractError('source-artifact-invalid', `Artifact identity does not match Source Result ${result.sourceId}.`, '$.artifacts');
      }
    }
  }
  for (const source of configuredSources.filter((item) => item.enabled)) {
    if (!resultIds.has(source.id)) throw contractError('source-result-invalid', `Enabled Source has no Source Result: ${source.id}.`, '$.sourceResults');
  }
  for (const artifact of normalizedArtifacts) {
    if (!resultIds.has(artifact.sourceId)) throw contractError('source-artifact-invalid', `Artifact has no Source Result: ${artifact.sourceId}.`, '$.artifacts');
    const source = configById.get(artifact.sourceId);
    if (!source?.enabled || artifact.provenance.scopeFingerprint !== sourceScopeFingerprint(source)) {
      throw confirmationError(`Artifact scope differs from confirmed Source ${artifact.sourceId}.`, artifact.sourceId);
    }
    assertArtifactWithinSource(artifact, source);
  }
  const collectedCatalog = results.filter((result) => result.kind === 'catalog' && result.status === 'collected' && sourceFresh(result, configById.get(result.sourceId), now));
  const collectedCode = results.filter((result) => result.kind === 'code' && result.status === 'collected' && sourceFresh(result, configById.get(result.sourceId), now));
  const blockingIssueIds = issues.filter((item) => item.severity === 'P0').map((item) => item.id ?? item.code).filter(Boolean).sort();
  if (collectedCatalog.length !== 1) blockingIssueIds.push('source-catalog-readiness');
  if (collectedCode.length === 0) blockingIssueIds.push('source-code-readiness');
  const requirementArtifacts = normalizedArtifacts.filter((artifact) => artifact.kind === 'requirement-artifact');
  const normalizedDatabaseArtifacts = normalizedArtifacts.filter((artifact) => artifact.kind === 'database-artifact');
  const databaseArtifacts = new Map();
  for (const artifact of normalizedDatabaseArtifacts) {
    if (!databaseArtifacts.has(artifact.sourceId)) databaseArtifacts.set(artifact.sourceId, []);
    databaseArtifacts.get(artifact.sourceId).push(artifact);
  }
  const databaseReconciliations = reconcileDatabaseArtifacts(normalizedDatabaseArtifacts);
  const featureResults = features.map((feature) => {
    const ref = `feature:${feature.id}`;
    const relevantItems = requirementArtifacts.flatMap((artifact) => artifact.items.filter((item) => item.featureRefs.includes(ref)));
    const requirementStatus = relevantItems.some((item) => item.decision === 'conflict')
      ? 'conflict'
      : relevantItems.some((item) => item.decision === 'adopted') ? 'ready' : 'missing';
    const assessment = assertObject(feature.dataSourceAssessment, `feature:${feature.id}.dataSourceAssessment`);
    let databaseStatus;
    if (assessment.applicability === 'not-applicable') databaseStatus = 'not-applicable';
    else if (assessment.applicability === 'unknown') databaseStatus = 'unknown';
    else {
      const sourceIds = assertArray(assessment.databaseSourceIds ?? [], `feature:${feature.id}.dataSourceAssessment.databaseSourceIds`);
      const available = sourceIds.some((sourceId) => {
        const result = results.find((item) => item.sourceId === sourceId && item.kind === 'database');
        return result?.status === 'collected' && sourceFresh(result, configById.get(sourceId), now) && databaseArtifacts.has(sourceId);
      });
      const conflict = sourceIds.some((sourceId) => databaseReconciliations.find((item) => item.sourceId === sourceId)?.status === 'conflict');
      databaseStatus = conflict ? 'conflict' : available ? 'ready' : 'missing';
    }
    const gapIds = [...new Set([...(feature.gapIds ?? []), ...(assessment.gapIds ?? [])])].sort();
    const outcome = ['missing', 'unknown', 'conflict'].includes(databaseStatus) ? 'blocked'
      : requirementStatus === 'ready' ? 'ready' : 'degraded';
    return { featureId: feature.id, requirementStatus, databaseStatus, outcome, gapIds };
  }).sort((left, right) => left.featureId.localeCompare(right.featureId));
  const status = blockingIssueIds.length > 0 ? 'blocked'
    : featureResults.some((item) => item.outcome !== 'ready') || results.some((result) => result.kind === 'requirement' && result.status !== 'collected')
      ? 'degraded'
      : 'ready';
  return {
    status,
    catalogSourceIds: collectedCatalog.map((item) => item.sourceId).sort(),
    codeSourceIds: collectedCode.map((item) => item.sourceId).sort(),
    featureResults,
    blockingIssueIds: [...new Set(blockingIssueIds)].sort(),
    sourceResults: results,
    artifacts: normalizedArtifacts,
    databaseReconciliations,
  };
}

export const __private = { canonical, fingerprint, assertNoSensitive };
