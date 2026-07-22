import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { stringifyFrontmatter } from './frontmatter.mjs';
import { publishWikiSnapshot } from './wiki-publisher.mjs';
import {
  GAP_FIELD_LABELS,
  normalizeGapGuidance,
  renderGapResponseGuidance,
  validateGapStatus,
} from './wiki-gap.mjs';
import { normalizeDecisionRecord } from './wiki-decision.mjs';
import { buildReviewItems, validateReviewItems } from './wiki-review.mjs';
import {
  assertPersistedWikiInputConfirmation,
  assertWikiGenerationAuthorization,
  buildSourceReadiness,
  SOURCE_KINDS,
  validateConfiguredWikiSources,
  __private as sourcePrivate,
} from './wiki-source-registry.mjs';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const RUN_ID_PATTERN = /^wiki-[a-z0-9-]+$/;
const OBJECT_STATUSES = new Set(['confirmed', 'partial', 'needs-review', 'deprecated']);
const FACT_LEVELS = new Set(['confirmed', 'partial', 'needs-review']);
const FACT_LAYERS = new Set(['expected', 'current', 'observed']);
const PAGE_STATUSES = new Set(['product-review-draft', 'publishable', 'partially-publishable', 'not-publishable', 'deprecated']);
const DATA_APPLICABILITY = new Set(['applicable', 'not-applicable', 'unknown']);
const REQUIREMENT_SCOPE_TYPES = new Set(['baseline', 'enhancement', 'bugfix', 'migration']);
const METRIC_TYPES = new Set(['product-success', 'business-observation', 'implementation-count']);
const PERMISSION_LAYERS = new Set(['product', 'ui', 'api', 'data']);
const EVIDENCE_PRECISIONS = new Set(['file', 'line', 'symbol', 'metadata-object', 'requirement-item', 'document', 'catalog-node']);
const FLOW_LANE_TYPES = new Set(['actor', 'frontend', 'primary-system', 'collaborating-system', 'external-system', 'async-infrastructure']);
const FLOW_NODE_TYPES = new Set(['start', 'user-action', 'frontend-action', 'service-action', 'decision', 'async-task', 'external-action', 'result', 'end']);
const FLOW_PATH_TYPES = new Set(['main', 'branch', 'exception', 'fallback']);
const FLOW_INTERACTION_TYPES = new Set(['local', 'sync', 'async', 'callback', 'schedule']);
const FLOW_PARTICIPANT_TYPES = new Set(['actor', 'frontend', 'service', 'message-bus', 'scheduler', 'external-system', 'datastore']);
const FLOW_MESSAGE_TYPES = new Set(['request', 'response', 'command', 'event', 'callback', 'schedule']);
const FLOW_VIEW_APPLICABILITY = new Set(['applicable', 'not-applicable', 'unknown']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const GAP_TYPES = new Set([
  'hierarchy-gap',
  'evidence-gap',
  'product-decision-gap',
  'conflict-gap',
  'acceptance-gap',
  'freshness-gap',
  'data-source-gap',
  'schema-drift-gap',
  'orm-schema-conflict',
  'unused-data-object-gap',
  'business-meaning-gap',
  'database-access-gap',
  'internal-integrity-gap',
]);
const AUTHORITY_SOURCES = new Map([
  ['requirement-statement', new Set(['requirement'])],
  ['design-decision', new Set(['spec'])],
  ['implementation-fact', new Set(['code', 'knowledge'])],
  ['runtime-observation', new Set(['record'])],
  ['test-verification', new Set(['code', 'knowledge'])],
  ['human-confirmation', new Set(['catalog', 'requirement', 'spec', 'record'])],
  ['data-structure-fact', new Set(['database'])],
]);
const LAYER_AUTHORITIES = new Map([
  ['expected', new Set(['requirement-statement', 'design-decision', 'human-confirmation', 'data-structure-fact'])],
  ['current', new Set(['implementation-fact', 'test-verification', 'data-structure-fact'])],
  ['observed', new Set(['runtime-observation', 'test-verification'])],
]);
const AUTHORITY_SUBJECT_KINDS = new Map([
  ['requirement-statement', new Set(['system', 'domain', 'module', 'feature', 'rule', 'role', 'permission', 'metric', 'interface', 'requirement', 'acceptance-criteria', 'version'])],
  ['design-decision', null],
  ['implementation-fact', new Set(['feature', 'page', 'operation', 'flow', 'state-machine', 'rule', 'role', 'permission', 'data-entity', 'metric', 'interface'])],
  ['runtime-observation', new Set(['feature', 'page', 'operation', 'scenario', 'flow', 'state-machine', 'rule', 'permission', 'interface'])],
  ['test-verification', new Set(['feature', 'page', 'operation', 'scenario', 'flow', 'state-machine', 'rule', 'permission', 'data-entity', 'metric', 'interface', 'acceptance-criteria'])],
  ['human-confirmation', null],
  ['data-structure-fact', new Set(['data-entity', 'permission'])],
]);
const CATALOG_KINDS = new Map([
  ['systems', 'system'],
  ['domains', 'domain'],
  ['modules', 'module'],
  ['features', 'feature'],
]);
const OBJECT_KINDS = new Map([
  ['pages', 'page'],
  ['operations', 'operation'],
  ['scenarios', 'scenario'],
  ['flows', 'flow'],
  ['stateMachines', 'state-machine'],
  ['rules', 'rule'],
  ['roles', 'role'],
  ['permissions', 'permission'],
  ['dataEntities', 'data-entity'],
  ['metrics', 'metric'],
  ['interfaces', 'interface'],
  ['requirements', 'requirement'],
  ['acceptanceCriteria', 'acceptance-criteria'],
  ['versions', 'version'],
]);
const REQUIRED_FIELDS = new Map([
  ['system', ['sourceIdentity', 'parentRef', 'positioning', 'boundary', 'domainRefs']],
  ['domain', ['sourceIdentity', 'parentRef', 'boundary', 'moduleRefs']],
  ['module', ['sourceIdentity', 'parentRef', 'featureRefs', 'entryRefs']],
  ['feature', ['sourceIdentity', 'parentRef', 'purpose', 'dataSourceAssessment', 'pageRefs', 'operationRefs', 'scenarioRefs', 'flowRefs', 'stateMachineRefs', 'ruleRefs', 'roleRefs', 'permissionRefs', 'dataEntityRefs', 'metricRefs', 'interfaceRefs', 'requirementRefs', 'acceptanceCriteriaRefs', 'versionRefs']],
  ['page', ['route', 'areas', 'operationRefs']],
  ['operation', ['action', 'actorRefs', 'preconditions', 'outcomes', 'errorOutcomes']],
  ['scenario', ['goal', 'actorRefs', 'preconditions', 'steps', 'outcomes']],
  ['flow', ['goal', 'scope', 'nonScope', 'trigger', 'entryRefs', 'phases', 'lanes', 'nodes', 'edges', 'exceptionPaths', 'stateMachineRefs', 'interaction', 'viewAssessments']],
  ['state-machine', ['businessObjectRef', 'dimension', 'stateMode', 'states', 'transitions', 'unresolvedTransitions', 'completeness']],
  ['rule', ['trigger', 'conditions', 'effects', 'priority', 'exceptions', 'configurationRefs']],
  ['role', ['roleType', 'responsibilities', 'scopeRefs', 'operationRefs']],
  ['permission', ['rows']],
  ['data-entity', ['storageRefs', 'storageName', 'databaseObjectRefs', 'fields', 'constraints', 'indexes', 'relationships', 'fieldCoverage', 'sensitivity', 'readerRefs', 'writerRefs']],
  ['metric', ['metricType', 'formula', 'unit', 'dimensions', 'filters', 'timeWindow', 'baseline', 'target', 'sourceRefs', 'refreshPolicy']],
  ['interface', ['providerRef', 'consumerRefs', 'protocol', 'endpoints', 'auth', 'input', 'output', 'errors', 'idempotency', 'timeout', 'retry', 'version']],
  ['requirement', ['provider', 'externalId', 'normalizedStatus', 'scopeType', 'scopeRef', 'featureRefs']],
  ['acceptance-criteria', ['featureRef', 'operationRefs', 'criterionType', 'given', 'when', 'then', 'requirementRef', 'decisionId']],
  ['version', ['label', 'effectiveAt', 'changeRefs', 'supersedesRefs']],
]);
const OPTIONAL_FEATURE_REFERENCE_FIELDS = new Set([
  'pageRefs',
  'scenarioRefs',
  'flowRefs',
  'stateMachineRefs',
  'ruleRefs',
  'roleRefs',
  'permissionRefs',
  'dataEntityRefs',
  'metricRefs',
  'interfaceRefs',
  'versionRefs',
]);
const RELATION_TYPES = new Map([
  ['contains', { from: new Set(['system', 'domain', 'module']), to: new Set(['domain', 'module', 'feature']), pairs: new Set(['system:domain', 'domain:module', 'module:feature']) }],
  ['exposes', { from: new Set(['system', 'module', 'feature']), to: new Set(['page', 'operation', 'interface']) }],
  ['applies-to', { from: new Set(['rule', 'state-machine', 'permission']), to: new Set(['feature', 'flow', 'operation', 'data-entity', 'interface']) }],
  ['performed-by', { from: new Set(['operation', 'scenario', 'flow']), to: new Set(['role']) }],
  ['reads', { from: new Set(['feature', 'operation', 'interface']), to: new Set(['data-entity']) }],
  ['writes', { from: new Set(['feature', 'operation', 'interface']), to: new Set(['data-entity']) }],
  ['calls', { from: new Set(['system', 'feature', 'interface']), to: new Set(['interface']) }],
  ['measures', { from: new Set(['metric']), to: new Set(['system', 'domain', 'module', 'feature', 'flow']) }],
  ['specified-by', { from: new Set(['feature', 'rule', 'metric', 'interface']), to: new Set(['requirement', 'acceptance-criteria']) }],
  ['depends-on', { from: null, to: null }],
  ['supersedes', { from: new Set(['requirement', 'rule', 'interface', 'version']), to: new Set(['requirement', 'rule', 'interface', 'version']), sameKind: true }],
]);
const OBJECT_DIRECTORIES = new Map([
  ['scenario', '用户场景'],
  ['flow', '业务流程'],
  ['state-machine', '状态模型'],
  ['page', '页面与操作'],
  ['operation', '页面与操作'],
  ['rule', '业务规则'],
  ['data-entity', '数据字典'],
  ['metric', '指标口径'],
  ['interface', '接口集成'],
  ['role', '角色权限'],
  ['permission', '角色权限'],
]);
const FEATURE_CATALOG_ENTRY_FIELDS = [
  'ownerRefs',
  'subjectRefs',
  'pageRefs',
  'operationRefs',
  'scenarioRefs',
  'flowRefs',
  'stateMachineRefs',
  'ruleRefs',
  'roleRefs',
  'permissionRefs',
  'dataEntityRefs',
  'metricRefs',
  'interfaceRefs',
  'requirementRefs',
  'acceptanceCriteriaRefs',
  'versionRefs',
];
const CATALOG_OBJECT_ENTRY_FIELDS = ['ownerRefs', 'entryRefs', 'scenarioRefs', 'versionRefs'];
const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\b(?:postgres(?:ql)?|mysql):\/\/[^\s]+/i,
  /\b(?:token|password|passwd|secret)\s*[:=]\s*["']?(?!redacted|unknown|missing)[A-Za-z0-9_+/.=-]{8,}/i,
];

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compactJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function issue(code, message, path = '$', severity = 'P1') {
  return { severity, code, path, message };
}

function fail(code, message, path = '$', issues = null) {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  if (issues) error.issues = issues;
  throw error;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function requireObject(value, path) {
  const result = objectValue(value);
  if (!result) fail('wiki-model-invalid', `${path} must be an object.`, path);
  return result;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) fail('wiki-model-invalid', `${path} must be an array.`, path);
  return value;
}

function requireText(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) fail('wiki-model-invalid', `${path} must be a non-empty string.`, path);
  return value;
}

function requireId(value, path) {
  const id = requireText(value, path);
  if (!ID_PATTERN.test(id)) fail('wiki-model-invalid', `${path} must match ${ID_PATTERN}.`, path);
  return id;
}

function requireEnum(value, allowed, path, code = 'wiki-model-invalid') {
  if (!allowed.has(value)) fail(code, `${path} has unsupported value: ${value}.`, path);
  return value;
}

function safeRelativePath(value, path) {
  const text = requireText(value, path).replaceAll('\\', '/');
  if (isAbsolute(value) || text === '.' || text === '..' || text.startsWith('../') || text.includes('/../') || text.includes('\0')) fail('wiki-path-invalid', `${path} must be a safe relative path.`, path);
  return posix.normalize(text.replace(/^\.\//, ''));
}

function safeFilename(value, id) {
  const name = String(value ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return name || id;
}

function refKind(ref) {
  return typeof ref === 'string' && ref.includes(':') ? ref.slice(0, ref.indexOf(':')) : null;
}

function refId(ref) {
  return typeof ref === 'string' && ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : null;
}

function normalizeFact(raw, path, evidenceById) {
  const fact = typeof raw === 'string' ? { text: raw, level: 'partial', evidenceIds: [] } : requireObject(raw, path);
  const normalized = {
    text: requireText(fact.text, `${path}.text`),
    level: requireEnum(fact.level, FACT_LEVELS, `${path}.level`),
    evidenceIds: [...new Set(requireArray(fact.evidenceIds ?? [], `${path}.evidenceIds`))].sort(),
  };
  for (const evidenceId of normalized.evidenceIds) if (!evidenceById.has(evidenceId)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${evidenceId}.`, `${path}.evidenceIds`);
  if (normalized.level === 'confirmed' && normalized.evidenceIds.length === 0) fail('wiki-confirmed-evidence-required', 'Confirmed Fact requires Evidence.', path);
  return normalized;
}

function normalizeFactField(value, path, evidenceById, field = '') {
  if (value === null || value === undefined) return value ?? null;
  if (field.endsWith('Ref') || field.endsWith('Refs') || ['sourceIdentity', 'dataSourceAssessment', 'gwt'].includes(field)) return structuredClone(value);
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string' || objectValue(item)?.text)) return value.map((item, index) => normalizeFact(item, `${path}[${index}]`, evidenceById));
    return structuredClone(value);
  }
  if (objectValue(value)?.text) return normalizeFact(value, path, evidenceById);
  return structuredClone(value);
}

function normalizeEvidence(rawEvidence, sourceKindById) {
  const byId = new Map();
  const evidence = requireArray(rawEvidence, '$.governance.evidence').map((raw, index) => {
    const path = `$.governance.evidence[${index}]`;
    const value = requireObject(raw, path);
    const id = requireId(value.id, `${path}.id`);
    if (byId.has(id)) fail('wiki-evidence-duplicate', `Duplicate Evidence: ${id}.`, `${path}.id`);
    const sourceId = requireId(value.sourceId, `${path}.sourceId`);
    const sourceKind = sourceKindById.get(sourceId);
    if (!sourceKind) fail('wiki-evidence-source-missing', `Unknown Evidence source: ${sourceId}.`, `${path}.sourceId`);
    const authority = requireText(value.authority, `${path}.authority`);
    if (!AUTHORITY_SOURCES.get(authority)?.has(sourceKind)) fail('wiki-evidence-authority-invalid', `${authority} is invalid for ${sourceKind}.`, `${path}.authority`);
    const permissionLayers = [...new Set(requireArray(value.permissionLayers ?? [], `${path}.permissionLayers`)
      .map((layer, layerIndex) => requireEnum(layer, PERMISSION_LAYERS, `${path}.permissionLayers[${layerIndex}]`)))];
    const precision = requireEnum(value.precision, EVIDENCE_PRECISIONS, `${path}.precision`);
    const normalized = {
      ...structuredClone(value),
      id,
      sourceId,
      authority,
      precision,
      permissionLayers: [...PERMISSION_LAYERS].filter((layer) => permissionLayers.includes(layer)),
      description: requireText(value.description, `${path}.description`),
    };
    if (value.path !== undefined) normalized.path = safeRelativePath(value.path, `${path}.path`);
    if (value.locator !== undefined) normalized.locator = requireText(value.locator, `${path}.locator`);
    if (!normalized.path && !normalized.locator) fail('wiki-evidence-locator-required', 'Evidence requires path or locator.', path);
    byId.set(id, normalized);
    return normalized;
  }).sort((left, right) => left.id.localeCompare(right.id));
  return { evidence, byId };
}

function artifactEvidenceExpectations(artifacts) {
  const byId = new Map();
  const add = (id, expected, path) => {
    const identity = JSON.stringify(expected);
    const prior = byId.get(id);
    if (prior && prior.identity !== identity) {
      fail('wiki-artifact-evidence-conflict', `Evidence ${id} is reused for a different fact, location, or execution surface.`, path);
    }
    if (!prior) byId.set(id, { identity, expected });
  };
  const codeLocation = (repository, locator) => {
    const relativePath = [repository.sourceRoot, locator.path].filter((part) => part && part !== '.').join('/').replaceAll(/\/{2,}/g, '/');
    const base = `code:${repository.id}:${relativePath}`;
    return locator.precision === 'file' ? base : `${base}:${locator.startLine}-${locator.endLine}`;
  };
  for (const artifact of artifacts) {
    if (artifact.kind === 'catalog-artifact') {
      for (const node of artifact.nodes) for (const id of node.evidenceIds) add(id, {
        sourceId: artifact.sourceId, authority: 'human-confirmation', precision: 'catalog-node',
        path: null, locator: `catalog:${node.id}`, permissionLayers: ['product'],
        factKind: null, artifactObjectRef: null, repositorySurface: null,
      }, `catalog:${node.id}.evidenceIds`);
    } else if (artifact.kind === 'code-artifact') {
      const repositories = new Map(artifact.repositories.map((repository) => [repository.id, repository]));
      for (const fact of artifact.facts) {
        const repository = repositories.get(fact.locator.repositoryId);
        const permissionLayers = repository.surface === 'frontend' && ['route', 'page', 'operation'].includes(fact.factKind) ? ['ui']
          : repository.surface === 'backend' && ['api', 'validation', 'operation'].includes(fact.factKind) ? ['api']
            : repository.surface === 'backend' && fact.factKind === 'database-usage' ? ['data'] : [];
        add(fact.evidenceId, {
          sourceId: artifact.sourceId,
          authority: fact.factKind === 'test' ? 'test-verification' : 'implementation-fact',
          precision: fact.locator.precision,
          path: null,
          locator: codeLocation(repository, fact.locator),
          permissionLayers,
          factKind: fact.factKind,
          artifactObjectRef: null,
          repositorySurface: repository.surface,
        }, `code-fact:${fact.id}`);
      }
    } else if (artifact.kind === 'requirement-artifact') {
      for (const item of artifact.items) if (item.evidenceId) add(item.evidenceId, {
        sourceId: artifact.sourceId, authority: 'requirement-statement', precision: 'requirement-item',
        path: null, locator: `requirement:${item.externalId}`, permissionLayers: ['product'],
        factKind: null, artifactObjectRef: null, repositorySurface: null,
      }, `requirement:${item.externalId}`);
    } else if (artifact.kind === 'database-artifact') {
      for (const collection of ['schemas', 'tables', 'views', 'columns', 'constraints', 'indexes', 'sequences', 'triggers', 'enums', 'accessControls']) {
        for (const item of artifact[collection] ?? []) add(item.evidenceId, {
          sourceId: artifact.sourceId, authority: 'data-structure-fact', precision: 'metadata-object',
          path: null, locator: `database:${artifact.environment}:${collection}:${item.id}`,
          permissionLayers: collection === 'accessControls' ? ['data'] : [], factKind: `database:${collection}`,
          artifactObjectRef: item.id, repositorySurface: null,
        }, `database:${collection}:${item.id}`);
      }
    } else if (artifact.kind === 'decision-artifact') {
      add(artifact.evidenceId, {
        sourceId: artifact.sourceId, authority: 'human-confirmation', precision: 'document',
        path: artifact.document.path, locator: null, permissionLayers: ['product'],
        factKind: null, artifactObjectRef: null, repositorySurface: null,
      }, `decision:${artifact.decision.decisionId}`);
    } else if (['spec-artifact', 'record-artifact', 'knowledge-artifact'].includes(artifact.kind)) {
      const authority = artifact.kind === 'spec-artifact' ? 'design-decision'
        : artifact.kind === 'record-artifact' ? 'runtime-observation' : 'implementation-fact';
      const documents = new Map((artifact.documents ?? []).map((document) => [document.id, document]));
      for (const statement of artifact.statements ?? []) add(statement.evidenceId, {
        sourceId: artifact.sourceId, authority, precision: 'document',
        path: documents.get(statement.documentId)?.path ?? null, locator: null, permissionLayers: [],
        factKind: statement.statementKind, artifactObjectRef: null, repositorySurface: null,
      }, `${artifact.kind}:${statement.id}`);
      for (const document of artifact.documents ?? []) if (!byId.has(document.evidenceId)) add(document.evidenceId, {
        sourceId: artifact.sourceId, authority, precision: 'document', path: document.path,
        locator: null, permissionLayers: [], factKind: null, artifactObjectRef: null, repositorySurface: null,
      }, `${artifact.kind}:${document.id}`);
    }
  }
  return byId;
}

function validateEvidenceAgainstArtifacts(evidence, artifacts) {
  const expectations = artifactEvidenceExpectations(artifacts);
  for (const item of evidence) {
    const expected = expectations.get(item.id)?.expected;
    if (!expected) fail('wiki-evidence-artifact-missing', `Evidence ${item.id} is not backed by a normalized Artifact fact.`, `evidence:${item.id}`);
    const actual = {
      sourceId: item.sourceId,
      authority: item.authority,
      precision: item.precision,
      path: item.path ?? null,
      locator: item.locator ?? null,
      permissionLayers: item.permissionLayers,
      factKind: item.factKind ?? null,
      artifactObjectRef: item.artifactObjectRef ?? null,
      repositorySurface: item.repositorySurface ?? null,
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail('wiki-evidence-artifact-mismatch', `Evidence ${item.id} does not match its Artifact fact, locator, or execution surface.`, `evidence:${item.id}`);
    }
  }
  for (const id of expectations.keys()) {
    if (!evidence.some((item) => item.id === id)) fail('wiki-artifact-evidence-unregistered', `Artifact Evidence ${id} is missing from canonical governance.`, `evidence:${id}`);
  }
}

function normalizeGap(rawGaps, evidenceById) {
  const byId = new Map();
  const gaps = requireArray(rawGaps ?? [], '$.governance.gaps').map((raw, index) => {
    const path = `$.governance.gaps[${index}]`;
    const value = requireObject(raw, path);
    const id = requireId(value.id, `${path}.id`);
    if (byId.has(id)) fail('wiki-gap-duplicate', `Duplicate Gap: ${id}.`, `${path}.id`);
    const normalized = {
      ...structuredClone(value),
      id,
      type: requireEnum(value.type, GAP_TYPES, `${path}.type`, 'wiki-gap-type-invalid'),
      audience: requireEnum(value.audience ?? 'product-review', new Set(['product-review', 'engineering-review', 'data-review', 'source-ops', 'internal']), `${path}.audience`),
      severity: requireEnum(value.severity ?? 'P1', new Set(['P0', 'P1', 'P2']), `${path}.severity`),
      status: validateGapStatus(value.status ?? 'open', `${path}.status`),
      description: requireText(value.description, `${path}.description`),
      subjectRefs: [...new Set(requireArray(value.subjectRefs ?? [], `${path}.subjectRefs`))].sort(),
      fieldRefs: [...new Set(requireArray(value.fieldRefs ?? [], `${path}.fieldRefs`))].sort(),
      evidenceIds: [...new Set(requireArray(value.evidenceIds ?? [], `${path}.evidenceIds`))].sort(),
      resolutionEvidenceIds: [...new Set(requireArray(value.resolutionEvidenceIds ?? [], `${path}.resolutionEvidenceIds`))].sort(),
      resolvedByDecisionId: value.resolvedByDecisionId === null || value.resolvedByDecisionId === undefined ? null : requireId(value.resolvedByDecisionId, `${path}.resolvedByDecisionId`),
      ...normalizeGapGuidance(value, path),
    };
    for (const idRef of normalized.evidenceIds) if (!evidenceById.has(idRef)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${idRef}.`, `${path}.evidenceIds`);
    for (const idRef of normalized.resolutionEvidenceIds) if (!evidenceById.has(idRef)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${idRef}.`, `${path}.resolutionEvidenceIds`);
    if (normalized.status === 'resolved' && normalized.resolutionEvidenceIds.length === 0) fail('wiki-gap-resolution-invalid', `Resolved Gap ${id} requires resolution Evidence.`, `${path}.resolutionEvidenceIds`);
    if (normalized.status === 'resolved' && normalized.resolutionMode !== 'evidence-required' && !normalized.resolvedByDecisionId) fail('wiki-gap-resolution-invalid', `Resolved Decision Gap ${id} requires a Decision ID.`, `${path}.resolvedByDecisionId`);
    byId.set(id, normalized);
    return normalized;
  }).sort((left, right) => left.id.localeCompare(right.id));
  return { gaps, byId };
}

function normalizeClaims(rawClaims, { evidenceById, refSet }) {
  const byId = new Map();
  const claims = requireArray(rawClaims, '$.governance.claims').map((raw, index) => {
    const path = `$.governance.claims[${index}]`;
    const value = requireObject(raw, path);
    const id = requireId(value.id, `${path}.id`);
    if (byId.has(id)) fail('wiki-claim-duplicate', `Duplicate Claim: ${id}.`, `${path}.id`);
    const subjectRef = requireText(value.subjectRef, `${path}.subjectRef`);
    if (!refSet.has(subjectRef)) fail('wiki-claim-subject-missing', `Unknown Claim subject: ${subjectRef}.`, `${path}.subjectRef`);
    const layer = requireEnum(value.layer, FACT_LAYERS, `${path}.layer`);
    const factLevel = requireEnum(value.factLevel, FACT_LEVELS, `${path}.factLevel`);
    const evidenceIds = [...new Set(requireArray(value.evidenceIds ?? [], `${path}.evidenceIds`))].sort();
    if (factLevel === 'confirmed' && evidenceIds.length === 0) fail('wiki-confirmed-evidence-required', `Confirmed Claim ${id} requires Evidence.`, path);
    for (const evidenceId of evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${evidenceId}.`, `${path}.evidenceIds`);
      if (!LAYER_AUTHORITIES.get(layer).has(evidence.authority)) fail('wiki-claim-layer-authority-invalid', `${evidence.authority} cannot support ${layer}.`, `${path}.evidenceIds`);
      const allowedSubjects = AUTHORITY_SUBJECT_KINDS.get(evidence.authority);
      if (allowedSubjects && !allowedSubjects.has(refKind(subjectRef))) {
        fail('wiki-evidence-authority-subject-invalid', `${evidence.authority} cannot support ${subjectRef}.`, `${path}.evidenceIds`);
      }
    }
    if (factLevel === 'confirmed' && ['current', 'observed'].includes(layer)
      && !evidenceIds.some((evidenceId) => evidenceById.get(evidenceId)?.precision !== 'file')) {
      fail('wiki-evidence-precision-invalid', `Confirmed ${layer} Claim ${id} requires precise Evidence.`, `${path}.evidenceIds`);
    }
    const normalized = {
      ...structuredClone(value), id, subjectRef, layer, factLevel, evidenceIds,
      text: requireText(value.text, `${path}.text`),
    };
    byId.set(id, normalized);
    return normalized;
  }).sort((left, right) => left.id.localeCompare(right.id));
  return { claims, byId };
}

function normalizeDataAssessment(value, path, evidenceById, gapById) {
  const assessment = requireObject(value, path);
  const applicability = requireEnum(assessment.applicability, DATA_APPLICABILITY, `${path}.applicability`);
  const reason = requireText(assessment.reason, `${path}.reason`);
  const evidenceIds = [...new Set(requireArray(assessment.evidenceIds ?? [], `${path}.evidenceIds`))].sort();
  const databaseSourceIds = [...new Set(requireArray(assessment.databaseSourceIds ?? [], `${path}.databaseSourceIds`))].sort();
  const gapIds = [...new Set(requireArray(assessment.gapIds ?? [], `${path}.gapIds`))].sort();
  evidenceIds.forEach((id) => { if (!evidenceById.has(id)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${id}.`, `${path}.evidenceIds`); });
  gapIds.forEach((id) => { if (!gapById.has(id)) fail('wiki-gap-reference-missing', `Unknown Gap: ${id}.`, `${path}.gapIds`); });
  if (applicability === 'not-applicable' && evidenceIds.length === 0) fail('wiki-data-assessment-evidence-required', 'not-applicable requires Evidence.', path);
  if (applicability === 'unknown' && gapIds.length === 0) fail('wiki-data-assessment-gap-required', 'unknown requires a Gap.', path);
  if (applicability === 'applicable' && databaseSourceIds.length === 0 && gapIds.length === 0) fail('wiki-data-assessment-gap-required', 'Applicable Feature without Database requires a Gap.', path);
  return { applicability, reason, evidenceIds, databaseSourceIds, gapIds };
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function fieldRefFor(nodeRef, field) {
  return `${nodeRef}.${field}`;
}

function hasFieldGap(context, nodeRef, field) {
  const target = fieldRefFor(nodeRef, field);
  return context.gapById && [...context.gapById.values()].some((gap) => gap.status === 'open'
    && gap.audience === 'product-review'
    && gap.subjectRefs.includes(nodeRef)
    && gap.fieldRefs.includes(target));
}

function normalizeStructuredEntries(value, path, context, requiredFields = []) {
  return requireArray(value, path).map((raw, index) => {
    const itemPath = `${path}[${index}]`;
    const item = requireObject(raw, itemPath);
    for (const field of [...requiredFields, 'claimIds', 'evidenceIds']) {
      if (!(field in item)) fail('wiki-object-field-required', `${itemPath} requires ${field}.`, `${itemPath}.${field}`);
    }
    const claimIds = [...new Set(requireArray(item.claimIds, `${itemPath}.claimIds`))].sort();
    const evidenceIds = [...new Set(requireArray(item.evidenceIds, `${itemPath}.evidenceIds`))].sort();
    if (claimIds.length === 0 || evidenceIds.length === 0) {
      fail('wiki-structured-entry-evidence-required', `${itemPath} requires non-empty Claim and Evidence references.`, itemPath);
    }
    for (const evidenceId of evidenceIds) {
      if (!context.evidenceById.has(evidenceId)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${evidenceId}.`, `${itemPath}.evidenceIds`);
    }
    return { ...structuredClone(item), claimIds, evidenceIds };
  });
}

function requirePositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) fail('wiki-flow-order-invalid', `${path} must be a positive integer.`, path);
  return value;
}

function assertUniqueFlowValues(items, key, path, code) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const value = item[key];
    if (seen.has(value)) fail(code, `Duplicate Flow ${key}: ${value}.`, `${path}[${index}].${key}`);
    seen.add(value);
  }
}

function normalizeFlowAssessment(value, path, context) {
  const assessment = requireObject(value, path);
  const applicability = requireEnum(assessment.applicability, FLOW_VIEW_APPLICABILITY, `${path}.applicability`);
  const reason = requireText(assessment.reason, `${path}.reason`);
  const evidenceIds = [...new Set(requireArray(assessment.evidenceIds ?? [], `${path}.evidenceIds`))].sort();
  const gapIds = [...new Set(requireArray(assessment.gapIds ?? [], `${path}.gapIds`))].sort();
  evidenceIds.forEach((id) => { if (!context.evidenceById.has(id)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${id}.`, `${path}.evidenceIds`); });
  gapIds.forEach((id) => { if (!context.gapById.has(id)) fail('wiki-gap-reference-missing', `Unknown Gap: ${id}.`, `${path}.gapIds`); });
  if (applicability === 'not-applicable' && evidenceIds.length === 0) fail('wiki-flow-assessment-evidence-required', 'not-applicable Flow view requires Evidence.', path);
  if (applicability === 'unknown' && gapIds.length === 0) fail('wiki-flow-assessment-gap-required', 'unknown Flow view requires a Gap.', path);
  return { applicability, reason, evidenceIds, gapIds };
}

function normalizeFlow(value, normalized, path, context) {
  normalized.phases = normalizeStructuredEntries(value.phases, `${path}.phases`, context, ['id', 'label', 'order'])
    .map((phase, index) => ({
      ...phase,
      id: requireId(phase.id, `${path}.phases[${index}].id`),
      label: requireText(phase.label, `${path}.phases[${index}].label`),
      order: requirePositiveInteger(phase.order, `${path}.phases[${index}].order`),
    }));
  assertUniqueFlowValues(normalized.phases, 'id', `${path}.phases`, 'wiki-flow-phase-duplicate');
  assertUniqueFlowValues(normalized.phases, 'order', `${path}.phases`, 'wiki-flow-phase-order-duplicate');
  const phaseIds = new Set(normalized.phases.map((phase) => phase.id));

  normalized.lanes = normalizeStructuredEntries(value.lanes, `${path}.lanes`, context, ['id', 'label', 'laneType', 'order'])
    .map((lane, index) => ({
      ...lane,
      id: requireId(lane.id, `${path}.lanes[${index}].id`),
      label: requireText(lane.label, `${path}.lanes[${index}].label`),
      laneType: requireEnum(lane.laneType, FLOW_LANE_TYPES, `${path}.lanes[${index}].laneType`),
      order: requirePositiveInteger(lane.order, `${path}.lanes[${index}].order`),
    }));
  assertUniqueFlowValues(normalized.lanes, 'id', `${path}.lanes`, 'wiki-flow-lane-duplicate');
  assertUniqueFlowValues(normalized.lanes, 'order', `${path}.lanes`, 'wiki-flow-lane-order-duplicate');
  const laneById = new Map(normalized.lanes.map((lane) => [lane.id, lane]));

  normalized.nodes = normalizeStructuredEntries(value.nodes, `${path}.nodes`, context, ['id', 'label', 'laneId', 'phaseId', 'nodeType'])
    .map((node, index) => {
      const itemPath = `${path}.nodes[${index}]`;
      const result = {
        ...node,
        id: requireId(node.id, `${itemPath}.id`),
        label: requireText(node.label, `${itemPath}.label`),
        laneId: requireId(node.laneId, `${itemPath}.laneId`),
        phaseId: requireId(node.phaseId, `${itemPath}.phaseId`),
        nodeType: requireEnum(node.nodeType, FLOW_NODE_TYPES, `${itemPath}.nodeType`),
      };
      if (!laneById.has(result.laneId)) fail('wiki-flow-lane-reference-missing', `Unknown Flow lane: ${result.laneId}.`, `${itemPath}.laneId`);
      if (!phaseIds.has(result.phaseId)) fail('wiki-flow-phase-reference-missing', `Unknown Flow phase: ${result.phaseId}.`, `${itemPath}.phaseId`);
      return result;
    });
  assertUniqueFlowValues(normalized.nodes, 'id', `${path}.nodes`, 'wiki-flow-node-duplicate');
  const nodeById = new Map(normalized.nodes.map((node) => [node.id, node]));

  normalized.edges = normalizeStructuredEntries(value.edges, `${path}.edges`, context, ['id', 'from', 'to', 'label', 'pathType', 'interactionType', 'condition'])
    .map((edge, index) => {
      const itemPath = `${path}.edges[${index}]`;
      const result = {
        ...edge,
        id: requireId(edge.id, `${itemPath}.id`),
        from: requireId(edge.from, `${itemPath}.from`),
        to: requireId(edge.to, `${itemPath}.to`),
        label: requireText(edge.label, `${itemPath}.label`),
        pathType: requireEnum(edge.pathType, FLOW_PATH_TYPES, `${itemPath}.pathType`),
        interactionType: requireEnum(edge.interactionType, FLOW_INTERACTION_TYPES, `${itemPath}.interactionType`),
        condition: requireText(edge.condition, `${itemPath}.condition`),
      };
      if (!nodeById.has(result.from) || !nodeById.has(result.to)) fail('wiki-flow-reference-missing', 'Flow edge endpoints must exist in the same Flow.', itemPath);
      if (result.from === result.to) fail('wiki-flow-edge-self-invalid', 'Flow edge cannot point to itself.', itemPath);
      return result;
    });
  assertUniqueFlowValues(normalized.edges, 'id', `${path}.edges`, 'wiki-flow-edge-duplicate');
  const edgeById = new Map(normalized.edges.map((edge) => [edge.id, edge]));

  const interaction = requireObject(value.interaction, `${path}.interaction`);
  const sequenceGroups = normalizeStructuredEntries(interaction.sequenceGroups, `${path}.interaction.sequenceGroups`, context, ['id', 'label', 'phaseId', 'pathType', 'order'])
    .map((group, index) => {
      const itemPath = `${path}.interaction.sequenceGroups[${index}]`;
      const result = {
        ...group,
        id: requireId(group.id, `${itemPath}.id`),
        label: requireText(group.label, `${itemPath}.label`),
        phaseId: requireId(group.phaseId, `${itemPath}.phaseId`),
        pathType: requireEnum(group.pathType, FLOW_PATH_TYPES, `${itemPath}.pathType`),
        order: requirePositiveInteger(group.order, `${itemPath}.order`),
      };
      if (!phaseIds.has(result.phaseId)) fail('wiki-flow-phase-reference-missing', `Unknown Flow phase: ${result.phaseId}.`, `${itemPath}.phaseId`);
      return result;
    });
  assertUniqueFlowValues(sequenceGroups, 'id', `${path}.interaction.sequenceGroups`, 'wiki-flow-sequence-group-duplicate');
  assertUniqueFlowValues(sequenceGroups, 'order', `${path}.interaction.sequenceGroups`, 'wiki-flow-sequence-group-order-duplicate');
  const groupById = new Map(sequenceGroups.map((group) => [group.id, group]));

  const participantCompatibility = new Map([
    ['actor', new Set(['actor'])],
    ['frontend', new Set(['frontend'])],
    ['primary-system', new Set(['service'])],
    ['collaborating-system', new Set(['service'])],
    ['external-system', new Set(['external-system'])],
    ['async-infrastructure', new Set(['message-bus', 'scheduler'])],
  ]);
  const participantIdentities = new Set();
  const participants = normalizeStructuredEntries(interaction.participants, `${path}.interaction.participants`, context, ['id', 'participantType', 'order'])
    .map((participant, index) => {
      const itemPath = `${path}.interaction.participants[${index}]`;
      const result = {
        ...participant,
        id: requireId(participant.id, `${itemPath}.id`),
        participantType: requireEnum(participant.participantType, FLOW_PARTICIPANT_TYPES, `${itemPath}.participantType`),
        order: requirePositiveInteger(participant.order, `${itemPath}.order`),
      };
      const hasLane = typeof result.laneId === 'string' && result.laneId.length > 0;
      const hasIndependentIdentity = typeof result.subjectRef === 'string' && result.subjectRef.length > 0
        && typeof result.label === 'string' && result.label.trim().length > 0;
      if (hasLane === hasIndependentIdentity) fail('wiki-flow-participant-identity-invalid', 'Flow participant requires exactly one laneId or subjectRef + label identity.', itemPath);
      if (hasLane) {
        const lane = laneById.get(result.laneId);
        if (!lane) fail('wiki-flow-lane-reference-missing', `Unknown Flow lane: ${result.laneId}.`, `${itemPath}.laneId`);
        if (!participantCompatibility.get(lane.laneType)?.has(result.participantType)) fail('wiki-flow-participant-type-invalid', `${result.participantType} is incompatible with lane type ${lane.laneType}.`, `${itemPath}.participantType`);
        if ('label' in result || 'subjectRef' in result) fail('wiki-flow-participant-identity-invalid', 'Lane participant derives label and subjectRef from its lane.', itemPath);
        const identityKey = `lane:${result.laneId}`;
        if (participantIdentities.has(identityKey)) fail('wiki-flow-participant-duplicate', `Duplicate Flow participant identity: ${identityKey}.`, itemPath);
        participantIdentities.add(identityKey);
      } else {
        if (result.participantType !== 'datastore') fail('wiki-flow-participant-identity-invalid', 'Only datastore may use an independent participant identity.', itemPath);
        result.subjectRef = requireText(result.subjectRef, `${itemPath}.subjectRef`);
        result.label = requireText(result.label, `${itemPath}.label`);
        const identityKey = `subject:${result.subjectRef}`;
        if (participantIdentities.has(identityKey)) fail('wiki-flow-participant-duplicate', `Duplicate Flow participant identity: ${identityKey}.`, itemPath);
        participantIdentities.add(identityKey);
      }
      return result;
    });
  assertUniqueFlowValues(participants, 'id', `${path}.interaction.participants`, 'wiki-flow-participant-duplicate');
  assertUniqueFlowValues(participants, 'order', `${path}.interaction.participants`, 'wiki-flow-participant-order-duplicate');
  const participantById = new Map(participants.map((participant) => [participant.id, participant]));

  const messages = normalizeStructuredEntries(interaction.messages, `${path}.interaction.messages`, context, ['id', 'groupId', 'from', 'to', 'order', 'label', 'messageType', 'ruleRefs'])
    .map((message, index) => {
      const itemPath = `${path}.interaction.messages[${index}]`;
      const result = {
        ...message,
        id: requireId(message.id, `${itemPath}.id`),
        groupId: requireId(message.groupId, `${itemPath}.groupId`),
        from: requireId(message.from, `${itemPath}.from`),
        to: requireId(message.to, `${itemPath}.to`),
        order: requirePositiveInteger(message.order, `${itemPath}.order`),
        label: requireText(message.label, `${itemPath}.label`),
        messageType: requireEnum(message.messageType, FLOW_MESSAGE_TYPES, `${itemPath}.messageType`),
        ruleRefs: [...new Set(requireArray(message.ruleRefs, `${itemPath}.ruleRefs`))].sort(),
      };
      if (!groupById.has(result.groupId)) fail('wiki-flow-sequence-group-reference-missing', `Unknown Flow sequence group: ${result.groupId}.`, `${itemPath}.groupId`);
      if (!participantById.has(result.from) || !participantById.has(result.to)) fail('wiki-flow-participant-reference-missing', 'Flow message participants must exist in the same Interaction.', itemPath);
      if (result.from === result.to) fail('wiki-flow-message-self-invalid', 'Flow message cannot point to itself.', itemPath);
      if (result.edgeRef !== undefined) {
        const edge = edgeById.get(result.edgeRef);
        if (!edge) fail('wiki-flow-edge-reference-missing', `Unknown Flow edge: ${result.edgeRef}.`, `${itemPath}.edgeRef`);
        const fromLane = participantById.get(result.from).laneId;
        const toLane = participantById.get(result.to).laneId;
        if (!fromLane || !toLane || nodeById.get(edge.from)?.laneId !== fromLane || nodeById.get(edge.to)?.laneId !== toLane) {
          fail('wiki-flow-message-edge-direction-invalid', 'Flow message participant lanes must match its edge direction.', `${itemPath}.edgeRef`);
        }
      }
      return result;
    });
  assertUniqueFlowValues(messages, 'id', `${path}.interaction.messages`, 'wiki-flow-message-duplicate');
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const messagesByGroup = new Map();
  for (const message of messages) {
    if (!messagesByGroup.has(message.groupId)) messagesByGroup.set(message.groupId, []);
    messagesByGroup.get(message.groupId).push(message);
  }
  for (const [groupId, groupMessages] of messagesByGroup) {
    assertUniqueFlowValues(groupMessages, 'order', `${path}.interaction.messages(${groupId})`, 'wiki-flow-message-order-duplicate');
    const ordered = [...groupMessages].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    for (const message of ordered) {
      if (message.messageType === 'response') {
        const request = ordered.find((candidate) => candidate.order < message.order && candidate.messageType === 'request'
          && candidate.from === message.to && candidate.to === message.from);
        if (!request) fail('wiki-flow-response-cause-missing', 'Flow response requires a preceding reverse request in the same sequence group.', `${path}.interaction.messages.${message.id}`);
      }
      if (message.messageType === 'callback') {
        const cause = messageById.get(message.causationMessageRef);
        if (!cause || cause.groupId !== message.groupId || cause.order >= message.order) fail('wiki-flow-callback-cause-invalid', 'Flow callback requires an earlier causationMessageRef in the same sequence group.', `${path}.interaction.messages.${message.id}.causationMessageRef`);
      }
    }
  }
  normalized.interaction = { sequenceGroups, participants, messages };

  const assessments = requireObject(value.viewAssessments, `${path}.viewAssessments`);
  if (Object.keys(assessments).some((key) => !['state', 'sequence'].includes(key))) fail('wiki-flow-assessment-view-invalid', 'Flow viewAssessments supports only state and sequence.', `${path}.viewAssessments`);
  normalized.viewAssessments = {
    state: normalizeFlowAssessment(assessments.state, `${path}.viewAssessments.state`, context),
    sequence: normalizeFlowAssessment(assessments.sequence, `${path}.viewAssessments.sequence`, context),
  };
  if (normalized.viewAssessments.state.applicability === 'applicable' && normalized.stateMachineRefs.length === 0) fail('wiki-flow-state-reference-required', 'Applicable Flow state view requires stateMachineRefs.', `${path}.stateMachineRefs`);
  if (normalized.viewAssessments.state.applicability === 'not-applicable' && normalized.stateMachineRefs.length > 0) fail('wiki-flow-state-reference-invalid', 'not-applicable Flow state view cannot reference State Machines.', `${path}.stateMachineRefs`);
  if (normalized.viewAssessments.sequence.applicability === 'applicable' && (sequenceGroups.length === 0 || messages.length === 0)) fail('wiki-flow-sequence-required', 'Applicable Flow sequence view requires sequence groups and messages.', `${path}.interaction`);
  if (normalized.viewAssessments.sequence.applicability === 'not-applicable' && (sequenceGroups.length > 0 || participants.length > 0 || messages.length > 0)) fail('wiki-flow-sequence-invalid', 'not-applicable Flow sequence view cannot contain Interaction entries.', `${path}.interaction`);
  return normalized;
}

function normalizeNode(raw, expectedKind, path, context) {
  const value = requireObject(raw, path);
  const id = requireId(value.id, `${path}.id`);
  const kind = requireText(value.kind, `${path}.kind`);
  if (kind !== expectedKind) fail('wiki-object-kind-invalid', `${path}.kind must equal ${expectedKind}.`, `${path}.kind`);
  const normalized = {
    ...structuredClone(value),
    id,
    kind,
    name: requireText(value.name, `${path}.name`),
    status: requireEnum(value.status, OBJECT_STATUSES, `${path}.status`),
    ownerRefs: [...new Set(requireArray(value.ownerRefs ?? [], `${path}.ownerRefs`))].sort(),
    subjectRefs: [...new Set(requireArray(value.subjectRefs ?? [], `${path}.subjectRefs`))].sort(),
    relationRefs: [...new Set(requireArray(value.relationRefs ?? [], `${path}.relationRefs`))].sort(),
    claimIds: [...new Set(requireArray(value.claimIds ?? [], `${path}.claimIds`))].sort(),
    evidenceIds: [...new Set(requireArray(value.evidenceIds ?? [], `${path}.evidenceIds`))].sort(),
    gapIds: [...new Set(requireArray(value.gapIds ?? [], `${path}.gapIds`))].sort(),
    confirmedEmptyFields: [...new Set(requireArray(value.confirmedEmptyFields ?? [], `${path}.confirmedEmptyFields`))].sort(),
    versionRefs: [...new Set(requireArray(value.versionRefs ?? [], `${path}.versionRefs`))].sort(),
    order: Number.isInteger(value.order) ? value.order : fail('wiki-object-order-invalid', `${path}.order must be an integer.`, `${path}.order`),
  };
  const nodeRef = `${kind}:${id}`;
  for (const field of normalized.confirmedEmptyFields) {
    if (!(REQUIRED_FIELDS.get(kind) ?? []).includes(field)) {
      fail('wiki-confirmed-empty-field-invalid', `${nodeRef}.${field} is not a governed required field.`, `${path}.confirmedEmptyFields`);
    }
    if (!isEmptyValue(value[field])) {
      fail('wiki-confirmed-empty-field-invalid', `${nodeRef}.${field} is declared empty but contains a value.`, `${path}.${field}`);
    }
  }
  if (normalized.confirmedEmptyFields.length > 0 && normalized.evidenceIds.length === 0) {
    fail('wiki-confirmed-empty-evidence-required', `${nodeRef} requires Evidence for confirmed empty fields.`, `${path}.evidenceIds`);
  }
  for (const field of REQUIRED_FIELDS.get(kind) ?? []) {
    if (!(field in value)) fail('wiki-object-field-required', `${kind} requires ${field}.`, `${path}.${field}`);
    const structurallyNullable = (kind === 'system' && field === 'parentRef')
      || (kind === 'feature' && field === 'requirementRefs')
      || (kind === 'feature' && OPTIONAL_FEATURE_REFERENCE_FIELDS.has(field))
      || (kind === 'feature' && field === 'operationRefs'
        && hasFieldGap(context, nodeRef, 'acceptanceCriteriaRefs'))
      || (kind === 'acceptance-criteria' && ['requirementRef', 'decisionId'].includes(field));
    if (isEmptyValue(value[field]) && !structurallyNullable
      && !normalized.confirmedEmptyFields.includes(field) && !hasFieldGap(context, nodeRef, field)) {
      if (kind === 'flow' && field === 'stateMachineRefs'
        && ['not-applicable', 'unknown'].includes(value.viewAssessments?.state?.applicability)) {
        normalized[field] = normalizeFactField(value[field], `${path}.${field}`, context.evidenceById, field);
        continue;
      }
      fail('wiki-object-field-gap-required', `${kind}.${field} is empty and requires a Gap.`, `${path}.${field}`);
    }
    normalized[field] = normalizeFactField(value[field], `${path}.${field}`, context.evidenceById, field);
  }
  normalized.evidenceIds.forEach((ref) => { if (!context.evidenceById.has(ref)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${ref}.`, `${path}.evidenceIds`); });
  normalized.gapIds.forEach((ref) => { if (!context.gapById.has(ref)) fail('wiki-gap-reference-missing', `Unknown Gap: ${ref}.`, `${path}.gapIds`); });
  if (kind === 'feature') normalized.dataSourceAssessment = normalizeDataAssessment(value.dataSourceAssessment, `${path}.dataSourceAssessment`, context.evidenceById, context.gapById);
  if (kind === 'permission') {
    normalized.rows = normalizeStructuredEntries(value.rows, `${path}.rows`, context, ['roleRef', 'resourceRef', 'action', 'dataScope', 'condition', 'decision', 'enforcementLayer']);
    const layerByEvidenceId = new Map();
    normalized.rows.forEach((row, index) => {
      requireEnum(row.enforcementLayer, PERMISSION_LAYERS, `${path}.rows[${index}].enforcementLayer`);
      for (const evidenceId of row.evidenceIds) {
        const evidence = context.evidenceById.get(evidenceId);
        if (!evidence.permissionLayers.includes(row.enforcementLayer)) {
          fail('wiki-permission-evidence-layer-invalid', `${evidenceId} does not support Permission layer ${row.enforcementLayer}.`, `${path}.rows[${index}].evidenceIds`);
        }
        const priorLayer = layerByEvidenceId.get(evidenceId);
        if (priorLayer && priorLayer !== row.enforcementLayer) {
          fail('wiki-permission-evidence-layer-conflict', `${evidenceId} cannot be reused across Permission layers ${priorLayer} and ${row.enforcementLayer}.`, `${path}.rows[${index}].evidenceIds`);
        }
        layerByEvidenceId.set(evidenceId, row.enforcementLayer);
      }
    });
  }
  if (kind === 'flow') {
    normalizeFlow(value, normalized, path, context);
  }
  if (kind === 'state-machine') {
    normalized.stateMode = isEmptyValue(value.stateMode) && hasFieldGap(context, nodeRef, 'stateMode')
      ? null
      : requireEnum(value.stateMode, new Set(['persisted', 'derived', 'external', 'composite']), `${path}.stateMode`);
    normalized.completeness = requireEnum(value.completeness, new Set(['complete', 'partial', 'unknown']), `${path}.completeness`);
    normalized.states = normalizeStructuredEntries(value.states, `${path}.states`, context, ['id', 'label']);
    normalized.transitions = normalizeStructuredEntries(value.transitions, `${path}.transitions`, context, ['from', 'to', 'trigger']);
    const stateIds = new Set();
    for (const state of normalized.states) {
      const stateId = requireId(state.id, `${path}.states.id`);
      if (stateIds.has(stateId)) fail('wiki-state-duplicate', `Duplicate State: ${stateId}.`, `${path}.states`);
      stateIds.add(stateId);
    }
    for (const [index, transition] of normalized.transitions.entries()) {
      if (!stateIds.has(transition.from) || !stateIds.has(transition.to)) {
        fail('wiki-state-reference-missing', 'State transition endpoints must exist in the same State Machine.', `${path}.transitions[${index}]`);
      }
      if (transition.from === transition.to) fail('wiki-state-transition-self-invalid', 'State transition cannot point to itself.', `${path}.transitions[${index}]`);
    }
    if (normalized.completeness === 'complete' && normalized.unresolvedTransitions.length > 0) {
      fail('wiki-state-completeness-invalid', 'Complete State Machine cannot contain unresolved transitions.', path);
    }
  }
  if (kind === 'data-entity') {
    normalized.fieldCoverage = requireEnum(value.fieldCoverage, new Set(['complete', 'partial', 'unknown']), `${path}.fieldCoverage`);
    normalized.fields = normalizeStructuredEntries(value.fields, `${path}.fields`, context, ['name', 'type', 'nullable', 'columnRef']);
    normalized.constraints = normalizeStructuredEntries(value.constraints, `${path}.constraints`, context, ['name', 'type', 'databaseRef']);
    normalized.indexes = normalizeStructuredEntries(value.indexes, `${path}.indexes`, context, ['name', 'columnRefs', 'unique', 'databaseRef']);
    if (normalized.fields.some((field) => isEmptyValue(field.businessMeaning)) && !hasFieldGap(context, nodeRef, 'fields.businessMeaning')) {
      fail('wiki-object-field-gap-required', `${nodeRef} has fields without business meaning and requires a field Gap.`, `${path}.fields`);
    }
  }
  if (kind === 'metric') {
    normalized.metricType = isEmptyValue(value.metricType) && hasFieldGap(context, nodeRef, 'metricType')
      ? null
      : requireEnum(value.metricType, METRIC_TYPES, `${path}.metricType`);
  }
  if (kind === 'interface') {
    normalized.errors = normalizeStructuredEntries(value.errors, `${path}.errors`, context, ['code']);
    normalized.endpoints = normalizeStructuredEntries(value.endpoints, `${path}.endpoints`, context, ['id', 'name', 'method', 'path', 'auth', 'request', 'response', 'errors', 'idempotency'])
      .map((endpoint, index) => ({
        ...endpoint,
        id: requireId(endpoint.id, `${path}.endpoints[${index}].id`),
        name: requireText(endpoint.name, `${path}.endpoints[${index}].name`),
        method: requireEnum(String(endpoint.method).toUpperCase(), HTTP_METHODS, `${path}.endpoints[${index}].method`),
        path: requireText(endpoint.path, `${path}.endpoints[${index}].path`),
        auth: requireText(endpoint.auth, `${path}.endpoints[${index}].auth`),
        request: requireText(endpoint.request, `${path}.endpoints[${index}].request`),
        response: requireText(endpoint.response, `${path}.endpoints[${index}].response`),
        idempotency: requireText(endpoint.idempotency, `${path}.endpoints[${index}].idempotency`),
        errors: normalizeStructuredEntries(endpoint.errors, `${path}.endpoints[${index}].errors`, context, ['code', 'condition', 'meaning'])
          .map((error, errorIndex) => ({
            ...error,
            code: requireText(error.code, `${path}.endpoints[${index}].errors[${errorIndex}].code`),
            condition: requireText(error.condition, `${path}.endpoints[${index}].errors[${errorIndex}].condition`),
            meaning: requireText(error.meaning, `${path}.endpoints[${index}].errors[${errorIndex}].meaning`),
          })),
      }));
    if (normalized.endpoints.some((endpoint) => endpoint.errors.length === 0) && !hasFieldGap(context, nodeRef, 'errors')) {
      fail('wiki-object-field-gap-required', `${nodeRef} has Endpoints without confirmed error semantics and requires an errors Gap.`, `${path}.endpoints`);
    }
  }
  if (kind === 'requirement') {
    normalized.scopeType = isEmptyValue(value.scopeType) && hasFieldGap(context, nodeRef, 'scopeType')
      ? null
      : requireEnum(value.scopeType, REQUIREMENT_SCOPE_TYPES, `${path}.scopeType`);
  }
  if (kind === 'acceptance-criteria') {
    normalized.criterionType = requireEnum(value.criterionType, new Set(['normal', 'boundary', 'failure']), `${path}.criterionType`);
    normalized.given = requireArray(value.given, `${path}.given`).map((item, index) => requireText(item, `${path}.given[${index}]`));
    normalized.when = requireText(value.when, `${path}.when`);
    normalized.then = requireArray(value.then, `${path}.then`).map((item, index) => requireText(item, `${path}.then[${index}]`));
    if (normalized.given.length === 0 || normalized.then.length === 0) {
      fail('wiki-acceptance-criterion-invalid', 'Atomic Acceptance Criteria requires non-empty given[] and then[].', path);
    }
    normalized.requirementRef = value.requirementRef === null ? null : requireText(value.requirementRef, `${path}.requirementRef`);
    normalized.decisionId = value.decisionId === null ? null : requireId(value.decisionId, `${path}.decisionId`);
    if (!normalized.requirementRef && !normalized.decisionId) {
      fail('wiki-acceptance-source-required', 'Atomic Acceptance Criteria requires requirementRef or decisionId.', path);
    }
  }
  return normalized;
}

function normalizeCatalogAndObjects(input, context) {
  const catalogInput = requireObject(input.catalog, '$.catalog');
  const objectsInput = requireObject(input.objects, '$.objects');
  const catalog = {};
  const objects = {};
  const byRef = new Map();
  for (const [property, kind] of CATALOG_KINDS) {
    catalog[property] = requireArray(catalogInput[property], `$.catalog.${property}`).map((value, index) => normalizeNode(value, kind, `$.catalog.${property}[${index}]`, context));
  }
  for (const [property, kind] of OBJECT_KINDS) {
    objects[property] = requireArray(objectsInput[property] ?? [], `$.objects.${property}`).map((value, index) => normalizeNode(value, kind, `$.objects.${property}[${index}]`, context));
  }
  for (const value of [...Object.values(catalog).flat(), ...Object.values(objects).flat()]) {
    const ref = `${value.kind}:${value.id}`;
    if (byRef.has(ref)) fail('wiki-object-duplicate', `Duplicate object reference: ${ref}.`, ref);
    byRef.set(ref, value);
  }
  const catalogArtifact = context.artifacts.find((artifact) => artifact.kind === 'catalog-artifact');
  if (!catalogArtifact) fail('wiki-catalog-artifact-required', 'A Catalog Artifact is required.', '$.artifacts');
  const artifactNodes = new Map(catalogArtifact.nodes.map((node) => [`${node.kind}:${node.id}`, node]));
  for (const value of Object.values(catalog).flat()) {
    const ref = `${value.kind}:${value.id}`;
    const artifactNode = artifactNodes.get(ref);
    if (!artifactNode) fail('wiki-catalog-authority-invalid', `${ref} does not exist in the Catalog Artifact.`, ref);
    const expectedParentRef = artifactNode.parentId ? `${artifactNodes.get(`${value.kind === 'domain' ? 'system' : value.kind === 'module' ? 'domain' : 'module'}:${artifactNode.parentId}`)?.kind ?? refKind(value.parentRef)}:${artifactNode.parentId}` : null;
    if (value.parentRef !== expectedParentRef) fail('wiki-catalog-parent-invalid', `${ref} parentRef does not match Catalog Artifact.`, `${ref}.parentRef`);
  }
  return { catalog, objects, byRef };
}

function relationId(from, type, to) {
  return `rel-${createHash('sha256').update(`${from}\0${type}\0${to}`).digest('hex').slice(0, 16)}`;
}

function normalizeRelationships(rawRelationships, context) {
  const seen = new Set();
  const relationships = requireArray(rawRelationships, '$.relationships').map((raw, index) => {
    const path = `$.relationships[${index}]`;
    const value = requireObject(raw, path);
    const from = requireText(value.from, `${path}.from`);
    const to = requireText(value.to, `${path}.to`);
    const type = requireText(value.type, `${path}.type`);
    const fromNode = context.byRef.get(from);
    const toNode = context.byRef.get(to);
    if (!fromNode || !toNode) fail('wiki-relationship-reference-missing', `Relationship ${from} -> ${to} references an unknown object.`, path);
    const rule = RELATION_TYPES.get(type);
    if (!rule) fail('wiki-relationship-type-invalid', `Unsupported relationship type: ${type}.`, `${path}.type`);
    if (from === to) fail('wiki-relationship-self-invalid', 'Relationship cannot point to itself.', path);
    const pair = `${fromNode.kind}:${toNode.kind}`;
    if (rule.pairs ? !rule.pairs.has(pair) : rule.from && (!rule.from.has(fromNode.kind) || !rule.to.has(toNode.kind))) fail('wiki-relationship-direction-invalid', `${type} does not allow ${pair}.`, path);
    if (rule.sameKind && fromNode.kind !== toNode.kind) fail('wiki-relationship-direction-invalid', `${type} requires the same kind.`, path);
    const key = `${from}\0${type}\0${to}`;
    if (seen.has(key)) fail('wiki-relationship-duplicate', `Duplicate relationship: ${from} ${type} ${to}.`, path);
    seen.add(key);
    const id = relationId(from, type, to);
    if (value.id !== id) fail('wiki-relationship-id-invalid', `Relationship ID must equal ${id}.`, `${path}.id`);
    const claimIds = [...new Set(requireArray(value.claimIds, `${path}.claimIds`))].sort();
    const evidenceIds = [...new Set(requireArray(value.evidenceIds, `${path}.evidenceIds`))].sort();
    if (claimIds.length === 0 || evidenceIds.length === 0) fail('wiki-relationship-evidence-required', 'Relationship requires Claim and Evidence references.', path);
    claimIds.forEach((ref) => { if (!context.claimById.has(ref)) fail('wiki-claim-reference-missing', `Unknown Claim: ${ref}.`, `${path}.claimIds`); });
    evidenceIds.forEach((ref) => { if (!context.evidenceById.has(ref)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${ref}.`, `${path}.evidenceIds`); });
    return { id, from, type, to, claimIds, evidenceIds };
  }).sort((left, right) => left.from.localeCompare(right.from) || left.type.localeCompare(right.type) || left.to.localeCompare(right.to));
  for (const relation of relationships) {
    for (const ref of [relation.from, relation.to]) {
      const node = context.byRef.get(ref);
      if (!node.relationRefs.includes(relation.id)) fail('wiki-relationship-object-join-missing', `${ref} must reference ${relation.id}.`, `${ref}.relationRefs`);
    }
  }
  const acyclicTypes = new Set(['contains', 'supersedes']);
  for (const type of acyclicTypes) {
    const edges = relationships.filter((item) => item.type === type);
    const adjacency = new Map();
    edges.forEach((edge) => { if (!adjacency.has(edge.from)) adjacency.set(edge.from, []); adjacency.get(edge.from).push(edge.to); });
    const visit = (node, stack = new Set()) => {
      if (stack.has(node)) fail('wiki-relationship-cycle', `${type} relationship cycle detected at ${node}.`, node);
      const nextStack = new Set(stack).add(node);
      for (const next of adjacency.get(node) ?? []) visit(next, nextStack);
    };
    for (const node of adjacency.keys()) visit(node);
  }
  for (const node of [...Object.values(context.catalog).flat()].filter((item) => item.kind !== 'system')) {
    const expected = relationships.find((item) => item.type === 'contains' && item.to === `${node.kind}:${node.id}` && item.from === node.parentRef);
    if (!expected) fail('wiki-catalog-relationship-missing', `Catalog node ${node.kind}:${node.id} requires a contains relationship.`, `${node.kind}:${node.id}`);
  }
  return relationships;
}

function validateObjectReferences(context) {
  const knownRef = (value) => context.byRef.has(value)
    || (SOURCE_KINDS.has(refKind(value)) && context.sourceIds?.has(refId(value)));
  const claimLevel = (entry, layer) => {
    const levels = entry.claimIds.map((id) => context.claimById.get(id)).filter((claim) => claim?.layer === layer).map((claim) => claim.factLevel);
    if (levels.includes('needs-review')) return 'needs-review';
    if (levels.includes('partial')) return 'partial';
    return levels.includes('confirmed') ? 'confirmed' : null;
  };
  const usableFact = (entry, layer) => ['confirmed', 'partial'].includes(claimLevel(entry, layer));
  for (const node of context.byRef.values()) {
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith('Ref') && value !== null && typeof value === 'string' && value.includes(':') && !knownRef(value)) fail('wiki-object-reference-missing', `Unknown object reference: ${value}.`, `${node.kind}:${node.id}.${key}`);
      if (key.endsWith('Refs') && Array.isArray(value)) for (const ref of value) if (typeof ref === 'string' && ref.includes(':') && !knownRef(ref)) fail('wiki-object-reference-missing', `Unknown object reference: ${ref}.`, `${node.kind}:${node.id}.${key}`);
    }
    node.claimIds.forEach((id) => { if (!context.claimById.has(id)) fail('wiki-claim-reference-missing', `Unknown Claim: ${id}.`, `${node.kind}:${node.id}.claimIds`); });
    const structuredEntries = node.kind === 'permission' ? node.rows
      : node.kind === 'flow' ? [
          ...node.phases,
          ...node.lanes,
          ...node.nodes,
          ...node.edges,
          ...node.interaction.sequenceGroups,
          ...node.interaction.participants,
          ...node.interaction.messages,
        ]
        : node.kind === 'state-machine' ? [...node.states, ...node.transitions]
          : node.kind === 'data-entity' ? [...node.fields, ...node.constraints, ...node.indexes]
            : node.kind === 'interface' ? [...node.errors, ...node.endpoints, ...node.endpoints.flatMap((endpoint) => endpoint.errors)] : [];
    for (const entry of structuredEntries) {
      entry.claimIds.forEach((id) => { if (!context.claimById.has(id)) fail('wiki-claim-reference-missing', `Unknown Claim: ${id}.`, `${node.kind}:${node.id}`); });
      entry.evidenceIds.forEach((id) => { if (!context.evidenceById.has(id)) fail('wiki-evidence-reference-missing', `Unknown Evidence: ${id}.`, `${node.kind}:${node.id}`); });
    }
    if (node.kind === 'permission') {
      node.rows.forEach((row, index) => {
        for (const key of ['roleRef', 'resourceRef']) {
          if (!context.byRef.has(row[key])) fail('wiki-object-reference-missing', `Unknown object reference: ${row[key]}.`, `${node.kind}:${node.id}.rows[${index}].${key}`);
        }
      });
    }
    if (node.kind === 'state-machine') {
      const currentStateIds = new Set(node.states.filter((state) => usableFact(state, 'current')).map((state) => state.id));
      for (const transition of node.transitions.filter((item) => usableFact(item, 'current'))) {
        if (!currentStateIds.has(transition.from) || !currentStateIds.has(transition.to)) {
          fail('wiki-state-layer-topology-invalid', 'Current State transition endpoints must also have Current Claims.', `${node.kind}:${node.id}.transitions`);
        }
      }
    }
    if (node.kind === 'flow') {
      if (systemsForFlow(node, context).length === 0) fail('wiki-flow-system-route-required', 'Flow must be reachable from at least one Catalog System.', `${node.kind}:${node.id}.subjectRefs`);
      for (const [index, entryRef] of node.entryRefs.entries()) {
        if (!['page', 'operation', 'scenario'].includes(context.byRef.get(entryRef)?.kind)) {
          fail('wiki-flow-entry-reference-invalid', 'Flow entryRefs may reference only Page, Operation, or Scenario objects.', `${node.kind}:${node.id}.entryRefs[${index}]`);
        }
      }
      for (const [index, lane] of node.lanes.entries()) {
        if (lane.subjectRef !== undefined && !context.byRef.has(lane.subjectRef)) {
          fail('wiki-object-reference-missing', `Unknown object reference: ${lane.subjectRef}.`, `${node.kind}:${node.id}.lanes[${index}].subjectRef`);
        }
      }
      const currentNodeIds = new Set(node.nodes.filter((item) => usableFact(item, 'current')).map((item) => item.id));
      const currentEdges = node.edges.filter((item) => usableFact(item, 'current'));
      const currentMainEdges = currentEdges.filter((edge) => edge.pathType === 'main');
      const currentResultNodes = node.nodes.filter((item) => currentNodeIds.has(item.id) && ['result', 'end'].includes(item.nodeType));
      if (currentNodeIds.size < 2 || currentMainEdges.length === 0 || currentResultNodes.length === 0) fail('wiki-flow-current-path-required', 'Flow requires at least two Current nodes, one Current main edge, and one Current result/end node.', `${node.kind}:${node.id}`);
      for (const edge of currentEdges) {
        if (!currentNodeIds.has(edge.from) || !currentNodeIds.has(edge.to)) fail('wiki-flow-layer-topology-invalid', 'Current Flow edge endpoints must also have Current Claims.', `${node.kind}:${node.id}.edges.${edge.id}`);
      }
      const relationshipIds = new Set(context.relationships.map((relationship) => relationship.id));
      for (const [index, message] of node.interaction.messages.entries()) {
        if (message.relationshipRef !== undefined && !relationshipIds.has(message.relationshipRef)) fail('wiki-flow-relationship-reference-missing', `Unknown Relationship: ${message.relationshipRef}.`, `${node.kind}:${node.id}.interaction.messages[${index}].relationshipRef`);
        if (message.interfaceRef !== undefined && context.byRef.get(message.interfaceRef)?.kind !== 'interface') {
          fail('wiki-flow-interface-reference-invalid', 'Flow message interfaceRef must reference an Interface.', `${node.kind}:${node.id}.interaction.messages[${index}].interfaceRef`);
        }
        for (const [ruleIndex, ruleRef] of message.ruleRefs.entries()) {
          if (context.byRef.get(ruleRef)?.kind !== 'rule') fail('wiki-flow-rule-reference-invalid', 'Flow message ruleRefs must reference Rules.', `${node.kind}:${node.id}.interaction.messages[${index}].ruleRefs[${ruleIndex}]`);
        }
        if (/(?:超时|重试|幂等|重复投递|timeout|retry|idempoten|duplicate)/i.test(message.label)) {
          const semanticRefs = [...message.ruleRefs, ...(message.interfaceRef ? [message.interfaceRef] : [])];
          const hasBoundEvidence = semanticRefs.some((ref) => context.byRef.get(ref)?.evidenceIds.some((id) => message.evidenceIds.includes(id)));
          if (!hasBoundEvidence) fail('wiki-flow-message-guarantee-evidence-required', 'Timeout, retry, idempotency, or duplicate-delivery semantics require bound Rule or Interface Evidence.', `${node.kind}:${node.id}.interaction.messages[${index}]`);
        }
      }
      for (const [index, participant] of node.interaction.participants.entries()) {
        if (participant.subjectRef !== undefined && context.byRef.get(participant.subjectRef)?.kind !== 'data-entity') {
          fail('wiki-flow-participant-reference-invalid', 'Independent datastore participant subjectRef must reference a Data Entity.', `${node.kind}:${node.id}.interaction.participants[${index}].subjectRef`);
        }
      }
      const stateMachines = node.stateMachineRefs.map((ref) => context.byRef.get(ref));
      if (stateMachines.some((machine) => machine?.kind !== 'state-machine')) fail('wiki-flow-state-reference-invalid', 'Flow stateMachineRefs must reference State Machines.', `${node.kind}:${node.id}.stateMachineRefs`);
      if (node.viewAssessments.state.applicability === 'applicable') {
        if (stateMachines.some((machine) => !machine.states.some((state) => usableFact(state, 'current')))) fail('wiki-flow-state-current-required', 'Applicable Flow state view requires Current State Machine facts.', `${node.kind}:${node.id}.stateMachineRefs`);
      }
      if (node.viewAssessments.sequence.applicability === 'applicable') {
        const currentGroupIds = new Set(node.interaction.sequenceGroups.filter((item) => usableFact(item, 'current')).map((item) => item.id));
        const currentParticipantIds = new Set(node.interaction.participants.filter((item) => usableFact(item, 'current')).map((item) => item.id));
        const currentMessages = node.interaction.messages.filter((item) => usableFact(item, 'current'));
        if (currentGroupIds.size === 0 || currentMessages.length === 0) fail('wiki-flow-sequence-current-required', 'Applicable Flow sequence view requires Current groups and messages.', `${node.kind}:${node.id}.interaction`);
        for (const message of currentMessages) {
          if (!currentGroupIds.has(message.groupId) || !currentParticipantIds.has(message.from) || !currentParticipantIds.has(message.to)) {
            fail('wiki-flow-sequence-layer-invalid', 'Current Flow message requires Current group and participants.', `${node.kind}:${node.id}.interaction.messages.${message.id}`);
          }
        }
      }

      const laneById = new Map(node.lanes.map((lane) => [lane.id, lane]));
      const nodeById = new Map(node.nodes.map((entry) => [entry.id, entry]));
      const nonActorLaneTypes = new Set([...FLOW_LANE_TYPES].filter((laneType) => laneType !== 'actor'));
      const hasCrossSystemInteraction = currentEdges.some((edge) => {
        const fromLane = laneById.get(nodeById.get(edge.from)?.laneId);
        const toLane = laneById.get(nodeById.get(edge.to)?.laneId);
        return fromLane && toLane && fromLane.id !== toLane.id
          && nonActorLaneTypes.has(fromLane.laneType) && nonActorLaneTypes.has(toLane.laneType)
          && edge.evidenceIds.length > 0;
      });
      const hasBusinessDistinction = currentEdges.some((edge) => edge.pathType !== 'main'
        || ['async', 'callback', 'schedule'].includes(edge.interactionType))
        || node.nodes.some((entry) => currentNodeIds.has(entry.id) && ['decision', 'async-task'].includes(entry.nodeType))
        || node.interaction.messages.some((message) => usableFact(message, 'current')
          && ['event', 'callback', 'schedule'].includes(message.messageType));
      const hasCurrentStateTransition = stateMachines.some((machine) => machine?.transitions.some((transition) => usableFact(transition, 'current')));
      const currentBusinessNodes = node.nodes.filter((entry) => currentNodeIds.has(entry.id) && !['start', 'end'].includes(entry.nodeType));
      const preciseBusinessLocations = new Set(currentBusinessNodes.flatMap((entry) => entry.evidenceIds)
        .map((id) => context.evidenceById.get(id))
        .filter((evidence) => ['line', 'symbol'].includes(evidence?.precision))
        .map((evidence) => [evidence.sourceId, evidence.repositorySurface ?? '', evidence.path ?? evidence.locator, evidence.factKind ?? ''].join('\0')));
      const hasDeepCurrentPath = currentBusinessNodes.length >= 4 && preciseBusinessLocations.size >= 2;
      if (!hasCrossSystemInteraction && !hasBusinessDistinction && !hasCurrentStateTransition && !hasDeepCurrentPath) {
        fail('wiki-flow-business-depth-insufficient', 'Flow is a linear implementation template without cross-system interaction, business branching, asynchronous behavior, state transition, or a sufficiently evidenced Current path.', `${node.kind}:${node.id}`);
      }
    }
  }
}

function validateGapFieldRefs(context) {
  for (const gap of context.gaps) {
    for (const fieldRef of gap.fieldRefs) {
      const subject = gap.subjectRefs.find((ref) => fieldRef.startsWith(`${ref}.`));
      if (!subject || !context.byRef.has(subject)) {
        fail('wiki-gap-field-reference-invalid', `Gap ${gap.id} has invalid fieldRef: ${fieldRef}.`, `gap:${gap.id}.fieldRefs`);
      }
      const field = fieldRef.slice(subject.length + 1).split('.')[0];
      if (!(field in context.byRef.get(subject))) {
        fail('wiki-gap-field-reference-invalid', `Gap ${gap.id} references unknown field: ${fieldRef}.`, `gap:${gap.id}.fieldRefs`);
      }
    }
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function validateResolvedGaps(context) {
  for (const gap of context.gaps.filter((item) => item.status === 'resolved' && item.resolutionMode !== 'evidence-required')) {
    const path = `gap:${gap.id}`;
    const decisionEvidence = gap.resolutionEvidenceIds
      .map((id) => context.evidenceById.get(id))
      .filter((evidence) => evidence?.authority === 'human-confirmation' && evidence.decision);
    if (decisionEvidence.length !== 1) fail('wiki-gap-resolution-invalid', `Resolved Gap ${gap.id} requires exactly one Decision Evidence.`, `${path}.resolutionEvidenceIds`);
    const evidence = decisionEvidence[0];
    let decision;
    try {
      decision = normalizeDecisionRecord(evidence.decision, { requireConfirmed: true });
    } catch (error) {
      fail(error.code ?? 'decision-confirmation-invalid', error.message, `${path}.resolutionEvidenceIds`);
    }
    if (decision.decisionId !== gap.resolvedByDecisionId || decision.target.kind !== 'gap' || decision.target.id !== gap.id
      || JSON.stringify(decision.fieldRefs) !== JSON.stringify(gap.fieldRefs)
      || gap.subjectRefs.length !== 1 || decision.subjectRef !== gap.subjectRefs[0]) {
      fail('wiki-gap-resolution-invalid', `Resolved Gap ${gap.id} does not match its confirmed Decision.`, `${path}.resolvedByDecisionId`);
    }
    const node = context.byRef.get(decision.subjectRef);
    const field = decision.resolution.field;
    if (!node || !gap.fieldRefs.includes(`${decision.subjectRef}.${field}`) || !(field in node)) {
      fail('wiki-gap-resolution-invalid', `Resolved Gap ${gap.id} targets an unsupported field.`, `${path}.fieldRefs`);
    }
    const actual = node[field];
    const matches = decision.resolution.kind === 'confirm-empty'
      ? isEmptyValue(actual) && node.confirmedEmptyFields.includes(field)
      : decision.resolution.kind === 'set-ref-list'
        ? JSON.stringify([...actual].sort()) === JSON.stringify([...decision.resolution.value].sort())
        : JSON.stringify(canonicalValue(actual)) === JSON.stringify(canonicalValue(decision.resolution.value));
    if (!matches) fail('wiki-gap-resolution-invalid', `Resolved Gap ${gap.id} target field does not match its confirmed Decision.`, `${decision.subjectRef}.${field}`);
    const supportingClaim = [...context.claimById.values()].find((claim) => claim.subjectRef === decision.subjectRef
      && claim.layer === 'expected' && claim.factLevel === 'confirmed' && claim.evidenceIds.includes(evidence.id));
    if (!supportingClaim) fail('wiki-gap-resolution-invalid', `Resolved Gap ${gap.id} requires a confirmed Expected Claim from its Decision Evidence.`, `${path}.resolutionEvidenceIds`);
  }
}

function validateDataEntityCoverage(context) {
  const databaseArtifacts = context.artifacts.filter((artifact) => artifact.kind === 'database-artifact');
  const tables = new Map(databaseArtifacts.flatMap((artifact) => artifact.tables ?? []).map((table) => [table.id, table]));
  const columns = new Map(databaseArtifacts.flatMap((artifact) => artifact.columns ?? []).map((column) => [column.id, column]));
  const constraints = new Map(databaseArtifacts.flatMap((artifact) => artifact.constraints ?? []).map((item) => [item.id, item]));
  const indexes = new Map(databaseArtifacts.flatMap((artifact) => artifact.indexes ?? []).map((item) => [item.id, item]));
  for (const entity of context.objects.dataEntities) {
    const entityRef = `data-entity:${entity.id}`;
    const tableIds = new Set(entity.databaseObjectRefs);
    for (const tableId of tableIds) if (!tables.has(tableId)) fail('wiki-data-object-reference-missing', `Unknown Database table: ${tableId}.`, `${entityRef}.databaseObjectRefs`);
    for (const field of entity.fields) {
      const column = columns.get(field.columnRef);
      if (!column || !tableIds.has(column.ownerId)) fail('wiki-data-field-reference-invalid', `${field.name} does not map to a selected Database table column.`, `${entityRef}.fields`);
      if (column.name !== field.name || column.dataType !== field.type || column.nullable !== field.nullable) {
        fail('wiki-data-field-metadata-mismatch', `${field.name} does not match captured Database metadata.`, `${entityRef}.fields`);
      }
      if (!field.evidenceIds.some((id) => context.evidenceById.get(id)?.artifactObjectRef === field.columnRef)) {
        fail('wiki-data-field-evidence-mismatch', `${field.name} must reference Evidence for Database column ${field.columnRef}.`, `${entityRef}.fields`);
      }
    }
    for (const entry of entity.constraints) {
      const constraint = constraints.get(entry.databaseRef);
      if (!constraint || !tableIds.has(constraint.ownerId)) fail('wiki-data-object-reference-missing', `Unknown Database constraint: ${entry.databaseRef}.`, `${entityRef}.constraints`);
      if (!entry.evidenceIds.some((id) => context.evidenceById.get(id)?.artifactObjectRef === entry.databaseRef)) {
        fail('wiki-data-constraint-evidence-mismatch', `${entry.name} must reference Evidence for Database constraint ${entry.databaseRef}.`, `${entityRef}.constraints`);
      }
    }
    for (const entry of entity.indexes) {
      const index = indexes.get(entry.databaseRef);
      if (!index || !tableIds.has(index.ownerId)) fail('wiki-data-object-reference-missing', `Unknown Database index: ${entry.databaseRef}.`, `${entityRef}.indexes`);
      if (!entry.evidenceIds.some((id) => context.evidenceById.get(id)?.artifactObjectRef === entry.databaseRef)) {
        fail('wiki-data-index-evidence-mismatch', `${entry.name} must reference Evidence for Database index ${entry.databaseRef}.`, `${entityRef}.indexes`);
      }
    }
    const capturedColumnIds = [...columns.values()].filter((column) => tableIds.has(column.ownerId)).map((column) => column.id).sort();
    const projectedColumnIds = entity.fields.map((field) => field.columnRef).sort();
    if (entity.fieldCoverage === 'complete' && JSON.stringify(capturedColumnIds) !== JSON.stringify(projectedColumnIds)) {
      fail('wiki-data-field-coverage-incomplete', `${entityRef} declares complete field coverage but does not project every captured column.`, `${entityRef}.fields`);
    }
    const capturedConstraintIds = [...constraints.values()].filter((constraint) => tableIds.has(constraint.ownerId)).map((constraint) => constraint.id).sort();
    const projectedConstraintIds = entity.constraints.map((constraint) => constraint.databaseRef).sort();
    if (entity.fieldCoverage === 'complete' && JSON.stringify(capturedConstraintIds) !== JSON.stringify(projectedConstraintIds)) {
      fail('wiki-data-constraint-coverage-incomplete', `${entityRef} declares complete field coverage but does not project every captured constraint.`, `${entityRef}.constraints`);
    }
    const capturedIndexIds = [...indexes.values()].filter((index) => tableIds.has(index.ownerId)).map((index) => index.id).sort();
    const projectedIndexIds = entity.indexes.map((index) => index.databaseRef).sort();
    if (entity.fieldCoverage === 'complete' && JSON.stringify(capturedIndexIds) !== JSON.stringify(projectedIndexIds)) {
      fail('wiki-data-index-coverage-incomplete', `${entityRef} declares complete field coverage but does not project every captured index.`, `${entityRef}.indexes`);
    }
    if (entity.fieldCoverage !== 'complete' && !hasOpenGap(context, [entityRef], new Set(['data-source-gap', 'schema-drift-gap', 'business-meaning-gap']))) {
      fail('wiki-data-gap-required', `${entityRef} has ${entity.fieldCoverage} field coverage without a data Gap.`, entityRef);
    }
  }
}

function hasOpenGap(context, refs, types) {
  return context.gaps.some((gap) => gap.status === 'open'
    && types.has(gap.type)
    && gap.subjectRefs.some((ref) => refs.includes(ref)));
}

function acceptanceCoverageFor(feature, context) {
  const operationRefs = [...feature.operationRefs].sort();
  const criteria = feature.acceptanceCriteriaRefs.map((ref) => context.byRef.get(ref)).filter(Boolean);
  const coveredOperationRefs = [...new Set(criteria.flatMap((item) => item.operationRefs))]
    .filter((ref) => operationRefs.includes(ref)).sort();
  const uncoveredOperationRefs = operationRefs.filter((ref) => !coveredOperationRefs.includes(ref));
  const baselineRequirementRefs = feature.requirementRefs.filter((ref) => context.byRef.get(ref)?.scopeType === 'baseline').sort();
  return {
    operationRefs,
    coveredOperationRefs,
    uncoveredOperationRefs,
    baselineRequirementRefs,
    coverageRate: operationRefs.length === 0 ? 0 : coveredOperationRefs.length / operationRefs.length,
  };
}

function validateFeaturePrdJoins(context, readiness) {
  const requirementItems = context.artifacts.filter((artifact) => artifact.kind === 'requirement-artifact').flatMap((artifact) => artifact.items ?? []);
  for (const requirement of context.objects.requirements) {
    if (requirement.provider !== 'tapd') continue;
    const adopted = requirementItems.find((item) => item.externalId === requirement.externalId
      && item.decision === 'adopted'
      && item.normalizedStatus === 'completed'
      && requirement.featureRefs.every((ref) => item.featureRefs.includes(ref)));
    if (!adopted) {
      fail('wiki-requirement-adoption-invalid', `requirement:${requirement.id} does not match an adopted completed Requirement Artifact item.`, `requirement:${requirement.id}`);
    }
  }
  for (const criteria of context.objects.acceptanceCriteria) {
    const ref = `acceptance-criteria:${criteria.id}`;
    const feature = context.byRef.get(criteria.featureRef);
    const requirement = criteria.requirementRef ? context.byRef.get(criteria.requirementRef) : null;
    if (feature?.kind !== 'feature' || (criteria.requirementRef && requirement?.kind !== 'requirement')) {
      fail('wiki-acceptance-reference-invalid', `${ref} must join one Feature and an optional valid Requirement.`, ref);
    }
    if (!feature.acceptanceCriteriaRefs.includes(ref)
      || (requirement && (!feature.requirementRefs.includes(criteria.requirementRef) || !requirement.featureRefs.includes(criteria.featureRef)))) {
      fail('wiki-acceptance-join-invalid', `${ref} is not joined bidirectionally with its Feature and optional Requirement.`, ref);
    }
    if (criteria.decisionId) {
      const matchingEvidence = criteria.evidenceIds.map((id) => context.evidenceById.get(id))
        .filter((item) => item?.authority === 'human-confirmation' && item.decision?.decisionId === criteria.decisionId);
      if (matchingEvidence.length !== 1) {
        fail('wiki-acceptance-decision-invalid', `${ref} decisionId requires exactly one matching Human Confirmation Evidence.`, `${ref}.decisionId`);
      }
    }
    for (const operationRef of criteria.operationRefs) {
      if (context.byRef.get(operationRef)?.kind !== 'operation' || !feature.operationRefs.includes(operationRef)) {
        fail('wiki-acceptance-operation-invalid', `${ref} covers an Operation outside ${criteria.featureRef}: ${operationRef}.`, `${ref}.operationRefs`);
      }
    }
  }

  for (const feature of context.catalog.features) {
    const ref = `feature:${feature.id}`;
    const featureReadiness = readiness.featureResults.find((item) => item.featureId === feature.id);
    const acceptanceIncomplete = feature.acceptanceCriteriaRefs.length === 0;
    if (acceptanceIncomplete && !hasOpenGap(context, [ref], new Set(['acceptance-gap', 'conflict-gap']))) {
      fail('wiki-acceptance-gap-required', `${ref} requires Atomic Acceptance Criteria refs or a product-review Gap.`, ref);
    }
    if (featureReadiness?.requirementStatus === 'ready' && acceptanceIncomplete) {
      fail('wiki-acceptance-join-invalid', `${ref} has adopted Requirement evidence but no Atomic Acceptance Criteria.`, ref);
    }
    const acceptanceCoverage = acceptanceCoverageFor(feature, context);
    const semanticCoverageIncomplete = acceptanceCoverage.operationRefs.length === 0
      || acceptanceCoverage.uncoveredOperationRefs.length > 0;
    if (semanticCoverageIncomplete
      && !hasOpenGap(context, [ref, ...acceptanceCoverage.uncoveredOperationRefs], new Set(['acceptance-gap']))) {
      fail('wiki-acceptance-gap-required', `${ref} requires Atomic Acceptance Criteria coverage for every Operation, or an acceptance-gap.`, ref);
    }
    let requiredDatabaseGapTypes = new Set(['data-source-gap', 'product-decision-gap', 'business-meaning-gap', 'database-access-gap']);
    if (featureReadiness?.databaseStatus === 'conflict') requiredDatabaseGapTypes = new Set(['schema-drift-gap']);
    else if (featureReadiness?.databaseStatus === 'missing') requiredDatabaseGapTypes = new Set(['data-source-gap']);
    if (['missing', 'unknown', 'conflict'].includes(featureReadiness?.databaseStatus)
      && !hasOpenGap(context, [ref], requiredDatabaseGapTypes)) {
      fail('wiki-data-gap-required', `${ref} has incomplete Database readiness without a product-review data Gap.`, ref);
    }
  }
}

function linkTarget(fromPath, toPath) {
  const result = posix.relative(posix.dirname(fromPath), toPath);
  return result || posix.basename(toPath);
}

function routeTarget(fromPath, route) {
  if (!route) return null;
  const target = linkTarget(fromPath, route.pagePath);
  return route.anchor ? `${target}#${route.anchor}` : target;
}

function displayFact(value) {
  if (value === null || value === undefined) return '待确认';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (objectValue(value)?.text) return value.text;
  return Object.entries(value).map(([key, item]) => `${key}=${displayFact(item)}`).join('；');
}

function renderValue(value, empty = '待确认') {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return `- ${empty}`;
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => `- ${displayFact(item)}`).join('\n');
}

function escapeTable(value) {
  return displayFact(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function renderTable(headers, rows, empty = '暂无已确认内容') {
  if (rows.length === 0) return `- ${empty}`;
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeTable).join(' | ')} |`),
  ].join('\n');
}

function evidenceText(model, evidenceIds) {
  if (!evidenceIds || evidenceIds.length === 0) return '无直接证据';
  const evidenceById = new Map(model.governance.evidence.map((item) => [item.id, item]));
  return [...new Set(evidenceIds)].map((id) => {
    const evidence = evidenceById.get(id);
    if (!evidence) return id;
    const locator = evidence.path ?? evidence.locator;
    if (!locator) return evidence.description;
    return evidence.precision === 'file'
      ? `${evidence.description}（${locator}；文件级证据）`
      : `${evidence.description}（${locator}）`;
  }).join('；');
}

function readableRef(ref, context) {
  return context.byRef.get(ref)?.name ?? ref;
}

function linkedRef(path, ref, pagePathByRef, context) {
  const name = readableRef(ref, context);
  const target = routeTarget(path, pagePathByRef.get(ref));
  return target ? `[${name}](${target})` : name;
}

function renderReadableRecord(value) {
  if (!objectValue(value)) return displayFact(value);
  return Object.entries(value).map(([key, item]) => `- ${key}：${displayFact(item)}`).join('\n');
}

function emptyFieldText(node, field, fallback = '暂无') {
  if (node.confirmedEmptyFields.includes(field)) return `- 已确认无${fallback}`;
  return `- 待确认（见关联 Gap）`;
}

function pageStatusFor(model, subjectRefs) {
  if (subjectRefs.length === 0) {
    return PAGE_STATUSES.has(model.governance.publication?.status) ? model.governance.publication.status : 'partially-publishable';
  }
  const subjectSet = new Set(subjectRefs);
  const blockedFeature = model.catalog.features.some((feature) => subjectSet.has(`feature:${feature.id}`)
    && model.sourceReadiness.featureResults.find((item) => item.featureId === feature.id)?.outcome === 'blocked');
  const openGaps = model.governance.gaps.filter((gap) => gap.status === 'open' && gap.subjectRefs.some((ref) => subjectSet.has(ref)));
  if (blockedFeature || openGaps.some((gap) => gap.severity === 'P0')) return 'not-publishable';
  const incompleteFeaturePrd = model.governance.coverage.featurePrd.features
    .some((item) => subjectSet.has(item.featureRef) && !item.complete);
  const incompleteSystemPrd = model.catalog.systems.some((system) => subjectSet.has(`system:${system.id}`)
    && model.governance.coverage.featurePrd.features.some((item) => {
      if (item.complete) return false;
      const feature = model.catalog.features.find((candidate) => candidate.id === item.featureId);
      const module = model.catalog.modules.find((candidate) => `module:${candidate.id}` === feature?.parentRef);
      const domain = model.catalog.domains.find((candidate) => `domain:${candidate.id}` === module?.parentRef);
      return domain?.parentRef === `system:${system.id}`;
    }));
  const uncertainClaim = model.governance.claims.some((claim) => subjectSet.has(claim.subjectRef) && claim.factLevel !== 'confirmed');
  const uncertainObject = [...Object.values(model.catalog).flat(), ...Object.values(model.objects).flat()]
    .some((node) => subjectSet.has(`${node.kind}:${node.id}`) && !['confirmed', 'deprecated'].includes(node.status));
  const incompletePermissionCoverage = model.governance.coverage.risks.permissionCoverageBlockingRefs
    .some((ref) => subjectSet.has(ref));
  if (openGaps.some((gap) => gap.severity === 'P1') || incompleteFeaturePrd || incompleteSystemPrd || uncertainClaim || uncertainObject || incompletePermissionCoverage) return 'product-review-draft';
  if (openGaps.length > 0) return 'partially-publishable';
  return 'publishable';
}

function pageMeta(model, { pageId, pageType, title, subjectRefs, relatedObjectRefs = [] }) {
  const normalizedSubjectRefs = [...new Set(subjectRefs)].sort();
  const claims = model.governance.claims.filter((claim) => normalizedSubjectRefs.includes(claim.subjectRef));
  const claimIds = claims.map((claim) => claim.id).sort();
  const nodes = [...Object.values(model.catalog).flat(), ...Object.values(model.objects).flat()]
    .filter((node) => normalizedSubjectRefs.includes(`${node.kind}:${node.id}`));
  const evidenceIds = [...new Set([
    ...claims.flatMap((claim) => claim.evidenceIds),
    ...nodes.flatMap((node) => node.evidenceIds),
  ])].sort();
  return {
    schemaVersion: 1,
    pageId,
    pageType,
    title,
    status: pageStatusFor(model, subjectRefs),
    generatedBy: 'yog:wiki',
    subjectRefs: normalizedSubjectRefs,
    claimIds,
    evidenceIds,
    relatedObjectRefs: [...new Set(relatedObjectRefs)].sort(),
    sourceSnapshotId: model.sourceSnapshot.id,
  };
}

function withFrontmatter(meta, body, model = null) {
  let renderedBody = body.trim();
  if (model) {
    const used = model.governance.evidence
      .map((evidence) => ({ evidence, expanded: evidenceText(model, [evidence.id]) }))
      .filter(({ expanded }) => renderedBody.includes(expanded))
      .sort((left, right) => left.evidence.id.localeCompare(right.evidence.id));
    if (used.length > 0) {
      const entries = used.map(({ evidence, expanded }, index) => ({ evidence, expanded, ref: `[E${index + 1}]` }));
      for (const entry of [...entries].sort((left, right) => right.expanded.length - left.expanded.length || left.evidence.id.localeCompare(right.evidence.id))) {
        renderedBody = renderedBody.split(entry.expanded).join(entry.ref);
      }
      renderedBody = `${renderedBody}\n\n## 证据索引\n\n${entries.map((entry) => `- ${entry.ref} ${entry.expanded}`).join('\n')}`;
    }
  }
  return `${stringifyFrontmatter(meta)}\n${renderedBody}\n`;
}

function featurePath(feature, context) {
  const module = context.byRef.get(feature.parentRef);
  const domain = context.byRef.get(module.parentRef);
  const system = context.byRef.get(domain.parentRef);
  return `产品目录/${safeFilename(system.name, system.id)}/${safeFilename(domain.name, domain.id)}/${safeFilename(module.name, module.id)}/${safeFilename(feature.name, feature.id)}.md`;
}

function systemPath(system) {
  return `产品目录/${safeFilename(system.name, system.id)}/系统总览.md`;
}

function renderSystemPage(model, system, context, pagePathByRef) {
  const path = systemPath(system);
  const inlineObjects = inlineObjectsForPage(model, pagePathByRef, path);
  const inlinePages = inlineObjects.filter((node) => node.kind === 'page');
  const inlineOperations = inlineObjects.filter((node) => node.kind === 'operation');
  const inlineMetrics = inlineObjects.filter((node) => node.kind === 'metric');
  const inlineRefs = inlineObjects.map((node) => `${node.kind}:${node.id}`);
  const domains = system.domainRefs.map((ref) => context.byRef.get(ref)).filter(Boolean);
  const modules = domains.flatMap((domain) => domain.moduleRefs.map((ref) => context.byRef.get(ref))).filter(Boolean);
  const features = modules.flatMap((module) => module.featureRefs.map((ref) => context.byRef.get(ref))).filter(Boolean);
  const related = model.relationships.filter((relation) => relation.from === `system:${system.id}` || relation.to === `system:${system.id}`).flatMap((relation) => [relation.from, relation.to]).filter((ref) => ref !== `system:${system.id}`);
  const moduleRows = modules.map((module) => `| ${module.name} | ${module.featureRefs.length} | ${renderValue(module.ownerRefs).replace(/^- /, '')} |`).join('\n') || '| 待确认 | 0 | 待确认 |';
  const roleAndPermissionRefs = [...new Set(features.flatMap((feature) => [...feature.roleRefs, ...feature.permissionRefs]))];
  const technicalRefs = [...new Set(related)];
  const flowRefs = model.objects.flows
    .filter((flow) => systemsForFlow(flow, context).some((item) => item.id === system.id))
    .map((flow) => `flow:${flow.id}`);
  const flowRows = flowRefs.map((ref) => {
    const flow = context.byRef.get(ref);
    return [linkedRef(path, ref, pagePathByRef, context), displayFact(flow.goal), flow.status];
  });
  const flowObjectLocator = flowRefs.length > 0
    ? `- 页面与操作已按业务流程聚合，请查看：${flowRefs.map((ref) => linkedRef(path, ref, pagePathByRef, context)).join('、')}`
    : null;
  const openRisks = model.governance.gaps
    .filter((gap) => gap.status === 'open' && (system.gapIds.includes(gap.id) || gap.subjectRefs.includes(`system:${system.id}`)))
    .map((gap) => `- ${gap.severity}：${gap.title}`)
    .join('\n') || '- 暂无开放风险';
  const body = [
    `# ${system.name}系统总览`,
    '',
    '## 1. 系统卡片',
    '',
    `- ID：${system.id}`,
    `- 定位：${displayFact(system.positioning)}`,
    `- 状态：${system.status}`,
    `- 负责人：${system.ownerRefs.map((ref) => readableRef(ref, context)).join('、') || '待确认'}`,
    '',
    '## 2. 业务边界', '', renderValue(system.boundary),
    '', '## 3. 模块地图', '', '| 模块 | 功能数量 | 负责人 |', '| --- | ---: | --- |', moduleRows,
    '', '## 4. 核心旅程', '', renderValue(system.scenarioRefs ?? [], '暂无已确认旅程'),
    '', '## 5. 核心业务流程', '', renderTable(['流程', '业务目标', '证据状态'], flowRows, '暂无已确认业务流程'),
    '', '## 6. 系统级页面与操作定位', '', '### 页面入口', '', inlinePages.length > 0 ? inlinePageTable(model, inlinePages) : flowObjectLocator ?? '- 暂无已确认页面入口', '', '### 功能操作', '', inlineOperations.length > 0 ? inlineOperationTable(model, inlineOperations, inlinePages, context) : flowObjectLocator ?? '- 暂无已确认功能操作',
    '', '## 7. 角色权限', '', linkedRefs(path, roleAndPermissionRefs, pagePathByRef, context),
    '', '## 8. 技术关联', '', technicalRefs.length > 0 ? linkedRefs(path, technicalRefs, pagePathByRef, context) : '- 暂无已确认技术关联',
    '', '## 9. 非产品成功指标', '', '以下仅用于业务观察或实现盘点，不作为产品成功判断。', '', inlineMetricTable(model, inlineMetrics),
    '', '## 10. 运营与风险', '', openRisks,
    '', '## 11. 版本证据', '', renderValue(system.versionRefs, '暂无已确认版本'),
  ].join('\n');
  return { path, content: withFrontmatter(pageMeta(model, { pageId: `system-${system.id}`, pageType: 'system-overview', title: system.name, subjectRefs: [`system:${system.id}`, ...inlineRefs], relatedObjectRefs: [...related, ...inlineObjects.flatMap((node) => node.subjectRefs)] }), body, model) };
}

function linkedRefs(path, refs, pagePathByRef, context) {
  if (!refs || refs.length === 0) return '- 待确认';
  return refs.map((ref) => {
    const target = routeTarget(path, pagePathByRef.get(ref));
    const node = context.byRef.get(ref);
    return target ? `- [${node?.name ?? ref}](${target})` : `- ${node?.name ?? ref}`;
  }).join('\n');
}

function renderAcceptanceCriteria(feature, context) {
  const criteria = feature.acceptanceCriteriaRefs.map((ref) => context.byRef.get(ref)).filter(Boolean);
  if (criteria.length === 0) return '- 暂无已审核的原子验收标准';
  return criteria.map((item) => {
    const requirement = item.requirementRef ? context.byRef.get(item.requirementRef) : null;
    return [
      `### ${item.name}`,
      '',
      `- 类型：${item.criterionType}`,
      `- 来源：${requirement ? `${requirement.name}（${requirement.scopeType}）` : `产品决策 ${item.decisionId}`}`,
      `- 覆盖操作：${item.operationRefs.map((ref) => readableRef(ref, context)).join('、') || '待确认'}`,
      `- Given：${item.given.join('；')}`,
      `- When：${item.when}`,
      `- Then：${item.then.join('；')}`,
    ].join('\n');
  }).join('\n\n');
}

function renderAcceptanceCoverageMatrix(feature, context) {
  const criteria = feature.acceptanceCriteriaRefs.map((ref) => context.byRef.get(ref)).filter(Boolean);
  const criteriaByOperation = new Map();
  for (const item of criteria) {
    for (const operationRef of item.operationRefs) {
      if (!criteriaByOperation.has(operationRef)) criteriaByOperation.set(operationRef, []);
      criteriaByOperation.get(operationRef).push(item);
    }
  }
  return renderTable(
    ['操作', '验收标准', '覆盖状态'],
    feature.operationRefs.map((ref) => {
      const covered = criteriaByOperation.get(ref) ?? [];
      return [readableRef(ref, context), covered.map((item) => item.name).join('、') || '无', covered.length > 0 ? '已覆盖' : '缺口'];
    }),
    '暂无可评估操作；需建立 Operation 基线',
  );
}

function isReadyProductMetric(model, metric) {
  if (!metric || metric.metricType !== 'product-success' || isEmptyValue(metric.baseline) || isEmptyValue(metric.target)) return false;
  return !model.governance.gaps.some((gap) => gap.status === 'open' && gap.subjectRefs.includes(`metric:${metric.id}`));
}

function featureRefsForGap(gap, context) {
  const refs = new Set();
  for (const subjectRef of gap.subjectRefs) {
    const node = context.byRef.get(subjectRef);
    if (!node) continue;
    if (node.kind === 'feature') refs.add(subjectRef);
    for (const ref of node.subjectRefs ?? []) if (context.byRef.get(ref)?.kind === 'feature') refs.add(ref);
    if (node.kind === 'module') for (const ref of node.featureRefs ?? []) refs.add(ref);
    if (node.kind === 'domain') {
      for (const moduleRef of node.moduleRefs ?? []) for (const ref of context.byRef.get(moduleRef)?.featureRefs ?? []) refs.add(ref);
    }
    if (node.kind === 'system') {
      for (const domainRef of node.domainRefs ?? []) {
        for (const moduleRef of context.byRef.get(domainRef)?.moduleRefs ?? []) for (const ref of context.byRef.get(moduleRef)?.featureRefs ?? []) refs.add(ref);
      }
    }
  }
  return [...refs].sort();
}

function systemForFeatureRef(featureRef, context) {
  let node = context.byRef.get(featureRef);
  while (node?.parentRef) node = context.byRef.get(node.parentRef);
  return node?.kind === 'system' ? node : null;
}

function featureRefsForFlow(flow, context) {
  const flowRef = `flow:${flow.id}`;
  return [...new Set([
    ...flow.subjectRefs.filter((ref) => context.byRef.get(ref)?.kind === 'feature'),
    ...context.catalog.features.filter((feature) => feature.flowRefs.includes(flowRef)).map((feature) => `feature:${feature.id}`),
  ])].sort();
}

function systemsForFlow(flow, context) {
  const directSystems = [
    ...flow.subjectRefs.filter((ref) => context.byRef.get(ref)?.kind === 'system'),
    ...flow.lanes.map((lane) => lane.subjectRef).filter((ref) => context.byRef.get(ref)?.kind === 'system'),
  ].map((ref) => context.byRef.get(ref));
  const featureSystems = featureRefsForFlow(flow, context).map((ref) => systemForFeatureRef(ref, context));
  return [...new Map([...directSystems, ...featureSystems].filter(Boolean).map((system) => [system.id, system])).values()]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function gapRoute(gap, context) {
  const featureRefs = featureRefsForGap(gap, context);
  const primaryFeatureRef = featureRefs[0] ?? null;
  let system = primaryFeatureRef ? systemForFeatureRef(primaryFeatureRef, context) : null;
  if (!system) {
    const systemRef = gap.subjectRefs.find((ref) => context.byRef.get(ref)?.kind === 'system');
    system = systemRef ? context.byRef.get(systemRef) : modelFirstSystem(context);
  }
  const systemId = system?.id ?? 'shared';
  const featureId = primaryFeatureRef ? refId(primaryFeatureRef) : 'system-level';
  return {
    system,
    systemId,
    featureRef: primaryFeatureRef,
    featureId,
    featureRefs,
    pagePath: `质量治理/待确认问题/${safeFilename(systemId, systemId)}/${safeFilename(featureId, featureId)}.md`,
  };
}

function modelFirstSystem(context) {
  return [...context.byRef.values()].filter((node) => node.kind === 'system').sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0] ?? null;
}

function acceptanceGapCoveredByReviewQueue(gap, reviewItems = []) {
  if (gap.type !== 'acceptance-gap' || !gap.fieldRefs.some((fieldRef) => fieldRef.endsWith('.acceptanceCriteriaRefs'))) return false;
  const featureRefs = gap.subjectRefs.filter((ref) => refKind(ref) === 'feature');
  return featureRefs.some((featureRef) => reviewItems.some((item) => item.featureRef === featureRef
    && ['pending', 'drift'].includes(item.status)));
}

function visibleProductGaps(gaps, reviewItems = []) {
  return gaps.filter((gap) => gap.audience === 'product-review' && gap.status === 'open'
    && !acceptanceGapCoveredByReviewQueue(gap, reviewItems));
}

function openGapsForFeature(model, featureRef, context) {
  return visibleProductGaps(model.governance.gaps, model.governance.reviewItems)
    .filter((gap) => gap.status === 'open'
    && featureRefsForGap(gap, context).includes(featureRef));
}

function inlineObjectsForPage(model, pagePathByRef, pagePath) {
  return [
    ...model.objects.pages,
    ...model.objects.operations,
    ...model.objects.metrics.filter((metric) => metric.metricType !== 'product-success'),
  ].filter((node) => pagePathByRef.get(`${node.kind}:${node.id}`)?.pagePath === pagePath)
    .sort((left, right) => left.order - right.order || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}

function compactFacts(values, empty = '无') {
  if (!values || values.length === 0) return empty;
  return values.map(displayFact).join('；');
}

function inlinePageTable(model, pages) {
  return renderTable(['页面入口', '路径', '区域', '证据状态', '证据'], pages.map((page) => [
    `<a id="${inlineObjectAnchor(page)}"></a>${page.name}`,
    displayFact(page.route),
    compactFacts(page.areas, page.confirmedEmptyFields.includes('areas') ? '已确认无独立区域' : '待确认'),
    page.status,
    evidenceText(model, page.evidenceIds),
  ]), '暂无已确认页面入口');
}

function inlineOperationTable(model, operations, pages, context) {
  return renderTable(['动作', '路径', '角色', '前置条件', '正常结果', '异常结果', '证据状态'], operations.map((operation) => {
    const routes = pages.filter((page) => page.operationRefs.includes(`operation:${operation.id}`)).map((page) => displayFact(page.route));
    return [
      `<a id="${inlineObjectAnchor(operation)}"></a>${displayFact(operation.action)}`,
      routes.join('、') || '非页面入口/待确认',
      operation.actorRefs.map((ref) => readableRef(ref, context)).join('、') || '待确认',
      compactFacts(operation.preconditions, operation.confirmedEmptyFields.includes('preconditions') ? '已确认无前置条件' : '待确认'),
      compactFacts(operation.outcomes, operation.confirmedEmptyFields.includes('outcomes') ? '已确认无正常结果' : '待确认'),
      compactFacts(operation.errorOutcomes, operation.confirmedEmptyFields.includes('errorOutcomes') ? '已确认无异常结果' : '待确认'),
      `${operation.status}；${evidenceText(model, operation.evidenceIds)}`,
    ];
  }), '暂无已确认功能操作');
}

function inlineMetricTable(model, metrics) {
  return renderTable(['指标', '类型', '口径', '统计窗口', '证据状态', '证据'], metrics.map((metric) => [
    `<a id="${inlineObjectAnchor(metric)}"></a>${metric.name}`,
    metric.metricType,
    displayFact(metric.formula),
    displayFact(metric.timeWindow),
    metric.status,
    evidenceText(model, metric.evidenceIds),
  ]), '暂无非产品成功指标');
}

function reviewItemsForFeature(model, featureRef, statuses = null) {
  return (model.governance.reviewItems ?? [])
    .filter((item) => item.featureRef === featureRef && (!statuses || statuses.has(item.status)))
    .sort((left, right) => left.priority.localeCompare(right.priority) || left.id.localeCompare(right.id));
}

function reviewAnchor(item) {
  return `review-${item.id}`;
}

function reviewPagePath(item, context) {
  const system = systemForFeatureRef(item.featureRef, context);
  return `质量治理/产品审核/${safeFilename(system?.id ?? 'shared', 'shared')}/${safeFilename(refId(item.featureRef), refId(item.featureRef))}.md`;
}

function renderReviewCard(item, model, { compact = false } = {}) {
  const proposal = item.proposal;
  const status = item.sourceFactLevel === 'partial' ? '当前行为证据不完整' : '当前行为已确认';
  const lines = [
    `<a id="${reviewAnchor(item)}"></a>`,
    `### [${item.priority}] ${item.question}`,
    '', `- 当前观察：${item.observedBehavior}`, `- 证据状态：${status}`, `- 观察执行层：${item.observedSurfaces.join('、') || 'unknown'}`,
    `- 价值原因：${item.reasonCodes.join('、')}`,
    '', '**建议验收标准**', '', `- Given：${proposal.given.join('；') || '无额外前置条件'}`, `- When：${proposal.when}`, `- Then：${proposal.then.join('；')}`,
    '', `- 可选动作：确认 / 修改 / 拒绝 / 延期`, `- 当前状态：${item.status}`,
  ];
  if (!compact) lines.push(`- 证据：${evidenceText(model, item.evidenceIds)}`);
  return lines.join('\n');
}

function renderFeatureReviewSummary(model, featureRef, path, context) {
  const pending = reviewItemsForFeature(model, featureRef, new Set(['pending', 'drift']));
  if (pending.length === 0) return '- 暂无待产品审核项';
  const next = pending.filter((item) => ['P0', 'P1'].includes(item.priority)).slice(0, 5);
  const selected = next.length > 0 ? next : pending.slice(0, 5);
  const target = reviewPagePath(selected[0], context);
  return [
    `- 待审核：${pending.length}；本批：${selected.length}（每批最多 5 项）`,
    `- [打开完整审核分片](${linkTarget(path, target)})`,
    '', ...selected.map((item) => renderReviewCard(item, model, { compact: true })),
  ].join('\n');
}

function renderFeaturePage(model, feature, context, pagePathByRef) {
  const path = featurePath(feature, context);
  const inlineObjects = inlineObjectsForPage(model, pagePathByRef, path);
  const inlinePages = inlineObjects.filter((node) => node.kind === 'page');
  const inlineOperations = inlineObjects.filter((node) => node.kind === 'operation');
  const inlineMetrics = inlineObjects.filter((node) => node.kind === 'metric');
  const inlineRefs = inlineObjects.map((node) => `${node.kind}:${node.id}`);
  const meta = pageMeta(model, {
    pageId: `feature-${feature.id}`,
    pageType: 'feature-prd',
    title: feature.name,
    subjectRefs: [`feature:${feature.id}`, ...inlineRefs],
    relatedObjectRefs: [...feature.subjectRefs, ...inlineObjects.flatMap((node) => node.subjectRefs)],
  });
  const refs = (...keys) => keys.flatMap((key) => feature[key] ?? []);
  const productMetricRefs = feature.metricRefs.filter((ref) => isReadyProductMetric(model, context.byRef.get(ref)));
  const openGaps = openGapsForFeature(model, `feature:${feature.id}`, context);
  const gapPages = [...new Map(openGaps.map((gap) => {
    const route = gapRoute(gap, context);
    return [route.pagePath, route];
  })).values()];
  const gapLinks = gapPages.length > 0
    ? gapPages.map((route) => `- [待确认问题（${openGaps.filter((gap) => gapRoute(gap, context).pagePath === route.pagePath).length} 项）](${linkTarget(path, route.pagePath)})`).join('\n')
    : '- 暂无待确认问题';
  const riskGroups = new Map();
  for (const gap of openGaps) {
    const key = `${gap.severity}\0${gap.title}`;
    const group = riskGroups.get(key) ?? { severity: gap.severity, title: gap.title, count: 0 };
    group.count += 1;
    riskGroups.set(key, group);
  }
  const riskSummary = riskGroups.size > 0
    ? [...riskGroups.values()].map((group) => `- ${group.severity}：${group.title}${group.count > 1 ? `（${group.count} 项）` : ''}`).join('\n')
    : '- 暂无开放风险';
  const flowRows = feature.flowRefs.map((ref) => {
    const flow = context.byRef.get(ref);
    return [linkedRef(path, ref, pagePathByRef, context), displayFact(flow?.goal), displayFact(flow?.trigger), flow?.status ?? '待确认'];
  });
  const sections = [[`# ${feature.name}`]];
  sections.push(['## 01 功能全貌', '', renderValue(feature.background ?? feature.purpose), '', '### 角色与入口', '', linkedRefs(path, refs('roleRefs', 'permissionRefs'), pagePathByRef, context)]);
  if (inlinePages.length > 0 || inlineOperations.length > 0 || flowRows.length > 0) sections.push([
    '## 02 当前实现', '', '以下内容来自 Current Implementation，不等同于历史 PRD。',
    ...(inlinePages.length > 0 ? ['', '### 页面入口', '', inlinePageTable(model, inlinePages)] : []),
    ...(inlineOperations.length > 0 ? ['', '### 功能操作', '', inlineOperationTable(model, inlineOperations, inlinePages, context)] : []),
    ...(flowRows.length > 0 ? ['', '### 核心业务流程', '', renderTable(['流程', '目标', '入口/触发', '证据状态'], flowRows)] : []),
  ]);
  if (feature.acceptanceCriteriaRefs.length > 0) sections.push(['## 03 已审核产品基线', '', renderAcceptanceCriteria(feature, context)]);
  const businessRefs = refs('ruleRefs', 'stateMachineRefs', 'permissionRefs');
  if (businessRefs.length > 0) sections.push(['## 04 业务规则、状态与权限', '', linkedRefs(path, businessRefs, pagePathByRef, context)]);
  const impactRefs = refs('pageRefs', 'operationRefs', 'flowRefs', 'dataEntityRefs', 'interfaceRefs');
  if (impactRefs.length > 0) sections.push(['## 05 变更影响地图', '', linkedRefs(path, impactRefs, pagePathByRef, context)]);
  sections.push(['## 06 下一批待产品确认', '', renderFeatureReviewSummary(model, `feature:${feature.id}`, path, context)]);
  if (productMetricRefs.length > 0 || inlineMetrics.length > 0) sections.push([
    '## 07 指标',
    ...(productMetricRefs.length > 0 ? ['', '### 产品成功指标', '', linkedRefs(path, productMetricRefs, pagePathByRef, context)] : []),
    ...(inlineMetrics.length > 0 ? ['', '### 非产品成功指标', '', '以下仅用于业务观察或实现盘点，不作为产品成功判断。', '', inlineMetricTable(model, inlineMetrics)] : []),
  ]);
  if (openGaps.length > 0 || refs('interfaceRefs', 'versionRefs').length > 0) sections.push(['## 08 风险与证据缺口', '', riskSummary, '', gapLinks]);
  const body = sections.flatMap((section, index) => index === 0 ? section : ['', ...section]).join('\n');
  return { path, content: withFrontmatter(meta, body, model) };
}

function objectPath(node) {
  if (['page', 'operation'].includes(node.kind)) return null;
  if (node.kind === 'metric' && node.metricType !== 'product-success') return null;
  const directory = OBJECT_DIRECTORIES.get(node.kind);
  return directory ? `知识对象/${directory}/${safeFilename(node.id, node.id)}-${safeFilename(node.name, node.id)}.md` : null;
}

function renderObjectEvidence(model, node) {
  return node.evidenceIds.length > 0 ? `- ${evidenceText(model, node.evidenceIds)}` : '- 暂无直接证据';
}

function renderObjectGaps(model, node) {
  const nodeRef = `${node.kind}:${node.id}`;
  const gaps = model.governance.gaps.filter((gap) => gap.status === 'open' && (node.gapIds.includes(gap.id) || gap.subjectRefs.includes(nodeRef)));
  return gaps.length > 0 ? gaps.map((gap) => `- ${gap.description}`).join('\n') : '- 暂无待确认项';
}

function renderRolePage(model, node, context, pagePathByRef, path) {
  return [
    `# ${node.name}`,
    '', '## 角色定位', '', `- 类型：${node.roleType}`,
    '', '## 核心职责', '', renderValue(node.responsibilities, '暂无已确认职责'),
    '', '## 适用范围', '', node.scopeRefs.length > 0 ? linkedRefs(path, node.scopeRefs, pagePathByRef, context) : emptyFieldText(node, 'scopeRefs', '独立适用范围'),
    '', '## 可执行操作', '', node.operationRefs.length > 0 ? linkedRefs(path, node.operationRefs, pagePathByRef, context) : emptyFieldText(node, 'operationRefs', '可执行操作'),
    '', '## 证据', '', renderObjectEvidence(model, node),
    '', '## 待确认项', '', renderObjectGaps(model, node),
  ].join('\n');
}

function renderPermissionPage(model, node, context, pagePathByRef, path) {
  const rows = node.rows.map((row) => [
    linkedRef(path, row.roleRef, pagePathByRef, context),
    linkedRef(path, row.resourceRef, pagePathByRef, context),
    row.action,
    row.enforcementLayer,
    row.dataScope,
    row.condition,
    row.decision,
    evidenceText(model, row.evidenceIds),
  ]);
  return [
    `# ${node.name}`,
    '', '## 权限矩阵', '', renderTable(['角色', '资源', '操作', '执行层', '数据范围', '条件', '决策', '证据'], rows),
    '', '## 分层说明', '', '- product：产品定义的可执行范围', '- ui：页面、按钮或前端可见性', '- api：接口访问与服务端鉴权', '- data：租户、组织、用户或数据范围过滤',
    '', '## 待确认项', '', renderObjectGaps(model, node),
  ].join('\n');
}

function renderDataEntityPage(model, node, context, pagePathByRef, path) {
  const fields = node.fields.map((field) => [
    field.name,
    field.type,
    field.nullable ? '是' : '否',
    field.defaultExpression ?? '无',
    field.businessMeaning ?? '待确认（见 Gap）',
    evidenceText(model, field.evidenceIds),
  ]);
  const constraints = node.constraints.map((item) => [item.name, item.type, (item.columnRefs ?? []).map((ref) => node.fields.find((field) => field.columnRef === ref)?.name ?? ref).join('、') || '无', evidenceText(model, item.evidenceIds)]);
  const indexes = node.indexes.map((item) => [item.name, item.unique ? '唯一' : '非唯一', item.columnRefs.map((ref) => node.fields.find((field) => field.columnRef === ref)?.name ?? ref).join('、'), evidenceText(model, item.evidenceIds)]);
  return [
    `# ${node.name}`,
    '', '## 存储与完整性', '', `- 字段覆盖：${node.fieldCoverage}`, `- 数据库对象：${node.storageName}`,
    '', '## 字段字典', '', renderTable(['字段', '类型', '可空', '默认值', '业务含义', '证据'], fields),
    '', '## 约束', '', constraints.length > 0 ? renderTable(['名称', '类型', '字段', '证据'], constraints) : emptyFieldText(node, 'constraints', '已采集约束'),
    '', '## 索引', '', indexes.length > 0 ? renderTable(['名称', '类型', '字段', '证据'], indexes) : emptyFieldText(node, 'indexes', '已采集索引'),
    '', '## 实体关系', '', node.relationships.length > 0 ? renderValue(node.relationships) : emptyFieldText(node, 'relationships', '已确认实体关系'),
    '', '## 读写方', '', '### 读取方', '', node.readerRefs.length > 0 ? linkedRefs(path, node.readerRefs, pagePathByRef, context) : emptyFieldText(node, 'readerRefs', '已确认读取方'), '', '### 写入方', '', node.writerRefs.length > 0 ? linkedRefs(path, node.writerRefs, pagePathByRef, context) : emptyFieldText(node, 'writerRefs', '已确认写入方'),
    '', '## 敏感性', '', renderValue(node.sensitivity),
    '', '## 待确认项', '', renderObjectGaps(model, node),
  ].join('\n');
}

function renderInterfacePage(model, node, context, pagePathByRef, path) {
  const endpointRows = node.endpoints.map((endpoint) => [endpoint.method, endpoint.path, endpoint.name, endpoint.auth, displayFact(endpoint.request), displayFact(endpoint.response), endpoint.idempotency, evidenceText(model, endpoint.evidenceIds)]);
  const errorRows = node.endpoints.flatMap((endpoint) => endpoint.errors.map((error) => [endpoint.name, error.code, error.condition, error.meaning ?? '待确认（见 Gap）', evidenceText(model, error.evidenceIds)]));
  return [
    `# ${node.name}`,
    '', '## 接口概览', '', `- 协议：${node.protocol}`, `- 集合级鉴权：${displayFact(node.auth)}`, `- 超时：${displayFact(node.timeout)}`, `- 重试：${displayFact(node.retry)}`, `- 版本：${displayFact(node.version)}`,
    '', '## Endpoint 清单', '', renderTable(['Method', 'Path', '用途', 'Auth', 'Request DTO', 'Response DTO', '幂等性', '证据'], endpointRows),
    '', '## 错误语义', '', errorRows.length > 0 ? renderTable(['Endpoint', '错误码', '触发条件', '返回语义', '证据'], errorRows) : emptyFieldText(node, 'errors', '已确认错误语义'),
    '', '## 消费方', '', node.consumerRefs.length > 0 ? linkedRefs(path, node.consumerRefs, pagePathByRef, context) : emptyFieldText(node, 'consumerRefs', '已确认消费方'),
    '', '## 待确认项', '', renderObjectGaps(model, node),
  ].join('\n');
}

function mermaidLabel(value) {
  return String(value)
    .replaceAll(/[\u0000-\u001f\u007f]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .replaceAll('"', "'")
    .replaceAll('[', '［')
    .replaceAll(']', '］')
    .replaceAll('{', '｛')
    .replaceAll('}', '｝')
    .replaceAll('(', '（')
    .replaceAll(')', '）')
    .replaceAll('<', '＜')
    .replaceAll('>', '＞')
    .replaceAll(';', '；')
    .replaceAll('%', '％')
    .replaceAll('`', '｀')
    .trim();
}

const claimIndexCache = new WeakMap();

function structuredFactLevel(model, entry, layer = 'current') {
  if (!claimIndexCache.has(model)) claimIndexCache.set(model, new Map(model.governance.claims.map((claim) => [claim.id, claim])));
  const claimById = claimIndexCache.get(model);
  const levels = entry.claimIds.map((id) => claimById.get(id)).filter((claim) => claim?.layer === layer).map((claim) => claim.factLevel);
  if (levels.includes('needs-review')) return 'needs-review';
  if (levels.includes('partial')) return 'partial';
  return levels.includes('confirmed') ? 'confirmed' : null;
}

function factStatusText(level) {
  return level === 'confirmed' ? '已确认' : level === 'partial' ? '部分确认' : level === 'needs-review' ? '待复核' : '未纳入 Current';
}

function usableStructuredFact(model, entry, layer = 'current') {
  return ['confirmed', 'partial'].includes(structuredFactLevel(model, entry, layer));
}

function selectCurrentFlow(model, flow) {
  const nodes = flow.nodes.filter((entry) => usableStructuredFact(model, entry, 'current'));
  const nodeIds = new Set(nodes.map((entry) => entry.id));
  const edges = flow.edges.filter((entry) => usableStructuredFact(model, entry, 'current') && nodeIds.has(entry.from) && nodeIds.has(entry.to));
  return { nodes, edges };
}

function renderFlowDiagram(model, flow) {
  const current = selectCurrentFlow(model, flow);
  const aliases = new Map(current.nodes.map((item, index) => [item.id, `flow_${index + 1}`]));
  const phases = [...flow.phases].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const lanes = [...flow.lanes].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const lines = ['```mermaid', 'flowchart LR'];
  for (const [phaseIndex, phase] of phases.entries()) {
    const phaseNodes = current.nodes.filter((entry) => entry.phaseId === phase.id);
    if (phaseNodes.length === 0) continue;
    lines.push(`  subgraph phase_${phaseIndex + 1}["${mermaidLabel(phase.label)}"]`, '    direction TB');
    for (const [laneIndex, lane] of lanes.entries()) {
      const laneNodes = phaseNodes.filter((entry) => entry.laneId === lane.id);
      if (laneNodes.length === 0) continue;
      lines.push(`    subgraph phase_${phaseIndex + 1}_lane_${laneIndex + 1}["${mermaidLabel(lane.label)}"]`, '      direction TB');
      for (const item of laneNodes) {
        const partial = structuredFactLevel(model, item, 'current') !== 'confirmed' ? ':::partial' : '';
        lines.push(`      ${aliases.get(item.id)}["${mermaidLabel(item.label)}"]${partial}`);
      }
      lines.push('    end');
    }
    lines.push('  end');
  }
  const pathStyle = {
    main: 'stroke:#3b82f6,stroke-width:2px',
    branch: 'stroke:#8b5cf6,stroke-width:2px,stroke-dasharray:5 3',
    exception: 'stroke:#dc2626,stroke-width:2px,stroke-dasharray:3 3',
    fallback: 'stroke:#64748b,stroke-width:2px,stroke-dasharray:1 4',
  };
  current.edges.forEach((edge, index) => {
    const level = structuredFactLevel(model, edge, 'current');
    const label = [edge.label, edge.pathType, edge.interactionType, edge.condition, level === 'confirmed' ? null : '部分确认'].filter(Boolean).join(' · ');
    lines.push(`  ${aliases.get(edge.from)} -->|"${mermaidLabel(label)}"| ${aliases.get(edge.to)}`);
    lines.push(`  linkStyle ${index} ${pathStyle[edge.pathType]}${level === 'confirmed' ? '' : ',opacity:0.65'}`);
  });
  lines.push('  classDef partial stroke:#d97706,stroke-width:2px,stroke-dasharray:4 2;', '```');
  return { ...current, diagram: lines.join('\n') };
}

function selectCurrentStateMachine(model, machine) {
  const states = machine.states.filter((entry) => usableStructuredFact(model, entry, 'current'));
  const stateIds = new Set(states.map((entry) => entry.id));
  const transitions = machine.transitions.filter((entry) => usableStructuredFact(model, entry, 'current') && stateIds.has(entry.from) && stateIds.has(entry.to));
  return { states, transitions };
}

function renderCurrentStateMachine(model, machine) {
  const selected = selectCurrentStateMachine(model, machine);
  const aliases = new Map(selected.states.map((state, index) => [state.id, `state_${index + 1}`]));
  const lines = ['```mermaid', 'stateDiagram-v2'];
  selected.states.forEach((state) => lines.push(`  state "${mermaidLabel(state.label)}${structuredFactLevel(model, state, 'current') === 'confirmed' ? '' : '（部分确认）'}" as ${aliases.get(state.id)}`));
  selected.transitions.forEach((transition) => lines.push(`  ${aliases.get(transition.from)} --> ${aliases.get(transition.to)}: ${mermaidLabel(transition.trigger)}${structuredFactLevel(model, transition, 'current') === 'confirmed' ? '' : '（部分确认）'}`));
  lines.push('```');
  return { ...selected, diagram: lines.join('\n') };
}

function renderStateMachineProjection(model, machine, context, pagePathByRef, path) {
  const current = renderCurrentStateMachine(model, machine);
  const expectedStates = machine.states.filter((entry) => !usableStructuredFact(model, entry, 'current') && usableStructuredFact(model, entry, 'expected'));
  const expectedTransitions = machine.transitions.filter((entry) => !usableStructuredFact(model, entry, 'current') && usableStructuredFact(model, entry, 'expected'));
  return [
    `### ${linkedRef(path, `state-machine:${machine.id}`, pagePathByRef, context)}`,
    '', current.diagram,
    '', renderTable(['状态 ID', '名称', '事实状态', '证据'], current.states.map((state) => [state.id, state.label, factStatusText(structuredFactLevel(model, state, 'current')), evidenceText(model, state.evidenceIds)])),
    '', renderTable(['起始状态', '目标状态', '触发条件', '事实状态', '证据'], current.transitions.map((transition) => [transition.from, transition.to, transition.trigger, factStatusText(structuredFactLevel(model, transition, 'current')), evidenceText(model, transition.evidenceIds)])),
    '', '#### 目标状态变更', '', renderTable(['类型', '内容', '证据'], [
      ...expectedStates.map((state) => ['状态', state.label, evidenceText(model, state.evidenceIds)]),
      ...expectedTransitions.map((transition) => ['转换', `${transition.from} → ${transition.to}：${transition.trigger}`, evidenceText(model, transition.evidenceIds)]),
    ], '暂无 Expected-only 状态变化'),
  ].join('\n');
}

function assessmentText(model, assessment) {
  const gaps = assessment.gapIds.map((id) => model.governance.gaps.find((gap) => gap.id === id)?.description ?? id);
  return [`- 结论：${assessment.applicability}`, `- 原因：${assessment.reason}`, ...(gaps.length > 0 ? gaps.map((gap) => `- 待确认：${gap}`) : [])].join('\n');
}

function participantLabel(flow, participant) {
  if (participant.laneId) return flow.lanes.find((lane) => lane.id === participant.laneId)?.label ?? participant.laneId;
  return participant.label;
}

function renderSequenceProjection(model, flow) {
  const currentParticipants = flow.interaction.participants.filter((entry) => usableStructuredFact(model, entry, 'current'));
  const participantById = new Map(currentParticipants.map((entry) => [entry.id, entry]));
  const aliases = new Map(currentParticipants.map((entry, index) => [entry.id, `participant_${index + 1}`]));
  const groups = [...flow.interaction.sequenceGroups]
    .filter((entry) => usableStructuredFact(model, entry, 'current'))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const messageArrow = (type) => type === 'response' ? '-->>' : ['event', 'command', 'callback', 'schedule'].includes(type) ? '-)' : '->>';
  const diagrams = [];
  const rows = [];
  for (const group of groups) {
    const messages = flow.interaction.messages
      .filter((entry) => entry.groupId === group.id && usableStructuredFact(model, entry, 'current'))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    if (messages.length === 0) continue;
    const usedIds = new Set(messages.flatMap((message) => [message.from, message.to]));
    const lines = ['```mermaid', 'sequenceDiagram'];
    const usedParticipants = currentParticipants.filter((participant) => usedIds.has(participant.id));
    usedParticipants.forEach((participant) => {
      lines.push(`  participant ${aliases.get(participant.id)} as ${mermaidLabel(participantLabel(flow, participant))}`);
    });
    const noteAliases = [aliases.get(usedParticipants[0].id), aliases.get(usedParticipants.at(-1).id)];
    lines.push(`  Note over ${[...new Set(noteAliases)].join(',')}: ${mermaidLabel(group.label)} · ${group.pathType}`);
    for (const message of messages) {
      const level = structuredFactLevel(model, message, 'current');
      const label = `${message.label}［${message.messageType}${level === 'confirmed' ? '' : '，部分确认'}］`;
      lines.push(`  ${aliases.get(message.from)}${messageArrow(message.messageType)}${aliases.get(message.to)}: ${mermaidLabel(label)}`);
      rows.push([group.label, group.pathType, message.order, participantLabel(flow, participantById.get(message.from)), participantLabel(flow, participantById.get(message.to)), message.messageType, message.label, factStatusText(level), evidenceText(model, message.evidenceIds)]);
    }
    lines.push('```');
    diagrams.push(`### ${group.label}（${group.pathType}）\n\n${lines.join('\n')}`);
  }
  return { diagrams: diagrams.join('\n\n'), rows };
}

function renderFlowPage(model, node, context, pagePathByRef, path) {
  const inlineObjects = inlineObjectsForPage(model, pagePathByRef, path);
  const inlinePages = inlineObjects.filter((item) => item.kind === 'page');
  const inlineOperations = inlineObjects.filter((item) => item.kind === 'operation');
  const inlineMetrics = inlineObjects.filter((item) => item.kind === 'metric');
  const current = renderFlowDiagram(model, node);
  const labelById = new Map(node.nodes.map((item) => [item.id, item.label]));
  const laneById = new Map(node.lanes.map((item) => [item.id, item]));
  const phaseById = new Map(node.phases.map((item) => [item.id, item]));
  const expectedNodes = node.nodes.filter((entry) => !usableStructuredFact(model, entry, 'current') && usableStructuredFact(model, entry, 'expected'));
  const expectedEdges = node.edges.filter((entry) => !usableStructuredFact(model, entry, 'current') && usableStructuredFact(model, entry, 'expected'));
  const stateAssessment = node.viewAssessments.state;
  const stateSection = stateAssessment.applicability === 'applicable'
    ? node.stateMachineRefs.map((ref) => renderStateMachineProjection(model, context.byRef.get(ref), context, pagePathByRef, path)).join('\n\n')
    : assessmentText(model, stateAssessment);
  const sequenceAssessment = node.viewAssessments.sequence;
  const sequence = sequenceAssessment.applicability === 'applicable' ? renderSequenceProjection(model, node) : null;
  const sequenceSection = sequence ? [sequence.diagrams, '', renderTable(['序列', '路径', '顺序', '发送方', '接收方', '消息类型', '业务含义', '事实状态', '证据'], sequence.rows)].join('\n') : assessmentText(model, sequenceAssessment);
  const overviewStatus = [...current.nodes, ...current.edges].every((entry) => structuredFactLevel(model, entry, 'current') === 'confirmed') ? '已确认' : '部分确认';
  const participants = node.lanes.map((lane) => [lane.label, lane.laneType, lane.subjectRef ? readableRef(lane.subjectRef, context) : '无独立对象引用', factStatusText(structuredFactLevel(model, lane, 'current')), evidenceText(model, lane.evidenceIds)]);
  return [
    `# ${node.name}`,
    '', '## 业务目标与范围', '', `- 业务目标：${displayFact(node.goal)}`, '- 范围：', renderValue(node.scope), '- 非范围：', renderValue(node.nonScope), `- 触发条件：${displayFact(node.trigger)}`,
    '', '## 证据状态', '', `- 完整流程：${overviewStatus}`, `- 状态视图：${stateAssessment.applicability}`, `- 时序视图：${sequenceAssessment.applicability}`,
    '', '## 完整业务流程图', '', current.diagram,
    '', '### Current 主路径、分支与异常', '', renderTable(['阶段', '起点', '终点', '路径', '交互', '条件', '事实状态', '证据'], current.edges.map((edge) => [phaseById.get(node.nodes.find((item) => item.id === edge.from)?.phaseId)?.label, labelById.get(edge.from), labelById.get(edge.to), edge.pathType, edge.interactionType, edge.condition, factStatusText(structuredFactLevel(model, edge, 'current')), evidenceText(model, edge.evidenceIds)])),
    '', '### Expected 目标流程变化', '', renderTable(['类型', '内容', '证据'], [...expectedNodes.map((entry) => ['节点', entry.label, evidenceText(model, entry.evidenceIds)]), ...expectedEdges.map((entry) => ['流转', `${labelById.get(entry.from)} → ${labelById.get(entry.to)}：${entry.label}`, evidenceText(model, entry.evidenceIds)])], '暂无 Expected-only 流程变化'),
    '', '## 核心状态流转', '', stateSection,
    '', '## 系统协作时序', '', sequenceSection,
    '', '## 入口与参与者', '', '### 入口', '', node.entryRefs.length > 0 ? linkedRefs(path, node.entryRefs, pagePathByRef, context) : emptyFieldText(node, 'entryRefs', '已确认入口'), '', '### 参与者泳道', '', renderTable(['泳道', '类型', '对象', '事实状态', '证据'], participants),
    '', '### 页面入口', '', inlinePageTable(model, inlinePages),
    '', '### 功能操作', '', inlineOperationTable(model, inlineOperations, inlinePages, context),
    '', '## 主路径、分支与异常', '', renderTable(['起点', '终点', '路径', '交互', '条件', '事实状态', '证据'], current.edges.map((edge) => [labelById.get(edge.from), labelById.get(edge.to), edge.pathType, edge.interactionType, edge.condition, factStatusText(structuredFactLevel(model, edge, 'current')), evidenceText(model, edge.evidenceIds)])), '', node.exceptionPaths.length > 0 ? renderValue(node.exceptionPaths) : emptyFieldText(node, 'exceptionPaths', '异常路径'),
    '', '## 关键业务节点', '', renderTable(['节点', '阶段', '泳道', '类型', '事实状态', '证据'], current.nodes.map((item) => [item.label, phaseById.get(item.phaseId)?.label, laneById.get(item.laneId)?.label, item.nodeType, factStatusText(structuredFactLevel(model, item, 'current')), evidenceText(model, item.evidenceIds)])),
    '', '## 非产品成功指标', '', '以下仅用于业务观察或实现盘点，不作为产品成功判断。', '', inlineMetricTable(model, inlineMetrics),
    '', '## 证据', '', renderObjectEvidence(model, node),
    '', '## 待确认问题', '', renderObjectGaps(model, node),
  ].join('\n');
}

function renderStateMachinePage(model, node, context, pagePathByRef, path) {
  const current = renderCurrentStateMachine(model, node);
  const expectedStates = node.states.filter((entry) => !usableStructuredFact(model, entry, 'current') && usableStructuredFact(model, entry, 'expected'));
  const expectedTransitions = node.transitions.filter((entry) => !usableStructuredFact(model, entry, 'current') && usableStructuredFact(model, entry, 'expected'));
  return [
    `# ${node.name}`,
    '', '## 状态对象', '', `- 业务对象：${readableRef(node.businessObjectRef, context)}`, `- 状态维度：${displayFact(node.dimension)}`, `- 状态模式：${node.stateMode}`, `- 完整度：${node.completeness}`,
    '', '## Current 状态图', '', current.diagram,
    '', '## Current 状态定义', '', renderTable(['状态 ID', '名称', '事实状态', '证据'], current.states.map((state) => [state.id, state.label, factStatusText(structuredFactLevel(model, state, 'current')), evidenceText(model, state.evidenceIds)])),
    '', '## Current 状态转换', '', renderTable(['起始状态', '目标状态', '触发条件', '事实状态', '证据'], current.transitions.map((transition) => [transition.from, transition.to, transition.trigger, factStatusText(structuredFactLevel(model, transition, 'current')), evidenceText(model, transition.evidenceIds)])),
    '', '## Expected 目标状态变更', '', renderTable(['类型', '内容', '证据'], [...expectedStates.map((state) => ['状态', state.label, evidenceText(model, state.evidenceIds)]), ...expectedTransitions.map((transition) => ['转换', `${transition.from} → ${transition.to}：${transition.trigger}`, evidenceText(model, transition.evidenceIds)])], '暂无 Expected-only 状态变化'),
    '', '## 未决转换', '', node.unresolvedTransitions.length > 0 ? renderValue(node.unresolvedTransitions) : emptyFieldText(node, 'unresolvedTransitions', '未决转换'),
    '', '## 待确认项', '', renderObjectGaps(model, node),
  ].join('\n');
}

const FIELD_LABELS = new Map([
  ...GAP_FIELD_LABELS,
  ['route', '路由'], ['areas', '页面区域'], ['operationRefs', '操作'], ['action', '动作'], ['actorRefs', '参与角色'],
  ['preconditions', '前置条件'], ['outcomes', '正常结果'], ['errorOutcomes', '异常结果'], ['goal', '目标'], ['steps', '步骤'],
  ['trigger', '触发条件'], ['conditions', '条件'], ['effects', '效果'], ['priority', '优先级'], ['exceptions', '例外'],
  ['configurationRefs', '配置引用'], ['metricType', '指标类型'], ['formula', '公式'], ['unit', '单位'], ['dimensions', '维度'],
  ['filters', '过滤条件'], ['timeWindow', '统计窗口'], ['sourceRefs', '数据来源'], ['refreshPolicy', '刷新策略'],
  ['baseline', '基线'], ['target', '目标值'],
]);

function renderGenericObjectPage(model, node, context, pagePathByRef, path) {
  const sections = [['概览', [`- 状态：${node.status}`, `- 负责人：${node.ownerRefs.map((ref) => readableRef(ref, context)).join('、') || '未指定'}`].join('\n')]];
  for (const field of REQUIRED_FIELDS.get(node.kind) ?? []) {
    if (['sourceIdentity', 'parentRef'].includes(field)) continue;
    const value = node[field];
    if (isEmptyValue(value)) continue;
    let content;
    if (field.endsWith('Ref')) content = `- ${linkedRef(path, value, pagePathByRef, context)}`;
    else if (field.endsWith('Refs')) content = linkedRefs(path, value, pagePathByRef, context);
    else if (objectValue(value) && !('text' in value)) content = renderReadableRecord(value);
    else content = renderValue(value);
    sections.push([FIELD_LABELS.get(field) ?? field, content]);
  }
  if (node.confirmedEmptyFields.length > 0) {
    sections.push(['已确认无', `- ${node.confirmedEmptyFields.map((field) => FIELD_LABELS.get(field) ?? field).join('、')}`]);
  }
  if (node.subjectRefs.length > 0) sections.push(['关联对象', linkedRefs(path, node.subjectRefs, pagePathByRef, context)]);
  sections.push(['证据', renderObjectEvidence(model, node)]);
  sections.push(['待确认项', renderObjectGaps(model, node)]);
  return [`# ${node.name}`, ...sections.flatMap(([title, content]) => ['', `## ${title}`, '', content])].join('\n');
}

const OBJECT_RENDERERS = new Map([
  ['role', renderRolePage],
  ['permission', renderPermissionPage],
  ['data-entity', renderDataEntityPage],
  ['interface', renderInterfacePage],
  ['flow', renderFlowPage],
  ['state-machine', renderStateMachinePage],
]);

function renderObjectPage(model, node, context, pagePathByRef) {
  const path = objectPath(node);
  const inlineObjects = inlineObjectsForPage(model, pagePathByRef, path);
  const meta = pageMeta(model, {
    pageId: `${node.kind}-${node.id}`,
    pageType: node.kind,
    title: node.name,
    subjectRefs: [`${node.kind}:${node.id}`, ...inlineObjects.map((item) => `${item.kind}:${item.id}`)],
    relatedObjectRefs: [...node.subjectRefs, ...inlineObjects.flatMap((item) => item.subjectRefs)],
  });
  const renderer = OBJECT_RENDERERS.get(node.kind) ?? renderGenericObjectPage;
  const body = renderer(model, node, context, pagePathByRef, path);
  return { path, content: withFrontmatter(meta, body, model) };
}

function summarizeRiskItems(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  const priority = (item) => item.startsWith('P0：') ? 0 : item.startsWith('P1：') ? 1 : 2;
  return [...counts.entries()]
    .sort(([left], [right]) => priority(left) - priority(right) || left.localeCompare(right, 'zh-CN'))
    .map(([item, count]) => count > 1 ? `${item}（${count} 项）` : item);
}

function renderCoveragePage(model) {
  const path = '质量治理/目录覆盖与质量报告.md';
  const coverage = model.governance.coverage;
  const byRef = new Map([...Object.values(model.catalog).flat(), ...Object.values(model.objects).flat()].map((node) => [`${node.kind}:${node.id}`, node]));
  const refName = (ref) => byRef.get(ref)?.name ?? ref;
  const gapById = new Map(model.governance.gaps.map((gap) => [gap.id, gap]));
  const gapName = (id) => gapById.get(id)?.title ?? '待确认问题';
  const objectCount = Object.values(coverage.objects).reduce((total, count) => total + count, 0);
  const riskContext = { byRef, catalog: model.catalog, objects: model.objects };
  const visibleProductGapIds = new Set(visibleProductGaps(model.governance.gaps, model.governance.reviewItems).map((gap) => gap.id));
  const audienceLabels = new Map([
    ['product-review', '产品基线'],
    ['data-review', '数据来源与结构'],
    ['engineering-review', '研发证据'],
    ['source-ops', '来源运维'],
    ['internal', '内部完整性'],
  ]);
  const gapRiskItems = [['P0', coverage.risks.p0GapIds], ['P1', coverage.risks.p1GapIds]]
    .map(([severity, ids]) => [severity, ids.filter((id) => gapById.get(id)?.audience !== 'product-review' || visibleProductGapIds.has(id))])
    .flatMap(([severity, ids]) => [...new Set(ids.map((id) => gapById.get(id)?.audience).filter(Boolean))]
      .sort()
      .map((audience) => `${severity}：${audienceLabels.get(audience) ?? audience}（${ids.filter((id) => gapById.get(id)?.audience === audience).length} 项）`));
  const riskItems = [
    ...gapRiskItems,
    ...summarizeRiskItems([
    ...coverage.risks.criticalWithoutEvidence.map((ref) => `关键对象缺少独立证据：${refName(ref)}`),
    ...coverage.risks.nonConfirmedObjectRefs.map((ref) => `对象尚未确认：${refName(ref)}`),
    ...coverage.risks.uncertainClaimIds.map((id) => `Claim 尚未确认：${id}`),
    ...coverage.risks.freshnessGapIds.map((id) => `来源过期：${gapName(id)}`),
    ...coverage.permissions.uncoveredRoleRefs.map((ref) => `权限未覆盖角色：${refName(ref)}`),
    ...coverage.permissions.permissionRoleCoverage
      .filter((item) => !item.complete)
      .map((item) => {
        const reasons = [
          item.missingEnforcementLayers.length > 0 ? `缺少 ${item.missingEnforcementLayers.join('、')} 层证据` : null,
          item.outOfScopeRowCount > 0 ? `存在 ${item.outOfScopeRowCount} 条越界权限行` : null,
          item.permissionStatusConfirmed ? null : '权限状态未确认',
          item.claimsConfirmed ? null : 'Claim 未完全确认',
          item.openGapIds.length > 0 ? `存在待确认问题：${item.openGapIds.map(gapName).join('、')}` : null,
        ].filter(Boolean);
        return `${refName(item.permissionRef)} / ${refName(item.roleRef)}：${reasons.join('；')}`;
      }),
    ...coverage.permissions.permissionDetails
      .filter((item) => item.applicableRoleRefs.length === 0 || item.outOfScopeRowCount > item.roleCoverage.reduce((total, role) => total + role.outOfScopeRowCount, 0))
      .map((item) => {
        const reasons = [
          item.applicableRoleRefs.length === 0 ? '未找到适用角色' : null,
          item.outOfScopeRowCount > 0 ? `共 ${item.outOfScopeRowCount} 条权限行超出适用资源范围` : null,
        ].filter(Boolean);
        return `${refName(item.permissionRef)}：${reasons.join('；')}`;
      }),
    ]),
  ];
  const openProductGaps = visibleProductGaps(model.governance.gaps, model.governance.reviewItems);
  const allOpenGaps = model.governance.gaps.filter((gap) => gap.status === 'open');
  const rawOpenProductGaps = allOpenGaps.filter((gap) => gap.audience === 'product-review');
  const openDataGaps = allOpenGaps.filter((gap) => gap.audience === 'data-review');
  const openEngineeringGaps = allOpenGaps.filter((gap) => gap.audience === 'engineering-review');
  const gapSeverityCounts = Object.fromEntries(['P0', 'P1', 'P2']
    .map((severity) => [severity, openProductGaps.filter((gap) => gap.severity === severity).length]));
  const gapShardCount = new Set(openProductGaps.map((gap) => gapRoute(gap, riskContext).pagePath)).size;
  const blockingGaps = model.governance.publication.blockingGapIds.map((id) => gapById.get(id)).filter(Boolean);
  const blockingGapSummary = blockingGaps.length === 0
    ? '无'
    : `${blockingGaps.length}（产品 ${blockingGaps.filter((gap) => gap.audience === 'product-review').length} / 数据 ${blockingGaps.filter((gap) => gap.audience === 'data-review').length} / 研发 ${blockingGaps.filter((gap) => gap.audience === 'engineering-review').length}）`;
  const permissionRows = coverage.permissions.permissionRoleCoverage.map((item) => [
    refName(item.permissionRef),
    refName(item.roleRef),
    ...[...PERMISSION_LAYERS].map((layer) => item.enforcementLayers[layer] > 0 ? `有（${item.enforcementLayers[layer]}）` : '缺失'),
    item.missingEnforcementLayers.join('、') || '无',
    item.permissionStatusConfirmed ? '已确认' : '未确认',
    item.claimsConfirmed ? '已确认' : '未确认',
    item.openGapIds.map(gapName).join('、') || '无',
    item.outOfScopeRowCount,
    item.complete ? '完整' : '不完整',
  ]);
  const body = [
    '# 目录覆盖与质量报告',
    '', '## 1. 统计范围与 Source Snapshot', '', `- Snapshot：${model.sourceSnapshot.id}`, `- Readiness：${model.sourceReadiness.status}`,
    '', '## 2. 目录与对象数量', '', '| System | Domain | Module | Feature | Object |', '| ---: | ---: | ---: | ---: | ---: |', `| ${coverage.catalog.systems} | ${coverage.catalog.domains} | ${coverage.catalog.modules} | ${coverage.catalog.features} | ${objectCount} |`,
    '', '## 3. 基线成熟度', '', `- Current Implementation 完整映射：${coverage.maturity.currentSnapshot.complete}/${coverage.maturity.currentSnapshot.total}`, `- Historical Requirement Readiness：${coverage.historicalRequirementReadiness}`, `- Approved Product Baseline：${coverage.maturity.approvedBaseline.complete}/${coverage.maturity.approvedBaseline.total}`, `- 产品基线待确认：${coverage.maturity.openDecisionCount}`,
    '', '### 产品审核进度', '', `- 已发现审核项：${coverage.review.total}`, `- 待审核：${coverage.review.pending}（P0 ${coverage.review.p0Pending} / P1 ${coverage.review.p1Pending}）`, `- 已确认：${coverage.review.confirmed}`, `- 已修改：${coverage.review.modified}`, `- 已拒绝：${coverage.review.rejected}`, `- 已延期：${coverage.review.deferred}`, `- Baseline Drift：${coverage.review.drift}`, '- 以上仅表示“已发现审核项”的处理进度，不代表历史 PRD 完整度。',
    '', '### 缺口口径', '', `- Canonical Open Gap：${allOpenGaps.length}`, `- 产品字段级 Gap：${rawOpenProductGaps.length}`, `- 产品可见基线问题：${openProductGaps.length}`, `- 已由具体行为审核接管：${rawOpenProductGaps.length - openProductGaps.length}`, `- 数据待补：${openDataGaps.length}`, `- 研发证据待补：${openEngineeringGaps.length}`, '- 发布阻断是以上 Gap 的子集，不应与各队列相加。',
    '', '### ReviewItem 去重诊断', '', `- 原始候选：${coverage.deduplication.rawCandidateCount ?? 0}`, `- 合并候选：${coverage.deduplication.mergedCandidateCount ?? 0}`, `- 抑制候选：${coverage.deduplication.suppressedCandidateCount ?? 0}`, `- 最终 ReviewItem：${coverage.deduplication.reviewItemCount ?? 0}`,
    '', '### Freshness', '', `- Current Implementation：${coverage.freshness.currentImplementationCapturedAt ?? 'unavailable'}`, `- Product Decision：${coverage.freshness.lastProductDecisionAt ?? 'unavailable'}`,
    '', '### 任务可用性', '', `- 功能理解：${coverage.taskReadiness.productUnderstanding}`, `- 变更影响初筛：${coverage.taskReadiness.changeImpactScreening}`, `- 最终需求基线：${coverage.taskReadiness.finalRequirementBaseline}`, `- 发布验收：${coverage.taskReadiness.releaseAcceptance}`,
    '', '## 4. Claim 分布', '', `- confirmed：${coverage.claims.confirmed}`, `- partial：${coverage.claims.partial}`, `- needs-review：${coverage.claims['needs-review']}`,
    '', '## 5. 证据与指标分布', '', `- 直接 Current 证据：${coverage.evidenceClasses.directCurrent}`, `- 仅 Expected 意图：${coverage.evidenceClasses.intentOnly}`, `- Observed 覆盖：${coverage.evidenceClasses.observed}`, `- 待复核或证据不足：${coverage.evidenceClasses.needsReview}`, `- 产品成功指标：${coverage.metrics['product-success']}`, `- 业务观察指标：${coverage.metrics['business-observation']}`, `- 实现计数：${coverage.metrics['implementation-count']}`, '', ...Object.entries(coverage.evidence).map(([authority, count]) => `- ${authority}：${count}`),
    '', '## 6. 权限覆盖', '', `- 权限对象完整：${coverage.permissions.completePermissions}/${coverage.permissions.totalPermissions}`, `- 已定义角色：${coverage.permissions.declaredRoles}`, `- 适用角色有权限行：${coverage.permissions.roles}/${coverage.permissions.totalRoles}`, `- 无权限行适用角色：${coverage.permissions.uncoveredRoleRefs.map(refName).join('、') || '无'}`, `- 适用资源数：${coverage.permissions.resources}`, `- 适用资源动作数：${coverage.permissions.actions}`, `- 越界权限行：${coverage.permissions.outOfScopeRows}`, ...Object.entries(coverage.permissions.enforcementLayers).map(([layer, count]) => `- ${layer} 层有效证据行：${count}`), `- 任一适用角色缺失层：${coverage.permissions.missingEnforcementLayers.join('、') || '无'}`, '', renderTable(['权限', '角色', 'product', 'ui', 'api', 'data', '缺失层', '权限状态', 'Claim', 'Open Gap', '越界行', '结论'], permissionRows, '暂无权限与角色覆盖关系'), '', `- 权限覆盖结论：${coverage.permissions.complete ? '完整' : '不完整'}`,
    '', '## 7. 业务流程三视图覆盖', '', `- 完整业务流程：${coverage.flows.overview.covered}/${coverage.flows.overview.total}（${coverage.flows.overview.rate}%）`, `- 状态适用性：${coverage.flows.state.covered}/${coverage.flows.state.total}（${coverage.flows.state.rate}%）`, `- 时序适用性：${coverage.flows.sequence.covered}/${coverage.flows.sequence.total}（${coverage.flows.sequence.rate}%）`, '', renderTable(['流程', '完整流程', '状态评估', '时序评估'], coverage.flows.details.map((item) => [refName(item.flowRef), item.overviewCovered ? '已覆盖' : '未覆盖', item.stateCovered ? '已覆盖' : '未覆盖', item.sequenceCovered ? '已覆盖' : '未覆盖']), '暂无业务流程'),
    '', '## 8. 风险与阻断项', '', renderValue(riskItems, '暂无开放风险'),
    '', '## 9. 缺口任务', '', openProductGaps.length === 0
      ? '暂无缺口任务'
      : [`- 待处理：${openProductGaps.length}（P0 ${gapSeverityCounts.P0} / P1 ${gapSeverityCounts.P1} / P2 ${gapSeverityCounts.P2}）`, `- 分片：${gapShardCount}`, `- 入口：[查看待确认问题](${linkTarget(path, '质量治理/待确认问题.md')})`].join('\n'),
    '', '## 10. 发布结论', '', `- ${model.governance.publication.status}`, `- 阻断问题：${blockingGapSummary}`, `- 阻断对象：${model.governance.publication.blockingObjectRefs.map(refName).join('、') || '无'}`,
  ].join('\n');
  return { path, content: withFrontmatter(pageMeta(model, { pageId: 'governance-coverage', pageType: 'coverage-report', title: '目录覆盖与质量报告', subjectRefs: [] }), body, model) };
}

function renderGapEntry(gap) {
  const response = renderGapResponseGuidance(gap.responseContract);
  const responseSection = gap.responseContract.guidanceMode === 'evidence-request'
    ? ['### 需要补充的证据', '', response]
    : ['### 需要你确认', '', gap.question, '', '### 请按以下内容回答', '', response];
  return [
    `## ${gap.title}`,
    '', `**优先级：${gap.severity}｜影响阶段：${gap.blockingStage}**`,
    '', '### 当前情况', '', gap.context,
    '', ...responseSection,
    '', '### 为什么需要确认', '', gap.decisionImpact,
    '', '### 什么时候算补齐', '', ...gap.resolutionCriteria.map((criterion) => `- ${criterion.label}`),
  ].join('\n');
}

function renderPendingPages(model, context) {
  const stageOrder = new Map(['baseline', 'design', 'development', 'release'].map((stage, index) => [stage, index]));
  const severityOrder = new Map(['P0', 'P1', 'P2'].map((severity, index) => [severity, index]));
  const gaps = visibleProductGaps(model.governance.gaps, model.governance.reviewItems)
    .sort((left, right) => severityOrder.get(left.severity) - severityOrder.get(right.severity)
      || stageOrder.get(left.blockingStage) - stageOrder.get(right.blockingStage)
      || left.id.localeCompare(right.id));
  if (gaps.length === 0) return [];
  const groups = new Map();
  for (const gap of gaps) {
    const route = gapRoute(gap, context);
    if (!groups.has(route.pagePath)) groups.set(route.pagePath, { route, gaps: [] });
    groups.get(route.pagePath).gaps.push(gap);
  }
  const shards = [...groups.values()].sort((left, right) => left.route.pagePath.localeCompare(right.route.pagePath)).map(({ route, gaps: groupGaps }) => {
    const target = route.featureRef ? context.byRef.get(route.featureRef)?.name : `${route.system?.name ?? '共享'}系统级问题`;
    return {
      path: route.pagePath,
      content: [`# ${target}待确认问题`, '', '以下问题按优先级排列。每次只处理一个问题；无法确认时保持 open。', '', ...groupGaps.map(renderGapEntry)].join('\n') + '\n',
    };
  });
  const rows = [...groups.values()].sort((left, right) => left.route.pagePath.localeCompare(right.route.pagePath)).map(({ route, gaps: groupGaps }) => [
    route.system?.name ?? '共享',
    route.featureRef ? context.byRef.get(route.featureRef)?.name ?? '功能级问题' : '系统级问题',
    groupGaps.filter((gap) => gap.severity === 'P0').length,
    groupGaps.filter((gap) => gap.severity === 'P1').length,
    groupGaps.filter((gap) => gap.severity === 'P2').length,
    [...new Set(groupGaps.map((gap) => gap.blockingStage))].join('、'),
    `[查看并回答](${linkTarget('质量治理/待确认问题.md', route.pagePath)})`,
  ]);
  const index = {
    path: '质量治理/待确认问题.md',
    content: [
      '# 待确认问题',
      '', '本页只用于定位。请选择目标系统和功能，再进入对应 Markdown 回答；不要读取完整 canonical model。',
      '', `- 待处理问题：${gaps.length}`, `- 涉及分片：${groups.size}`,
      '', renderTable(['系统', '功能', 'P0', 'P1', 'P2', '阻断阶段', '入口'], rows),
    ].join('\n') + '\n',
  };
  return [index, ...shards];
}

export function buildReadableGapProjections(model) {
  const byRef = new Map([
    ...Object.values(model.catalog).flat(),
    ...Object.values(model.objects).flat(),
  ].map((node) => [`${node.kind}:${node.id}`, node]));
  const context = { byRef, catalog: model.catalog, objects: model.objects };
  return {
    pages: renderPendingPages(model, context),
    metadata: buildGapIndexProjections(model),
  };
}

function renderReviewPages(model, context) {
  const items = model.governance.reviewItems ?? [];
  if (items.length === 0) return [];
  const groups = new Map();
  for (const item of items) {
    const path = reviewPagePath(item, context);
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(item);
  }
  const shards = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([path, groupItems]) => {
    const featureRef = groupItems[0].featureRef;
    const feature = context.byRef.get(featureRef);
    const sorted = [...groupItems].sort((left, right) => left.priority.localeCompare(right.priority) || left.id.localeCompare(right.id));
    const pending = sorted.filter((item) => ['pending', 'drift'].includes(item.status));
    const preferred = pending.filter((item) => ['P0', 'P1'].includes(item.priority));
    const next = (preferred.length > 0 ? preferred : pending).slice(0, 5);
    const remaining = sorted.filter((item) => !next.some((selected) => selected.id === item.id));
    const subjects = [...new Set([featureRef, ...sorted.flatMap((item) => item.subjectRefs)])];
    const body = [
      `# ${feature?.name ?? featureRef}产品审核`,
      '', '本页按价值排序，每次只处理一条；默认批次最多 5 项。逆向提案不是已确认产品要求。',
      '', `- 全部审核项：${sorted.length}`, `- 待处理：${pending.length}`, `- 本批：${next.length}`,
      '', '## 下一批', '', ...(next.length > 0 ? next.map((item) => renderReviewCard(item, model)) : ['- 暂无待审核项']),
      ...(remaining.length > 0 ? ['', '<details>', '<summary>其余队列（按需展开）</summary>', '', ...remaining.map((item) => renderReviewCard(item, model)), '', '</details>'] : []),
    ].join('\n');
    return {
      path,
      content: withFrontmatter(pageMeta(model, {
        pageId: `review-${refId(featureRef)}`,
        pageType: 'product-review-queue',
        title: `${feature?.name ?? featureRef}产品审核`,
        subjectRefs: subjects,
        relatedObjectRefs: subjects.filter((ref) => ref !== featureRef),
      }), body, model),
    };
  });
  const rows = shards.map((shard) => {
    const groupItems = groups.get(shard.path);
    const feature = context.byRef.get(groupItems[0].featureRef);
    const system = systemForFeatureRef(groupItems[0].featureRef, context);
    return [system?.name ?? '共享', feature?.name ?? groupItems[0].featureRef, groupItems.filter((item) => item.priority === 'P0' && ['pending', 'drift'].includes(item.status)).length, groupItems.filter((item) => item.priority === 'P1' && ['pending', 'drift'].includes(item.status)).length, `[开始审核](${linkTarget('质量治理/产品审核.md', shard.path)})`];
  });
  const indexBody = [
    '# 产品审核', '', '请选择一个 Feature，每次只确认一条验收标准。工程、数据和来源证据缺口不进入本队列。',
    '', renderTable(['系统', '功能', 'P0', 'P1', '入口'], rows),
  ].join('\n');
  return [{
    path: '质量治理/产品审核.md',
    content: withFrontmatter(pageMeta(model, { pageId: 'product-review-index', pageType: 'product-review-index', title: '产品审核', subjectRefs: [] }), indexBody, model),
  }, ...shards];
}

function renderVersionPage(model, version) {
  const path = `质量治理/版本与变更/${safeFilename(version.id, version.id)}-${safeFilename(version.name, version.id)}.md`;
  const body = [`# ${version.name}`, '', '## 版本', '', renderValue(version.label), '', '## 生效时间', '', renderValue(version.effectiveAt), '', '## 变更', '', renderValue(version.changeRefs), '', '## 替代版本', '', renderValue(version.supersedesRefs)].join('\n');
  return { path, content: withFrontmatter(pageMeta(model, { pageId: `version-${version.id}`, pageType: 'version-change', title: version.name, subjectRefs: [`version:${version.id}`], relatedObjectRefs: version.subjectRefs }), body, model) };
}

function featureRefsForObject(node, context) {
  const ref = `${node.kind}:${node.id}`;
  const direct = node.subjectRefs.filter((subjectRef) => context.byRef.get(subjectRef)?.kind === 'feature');
  const catalog = context.catalog.features
    .filter((feature) => FEATURE_CATALOG_ENTRY_FIELDS.some((field) => (feature[field] ?? []).includes(ref)))
    .map((feature) => `feature:${feature.id}`);
  return [...new Set([...direct, ...catalog])].sort((left, right) => {
    const leftNode = context.byRef.get(left);
    const rightNode = context.byRef.get(right);
    return (leftNode?.order ?? 0) - (rightNode?.order ?? 0) || left.localeCompare(right);
  });
}

function flowRefsForInlineObject(node, context) {
  const ref = `${node.kind}:${node.id}`;
  return context.objects.flows
    .filter((flow) => flow.entryRefs.includes(ref) || flow.subjectRefs.includes(ref))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((flow) => `flow:${flow.id}`);
}

function inlineObjectAnchor(node) {
  return `${node.kind}-${node.id}`;
}

function buildPathMap(model, context) {
  const map = new Map();
  model.catalog.systems.forEach((node) => map.set(`system:${node.id}`, { pagePath: systemPath(node) }));
  model.catalog.features.forEach((node) => map.set(`feature:${node.id}`, { pagePath: featurePath(node, context) }));
  for (const node of Object.values(model.objects).flat()) {
    const path = objectPath(node);
    if (path) map.set(`${node.kind}:${node.id}`, { pagePath: path });
    if (node.kind === 'version') map.set(`version:${node.id}`, { pagePath: `质量治理/版本与变更/${safeFilename(node.id, node.id)}-${safeFilename(node.name, node.id)}.md` });
  }
  const inlineNodes = [
    ...model.objects.pages,
    ...model.objects.operations,
    ...model.objects.metrics.filter((metric) => metric.metricType !== 'product-success'),
  ];
  for (const node of inlineNodes.sort((left, right) => left.order - right.order || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id))) {
    const ref = `${node.kind}:${node.id}`;
    const featureRef = featureRefsForObject(node, context)[0];
    if (featureRef) {
      map.set(ref, { pagePath: map.get(featureRef).pagePath, anchor: inlineObjectAnchor(node) });
      continue;
    }
    const flowRef = flowRefsForInlineObject(node, context)[0];
    if (flowRef) {
      map.set(ref, { pagePath: map.get(flowRef).pagePath, anchor: inlineObjectAnchor(node) });
      continue;
    }
    const systemRef = node.subjectRefs.find((subjectRef) => context.byRef.get(subjectRef)?.kind === 'system');
    if (systemRef) {
      map.set(ref, { pagePath: map.get(systemRef).pagePath, anchor: inlineObjectAnchor(node) });
      continue;
    }
    fail('wiki-object-projection-route-missing', `Inline ${ref} has no Feature, Flow, or System projection route.`, ref);
  }
  return map;
}

function compareIndexNodes(left, right) {
  return (left.order ?? 0) - (right.order ?? 0)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id);
}

function lightweightHierarchyNode(node, childField) {
  return {
    ref: `${node.kind}:${node.id}`,
    name: node.name,
    status: node.status,
    order: node.order,
    parentRef: node.parentRef,
    [childField]: [...node[childField]],
  };
}

export function buildCatalogIndexProjections(model) {
  const byRef = new Map([
    ...Object.values(model.catalog).flat(),
    ...Object.values(model.objects).flat(),
  ].map((node) => [`${node.kind}:${node.id}`, node]));
  const context = { byRef, catalog: model.catalog, objects: model.objects };
  const pathMap = buildPathMap(model, context);
  const systems = [...model.catalog.systems].sort(compareIndexNodes);
  const systemDrafts = systems.map((system) => {
    const domains = system.domainRefs.map((ref) => byRef.get(ref)).filter(Boolean);
    const modules = domains.flatMap((domain) => domain.moduleRefs.map((ref) => byRef.get(ref))).filter(Boolean);
    const features = modules.flatMap((module) => module.featureRefs.map((ref) => byRef.get(ref))).filter(Boolean);
    const membership = new Map();
    const addEntry = (ref, featureRef = null) => {
      const node = byRef.get(ref);
      if (!node || ['system', 'domain', 'module'].includes(node.kind)) return;
      if (!membership.has(ref)) membership.set(ref, { node, featureRefs: new Set() });
      if (featureRef) membership.get(ref).featureRefs.add(featureRef);
    };
    for (const feature of features) {
      const featureRef = `feature:${feature.id}`;
      addEntry(featureRef, featureRef);
      for (const field of FEATURE_CATALOG_ENTRY_FIELDS) {
        for (const ref of feature[field] ?? []) addEntry(ref, featureRef);
      }
    }
    for (const node of [system, ...domains, ...modules]) {
      for (const field of CATALOG_OBJECT_ENTRY_FIELDS) {
        for (const ref of node[field] ?? []) addEntry(ref);
      }
    }
    return { system, domains, modules, features, membership };
  });
  const systemsByEntryRef = new Map();
  for (const { system, membership } of systemDrafts) {
    for (const ref of membership.keys()) {
      if (!systemsByEntryRef.has(ref)) systemsByEntryRef.set(ref, new Set());
      systemsByEntryRef.get(ref).add(`system:${system.id}`);
    }
  }
  const shards = systemDrafts.map(({ system, domains, modules, features, membership }) => {
    const entries = [...membership.entries()].map(([ref, { node, featureRefs }]) => {
      const sortedFeatureRefs = [...featureRefs].sort();
      const route = pathMap.get(ref) ?? pathMap.get(sortedFeatureRefs[0]);
      if (!route) fail('wiki-catalog-entry-route-missing', `Catalog entry has no page route: ${ref}.`, `$.catalog.${system.id}.${ref}`);
      return {
        ref,
        kind: node.kind,
        name: node.name,
        status: node.status,
        order: node.order,
        pagePath: route.pagePath,
        ...(route.anchor ? { anchor: route.anchor } : {}),
        featureRefs: sortedFeatureRefs,
        shared: (systemsByEntryRef.get(ref)?.size ?? 0) > 1,
      };
    }).sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref));
    const value = {
      schemaVersion: 1,
      kind: 'yog-product-wiki-system-catalog',
      sourceSnapshotId: model.sourceSnapshot.id,
      system: {
        ref: `system:${system.id}`,
        name: system.name,
        status: system.status,
        order: system.order,
        overviewPath: pathMap.get(`system:${system.id}`).pagePath,
      },
      domains: domains.map((node) => lightweightHierarchyNode(node, 'moduleRefs')),
      modules: modules.map((node) => lightweightHierarchyNode(node, 'featureRefs')),
      entries,
    };
    return {
      path: `_meta/catalog/${system.id}.json`,
      value,
      content: compactJson(value),
      counts: {
        domains: domains.length,
        modules: modules.length,
        features: features.length,
        entries: entries.length,
      },
    };
  });
  const root = {
    schemaVersion: 1,
    kind: 'yog-product-wiki-catalog-index',
    sourceSnapshotId: model.sourceSnapshot.id,
    systems: shards.map(({ path, value, content, counts }) => ({
      ref: value.system.ref,
      name: value.system.name,
      status: value.system.status,
      order: value.system.order,
      catalogPath: path,
      catalogHash: sha256(content),
      overviewPath: value.system.overviewPath,
      counts,
    })),
  };
  return [
    { path: '_meta/catalog.json', value: root, content: compactJson(root) },
    ...shards.map(({ path, value, content }) => ({ path, value, content })),
  ];
}

export function buildFlowIndexProjections(model) {
  const byRef = new Map([
    ...Object.values(model.catalog).flat(),
    ...Object.values(model.objects).flat(),
  ].map((node) => [`${node.kind}:${node.id}`, node]));
  const context = { byRef, catalog: model.catalog, objects: model.objects };
  const pathMap = buildPathMap(model, context);
  const systemEntries = new Map(model.catalog.systems.map((system) => [system.id, { system, entries: [] }]));
  for (const flow of model.objects.flows) {
    const systems = systemsForFlow(flow, context);
    const featureRefs = featureRefsForFlow(flow, context);
    for (const system of systems) {
      systemEntries.get(system.id)?.entries.push({
        ref: `flow:${flow.id}`,
        name: flow.name,
        goal: flow.goal,
        pagePath: pathMap.get(`flow:${flow.id}`).pagePath,
        featureRefs,
        entryRefs: [...flow.entryRefs].sort(),
        status: flow.status,
        shared: systems.length > 1,
      });
    }
  }
  const shards = [...systemEntries.values()]
    .filter(({ entries }) => entries.length > 0)
    .sort((left, right) => left.system.order - right.system.order || left.system.id.localeCompare(right.system.id))
    .map(({ system, entries }) => {
      const value = {
        schemaVersion: 1,
        kind: 'yog-product-wiki-system-flow-index',
        sourceSnapshotId: model.sourceSnapshot.id,
        system: { ref: `system:${system.id}`, name: system.name },
        entries: entries.sort((left, right) => left.ref.localeCompare(right.ref)),
      };
      const path = `_meta/flows/${system.id}.json`;
      return { path, value, content: compactJson(value) };
    });
  const root = {
    schemaVersion: 1,
    kind: 'yog-product-wiki-flow-index',
    sourceSnapshotId: model.sourceSnapshot.id,
    systems: shards.map(({ path, value }) => ({
      systemRef: value.system.ref,
      flowCount: value.entries.length,
      flowCatalogPath: path,
    })),
  };
  return [{ path: '_meta/flows.json', value: root, content: compactJson(root) }, ...shards];
}

export function buildGapIndexProjections(model) {
  const byRef = new Map([
    ...Object.values(model.catalog).flat(),
    ...Object.values(model.objects).flat(),
  ].map((node) => [`${node.kind}:${node.id}`, node]));
  const context = { byRef, catalog: model.catalog, objects: model.objects };
  const openGaps = visibleProductGaps(model.governance.gaps, model.governance.reviewItems);
  const bySystem = new Map();
  for (const gap of openGaps) {
    const route = gapRoute(gap, context);
    if (!bySystem.has(route.systemId)) bySystem.set(route.systemId, { route, entries: [] });
    bySystem.get(route.systemId).entries.push({
      gapId: gap.id,
      title: gap.title,
      severity: gap.severity,
      status: gap.status,
      resolutionMode: gap.resolutionMode,
      blockingStage: gap.blockingStage,
      subjectRefs: gap.subjectRefs,
      fieldRefs: gap.fieldRefs,
      featureRefs: route.featureRefs,
      pagePath: route.pagePath,
    });
  }
  const shards = [...bySystem.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([systemId, { route, entries }]) => {
    const value = {
      schemaVersion: 1,
      kind: 'yog-product-wiki-system-gap-index',
      sourceSnapshotId: model.sourceSnapshot.id,
      system: { ref: route.system ? `system:${route.system.id}` : 'system:shared', name: route.system?.name ?? '共享' },
      entries: entries.sort((left, right) => left.severity.localeCompare(right.severity) || left.blockingStage.localeCompare(right.blockingStage) || left.gapId.localeCompare(right.gapId)),
    };
    const path = `_meta/gaps/${safeFilename(systemId, systemId)}.json`;
    const content = compactJson(value);
    return { path, value, content };
  });
  const root = {
    schemaVersion: 1,
    kind: 'yog-product-wiki-gap-index',
    sourceSnapshotId: model.sourceSnapshot.id,
    openGapCount: openGaps.length,
    systems: shards.map(({ path, value, content }) => ({
      ref: value.system.ref,
      name: value.system.name,
      openGapCount: value.entries.length,
      gapCatalogPath: path,
      gapCatalogHash: sha256(content),
    })),
  };
  return [{ path: '_meta/gaps.json', value: root, content: compactJson(root) }, ...shards.map(({ path, value, content }) => ({ path, value, content }))];
}

export function buildReviewIndexProjections(model) {
  const byRef = new Map([
    ...Object.values(model.catalog).flat(),
    ...Object.values(model.objects).flat(),
  ].map((node) => [`${node.kind}:${node.id}`, node]));
  const context = { byRef, catalog: model.catalog, objects: model.objects };
  const bySystem = new Map();
  for (const item of model.governance.reviewItems ?? []) {
    const system = systemForFeatureRef(item.featureRef, context);
    const systemId = system?.id ?? 'shared';
    if (!bySystem.has(systemId)) bySystem.set(systemId, { system, entries: [] });
    bySystem.get(systemId).entries.push({
      reviewItemId: item.id,
      featureRef: item.featureRef,
      priority: item.priority,
      status: item.status,
      reviewKind: item.reviewKind,
      sourceFactLevel: item.sourceFactLevel,
      pagePath: reviewPagePath(item, context),
      anchor: reviewAnchor(item),
    });
  }
  const shards = [...bySystem.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([systemId, { system, entries }]) => {
    const value = {
      schemaVersion: 1,
      kind: 'yog-product-wiki-system-review-index',
      sourceSnapshotId: model.sourceSnapshot.id,
      system: { ref: system ? `system:${system.id}` : 'system:shared', name: system?.name ?? '共享' },
      entries: entries.sort((left, right) => left.priority.localeCompare(right.priority) || left.featureRef.localeCompare(right.featureRef) || left.reviewItemId.localeCompare(right.reviewItemId)),
    };
    const path = `_meta/reviews/${safeFilename(systemId, systemId)}.json`;
    const content = compactJson(value);
    return { path, value, content };
  });
  const root = {
    schemaVersion: 1,
    kind: 'yog-product-wiki-review-index',
    sourceSnapshotId: model.sourceSnapshot.id,
    counts: {
      ...Object.fromEntries(['pending', 'confirmed', 'modified', 'rejected', 'deferred', 'drift'].map((status) => [status, (model.governance.reviewItems ?? []).filter((item) => item.status === status).length])),
      total: (model.governance.reviewItems ?? []).length,
    },
    diagnostics: model.governance.reviewDiagnostics,
    systems: shards.map(({ path, value, content }) => ({
      ref: value.system.ref,
      name: value.system.name,
      reviewItemCount: value.entries.length,
      reviewCatalogPath: path,
      reviewCatalogHash: sha256(content),
    })),
  };
  return [{ path: '_meta/reviews.json', value: root, content: compactJson(root) }, ...shards.map(({ path, value, content }) => ({ path, value, content }))];
}

function renderIndex(model, context, pathMap) {
  const lines = ['# 产品知识目录', '', `- Source readiness：${model.sourceReadiness.status}`, `- Source snapshot：${model.sourceSnapshot.id}`, '', '## 产品目录'];
  for (const system of model.catalog.systems) {
    lines.push('', `### [${system.name}](${routeTarget('目录.md', pathMap.get(`system:${system.id}`))})`);
    for (const domainRef of system.domainRefs) {
      const domain = context.byRef.get(domainRef);
      lines.push('', `- ${domain.name}`);
      for (const moduleRef of domain.moduleRefs) {
        const module = context.byRef.get(moduleRef);
        lines.push(`  - ${module.name}`);
        for (const featureRef of module.featureRefs) {
          const feature = context.byRef.get(featureRef);
          lines.push(`    - [${feature.name}](${routeTarget('目录.md', pathMap.get(featureRef))})`);
        }
      }
    }
  }
  lines.push('', '## 知识对象', '', '- [业务流程目录](知识对象/业务流程/目录.md)');
  const kindsByDirectory = new Map();
  for (const [kind, directory] of OBJECT_DIRECTORIES) {
    if (!kindsByDirectory.has(directory)) kindsByDirectory.set(directory, []);
    kindsByDirectory.get(directory).push(kind);
  }
  for (const [directory, kinds] of kindsByDirectory) {
    const nodes = [...context.byRef.values()].filter((node) => kinds.includes(node.kind) && pathMap.has(`${node.kind}:${node.id}`));
    if (nodes.length === 0) continue;
    lines.push('', `### ${directory}`, '', ...nodes.map((node) => `- [${node.name}](${routeTarget('目录.md', pathMap.get(`${node.kind}:${node.id}`))})`));
  }
  lines.push('', '## 质量治理', '', '- [产品审核](质量治理/产品审核.md)', '- [目录覆盖与质量报告](质量治理/目录覆盖与质量报告.md)');
  if (visibleProductGaps(model.governance.gaps, model.governance.reviewItems).length > 0) lines.push('- [待确认问题](质量治理/待确认问题.md)');
  const meta = pageMeta(model, { pageId: 'wiki-catalog', pageType: 'catalog', title: '产品知识目录', subjectRefs: [] });
  return { path: '目录.md', content: withFrontmatter(meta, lines.join('\n'), model) };
}

function renderFlowDirectory(model, context, pathMap) {
  const path = '知识对象/业务流程/目录.md';
  const rows = model.objects.flows.map((flow) => {
    const stateMachineObjects = flow.stateMachineRefs.map((ref) => context.byRef.get(ref)).filter(Boolean);
    const coreObjects = [...new Set(stateMachineObjects.map((machine) => readableRef(machine.businessObjectRef, context)))];
    return [
      linkedRef(path, `flow:${flow.id}`, pathMap, context),
      displayFact(flow.goal),
      flow.entryRefs.map((ref) => readableRef(ref, context)).join('、')
        || (flow.confirmedEmptyFields.includes('entryRefs') ? '已确认无页面入口' : '待确认（见 Gap）'),
      coreObjects.join('、') || '无独立状态对象',
      systemsForFlow(flow, context).map((system) => system.name).join('、') || '待确认',
      flow.status,
    ];
  });
  const body = [
    '# 业务流程目录',
    '', '本页用于按业务目标定位端到端流程。Agent 应先通过 `_meta/flows.json` 定位系统分片，再读取一个流程页面；不要读取完整 model。',
    '', renderTable(['业务流程', '业务目标', '入口', '核心对象', '涉及系统', '证据状态'], rows, '暂无已确认业务流程'),
  ].join('\n');
  return { path, content: withFrontmatter(pageMeta(model, { pageId: 'flow-directory', pageType: 'flow-directory', title: '业务流程目录', subjectRefs: [] }), body, model) };
}

function renderAgentGuidance(model) {
  const meta = pageMeta(model, {
    pageId: 'wiki-agent-guidance',
    pageType: 'agent-guidance',
    title: 'Wiki Agent 阅读指南',
    subjectRefs: [],
  });
  const body = [
    '# Wiki Agent 阅读指南',
    '',
    '本目录是 Yog 管理的产品 Wiki。回答产品问题时按最小上下文路径读取，不要从完整模型开始。',
    '',
    '## 默认检索顺序',
    '',
    '1. 先读取 `_meta/catalog.json`，只用它定位目标 System。',
    '2. 只读取该 System 指向的 `_meta/catalog/<system-id>.json` 二级索引。',
    '3. 查询端到端业务流程时，读取 `_meta/flows.json` 定位目标 System，再只读 `_meta/flows/<system-id>.json`、`知识对象/业务流程/目录.md` 和一个目标 Flow 页面。',
    '4. 根据二级索引中的 `pagePath` 读取目标 Markdown；跨系统问题才加载其他 System 分片。',
    '5. 仅在需要追溯事实时，按当前对象引用或页面 frontmatter 中的 ID 定向过滤 `_meta/relationships.json`、`_meta/claims.json` 和 `_meta/evidence.json`。',
    '6. 产品审核先读取 `_meta/reviews.json` 定位 System，再只读 `_meta/reviews/<system-id>.json`、一个 Feature 审核分片和 Feature 正文；每次只处理一个 ReviewItem。工程或数据缺口才定向读取 `_meta/gaps.json`。',
    '',
    '## 上下文边界',
    '',
    '- 不要全文读取、输出或 `cat _meta/model.json`；它是生成与校验使用的完整 canonical model，体积可能很大。',
    '- 不要一次性全文加载 Claims、Relationships 或 Evidence；只读取回答当前问题所需的条目。',
    '- 优先引用目标 Markdown 中已组织好的产品说明，只有在需要验证关系、事实层级或证据来源时才下钻 `_meta` 投影。',
  ].join('\n');
  return { path: 'AGENTS.md', content: withFrontmatter(meta, body, model) };
}

function renderPages(model, context) {
  const pathMap = buildPathMap(model, context);
  const pages = [renderAgentGuidance(model), renderIndex(model, context, pathMap), renderFlowDirectory(model, context, pathMap)];
  pages.push(...model.catalog.systems.map((system) => renderSystemPage(model, system, context, pathMap)));
  pages.push(...model.catalog.features.map((feature) => renderFeaturePage(model, feature, context, pathMap)));
  for (const node of Object.values(model.objects).flat()) {
    if (OBJECT_DIRECTORIES.has(node.kind) && objectPath(node)) pages.push(renderObjectPage(model, node, context, pathMap));
    if (node.kind === 'version') pages.push(renderVersionPage(model, node));
  }
  pages.push(renderCoveragePage(model));
  pages.push(...renderReviewPages(model, context));
  pages.push(...renderPendingPages(model, context));
  const paths = new Set();
  for (const page of pages) {
    if (paths.has(page.path)) fail('wiki-page-path-duplicate', `Duplicate rendered page: ${page.path}.`, page.path);
    paths.add(page.path);
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(page.content))) fail('wiki-sensitive-content', `Generated page contains sensitive content: ${page.path}.`, page.path, [issue('wiki-sensitive-content', 'Generated content contains a sensitive or machine-local value.', page.path, 'P0')]);
  }
  const pageByPath = new Map(pages.map((page) => [page.path, page]));
  for (const page of pages) {
    for (const match of page.content.matchAll(/\]\(([^)#]+\.md)(?:#([^)]+))?\)/g)) {
      const resolved = posix.normalize(posix.join(posix.dirname(page.path), match[1]));
      if (!paths.has(resolved)) fail('wiki-link-broken', `Broken internal link ${match[1]} in ${page.path}.`, page.path);
      if (match[2] && !pageByPath.get(resolved)?.content.includes(`<a id="${match[2]}"></a>`)) {
        fail('wiki-link-anchor-broken', `Broken internal anchor ${match[2]} in ${page.path}.`, page.path);
      }
    }
  }
  return pages.sort((left, right) => left.path.localeCompare(right.path));
}

function sourceSnapshotId(snapshot) {
  return sha256(JSON.stringify({
    sources: snapshot.sources,
    artifactFingerprints: snapshot.artifactFingerprints,
    inputConfirmation: snapshot.inputConfirmation,
  }));
}

function sourceSnapshot(readiness, configuredSources, inputConfirmation) {
  const configuredById = new Map(configuredSources.map((source) => [source.id, source]));
  const sources = readiness.sourceResults.map((result) => ({
    sourceId: result.sourceId,
    kind: result.kind,
    provider: result.provider,
    status: result.status,
    capturedAt: result.capturedAt,
    sourceRevision: result.sourceRevision,
    fingerprint: result.fingerprint,
    reasonCode: result.reasonCode,
    maxAgeHours: configuredById.get(result.sourceId)?.freshness?.maxAgeHours ?? null,
    expiresAt: configuredById.get(result.sourceId)?.freshness?.maxAgeHours && result.capturedAt
      ? new Date(Date.parse(result.capturedAt) + configuredById.get(result.sourceId).freshness.maxAgeHours * 60 * 60 * 1000).toISOString()
      : null,
  })).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const artifactFingerprints = readiness.artifacts.map((artifact) => ({ sourceId: artifact.sourceId, kind: artifact.kind, fingerprint: artifact.fingerprint })).sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.kind.localeCompare(right.kind));
  const snapshot = {
    inputConfirmation: structuredClone(inputConfirmation),
    sources,
    artifactFingerprints,
  };
  return { id: sourceSnapshotId(snapshot), ...snapshot };
}

function buildCoverage({ readiness, catalog, objects, relationships = [], claims, evidence, gaps, reviewItems = [], reviewDiagnostics = {}, declared = {} }) {
  const byRef = new Map([...Object.values(catalog).flat(), ...Object.values(objects).flat()].map((node) => [`${node.kind}:${node.id}`, node]));
  const coverageContext = { byRef, gaps };
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const authorityByEvidence = new Map(evidence.map((item) => [item.id, item.authority]));
  const entryLevel = (entry, layer = 'current') => {
    const levels = entry.claimIds.map((id) => claimById.get(id)).filter((claim) => claim?.layer === layer).map((claim) => claim.factLevel);
    if (levels.includes('needs-review')) return 'needs-review';
    if (levels.includes('partial')) return 'partial';
    return levels.includes('confirmed') ? 'confirmed' : null;
  };
  const usableEntry = (entry, layer = 'current') => ['confirmed', 'partial'].includes(entryLevel(entry, layer));
  const evidenceClasses = { directCurrent: 0, intentOnly: 0, observed: 0, needsReview: 0 };
  for (const claim of claims) {
    const authorities = claim.evidenceIds.map((id) => authorityByEvidence.get(id));
    if (claim.factLevel !== 'confirmed') evidenceClasses.needsReview += 1;
    else if (claim.layer === 'observed') evidenceClasses.observed += 1;
    else if (claim.layer === 'expected') evidenceClasses.intentOnly += 1;
    else if (authorities.some((authority) => ['implementation-fact', 'test-verification', 'data-structure-fact'].includes(authority))) evidenceClasses.directCurrent += 1;
    else evidenceClasses.needsReview += 1;
  }
  const criticalKinds = new Set(['rule', 'permission', 'state-machine', 'interface']);
  const criticalWithoutEvidence = Object.values(objects).flat()
    .filter((node) => criticalKinds.has(node.kind) && (node.claimIds.length === 0 || node.evidenceIds.length === 0))
    .map((node) => `${node.kind}:${node.id}`).sort();
  const nonConfirmedObjectRefs = Object.values(objects).flat()
    .filter((node) => ['partial', 'needs-review'].includes(node.status))
    .map((node) => `${node.kind}:${node.id}`).sort();
  const uncertainClaimIds = claims.filter((claim) => claim.factLevel !== 'confirmed').map((claim) => claim.id).sort();
  const featureDetails = catalog.features.map((feature) => {
    const featureRef = `feature:${feature.id}`;
    const result = readiness.featureResults.find((item) => item.featureId === feature.id);
    const acceptance = acceptanceCoverageFor(feature, coverageContext);
    const gapIds = gaps.filter((gap) => gap.status === 'open' && gap.type === 'acceptance-gap'
      && gap.subjectRefs.some((ref) => ref === featureRef || acceptance.operationRefs.includes(ref))).map((gap) => gap.id).sort();
    const acceptanceDefinitions = feature.acceptanceCriteriaRefs.map((ref) => byRef.get(ref)).filter(Boolean);
    const nodeClaimsConfirmed = (node) => node.status === 'confirmed'
      && node.claimIds.length > 0
      && node.claimIds.every((id) => claimById.get(id)?.factLevel === 'confirmed');
    const acceptanceFactsConfirmed = acceptanceDefinitions.length > 0 && acceptanceDefinitions.every((item) => {
      if (!nodeClaimsConfirmed(item)) return false;
      if (item.requirementRef && !nodeClaimsConfirmed(byRef.get(item.requirementRef))) return false;
      if (item.decisionId) return item.evidenceIds.some((id) => evidence.find((entry) => entry.id === id)?.authority === 'human-confirmation');
      return true;
    });
    const definitionConfirmed = acceptanceFactsConfirmed;
    const complete = result?.outcome === 'ready'
      && acceptance.operationRefs.length > 0
      && acceptance.uncoveredOperationRefs.length === 0
      && definitionConfirmed
      && gapIds.length === 0;
    return {
      featureId: feature.id,
      featureRef,
      operationTotal: acceptance.operationRefs.length,
      coveredOperations: acceptance.coveredOperationRefs.length,
      uncoveredOperationRefs: acceptance.uncoveredOperationRefs,
      acceptanceGapIds: gapIds,
      baselineRequirementRefs: acceptance.baselineRequirementRefs,
      definitionConfirmed,
      coverageRate: Number((acceptance.coverageRate * 100).toFixed(2)),
      complete,
    };
  }).sort((left, right) => left.featureId.localeCompare(right.featureId));
  const completeFeatureIds = featureDetails.filter((item) => item.complete).map((item) => item.featureId);
  const openGaps = gaps.filter((gap) => gap.status === 'open');
  const openProductGaps = openGaps.filter((gap) => gap.audience === 'product-review');
  const visibleOpenProductGaps = visibleProductGaps(gaps, reviewItems);
  const currentSnapshotFeatureIds = featureDetails.filter((item) => {
    const feature = byRef.get(item.featureRef);
    return readiness.featureResults.find((result) => result.featureId === item.featureId)?.outcome === 'ready'
      && feature.claimIds.some((id) => {
        const claim = claimById.get(id);
        return claim?.layer === 'current' && claim.factLevel === 'confirmed';
      });
  }).map((item) => item.featureId);
  const approvedBaselineFeatureIds = featureDetails.filter((item) => {
    const feature = byRef.get(item.featureRef);
    const approvedCriteria = feature.acceptanceCriteriaRefs.map((ref) => byRef.get(ref)).filter((criterion) => criterion
      && (criterion.decisionId || (criterion.requirementRef && byRef.get(criterion.requirementRef)?.scopeType === 'baseline')));
    return item.definitionConfirmed && approvedCriteria.length > 0
      && !openGaps.some((gap) => ['product-decision', 'conflict-resolution'].includes(gap.resolutionMode)
        && gap.subjectRefs.includes(item.featureRef));
  }).map((item) => item.featureId);
  const acceptanceFeatureIds = featureDetails.filter((item) => item.operationTotal > 0
    && item.uncoveredOperationRefs.length === 0 && item.definitionConfirmed).map((item) => item.featureId);
  const declaredRoleRefs = objects.roles.map((role) => `role:${role.id}`).sort();
  const permissionDetails = objects.permissions.map((permission) => {
    const permissionRef = `permission:${permission.id}`;
    const directFeatures = permission.subjectRefs.map((ref) => byRef.get(ref)).filter((node) => node?.kind === 'feature');
    const relevantOperationRefs = [...new Set([
      ...permission.subjectRefs.filter((ref) => byRef.get(ref)?.kind === 'operation'),
      ...directFeatures.flatMap((feature) => feature.operationRefs),
    ])];
    const relevantFlowRefs = permission.subjectRefs.filter((ref) => byRef.get(ref)?.kind === 'flow');
    const applicableRoleRefs = [...new Set([
      ...directFeatures.flatMap((feature) => feature.roleRefs),
      ...objects.roles.filter((role) => role.scopeRefs.some((ref) => permission.subjectRefs.includes(ref)))
        .map((role) => `role:${role.id}`),
      ...objects.roles.filter((role) => role.operationRefs.some((ref) => relevantOperationRefs.includes(ref)))
        .map((role) => `role:${role.id}`),
      ...relevantOperationRefs.flatMap((ref) => byRef.get(ref)?.actorRefs ?? []),
      ...relationships.filter((relationship) => relationship.type === 'performed-by'
        && [...relevantOperationRefs, ...relevantFlowRefs].includes(relationship.from))
        .map((relationship) => relationship.to),
    ])].filter((ref) => declaredRoleRefs.includes(ref)).sort();
    const catalogScopeRefs = new Set();
    const addCatalogScope = (ref) => {
      if (catalogScopeRefs.has(ref)) return;
      const node = byRef.get(ref);
      if (!node || !['system', 'domain', 'module', 'feature'].includes(node.kind)) return;
      catalogScopeRefs.add(ref);
      const childField = { system: 'domainRefs', domain: 'moduleRefs', module: 'featureRefs' }[node.kind];
      for (const childRef of childField ? node[childField] : []) addCatalogScope(childRef);
    };
    permission.subjectRefs.forEach(addCatalogScope);
    const resourceRefs = new Set(permission.subjectRefs);
    for (const scopeRef of catalogScopeRefs) {
      const scope = byRef.get(scopeRef);
      if (scope?.kind === 'feature') {
        for (const field of FEATURE_CATALOG_ENTRY_FIELDS) for (const ref of scope[field] ?? []) resourceRefs.add(ref);
      }
    }
    for (const node of Object.values(objects).flat()) {
      if ((node.subjectRefs ?? []).some((ref) => catalogScopeRefs.has(ref))) resourceRefs.add(`${node.kind}:${node.id}`);
    }
    const sortedResourceRefs = [...resourceRefs].sort();
    const scopedRows = permission.rows.filter((row) => resourceRefs.has(row.resourceRef));
    const outOfScopeRows = permission.rows.filter((row) => !resourceRefs.has(row.resourceRef));
    const directPermissionClaims = permission.claimIds.map((id) => claimById.get(id));
    const directClaimsConfirmed = directPermissionClaims.length > 0
      && directPermissionClaims.every((claim) => claim?.subjectRef === permissionRef && claim.factLevel === 'confirmed');
    const rowClaimsConfirmed = permission.rows.length > 0 && permission.rows.every((row) => row.claimIds.length > 0
      && row.claimIds.every((id) => {
        const claim = claimById.get(id);
        return claim?.factLevel === 'confirmed'
          && [permissionRef, row.resourceRef].includes(claim.subjectRef)
          && claim.evidenceIds.some((evidenceId) => row.evidenceIds.includes(evidenceId));
      }));
    const claimsConfirmed = directClaimsConfirmed && rowClaimsConfirmed;
    const permissionStatusConfirmed = permission.status === 'confirmed';
    const openGapIds = gaps.filter((gap) => gap.status === 'open'
      && (gap.subjectRefs.includes(permissionRef) || permission.gapIds.includes(gap.id)))
      .map((gap) => gap.id).sort();
    const roleCoverage = applicableRoleRefs.map((roleRef) => {
      const rows = scopedRows.filter((row) => row.roleRef === roleRef);
      const roleOutOfScopeRows = outOfScopeRows.filter((row) => row.roleRef === roleRef);
      const roleEnforcementLayers = Object.fromEntries([...PERMISSION_LAYERS]
        .map((layer) => [layer, rows.filter((row) => row.enforcementLayer === layer).length]));
      const roleEvidenceIds = Object.fromEntries([...PERMISSION_LAYERS].map((layer) => [
        layer,
        [...new Set(rows.filter((row) => row.enforcementLayer === layer).flatMap((row) => row.evidenceIds))].sort(),
      ]));
      const roleMissingLayers = [...PERMISSION_LAYERS].filter((layer) => roleEnforcementLayers[layer] === 0);
      return {
        permissionRef,
        roleRef,
        enforcementLayers: roleEnforcementLayers,
        evidenceIds: roleEvidenceIds,
        missingEnforcementLayers: roleMissingLayers,
        permissionStatusConfirmed,
        claimsConfirmed,
        openGapIds,
        outOfScopeRowCount: roleOutOfScopeRows.length,
        complete: roleMissingLayers.length === 0 && roleOutOfScopeRows.length === 0
          && permissionStatusConfirmed && claimsConfirmed && openGapIds.length === 0,
      };
    });
    return {
      permissionRef,
      resourceRefs: sortedResourceRefs,
      applicableRoleRefs,
      coveredRoleRefs: applicableRoleRefs.filter((roleRef) => scopedRows.some((row) => row.roleRef === roleRef)),
      uncoveredRoleRefs: applicableRoleRefs.filter((roleRef) => !scopedRows.some((row) => row.roleRef === roleRef)),
      permissionStatusConfirmed,
      directClaimsConfirmed,
      rowClaimsConfirmed,
      claimsConfirmed,
      openGapIds,
      outOfScopeRowCount: outOfScopeRows.length,
      outOfScopeResourceRefs: [...new Set(outOfScopeRows.map((row) => row.resourceRef))].sort(),
      roleCoverage,
      complete: applicableRoleRefs.length > 0 && outOfScopeRows.length === 0 && roleCoverage.every((item) => item.complete),
    };
  }).sort((left, right) => left.permissionRef.localeCompare(right.permissionRef));
  const permissionRoleCoverage = permissionDetails.flatMap((permission) => permission.roleCoverage);
  const scopedPermissionRows = objects.permissions.flatMap((permission) => {
    const detail = permissionDetails.find((item) => item.permissionRef === `permission:${permission.id}`);
    const resourceRefs = new Set(detail.resourceRefs);
    return permission.rows.filter((row) => resourceRefs.has(row.resourceRef));
  });
  const enforcementLayers = Object.fromEntries([...PERMISSION_LAYERS].map((layer) => [layer, scopedPermissionRows.filter((row) => row.enforcementLayer === layer).length]));
  const applicableRoleRefs = [...new Set(permissionDetails.flatMap((permission) => permission.applicableRoleRefs))].sort();
  const coveredRoleRefs = [...new Set(permissionDetails.flatMap((permission) => permission.coveredRoleRefs))].sort();
  const uncoveredRoleRefs = [...new Set(permissionDetails.flatMap((permission) => permission.uncoveredRoleRefs))].sort();
  const missingEnforcementLayers = [...PERMISSION_LAYERS]
    .filter((layer) => permissionRoleCoverage.some((item) => item.missingEnforcementLayers.includes(layer)));
  const completePermissions = permissionDetails.filter((permission) => permission.complete).length;
  const permissionCoverageComplete = permissionDetails.length === 0
    || (completePermissions === permissionDetails.length && uncoveredRoleRefs.length === 0);
  const permissionCoverageBlockingRefs = permissionDetails.filter((permission) => !permission.complete)
    .map((permission) => permission.permissionRef).sort();
  const flowDetails = objects.flows.map((flow) => {
    const flowRef = `flow:${flow.id}`;
    const currentNodes = flow.nodes.filter((entry) => usableEntry(entry));
    const currentNodeIds = new Set(currentNodes.map((entry) => entry.id));
    const currentMainEdges = flow.edges.filter((entry) => entry.pathType === 'main' && usableEntry(entry)
      && currentNodeIds.has(entry.from) && currentNodeIds.has(entry.to));
    const mainNodeIds = new Set(currentMainEdges.flatMap((entry) => [entry.from, entry.to]));
    const productDefinitionConfirmed = flow.claimIds.some((id) => {
      const claim = claimById.get(id);
      return claim?.layer === 'expected' && claim.factLevel === 'confirmed';
    });
    const overviewCovered = productDefinitionConfirmed
      && !isEmptyValue(flow.goal)
      && !isEmptyValue(flow.trigger)
      && currentNodes.some((entry) => ['result', 'end'].includes(entry.nodeType) && entryLevel(entry) === 'confirmed')
      && currentMainEdges.length > 0
      && currentMainEdges.every((entry) => entryLevel(entry) === 'confirmed')
      && currentNodes.filter((entry) => mainNodeIds.has(entry.id)).every((entry) => entryLevel(entry) === 'confirmed');
    const stateAssessment = flow.viewAssessments.state;
    const stateCovered = stateAssessment.applicability === 'not-applicable' ? stateAssessment.evidenceIds.length > 0
      : Boolean(stateAssessment.applicability === 'applicable' && flow.stateMachineRefs.length > 0
        && flow.stateMachineRefs.every((ref) => {
          const machine = byRef.get(ref);
          const currentStates = machine?.states.filter((entry) => usableEntry(entry)) ?? [];
          const currentTransitions = machine?.transitions.filter((entry) => usableEntry(entry)) ?? [];
          return currentStates.length > 0
            && currentStates.every((entry) => entryLevel(entry) === 'confirmed')
            && currentTransitions.every((entry) => entryLevel(entry) === 'confirmed');
        }));
    const sequenceAssessment = flow.viewAssessments.sequence;
    const currentGroups = flow.interaction.sequenceGroups.filter((entry) => usableEntry(entry));
    const currentMessages = flow.interaction.messages.filter((entry) => usableEntry(entry));
    const sequenceCovered = sequenceAssessment.applicability === 'not-applicable' ? sequenceAssessment.evidenceIds.length > 0
      : Boolean(sequenceAssessment.applicability === 'applicable'
        && currentGroups.length > 0 && currentMessages.length > 0
        && currentGroups.every((entry) => entryLevel(entry) === 'confirmed')
        && currentMessages.every((entry) => entryLevel(entry) === 'confirmed'));
    return { flowRef, overviewCovered, stateCovered, sequenceCovered };
  }).sort((left, right) => left.flowRef.localeCompare(right.flowRef));
  const flowCoverage = (field) => {
    const coveredRefs = flowDetails.filter((item) => item[field]).map((item) => item.flowRef);
    const total = flowDetails.length;
    return {
      covered: coveredRefs.length,
      total,
      rate: total === 0 ? 100 : Number(((coveredRefs.length / total) * 100).toFixed(2)),
      coveredRefs,
      uncoveredRefs: flowDetails.filter((item) => !item[field]).map((item) => item.flowRef),
    };
  };
  return {
    declared: structuredClone(declared),
    catalog: {
      systems: catalog.systems.length,
      domains: catalog.domains.length,
      modules: catalog.modules.length,
      features: catalog.features.length,
    },
    objects: Object.fromEntries(Object.entries(objects).map(([kind, values]) => [kind, values.length])),
    claims: Object.fromEntries([...FACT_LEVELS].map((level) => [level, claims.filter((claim) => claim.factLevel === level).length])),
    evidence: Object.fromEntries([...AUTHORITY_SOURCES.keys()].map((authority) => [authority, evidence.filter((item) => item.authority === authority).length])),
    evidenceClasses,
    featurePrd: { completeFeatureIds, complete: completeFeatureIds.length, total: catalog.features.length, features: featureDetails },
    maturity: {
      currentSnapshot: { complete: currentSnapshotFeatureIds.length, total: catalog.features.length, featureIds: currentSnapshotFeatureIds },
      approvedBaseline: { complete: approvedBaselineFeatureIds.length, total: catalog.features.length, featureIds: approvedBaselineFeatureIds },
      acceptance: { complete: acceptanceFeatureIds.length, total: catalog.features.length, featureIds: acceptanceFeatureIds },
      openDecisionCount: visibleOpenProductGaps.filter((gap) => ['product-decision', 'conflict-resolution'].includes(gap.resolutionMode)).length,
    },
    gaps: {
      openTotal: openGaps.length,
      productRaw: openProductGaps.length,
      productVisible: visibleOpenProductGaps.length,
      productSuppressedByReview: openProductGaps.length - visibleOpenProductGaps.length,
      data: openGaps.filter((gap) => gap.audience === 'data-review').length,
      engineering: openGaps.filter((gap) => gap.audience === 'engineering-review').length,
      other: openGaps.filter((gap) => !['product-review', 'data-review', 'engineering-review'].includes(gap.audience)).length,
    },
    historicalRequirementReadiness: objects.requirements.some((item) => item.scopeType === 'baseline')
      ? (catalog.features.every((feature) => feature.requirementRefs.some((ref) => byRef.get(ref)?.scopeType === 'baseline')) ? 'ready' : 'partial')
      : 'unavailable',
    review: {
      total: reviewItems.length,
      ...Object.fromEntries(['pending', 'confirmed', 'modified', 'rejected', 'deferred', 'drift'].map((status) => [status, reviewItems.filter((item) => item.status === status).length])),
      p0Pending: reviewItems.filter((item) => item.priority === 'P0' && ['pending', 'drift'].includes(item.status)).length,
      p1Pending: reviewItems.filter((item) => item.priority === 'P1' && ['pending', 'drift'].includes(item.status)).length,
    },
    deduplication: structuredClone(reviewDiagnostics),
    freshness: {
      currentImplementationCapturedAt: (readiness.sourceResults ?? [])
        .filter((item) => ['code', 'database'].includes(item.kind) && item.capturedAt)
        .map((item) => item.capturedAt).sort().at(-1) ?? null,
      lastProductDecisionAt: evidence
        .filter((item) => item.authority === 'human-confirmation' && item.decision?.confirmedAt)
        .map((item) => item.decision.confirmedAt).sort().at(-1) ?? null,
    },
    taskReadiness: {
      productUnderstanding: currentSnapshotFeatureIds.length > 0 ? 'usable' : 'partial',
      changeImpactScreening: objects.flows.length > 0 || objects.operations.length > 0 ? 'partial' : 'blocked',
      finalRequirementBaseline: approvedBaselineFeatureIds.length === catalog.features.length && catalog.features.length > 0 ? 'ready' : 'partial',
      releaseAcceptance: readiness.status === 'ready' && completeFeatureIds.length === catalog.features.length ? 'ready' : 'partial',
    },
    metrics: Object.fromEntries([...METRIC_TYPES].map((type) => [type, objects.metrics.filter((metric) => metric.metricType === type).length])),
    permissions: {
      totalPermissions: permissionDetails.length,
      completePermissions,
      declaredRoles: declaredRoleRefs.length,
      totalRoles: applicableRoleRefs.length,
      roles: coveredRoleRefs.length,
      uncoveredRoleRefs,
      resources: new Set(scopedPermissionRows.map((row) => row.resourceRef)).size,
      actions: new Set(scopedPermissionRows.map((row) => `${row.resourceRef}\0${row.action}`)).size,
      outOfScopeRows: permissionDetails.reduce((total, permission) => total + permission.outOfScopeRowCount, 0),
      enforcementLayers,
      missingEnforcementLayers,
      permissionDetails,
      permissionRoleCoverage,
      complete: permissionCoverageComplete,
    },
    flows: {
      overview: flowCoverage('overviewCovered'),
      state: flowCoverage('stateCovered'),
      sequence: flowCoverage('sequenceCovered'),
      details: flowDetails,
    },
    risks: {
      p0GapIds: openGaps.filter((gap) => gap.severity === 'P0').map((gap) => gap.id).sort(),
      p1GapIds: openGaps.filter((gap) => gap.severity === 'P1').map((gap) => gap.id).sort(),
      criticalWithoutEvidence,
      nonConfirmedObjectRefs,
      uncertainClaimIds,
      freshnessGapIds: openGaps.filter((gap) => gap.type === 'freshness-gap').map((gap) => gap.id).sort(),
      permissionCoverageBlockingRefs,
    },
  };
}

function publication(readiness, gaps, coverage) {
  const blockers = gaps.filter((gap) => gap.status === 'open' && ['P0', 'P1'].includes(gap.severity));
  const blockingObjectRefs = [...new Set([
    ...coverage.risks.criticalWithoutEvidence,
    ...coverage.risks.nonConfirmedObjectRefs,
    ...coverage.risks.permissionCoverageBlockingRefs,
  ])].sort();
  const hasUncertainClaims = coverage.risks.uncertainClaimIds.length > 0;
  const status = readiness.status === 'blocked' || blockers.some((gap) => gap.severity === 'P0') ? 'not-publishable'
    : readiness.status === 'ready' && blockers.length === 0 && blockingObjectRefs.length === 0 && !hasUncertainClaims && coverage.featurePrd.complete === coverage.featurePrd.total
      ? 'publishable' : 'partially-publishable';
  return {
    status,
    blockingGapIds: blockers.map((gap) => gap.id).sort(),
    blockingObjectRefs,
  };
}

function assertGovernanceConsistency(model) {
  const recalculatedCoverage = buildCoverage({
    readiness: { status: model.sourceReadiness.status, featureResults: model.sourceReadiness.featureResults, sourceResults: model.sources },
    catalog: model.catalog,
    objects: model.objects,
    relationships: model.relationships,
    claims: model.governance.claims,
    evidence: model.governance.evidence,
    gaps: model.governance.gaps,
    reviewItems: model.governance.reviewItems ?? [],
    reviewDiagnostics: model.governance.reviewDiagnostics ?? {},
    declared: model.governance.coverage?.declared ?? {},
  });
  if (JSON.stringify(recalculatedCoverage) !== JSON.stringify(model.governance.coverage)) {
    fail('wiki-coverage-contradiction', 'Stored coverage contradicts the canonical objects, Claims, or Gaps.', '$.governance.coverage');
  }
  const recalculatedPublication = publication({ status: model.sourceReadiness.status }, model.governance.gaps, recalculatedCoverage);
  if (JSON.stringify(recalculatedPublication) !== JSON.stringify(model.governance.publication)) {
    fail('wiki-publication-contradiction', 'Stored publication contradicts Source readiness, coverage, or open Gaps.', '$.governance.publication');
  }
}

export function recomputeWikiGovernance(model) {
  const coverage = buildCoverage({
    readiness: { status: model.sourceReadiness.status, featureResults: model.sourceReadiness.featureResults },
    catalog: model.catalog,
    objects: model.objects,
    relationships: model.relationships,
    claims: model.governance.claims,
    evidence: model.governance.evidence,
    gaps: model.governance.gaps,
    reviewItems: model.governance.reviewItems ?? [],
    reviewDiagnostics: model.governance.reviewDiagnostics ?? {},
    declared: model.governance.coverage?.declared ?? {},
  });
  return {
    coverage,
    publication: publication({ status: model.sourceReadiness.status }, model.governance.gaps, coverage),
  };
}

export function buildProductWiki(input) {
  const root = requireObject(input, '$');
  if (root.schemaVersion !== 1) fail('wiki-version-invalid', 'schemaVersion must equal 1.', '$.schemaVersion');
  const outputRoot = requireText(root.outputRoot, '$.outputRoot');
  if (!isAbsolute(outputRoot) || !existsSync(outputRoot) || !statSync(outputRoot).isDirectory()) fail('wiki-output-root-invalid', 'outputRoot must be an existing absolute directory.', '$.outputRoot');
  const wikiRoot = safeRelativePath(root.wikiRoot ?? 'docs/wiki', '$.wikiRoot');
  const configuredSources = validateConfiguredWikiSources({
    wikiRoot,
    sources: requireArray(root.configuredSources ?? [], '$.configuredSources'),
  });
  const inputConfirmation = assertWikiGenerationAuthorization({
    outputRoot,
    wikiRoot,
    configuredSources,
    inputConfirmation: root.inputConfirmation,
  });
  const runId = root.runId ?? `wiki-${Date.now()}`;
  if (!RUN_ID_PATTERN.test(runId)) fail('wiki-run-id-invalid', `runId must match ${RUN_ID_PATTERN}.`, '$.runId');
  const sourceResultsInput = requireArray(root.sourceResults, '$.sourceResults');
  const sourceKindById = new Map(sourceResultsInput.map((result) => [result.sourceId, result.kind]));
  const { evidence, byId: evidenceById } = normalizeEvidence(root.governance?.evidence, sourceKindById);
  const { gaps, byId: gapById } = normalizeGap(root.governance?.gaps, evidenceById);
  const preliminaryArtifacts = requireArray(root.artifacts, '$.artifacts');
  const preliminaryContext = { evidenceById, gapById, artifacts: preliminaryArtifacts.map((artifact) => structuredClone(artifact)) };
  const { catalog, objects, byRef } = normalizeCatalogAndObjects(root, preliminaryContext);
  const { claims, byId: claimById } = normalizeClaims(root.governance?.claims, { evidenceById, refSet: new Set(byRef.keys()) });
  const readiness = buildSourceReadiness({ configuredSources, sourceResults: sourceResultsInput, artifacts: preliminaryArtifacts, features: catalog.features, issues: root.issues ?? [], now: root.now ? new Date(root.now) : new Date() });
  if (readiness.status === 'blocked') fail('wiki-source-readiness-blocked', 'Catalog + Code readiness gate failed.', '$.sourceReadiness', readiness.blockingIssueIds.map((id) => issue(id, 'Source readiness blocked formal Wiki generation.', '$.sourceReadiness')));
  const evidenceSourceIds = new Set(readiness.sourceResults.filter((result) => ['collected', 'partial'].includes(result.status)).map((result) => result.sourceId));
  for (const item of evidence) {
    if (!evidenceSourceIds.has(item.sourceId)) fail('wiki-evidence-source-unavailable', `Evidence ${item.id} uses an unavailable Source Result.`, `$.governance.evidence.${item.id}`);
  }
  validateEvidenceAgainstArtifacts(evidence, readiness.artifacts);
  const context = { catalog, objects, byRef, evidenceById, gapById, claimById, gaps, artifacts: readiness.artifacts };
  const relationships = normalizeRelationships(root.relationships, context);
  validateObjectReferences({ ...context, relationships, sourceIds: new Set(readiness.sourceResults.map((result) => result.sourceId)) });
  validateGapFieldRefs(context);
  validateResolvedGaps(context);
  validateDataEntityCoverage(context);
  validateFeaturePrdJoins(context, readiness);
  const builtReview = buildReviewItems({ catalog, objects, claims, evidence, gaps });
  let reviewItems = validateReviewItems(builtReview.items, {
    refSet: new Set(byRef.keys()), claimById, evidenceById, gapById,
  });
  if (root.governance?.reviewItems !== undefined) {
    const suppliedReviewItems = validateReviewItems(root.governance.reviewItems, {
      refSet: new Set(byRef.keys()), claimById, evidenceById, gapById,
    });
    const comparable = (item) => {
      const value = structuredClone(item);
      value.status = 'pending';
      delete value.decisionId;
      return value;
    };
    const suppliedById = new Map(suppliedReviewItems.map((item) => [item.id, item]));
    if (suppliedById.size !== reviewItems.length
      || reviewItems.some((item) => !suppliedById.has(item.id)
        || JSON.stringify(comparable(suppliedById.get(item.id))) !== JSON.stringify(comparable(item)))) {
      fail('wiki-review-composer-mismatch', 'Supplied ReviewItems differ from deterministic Current behavior synthesis.', '$.governance.reviewItems');
    }
    reviewItems = suppliedReviewItems;
  }
  const snapshot = sourceSnapshot(readiness, configuredSources, inputConfirmation);
  const coverage = buildCoverage({
    readiness,
    catalog,
    objects,
    relationships,
    claims,
    evidence,
    gaps,
    reviewItems,
    reviewDiagnostics: builtReview.diagnostics,
    declared: root.governance?.coverage ?? {},
  });
  const publicationResult = publication(readiness, gaps, coverage);
  const model = {
    schemaVersion: 1,
    kind: 'yog-product-wiki-model',
    runId,
    generatedAt: root.generatedAt ?? new Date().toISOString(),
    maintenance: structuredClone(root.maintenance ?? {}),
    scope: structuredClone(root.scope ?? {}),
    inputConfirmation,
    sources: readiness.sourceResults,
    sourceReadiness: {
      status: readiness.status,
      catalogSourceIds: readiness.catalogSourceIds,
      codeSourceIds: readiness.codeSourceIds,
      featureResults: readiness.featureResults,
      blockingIssueIds: readiness.blockingIssueIds,
      databaseReconciliations: readiness.databaseReconciliations,
    },
    sourceSnapshot: snapshot,
    catalog,
    objects,
    relationships,
    governance: {
      claims,
      evidence,
      gaps,
      reviewItems,
      reviewDiagnostics: builtReview.diagnostics,
      coverage,
      publication: publicationResult,
    },
    pages: [],
  };
  const pageContext = { ...context, relationships };
  const rendered = renderPages(model, pageContext);
  model.pages = rendered.map((page) => ({ path: page.path, contentHash: sha256(page.content) }));
  return projectProductWikiModel(model, { renderedPages: rendered, outputRoot: resolve(outputRoot), wikiRoot });
}

export function projectProductWikiModel(modelInput, { renderedPages = null, pageContents = null, outputRoot = null, wikiRoot = 'docs/wiki' } = {}) {
  const model = structuredClone(modelInput);
  if (model.schemaVersion !== 1 || model.kind !== 'yog-product-wiki-model') fail('wiki-model-invalid', 'Unsupported canonical model.', '$.model');
  if (!outputRoot) fail('wiki-output-root-invalid', 'Projection outputRoot is required to verify input confirmation.', '$.outputRoot');
  const inputConfirmation = assertPersistedWikiInputConfirmation({
    outputRoot,
    wikiRoot,
    inputConfirmation: model.inputConfirmation,
  });
  if (JSON.stringify(model.sourceSnapshot?.inputConfirmation) !== JSON.stringify(inputConfirmation)) {
    fail('wiki-source-scope-unconfirmed', 'Source Snapshot input confirmation differs from the canonical model.', '$.sourceSnapshot.inputConfirmation');
  }
  if (model.sourceSnapshot?.id !== sourceSnapshotId(model.sourceSnapshot ?? {})) {
    fail('wiki-source-snapshot-invalid', 'Source Snapshot id does not match its canonical content.', '$.sourceSnapshot.id');
  }
  assertGovernanceConsistency(model);
  const byRef = new Map([...Object.values(model.catalog).flat(), ...Object.values(model.objects).flat()].map((node) => [`${node.kind}:${node.id}`, node]));
  const context = { byRef, catalog: model.catalog, objects: model.objects };
  const pages = renderedPages ?? renderPages(model, context);
  if (pageContents) {
    for (const page of pages) {
      if (!pageContents.has(page.path)) fail('wiki-page-missing', `Missing canonical page content: ${page.path}.`, page.path);
      page.content = pageContents.get(page.path);
    }
  }
  const pageMetadata = pages.map((page) => ({ path: page.path, contentHash: sha256(page.content) })).sort((left, right) => left.path.localeCompare(right.path));
  model.pages = pageMetadata;
  const modelContent = json(model);
  const modelHash = sha256(modelContent);
  const catalogProjections = buildCatalogIndexProjections(model)
    .map(({ path, content }) => ({ path, content }));
  const gapProjections = buildGapIndexProjections(model)
    .map(({ path, content }) => ({ path, content }));
  const flowProjections = buildFlowIndexProjections(model)
    .map(({ path, content }) => ({ path, content }));
  const reviewProjections = buildReviewIndexProjections(model)
    .map(({ path, content }) => ({ path, content }));
  const coverage = {
    schemaVersion: 1,
    sourceReadiness: model.sourceReadiness,
    publication: model.governance.publication,
    coverage: model.governance.coverage,
    counts: {
      systems: model.catalog.systems.length,
      domains: model.catalog.domains.length,
      modules: model.catalog.modules.length,
      features: model.catalog.features.length,
      objects: Object.values(model.objects).flat().length,
    },
  };
  const projections = [
    { path: '_meta/model.json', content: modelContent },
    ...catalogProjections,
    ...gapProjections,
    ...flowProjections,
    ...reviewProjections,
    { path: '_meta/claims.json', content: json({ schemaVersion: 1, claims: model.governance.claims }) },
    { path: '_meta/evidence.json', content: json({ schemaVersion: 1, evidence: model.governance.evidence }) },
    { path: '_meta/relationships.json', content: json({ schemaVersion: 1, relationships: model.relationships }) },
    { path: '_meta/coverage.json', content: json(coverage) },
    { path: '_meta/state-machines.json', content: json({ schemaVersion: 1, stateMachines: model.objects.stateMachines }) },
  ];
  const manifest = {
    schemaVersion: 1,
    managedBy: 'yog:wiki',
    kind: 'yog-product-wiki-manifest',
    runId: model.runId,
    generatedAt: model.generatedAt,
    wikiRoot,
    modelHash,
    sourceSnapshotId: model.sourceSnapshot.id,
    inputConfirmation,
    sourceReadiness: model.sourceReadiness.status,
    publication: model.governance.publication,
    pages: pageMetadata,
    projections: projections.map((file) => ({ path: file.path, contentHash: sha256(file.content) })),
  };
  const files = [...pages, ...projections, { path: '_meta/manifest.json', content: json(manifest) }].sort((left, right) => left.path.localeCompare(right.path));
  for (const file of files) {
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(file.content))) fail('wiki-sensitive-content', `Generated file contains sensitive content: ${file.path}.`, file.path, [issue('wiki-sensitive-content', 'Generated content contains a sensitive or machine-local value.', file.path, 'P0')]);
  }
  sourcePrivate.assertNoSensitive({ manifest, model: { ...model, governance: { ...model.governance, evidence: [] } } }, '$.projection');
  return { outputRoot, wikiRoot, runId: model.runId, files, manifest, model, issues: [] };
}

export function publishProductWiki(build, options = {}) {
  if (!build.outputRoot) fail('wiki-output-root-invalid', 'Build outputRoot is required.', '$.outputRoot');
  const currentManifest = resolve(build.outputRoot, build.wikiRoot, '_meta', 'manifest.json');
  if (existsSync(resolve(build.outputRoot, build.wikiRoot))) {
    if (!existsSync(currentManifest)) fail('wiki-root-unmanaged', 'Existing wikiRoot is not managed by Yog Wiki.', build.wikiRoot);
    let parsed;
    try { parsed = JSON.parse(readFileSync(currentManifest, 'utf8')); } catch { fail('wiki-root-unmanaged', 'Existing Wiki manifest is invalid.', currentManifest); }
    if (parsed.managedBy !== 'yog:wiki' || parsed.kind !== 'yog-product-wiki-manifest') fail('wiki-root-unmanaged', 'Existing wikiRoot does not use the current Yog Wiki contract.', build.wikiRoot);
  }
  return publishWikiSnapshot(build, options);
}

export function generateProductWiki(input, options = {}) {
  return publishProductWiki(buildProductWiki(input), options);
}

export function formatWikiError(error) {
  return {
    schemaVersion: 1,
    ok: false,
    issues: error.issues ?? [issue(error.code ?? 'wiki-generation-failed', error.message, error.path ?? '$')],
  };
}

export const __private = { relationId, renderPages, normalizeRelationships, normalizeNode, sha256 };
