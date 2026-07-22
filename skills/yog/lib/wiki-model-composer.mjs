import { createHash } from 'node:crypto';
import { buildGapGuidance, validateGapAnswer } from './wiki-gap.mjs';
import { activeDecisionIds } from './wiki-decision.mjs';
import { buildReviewItems } from './wiki-review.mjs';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const CATALOG_KINDS = new Set(['system', 'domain', 'module', 'feature']);
const OBJECT_COLLECTIONS = new Map([
  ['page', 'pages'],
  ['operation', 'operations'],
  ['scenario', 'scenarios'],
  ['flow', 'flows'],
  ['state-machine', 'stateMachines'],
  ['rule', 'rules'],
  ['role', 'roles'],
  ['permission', 'permissions'],
  ['data-entity', 'dataEntities'],
  ['metric', 'metrics'],
  ['interface', 'interfaces'],
  ['requirement', 'requirements'],
  ['acceptance-criteria', 'acceptanceCriteria'],
  ['version', 'versions'],
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
// Feature links describe discovered knowledge objects. Their absence is not, by
// itself, a product decision: a Feature may legitimately have no independent
// Flow, State Machine, Rule, Metric, or other linked object. Keep the fields in
// the canonical shape, but only create product Gaps when evidence establishes
// applicability or for the small product baseline core handled below.
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
const REFERENCE_FIELDS = new Map([
  ['page', 'pageRefs'],
  ['operation', 'operationRefs'],
  ['scenario', 'scenarioRefs'],
  ['flow', 'flowRefs'],
  ['state-machine', 'stateMachineRefs'],
  ['rule', 'ruleRefs'],
  ['role', 'roleRefs'],
  ['permission', 'permissionRefs'],
  ['data-entity', 'dataEntityRefs'],
  ['metric', 'metricRefs'],
  ['interface', 'interfaceRefs'],
  ['requirement', 'requirementRefs'],
  ['acceptance-criteria', 'acceptanceCriteriaRefs'],
  ['version', 'versionRefs'],
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
const DEFAULTS = new Map([
  ['feature.dataSourceAssessment', null],
  ['acceptance-criteria.requirementRef', null],
  ['acceptance-criteria.decisionId', null],
  ['data-entity.fieldCoverage', 'unknown'],
  ['state-machine.completeness', 'unknown'],
]);
const STRUCTURED_FIELDS = new Map([
  ['permission', ['rows']],
  ['flow', ['phases', 'lanes', 'nodes', 'edges']],
  ['state-machine', ['states', 'transitions']],
  ['data-entity', ['fields', 'constraints', 'indexes']],
  ['interface', ['errors', 'endpoints']],
]);
const CANDIDATE_FIELDS = new Set([
  'key', 'ref', 'kind', 'name', 'order', 'subjectRefs', 'ownerRefs', 'confirmedEmptyFields', 'fields', 'claims', 'relationships',
]);
const NON_OBJECT_REFERENCE_FIELDS = new Set([
  'claimKeys',
  'evidenceRefs',
  'gapIds',
  'gapKeys',
  'edgeRef',
  'relationshipRef',
  'causationMessageRef',
  'groupId',
  'laneId',
  'phaseId',
  'from',
  'to',
]);

function composerError(code, message, path = '$') {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw composerError('wiki-semantic-draft-invalid', `${path} must be an object.`, path);
  }
  return value;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) throw composerError('wiki-semantic-draft-invalid', `${path} must be an array.`, path);
  return value;
}

function requireText(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw composerError('wiki-semantic-draft-invalid', `${path} must be a non-empty string.`, path);
  }
  return value;
}

function hashId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function stableId(kind, key) {
  return ID_PATTERN.test(key) ? key : hashId(kind, key);
}

function relationId(from, type, to) {
  return hashId('rel', `${from}\0${type}\0${to}`);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function isEmpty(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function joinPath(...parts) {
  return parts.filter((part) => part && part !== '.').join('/').replaceAll(/\/{2,}/g, '/');
}

function evidenceEntry({
  id, sourceId, authority, description, path, locator, permissionLayers = [], decision = null,
  factKind = null, precision = null, artifactObjectRef = null, repositorySurface = null,
}) {
  if (!ID_PATTERN.test(id)) throw composerError('wiki-artifact-evidence-invalid', `Artifact Evidence ID is invalid: ${id}.`, '$.artifacts');
  return {
    id,
    sourceId,
    authority,
    description,
    ...(path ? { path } : { locator }),
    permissionLayers: sortedUnique(permissionLayers),
    ...(factKind ? { factKind } : {}),
    ...(precision ? { precision } : {}),
    ...(artifactObjectRef ? { artifactObjectRef } : {}),
    ...(repositorySurface ? { repositorySurface } : {}),
    ...(decision ? { decision: structuredClone(decision) } : {}),
  };
}

function collectArtifactEvidence(artifacts) {
  const registry = new Map();
  const add = (entry, path) => {
    const prior = registry.get(entry.id);
    const identity = (value) => JSON.stringify({
      sourceId: value.sourceId,
      authority: value.authority,
      path: value.path ?? null,
      locator: value.locator ?? null,
      permissionLayers: value.permissionLayers,
      factKind: value.factKind ?? null,
      precision: value.precision ?? null,
      artifactObjectRef: value.artifactObjectRef ?? null,
      repositorySurface: value.repositorySurface ?? null,
    });
    if (prior && identity(prior) !== identity(entry)) {
      throw composerError('wiki-artifact-evidence-conflict', `Evidence ${entry.id} is reused for a different fact, location, or execution surface.`, path);
    }
    if (!prior) registry.set(entry.id, entry);
    else {
      prior.description = [prior.description, entry.description].sort()[0];
    }
  };

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    const artifactPath = `$.artifacts[${artifactIndex}]`;
    if (artifact.kind === 'catalog-artifact') {
      for (const node of artifact.nodes) for (const id of node.evidenceIds) add(evidenceEntry({
        id, sourceId: artifact.sourceId, authority: 'human-confirmation', description: `已确认产品目录：${node.name}`,
        locator: `catalog:${node.id}`, permissionLayers: ['product'], precision: 'catalog-node',
      }), artifactPath);
    } else if (artifact.kind === 'code-artifact') {
      const repositories = new Map(artifact.repositories.map((item) => [item.id, item]));
      for (const fact of artifact.facts) {
        const repository = repositories.get(fact.locator.repositoryId);
        const authority = fact.factKind === 'test' ? 'test-verification' : 'implementation-fact';
        const permissionLayers = repository.surface === 'frontend' && ['route', 'page', 'operation'].includes(fact.factKind) ? ['ui']
          : repository.surface === 'backend' && ['api', 'validation', 'operation'].includes(fact.factKind) ? ['api']
            : repository.surface === 'backend' && fact.factKind === 'database-usage' ? ['data'] : [];
        const location = `code:${repository.id}:${joinPath(repository.sourceRoot, fact.locator.path)}`;
        const locator = fact.locator.precision === 'file'
          ? location
          : `${location}:${fact.locator.startLine}-${fact.locator.endLine}`;
        add(evidenceEntry({
          id: fact.evidenceId,
          sourceId: artifact.sourceId,
          authority,
          description: fact.text,
          locator,
          permissionLayers,
          factKind: fact.factKind,
          precision: fact.locator.precision,
          repositorySurface: repository.surface,
        }), artifactPath);
      }
    } else if (artifact.kind === 'requirement-artifact') {
      for (const item of artifact.items) if (item.evidenceId) add(evidenceEntry({
        id: item.evidenceId, sourceId: artifact.sourceId, authority: 'requirement-statement',
        description: item.title ?? `需求 ${item.externalId}`, locator: `requirement:${item.externalId}`, permissionLayers: ['product'], precision: 'requirement-item',
      }), artifactPath);
    } else if (artifact.kind === 'database-artifact') {
      for (const collection of ['schemas', 'tables', 'views', 'columns', 'constraints', 'indexes', 'sequences', 'triggers', 'enums', 'accessControls']) {
        for (const item of artifact[collection] ?? []) {
          const id = item.evidenceId ?? hashId('evidence', `${artifact.sourceId}\0${collection}\0${item.id}`);
          add(evidenceEntry({
            id, sourceId: artifact.sourceId, authority: 'data-structure-fact',
            description: `${artifact.provider} ${collection} metadata：${item.name ?? item.id}`,
            locator: `database:${artifact.environment}:${collection}:${item.id}`,
            permissionLayers: collection === 'accessControls' ? ['data'] : [],
            factKind: `database:${collection}`,
            precision: 'metadata-object',
            artifactObjectRef: item.id,
          }), artifactPath);
        }
      }
    } else if (artifact.kind === 'decision-artifact') {
      add(evidenceEntry({
        id: artifact.evidenceId,
        sourceId: artifact.sourceId,
        authority: 'human-confirmation',
        description: `已确认产品决策：${artifact.document.title}`,
        path: artifact.document.path,
        permissionLayers: ['product'],
        precision: 'document',
        decision: artifact.decision,
      }), artifactPath);
    } else if (['spec-artifact', 'record-artifact', 'knowledge-artifact'].includes(artifact.kind)) {
      const authority = artifact.kind === 'spec-artifact' ? 'design-decision'
        : artifact.kind === 'record-artifact' ? 'runtime-observation' : 'implementation-fact';
      const documents = new Map((artifact.documents ?? []).map((item) => [item.id, item]));
      for (const statement of artifact.statements ?? []) add(evidenceEntry({
        id: statement.evidenceId,
        sourceId: artifact.sourceId,
        authority,
        description: statement.text,
        path: documents.get(statement.documentId)?.path,
        factKind: statement.statementKind,
        precision: 'document',
      }), artifactPath);
      for (const document of artifact.documents ?? []) if (!registry.has(document.evidenceId)) add(evidenceEntry({
        id: document.evidenceId, sourceId: artifact.sourceId, authority,
        description: document.title, path: document.path, precision: 'document',
      }), artifactPath);
    }
  }
  return registry;
}

function resolveEvidenceRefs(rawRefs, registry, path) {
  const refs = requireArray(rawRefs ?? [], path).map((raw, index) => {
    const refPath = `${path}[${index}]`;
    const id = typeof raw === 'string' ? raw : requireText(requireObject(raw, refPath).evidenceId, `${refPath}.evidenceId`);
    const evidence = registry.get(id);
    if (!evidence) throw composerError('wiki-semantic-evidence-missing', `semanticDraft references Evidence not present in Artifacts: ${id}.`, refPath);
    if (typeof raw === 'object' && raw.sourceId !== undefined && raw.sourceId !== evidence.sourceId) {
      throw composerError('wiki-semantic-evidence-source-invalid', `Evidence ${id} does not belong to Source ${raw.sourceId}.`, `${refPath}.sourceId`);
    }
    return id;
  });
  return sortedUnique(refs);
}

function claimFor({ subjectRef, layer, factLevel = 'partial', text, evidenceIds, key = '' }, path, evidenceRegistry) {
  if (!['expected', 'current', 'observed'].includes(layer)) throw composerError('wiki-semantic-claim-layer-invalid', `Unsupported Claim layer: ${layer}.`, `${path}.layer`);
  if (!['confirmed', 'partial', 'needs-review'].includes(factLevel)) throw composerError('wiki-semantic-draft-invalid', `Unsupported factLevel: ${factLevel}.`, `${path}.factLevel`);
  if (evidenceIds.length === 0) throw composerError('wiki-semantic-evidence-required', `Claim ${path} requires Artifact Evidence.`, `${path}.evidenceRefs`);
  for (const evidenceId of evidenceIds) {
    const authority = evidenceRegistry.get(evidenceId).authority;
    if (!LAYER_AUTHORITIES.get(layer).has(authority)) {
      throw composerError('wiki-semantic-evidence-authority-invalid', `${authority} cannot support ${layer} Claim ${subjectRef}.`, `${path}.evidenceRefs`);
    }
    const allowedSubjects = AUTHORITY_SUBJECT_KINDS.get(authority);
    const subjectKind = subjectRef.slice(0, subjectRef.indexOf(':'));
    if (allowedSubjects && !allowedSubjects.has(subjectKind)) {
      throw composerError('wiki-semantic-evidence-subject-invalid', `${authority} cannot support ${subjectRef}.`, `${path}.evidenceRefs`);
    }
  }
  if (factLevel === 'confirmed' && ['current', 'observed'].includes(layer)) {
    const hasPreciseEvidence = evidenceIds.some((id) => evidenceRegistry.get(id)?.precision !== 'file');
    if (!hasPreciseEvidence) {
      throw composerError('wiki-semantic-evidence-precision-invalid', `Confirmed ${layer} Claim ${subjectRef} requires line, symbol, test, or object-level Evidence.`, `${path}.evidenceRefs`);
    }
  }
  const id = hashId('claim', `${subjectRef}\0${layer}\0${key}\0${text}\0${evidenceIds.join(',')}`);
  return { id, subjectRef, layer, factLevel, text: requireText(text, `${path}.text`), evidenceIds };
}

function baseNode(id, kind, name, order) {
  return {
    id, kind, name, status: 'needs-review', ownerRefs: [], subjectRefs: [], relationRefs: [], claimIds: [], evidenceIds: [],
    gapIds: [], confirmedEmptyFields: [], versionRefs: [], order,
  };
}

function defaultValue(kind, field) {
  const specific = DEFAULTS.get(`${kind}.${field}`);
  if (specific !== undefined) return structuredClone(specific);
  if (field.endsWith('Refs') || ['boundary', 'areas', 'preconditions', 'outcomes', 'errorOutcomes', 'steps', 'phases', 'lanes', 'nodes', 'edges', 'exceptionPaths', 'conditions', 'effects', 'exceptions', 'responsibilities', 'rows', 'fields', 'constraints', 'indexes', 'relationships', 'dimensions', 'filters', 'endpoints', 'errors', 'states', 'transitions', 'unresolvedTransitions'].includes(field)) return [];
  if (kind === 'flow' && field === 'interaction') return { sequenceGroups: [], participants: [], messages: [] };
  if (kind === 'flow' && field === 'viewAssessments') return { state: null, sequence: null };
  return null;
}

function gapType(kind, field) {
  if (kind === 'feature' && ['operationRefs', 'requirementRefs', 'acceptanceCriteriaRefs'].includes(field)) return 'acceptance-gap';
  if ((kind === 'feature' && field === 'dataSourceAssessment') || kind === 'data-entity') return 'data-source-gap';
  return 'product-decision-gap';
}

function audienceForGap(type) {
  if (['data-source-gap', 'schema-drift-gap', 'orm-schema-conflict', 'unused-data-object-gap', 'database-access-gap'].includes(type)) return 'data-review';
  if (['evidence-gap', 'freshness-gap'].includes(type)) return 'engineering-review';
  if (type === 'internal-integrity-gap') return 'internal';
  return 'product-review';
}

function addGap(state, { type, description, subjectRefs, fieldRefs, evidenceIds = [], severity = 'P1', key = '', guidance = {}, audience = null }) {
  const normalizedSubjects = sortedUnique(subjectRefs);
  const normalizedFields = sortedUnique(fieldRefs);
  const id = hashId('gap', `${type}\0${key}\0${normalizedSubjects.join(',')}\0${normalizedFields.join(',')}`);
  if (!state.gapById.has(id)) {
    const subjectName = state.nodeByRef.get(normalizedSubjects[0])?.name ?? '该产品对象';
    state.gapById.set(id, {
      id,
      type,
      audience: audience ?? audienceForGap(type),
      severity,
      status: 'open',
      description,
      subjectRefs: normalizedSubjects,
      fieldRefs: normalizedFields,
      evidenceIds: sortedUnique(evidenceIds),
      ...buildGapGuidance({ type, description, subjectRefs: normalizedSubjects, fieldRefs: normalizedFields, subjectName, overrides: guidance }),
      resolutionEvidenceIds: [],
      resolvedByDecisionId: null,
    });
  }
  for (const ref of normalizedSubjects) state.nodeByRef.get(ref)?.gapIds.push(id);
  if (key) {
    const prior = state.gapIdByKey.get(key);
    if (prior && prior !== id) throw composerError('wiki-semantic-gap-key-duplicate', `Duplicate semantic Gap key: ${key}.`, '$.semanticDraft.gaps');
    state.gapIdByKey.set(key, id);
  }
  return id;
}

function ensureRequiredFields(state, node) {
  const ref = `${node.kind}:${node.id}`;
  for (const field of REQUIRED_FIELDS.get(node.kind) ?? []) {
    if (!(field in node)) node[field] = defaultValue(node.kind, field);
    if (!isEmpty(node[field]) || node.confirmedEmptyFields.includes(field)) continue;
    if (node.kind === 'feature' && field === 'requirementRefs') continue;
    if (node.kind === 'feature' && OPTIONAL_FEATURE_REFERENCE_FIELDS.has(field)) continue;
    if (node.kind === 'feature' && field === 'operationRefs') continue;
    if (node.kind === 'flow' && field === 'stateMachineRefs'
      && ['not-applicable', 'unknown'].includes(node.viewAssessments?.state?.applicability)) continue;
    const featureAcceptanceFields = node.kind === 'feature' && field === 'acceptanceCriteriaRefs'
      ? [
          ...(node.operationRefs.length === 0 ? [`${ref}.operationRefs`] : []),
          `${ref}.acceptanceCriteriaRefs`,
        ]
      : null;
    addGap(state, {
      type: gapType(node.kind, field),
      description: `${node.name}的${field}尚无足够证据确认。`,
      subjectRefs: [ref],
      fieldRefs: featureAcceptanceFields ?? [`${ref}.${field}`],
      evidenceIds: node.evidenceIds,
      key: `${ref}.${field}`,
    });
  }
}

function makeCatalog(state, catalogArtifact) {
  const nodesById = new Map(catalogArtifact.nodes.map((node) => [node.id, node]));
  const collectionByKind = { system: 'systems', domain: 'domains', module: 'modules', feature: 'features' };
  for (const artifactNode of catalogArtifact.nodes.filter((node) => node.enabled)) {
    const node = baseNode(artifactNode.id, artifactNode.kind, artifactNode.name, artifactNode.order);
    node.sourceIdentity = structuredClone(artifactNode.sourceIdentity);
    node.parentRef = artifactNode.parentId ? `${nodesById.get(artifactNode.parentId).kind}:${artifactNode.parentId}` : null;
    const evidenceIds = sortedUnique(artifactNode.evidenceIds);
    const claim = claimFor({
      subjectRef: `${node.kind}:${node.id}`, layer: 'expected', factLevel: 'confirmed',
      text: `产品目录确认${artifactNode.name}为${artifactNode.kind}节点。`, evidenceIds, key: 'catalog-identity',
    }, `$.artifacts.catalog.nodes.${artifactNode.id}`, state.evidenceRegistry);
    state.claimById.set(claim.id, claim);
    node.claimIds.push(claim.id);
    node.evidenceIds.push(...evidenceIds);
    state.catalog[collectionByKind[node.kind]].push(node);
    state.nodeByRef.set(`${node.kind}:${node.id}`, node);
  }
  for (const node of state.nodeByRef.values()) {
    if (!CATALOG_KINDS.has(node.kind)) continue;
    if (node.kind === 'system') node.domainRefs = [];
    if (node.kind === 'domain') node.moduleRefs = [];
    if (node.kind === 'module') node.featureRefs = [];
  }
  for (const node of state.nodeByRef.values()) {
    if (!node.parentRef) continue;
    const parent = state.nodeByRef.get(node.parentRef);
    const field = node.kind === 'domain' ? 'domainRefs' : node.kind === 'module' ? 'moduleRefs' : 'featureRefs';
    parent[field].push(`${node.kind}:${node.id}`);
    const claim = state.claimById.get(node.claimIds[0]);
    const relation = { id: relationId(node.parentRef, 'contains', `${node.kind}:${node.id}`), from: node.parentRef, type: 'contains', to: `${node.kind}:${node.id}`, claimIds: [claim.id], evidenceIds: [...claim.evidenceIds] };
    state.relationshipById.set(relation.id, relation);
    parent.relationRefs.push(relation.id);
    node.relationRefs.push(relation.id);
  }
}

function candidateIdentity(candidate, path, state) {
  for (const key of Object.keys(candidate)) {
    if (!CANDIDATE_FIELDS.has(key)) throw composerError('wiki-semantic-field-invalid', `Unsupported semantic candidate field: ${key}.`, `${path}.${key}`);
  }
  const kind = requireText(candidate.kind, `${path}.kind`);
  if (CATALOG_KINDS.has(kind)) {
    const ref = requireText(candidate.ref, `${path}.ref`);
    const node = state.nodeByRef.get(ref);
    if (!node || node.kind !== kind) throw composerError('wiki-semantic-catalog-authority-invalid', `${ref} is not an enabled Catalog Artifact node.`, `${path}.ref`);
    if (candidate.name !== undefined && candidate.name !== node.name) throw composerError('wiki-semantic-catalog-authority-invalid', `semanticDraft cannot rename Catalog node ${ref}.`, `${path}.name`);
    return { kind, key: ref, ref, id: node.id, node };
  }
  if (!OBJECT_COLLECTIONS.has(kind)) throw composerError('wiki-semantic-kind-invalid', `Unsupported semantic candidate kind: ${kind}.`, `${path}.kind`);
  const key = requireText(candidate.key, `${path}.key`);
  const id = stableId(kind, key);
  const ref = `${kind}:${id}`;
  if (state.nodeByRef.has(ref)) throw composerError('wiki-semantic-candidate-duplicate', `Duplicate semantic candidate: ${ref}.`, path);
  const node = baseNode(id, kind, requireText(candidate.name, `${path}.name`), Number.isInteger(candidate.order) ? candidate.order : 1000);
  state.objects[OBJECT_COLLECTIONS.get(kind)].push(node);
  state.nodeByRef.set(ref, node);
  return { kind, key, ref, id, node };
}

function resolveCandidateRef(value, state, path) {
  if (typeof value === 'string' && state.nodeByRef.has(value)) return value;
  if (typeof value === 'string' && state.refByKey.has(value)) return state.refByKey.get(value);
  throw composerError('wiki-semantic-reference-missing', `Unknown semantic object or Catalog ref: ${value}.`, path);
}

function resolveFieldRefs(value, state, path, field = '') {
  if (value === null || value === undefined) return value;
  if (NON_OBJECT_REFERENCE_FIELDS.has(field)) return structuredClone(value);
  if (field.endsWith('Ref')) return resolveCandidateRef(value, state, path);
  if (field.endsWith('Refs')) return requireArray(value, path).map((item, index) => resolveCandidateRef(item, state, `${path}[${index}]`)).sort();
  if (Array.isArray(value)) return value.map((item, index) => resolveFieldRefs(item, state, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = resolveFieldRefs(item, state, `${path}.${key}`, key);
    return result;
  }
  return value;
}

function attachFlowStructuredProof(node, claimByKey, state, path) {
  const attach = (entry, entryPath) => {
    const claimKeys = requireArray(entry.claimKeys, `${entryPath}.claimKeys`);
    const claims = claimKeys.map((key, index) => {
      const claim = claimByKey.get(key);
      if (!claim) throw composerError('wiki-semantic-claim-reference-missing', `Unknown candidate Claim key: ${key}.`, `${entryPath}.claimKeys[${index}]`);
      return claim;
    });
    const evidenceIds = resolveEvidenceRefs(entry.evidenceRefs, state.evidenceRegistry, `${entryPath}.evidenceRefs`);
    if (claims.length === 0 || evidenceIds.length === 0) {
      throw composerError('wiki-semantic-evidence-required', `${entryPath} requires independent Claim and Evidence references.`, entryPath);
    }
    const claimEvidenceIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
    if (evidenceIds.some((id) => !claimEvidenceIds.has(id))
      || claims.some((claim) => !claim.evidenceIds.some((id) => evidenceIds.includes(id)))) {
      throw composerError('wiki-semantic-structured-proof-invalid', `${entryPath} Evidence must support every selected Claim and cannot borrow unrelated candidate Evidence.`, entryPath);
    }
    const normalized = { ...entry, claimIds: sortedUnique(claims.map((claim) => claim.id)), evidenceIds };
    delete normalized.claimKeys;
    delete normalized.evidenceRefs;
    return normalized;
  };
  for (const field of ['phases', 'lanes', 'nodes', 'edges']) {
    node[field] = (node[field] ?? []).map((entry, index) => attach(entry, `${path}.fields.${field}[${index}]`));
  }
  const interaction = requireObject(node.interaction, `${path}.fields.interaction`);
  node.interaction = {
    sequenceGroups: requireArray(interaction.sequenceGroups, `${path}.fields.interaction.sequenceGroups`)
      .map((entry, index) => attach(entry, `${path}.fields.interaction.sequenceGroups[${index}]`)),
    participants: requireArray(interaction.participants, `${path}.fields.interaction.participants`)
      .map((entry, index) => attach(entry, `${path}.fields.interaction.participants[${index}]`)),
    messages: requireArray(interaction.messages, `${path}.fields.interaction.messages`)
      .map((entry, index) => attach(entry, `${path}.fields.interaction.messages[${index}]`)),
  };
}

function attachStructuredProof(node, claimIds, evidenceIds) {
  for (const field of STRUCTURED_FIELDS.get(node.kind) ?? []) {
    node[field] = (node[field] ?? []).map((entry) => {
      const normalized = { ...entry, claimIds: [...claimIds], evidenceIds: [...evidenceIds] };
      if (node.kind === 'interface' && field === 'endpoints') {
        normalized.id = stableId('endpoint', String(entry.key ?? entry.id ?? entry.name));
        normalized.errors = (entry.errors ?? []).map((error) => ({ ...error, claimIds: [...claimIds], evidenceIds: [...evidenceIds] }));
      }
      return normalized;
    });
  }
}

function applyCandidate(state, candidate, identity, index) {
  const path = `$.semanticDraft.candidates[${index}]`;
  const { node, ref } = identity;
  const claims = requireArray(candidate.claims ?? [], `${path}.claims`).map((raw, claimIndex) => {
    const claimPath = `${path}.claims[${claimIndex}]`;
    const claim = requireObject(raw, claimPath);
    const evidenceIds = resolveEvidenceRefs(claim.evidenceRefs, state.evidenceRegistry, `${claimPath}.evidenceRefs`);
    return claimFor({
      subjectRef: ref,
      layer: requireText(claim.layer, `${claimPath}.layer`),
      factLevel: claim.factLevel ?? 'partial',
      text: claim.text,
      evidenceIds,
      key: claim.key ?? String(claimIndex),
    }, claimPath, state.evidenceRegistry);
  });
  if (!CATALOG_KINDS.has(node.kind) && claims.length === 0) {
    throw composerError('wiki-semantic-evidence-required', `Non-Catalog candidate ${identity.key} requires at least one evidenced Claim.`, `${path}.claims`);
  }
  for (const claim of claims) state.claimById.set(claim.id, claim);
  const claimByKey = new Map();
  claims.forEach((claim, claimIndex) => {
    const raw = candidate.claims[claimIndex];
    const key = raw.key ?? String(claimIndex);
    if (claimByKey.has(key)) throw composerError('wiki-semantic-claim-key-duplicate', `Duplicate candidate Claim key: ${key}.`, `${path}.claims[${claimIndex}].key`);
    claimByKey.set(key, claim);
    claimByKey.set(claim.id, claim);
  });
  node.claimIds.push(...claims.map((claim) => claim.id));
  node.evidenceIds.push(...claims.flatMap((claim) => claim.evidenceIds));
  node.subjectRefs = requireArray(candidate.subjectRefs ?? [], `${path}.subjectRefs`).map((value, refIndex) => resolveCandidateRef(value, state, `${path}.subjectRefs[${refIndex}]`));
  node.ownerRefs = requireArray(candidate.ownerRefs ?? node.ownerRefs, `${path}.ownerRefs`).map((value, refIndex) => resolveCandidateRef(value, state, `${path}.ownerRefs[${refIndex}]`));
  node.confirmedEmptyFields = sortedUnique(requireArray(candidate.confirmedEmptyFields ?? [], `${path}.confirmedEmptyFields`));
  const fields = requireObject(candidate.fields ?? {}, `${path}.fields`);
  for (const [field, value] of Object.entries(fields)) {
    if (!(REQUIRED_FIELDS.get(node.kind) ?? []).includes(field)) throw composerError('wiki-semantic-field-invalid', `${node.kind} does not declare semantic field ${field}.`, `${path}.fields.${field}`);
    if (CATALOG_KINDS.has(node.kind) && ['sourceIdentity', 'parentRef'].includes(field)) {
      throw composerError('wiki-semantic-catalog-authority-invalid', `semanticDraft cannot replace Catalog-owned field ${field}.`, `${path}.fields.${field}`);
    }
    if (field === 'dataSourceAssessment') {
      const assessment = requireObject(value, `${path}.fields.${field}`);
      const databaseSourceIds = sortedUnique(requireArray(assessment.databaseSourceIds ?? [], `${path}.fields.${field}.databaseSourceIds`));
      for (const sourceId of databaseSourceIds) {
        if (!state.sourceIds.has(sourceId)) throw composerError('wiki-semantic-reference-missing', `Unknown Database Source: ${sourceId}.`, `${path}.fields.${field}.databaseSourceIds`);
      }
      node[field] = {
        applicability: requireText(assessment.applicability, `${path}.fields.${field}.applicability`),
        reason: requireText(assessment.reason, `${path}.fields.${field}.reason`),
        evidenceIds: resolveEvidenceRefs(assessment.evidenceRefs ?? [], state.evidenceRegistry, `${path}.fields.${field}.evidenceRefs`),
        databaseSourceIds,
        gapIds: [],
      };
    } else if (node.kind === 'flow' && field === 'viewAssessments') {
      const assessments = requireObject(value, `${path}.fields.${field}`);
      node[field] = Object.fromEntries(['state', 'sequence'].map((view) => {
        const assessment = requireObject(assessments[view], `${path}.fields.${field}.${view}`);
        return [view, {
          applicability: requireText(assessment.applicability, `${path}.fields.${field}.${view}.applicability`),
          reason: requireText(assessment.reason, `${path}.fields.${field}.${view}.reason`),
          evidenceIds: resolveEvidenceRefs(assessment.evidenceRefs ?? [], state.evidenceRegistry, `${path}.fields.${field}.${view}.evidenceRefs`),
          gapIds: sortedUnique(requireArray(assessment.gapIds ?? [], `${path}.fields.${field}.${view}.gapIds`)),
          gapKeys: sortedUnique(requireArray(assessment.gapKeys ?? [], `${path}.fields.${field}.${view}.gapKeys`)),
        }];
      }));
    } else {
      node[field] = resolveFieldRefs(value, state, `${path}.fields.${field}`, field);
    }
  }
  node.claimIds = sortedUnique(node.claimIds);
  node.evidenceIds = sortedUnique(node.evidenceIds);
  if (node.kind === 'flow') attachFlowStructuredProof(node, claimByKey, state, path);
  else attachStructuredProof(node, node.claimIds, node.evidenceIds);
}

function addCandidateRelationships(state, candidate, identity, index) {
  const path = `$.semanticDraft.candidates[${index}].relationships`;
  for (const [relationIndex, raw] of requireArray(candidate.relationships ?? [], path).entries()) {
    const relationPath = `${path}[${relationIndex}]`;
    const value = requireObject(raw, relationPath);
    const to = resolveCandidateRef(value.to, state, `${relationPath}.to`);
    const evidenceIds = resolveEvidenceRefs(value.evidenceRefs, state.evidenceRegistry, `${relationPath}.evidenceRefs`);
    const claim = claimFor({
      subjectRef: identity.ref,
      layer: requireText(value.layer, `${relationPath}.layer`),
      factLevel: value.factLevel ?? 'partial',
      text: value.text,
      evidenceIds,
      key: `relationship:${relationIndex}`,
    }, relationPath, state.evidenceRegistry);
    state.claimById.set(claim.id, claim);
    identity.node.claimIds.push(claim.id);
    identity.node.evidenceIds.push(...evidenceIds);
    const relation = { id: relationId(identity.ref, value.type, to), from: identity.ref, type: requireText(value.type, `${relationPath}.type`), to, claimIds: [claim.id], evidenceIds };
    if (state.relationshipById.has(relation.id)) throw composerError('wiki-semantic-relationship-duplicate', `Duplicate relationship ${relation.id}.`, relationPath);
    state.relationshipById.set(relation.id, relation);
    identity.node.relationRefs.push(relation.id);
    state.nodeByRef.get(to).relationRefs.push(relation.id);
  }
}

function addArtifactClaims(state, artifacts) {
  for (const artifact of artifacts) {
    const statements = artifact.kind === 'code-artifact' ? artifact.facts
      : ['spec-artifact', 'record-artifact', 'knowledge-artifact'].includes(artifact.kind) ? artifact.statements : [];
    const layer = artifact.kind === 'spec-artifact' ? 'expected'
      : artifact.kind === 'record-artifact' ? 'observed' : 'current';
    for (const statement of statements ?? []) {
      for (const candidateRef of statement.candidateRefs ?? []) {
        const ref = state.nodeByRef.has(candidateRef) ? candidateRef : state.refByKey.get(candidateRef);
        if (!ref) continue;
        const evidenceIds = [statement.evidenceId];
        const claim = claimFor({ subjectRef: ref, layer, factLevel: 'confirmed', text: statement.text, evidenceIds, key: `artifact:${statement.id}` }, '$.artifacts', state.evidenceRegistry);
        state.claimById.set(claim.id, claim);
        const node = state.nodeByRef.get(ref);
        node.claimIds.push(claim.id);
        node.evidenceIds.push(...evidenceIds);
      }
    }
  }
}

function addReverseReferences(state) {
  for (const [ref, node] of state.nodeByRef.entries()) {
    if (CATALOG_KINDS.has(node.kind)) continue;
    const featureField = REFERENCE_FIELDS.get(node.kind);
    if (!featureField) continue;
    for (const subjectRef of node.subjectRefs) {
      const feature = state.nodeByRef.get(subjectRef);
      if (feature?.kind !== 'feature') continue;
      feature[featureField] ??= [];
      feature[featureField].push(ref);
    }
  }
}

function addAdoptedRequirements(state, artifacts) {
  for (const artifact of artifacts.filter((item) => item.kind === 'requirement-artifact')) {
    for (const item of artifact.items.filter((candidate) => candidate.decision === 'adopted')) {
      const featureRefs = item.featureRefs.filter((ref) => state.nodeByRef.get(ref)?.kind === 'feature');
      if (featureRefs.length === 0) continue;
      const id = stableId('requirement', `${artifact.sourceId}-${item.externalId}`);
      const ref = `requirement:${id}`;
      if (state.nodeByRef.has(ref)) continue;
      const node = baseNode(id, 'requirement', item.title ?? item.externalId, 1000);
      node.provider = artifact.provenance.provider;
      node.externalId = item.externalId;
      node.normalizedStatus = item.normalizedStatus;
      node.scopeType = ['baseline', 'enhancement', 'bugfix', 'migration'].includes(item.scopeType) ? item.scopeType : 'enhancement';
      node.scopeRef = featureRefs.length === 1 ? featureRefs[0] : null;
      node.featureRefs = featureRefs;
      node.subjectRefs = featureRefs;
      const evidenceIds = [item.evidenceId];
      const claim = claimFor({ subjectRef: ref, layer: 'expected', factLevel: 'confirmed', text: item.title ?? `需求 ${item.externalId}`, evidenceIds, key: 'adopted-requirement' }, '$.artifacts', state.evidenceRegistry);
      node.claimIds = [claim.id];
      node.evidenceIds = evidenceIds;
      state.claimById.set(claim.id, claim);
      state.nodeByRef.set(ref, node);
      state.objects.requirements.push(node);
      for (const featureRef of featureRefs) {
        const feature = state.nodeByRef.get(featureRef);
        feature.requirementRefs ??= [];
        feature.requirementRefs.push(ref);
        const relation = { id: relationId(featureRef, 'specified-by', ref), from: featureRef, type: 'specified-by', to: ref, claimIds: [claim.id], evidenceIds };
        state.relationshipById.set(relation.id, relation);
        feature.relationRefs.push(relation.id);
        node.relationRefs.push(relation.id);
      }
    }
  }
}

function addDeclaredGaps(state, draft) {
  for (const [index, raw] of requireArray(draft.gaps ?? [], '$.semanticDraft.gaps').entries()) {
    const path = `$.semanticDraft.gaps[${index}]`;
    const value = requireObject(raw, path);
    const subjectRefs = requireArray(value.subjects, `${path}.subjects`).map((ref, refIndex) => resolveCandidateRef(ref, state, `${path}.subjects[${refIndex}]`));
    const fieldRefs = requireArray(value.fields ?? [], `${path}.fields`).map((field, fieldIndex) => {
      const text = requireText(field, `${path}.fields[${fieldIndex}]`);
      if (text.includes(':') && text.includes('.')) return text;
      if (subjectRefs.length !== 1) throw composerError('wiki-semantic-gap-field-invalid', 'Short Gap fields require exactly one subject.', `${path}.fields[${fieldIndex}]`);
      return `${subjectRefs[0]}.${text}`;
    });
    addGap(state, {
      type: requireText(value.type, `${path}.type`),
      description: requireText(value.description, `${path}.description`),
      subjectRefs,
      fieldRefs,
      evidenceIds: resolveEvidenceRefs(value.evidenceRefs ?? [], state.evidenceRegistry, `${path}.evidenceRefs`),
      severity: value.severity ?? 'P1',
      key: value.key ?? String(index),
      guidance: {
        title: value.title,
        question: value.question,
        context: value.context,
        decisionImpact: value.decisionImpact,
        resolutionMode: value.resolutionMode,
        responseContract: value.responseContract,
        suggestedSourceKinds: value.suggestedSourceKinds,
        blockingStage: value.blockingStage,
        resolutionCriteria: value.resolutionCriteria,
      },
    });
  }
}

function addConflictGaps(state, draft) {
  for (const [index, raw] of requireArray(draft.conflicts ?? [], '$.semanticDraft.conflicts').entries()) {
    const path = `$.semanticDraft.conflicts[${index}]`;
    const value = requireObject(raw, path);
    const subjectRef = resolveCandidateRef(value.subject, state, `${path}.subject`);
    const field = requireText(value.field, `${path}.field`);
    addGap(state, {
      type: 'conflict-gap', description: requireText(value.description, `${path}.description`),
      subjectRefs: [subjectRef], fieldRefs: [`${subjectRef}.${field}`],
      evidenceIds: resolveEvidenceRefs(value.evidenceRefs, state.evidenceRegistry, `${path}.evidenceRefs`),
      key: value.key ?? String(index),
      guidance: {
        title: value.title,
        question: value.question,
        context: value.context,
        decisionImpact: value.decisionImpact,
        responseContract: value.responseContract,
        suggestedSourceKinds: value.suggestedSourceKinds,
        blockingStage: value.blockingStage,
        resolutionCriteria: value.resolutionCriteria,
      },
    });
  }
}

function addConfirmationDecisions(state, decisionsInput, reviewItems = []) {
  const allDecisionEvidence = [...state.evidenceRegistry.values()].filter((evidence) => evidence.authority === 'human-confirmation' && evidence.decision);
  const activeDecisions = activeDecisionIds(allDecisionEvidence.map((evidence) => evidence.decision));
  const reviewById = new Map(reviewItems.map((item) => [item.id, item]));
  for (const [index, raw] of requireArray(decisionsInput ?? [], '$.confirmationDecisions').entries()) {
    const path = `$.confirmationDecisions[${index}]`;
    const value = requireObject(raw, path);
    const target = requireObject(value.target, `${path}.target`);
    const evidenceIds = resolveEvidenceRefs(value.evidenceRefs, state.evidenceRegistry, `${path}.evidenceRefs`);
    const decisionEvidence = evidenceIds.map((id) => state.evidenceRegistry.get(id)).filter((evidence) => evidence?.decision);
    if (decisionEvidence.length !== 1 || decisionEvidence[0].authority !== 'human-confirmation') throw composerError('wiki-decision-resolution-invalid', 'Decision requires exactly one confirmed Decision Artifact Evidence.', `${path}.evidenceRefs`);
    const decision = decisionEvidence[0].decision;
    const fingerprint = requireText(value.decisionFingerprint, `${path}.decisionFingerprint`);
    if (fingerprint !== decision.decisionFingerprint) throw composerError('decision-confirmation-invalid', 'Decision fingerprint differs from the confirmed Artifact.', `${path}.decisionFingerprint`);
    if (!activeDecisions.has(decision.decisionId)) continue;

    if (target.kind === 'review-item') {
      const reviewItemId = requireText(target.id, `${path}.target.id`);
      const item = reviewById.get(reviewItemId);
      if (!item) throw composerError('wiki-review-decision-invalid', `Decision references an unknown ReviewItem: ${reviewItemId}.`, `${path}.target.id`);
      const sourceFingerprint = requireText(target.sourceFingerprint, `${path}.target.sourceFingerprint`);
      if (decision.target.kind !== 'review-item' || decision.target.id !== reviewItemId
        || decision.target.sourceFingerprint !== sourceFingerprint) {
        throw composerError('wiki-review-decision-invalid', 'Decision Artifact target does not match the ReviewItem application target.', `${path}.target`);
      }
      const sourceDrift = item.sourceFingerprint !== sourceFingerprint;
      item.status = sourceDrift ? 'drift' : {
        confirm: 'confirmed', modify: 'modified', reject: 'rejected', defer: 'deferred',
      }[decision.outcome];
      item.decisionId = decision.decisionId;
      if (sourceDrift) {
        item.priority = 'P0';
        item.reasonCodes = sortedUnique([...item.reasonCodes, 'baseline-current-conflict']);
      }
      if (['reject', 'defer'].includes(decision.outcome)) continue;

      const proposal = decision.answer.proposal;
      const acId = stableId('ac', item.id);
      const acRef = `acceptance-criteria:${acId}`;
      if (state.nodeByRef.has(acRef)) throw composerError('wiki-review-decision-invalid', `Duplicate Atomic Acceptance Criteria: ${acRef}.`, path);
      const feature = state.nodeByRef.get(item.featureRef);
      const operationRefs = item.subjectRefs.filter((ref) => state.nodeByRef.get(ref)?.kind === 'operation');
      const ac = baseNode(acId, 'acceptance-criteria', item.question, 1000);
      Object.assign(ac, {
        featureRef: item.featureRef,
        operationRefs,
        criterionType: proposal.criterionType,
        given: proposal.given,
        when: proposal.when,
        then: proposal.then,
        requirementRef: null,
        decisionId: decision.decisionId,
        subjectRefs: [item.featureRef],
        evidenceIds,
        confirmedEmptyFields: operationRefs.length === 0 ? ['operationRefs'] : [],
      });
      const claim = claimFor({
        subjectRef: acRef,
        layer: 'expected',
        factLevel: 'confirmed',
        text: `${proposal.given.join('；')}；当${proposal.when}时，应${proposal.then.join('；')}`,
        evidenceIds,
        key: decision.decisionId,
      }, path, state.evidenceRegistry);
      ac.claimIds = [claim.id];
      state.claimById.set(claim.id, claim);
      state.nodeByRef.set(acRef, ac);
      state.objects.acceptanceCriteria.push(ac);
      feature.acceptanceCriteriaRefs.push(acRef);
      const coveredOperationRefs = new Set(feature.acceptanceCriteriaRefs.flatMap((ref) => state.nodeByRef.get(ref)?.operationRefs ?? []));
      if (feature.operationRefs.every((ref) => coveredOperationRefs.has(ref))) {
        for (const gap of [...state.gapById.values()]) {
          if (gap.status !== 'open' || gap.type !== 'acceptance-gap'
            || !gap.fieldRefs.includes(`${item.featureRef}.acceptanceCriteriaRefs`)) continue;
          state.gapById.delete(gap.id);
          for (const node of state.nodeByRef.values()) node.gapIds = node.gapIds.filter((id) => id !== gap.id);
        }
      }
      const relation = { id: relationId(item.featureRef, 'specified-by', acRef), from: item.featureRef, type: 'specified-by', to: acRef, claimIds: [claim.id], evidenceIds };
      state.relationshipById.set(relation.id, relation);
      feature.relationRefs.push(relation.id);
      ac.relationRefs.push(relation.id);
      if (decision.outcome === 'modify' || sourceDrift) {
        const conflictId = addGap(state, {
          type: 'conflict-gap',
          description: `${feature.name}的已审核产品基线与当前实现提案不一致。`,
          subjectRefs: [item.featureRef, acRef],
          fieldRefs: [`${acRef}.then`],
          evidenceIds: sortedUnique([...item.evidenceIds, ...evidenceIds]),
          severity: 'P0',
          key: `baseline-current:${item.id}:${decision.decisionId}`,
          audience: 'product-review',
        });
        feature.gapIds.push(conflictId);
        ac.gapIds.push(conflictId);
      }
      continue;
    }
    if (target.kind !== 'gap') throw composerError('wiki-gap-resolution-invalid', 'Gap confirmation requires target.kind gap.', `${path}.target.kind`);
    const gapId = requireText(target.id, `${path}.target.id`);
    const gap = state.gapById.get(gapId);
    if (!gap || gap.status !== 'open') throw composerError('wiki-gap-resolution-invalid', `Decision references an unknown or non-open Gap: ${gapId}.`, `${path}.target.id`);
    const subjectRef = resolveCandidateRef(value.subject, state, `${path}.subject`);
    if (gap.subjectRefs.length !== 1 || gap.subjectRefs[0] !== subjectRef) throw composerError('wiki-gap-resolution-invalid', 'Decision subject does not exactly match the Gap.', `${path}.subject`);
    if (decision.target.kind !== 'gap' || decision.target.id !== gapId || decision.subjectRef !== subjectRef
      || JSON.stringify(decision.fieldRefs) !== JSON.stringify(gap.fieldRefs)) {
      throw composerError('wiki-gap-resolution-invalid', 'Decision Artifact target does not exactly match the Gap.', `${path}.evidenceRefs`);
    }
    validateGapAnswer(gap.responseContract, decision.answer, `${path}.answer`);
    const node = state.nodeByRef.get(subjectRef);
    const resolution = decision.resolution;
    const fieldRef = `${subjectRef}.${resolution.field}`;
    if (!gap.fieldRefs.includes(fieldRef) || !(REQUIRED_FIELDS.get(node.kind) ?? []).includes(resolution.field)) {
      throw composerError('wiki-gap-resolver-unsupported', `Typed resolver cannot modify ${fieldRef}.`, `${path}.resolution`);
    }
    if (resolution.kind === 'set-field') {
      if (resolution.value === null || resolution.value === undefined || resolution.value === '') throw composerError('wiki-gap-answer-invalid', 'set-field requires a non-empty value.', `${path}.resolution.value`);
      node[resolution.field] = structuredClone(resolution.value);
      node.confirmedEmptyFields = node.confirmedEmptyFields.filter((field) => field !== resolution.field);
    } else if (resolution.kind === 'set-ref-list') {
      node[resolution.field] = requireArray(resolution.value, `${path}.resolution.value`)
        .map((ref, refIndex) => resolveCandidateRef(ref, state, `${path}.resolution.value[${refIndex}]`));
      if (node[resolution.field].length === 0) throw composerError('wiki-gap-answer-invalid', 'set-ref-list requires at least one reference.', `${path}.resolution.value`);
      node.confirmedEmptyFields = node.confirmedEmptyFields.filter((field) => field !== resolution.field);
    } else if (resolution.kind === 'confirm-empty') {
      node[resolution.field] = defaultValue(node.kind, resolution.field);
      node.confirmedEmptyFields = sortedUnique([...node.confirmedEmptyFields, resolution.field]);
    } else {
      throw composerError('wiki-gap-resolver-unsupported', `Unsupported typed resolver: ${resolution.kind}.`, `${path}.resolution.kind`);
    }
    if (value.factLevel !== undefined && value.factLevel !== 'confirmed') {
      throw composerError('wiki-gap-resolution-invalid', 'A resolved product Decision requires a confirmed Expected Claim.', `${path}.factLevel`);
    }
    const claim = claimFor({
      subjectRef,
      layer: 'expected',
      factLevel: 'confirmed',
      text: value.text,
      evidenceIds,
      key: value.key ?? String(index),
    }, path, state.evidenceRegistry);
    state.claimById.set(claim.id, claim);
    node.claimIds.push(claim.id);
    node.evidenceIds.push(...evidenceIds);
    gap.status = 'resolved';
    gap.resolutionEvidenceIds = evidenceIds;
    gap.resolvedByDecisionId = decision.decisionId;
  }
  return reviewItems;
}

function resolveFlowAssessmentGaps(state) {
  for (const flow of state.objects.flows) {
    for (const view of ['state', 'sequence']) {
      const assessment = flow.viewAssessments?.[view];
      if (!assessment) continue;
      const resolved = (assessment.gapKeys ?? []).map((key, index) => {
        const id = state.gapIdByKey.get(key);
        if (!id) throw composerError('wiki-semantic-gap-reference-missing', `Unknown semantic Gap key: ${key}.`, `flow:${flow.id}.viewAssessments.${view}.gapKeys[${index}]`);
        return id;
      });
      assessment.gapIds = sortedUnique([...assessment.gapIds, ...resolved]);
      delete assessment.gapKeys;
    }
  }
}

function finalize(state) {
  for (const node of state.nodeByRef.values()) {
    ensureRequiredFields(state, node);
    if (node.kind === 'data-entity' && node.fieldCoverage === 'unknown') {
      addGap(state, {
        type: 'data-source-gap',
        description: `${node.name}的数据字段覆盖范围尚未确认。`,
        subjectRefs: [`data-entity:${node.id}`],
        fieldRefs: [`data-entity:${node.id}.fieldCoverage`],
        evidenceIds: node.evidenceIds,
        key: `data-entity:${node.id}.fieldCoverage`,
      });
    }
    if (node.kind === 'feature' && node.dataSourceAssessment === null) {
      const dataGapIds = node.gapIds.filter((id) => state.gapById.get(id)?.fieldRefs.includes(`feature:${node.id}.dataSourceAssessment`));
      node.dataSourceAssessment = { applicability: 'unknown', reason: '尚未完成数据源适用性判断', evidenceIds: [], databaseSourceIds: [], gapIds: dataGapIds };
    } else if (node.kind === 'feature') {
      const ref = `feature:${node.id}`;
      if (node.dataSourceAssessment.applicability === 'not-applicable' && node.dataSourceAssessment.evidenceIds.length === 0) {
        throw composerError('wiki-semantic-evidence-required', `${ref} not-applicable dataSourceAssessment requires Artifact Evidence.`, `${ref}.dataSourceAssessment.evidenceRefs`);
      }
      if ((node.dataSourceAssessment.applicability === 'unknown'
        || (node.dataSourceAssessment.applicability === 'applicable' && node.dataSourceAssessment.databaseSourceIds.length === 0))) {
        addGap(state, {
          type: 'data-source-gap',
          description: `${node.name}的数据源适用性或可用性尚未确认。`,
          subjectRefs: [ref],
          fieldRefs: [`${ref}.dataSourceAssessment`],
          evidenceIds: node.dataSourceAssessment.evidenceIds,
          key: `${ref}.dataSourceAssessment`,
        });
      }
      node.dataSourceAssessment.gapIds = sortedUnique([
        ...node.dataSourceAssessment.gapIds,
        ...node.gapIds.filter((id) => state.gapById.get(id)?.fieldRefs.includes(`${ref}.dataSourceAssessment`)),
      ]);
    }
    node.ownerRefs = sortedUnique(node.ownerRefs);
    node.subjectRefs = sortedUnique(node.subjectRefs);
    node.relationRefs = sortedUnique(node.relationRefs);
    node.claimIds = sortedUnique(node.claimIds);
    node.evidenceIds = sortedUnique(node.evidenceIds);
    node.gapIds = sortedUnique(node.gapIds);
    node.versionRefs = sortedUnique(node.versionRefs);
    for (const field of REQUIRED_FIELDS.get(node.kind) ?? []) {
      if (field.endsWith('Refs') && Array.isArray(node[field])) node[field] = sortedUnique(node[field]);
    }
    const hasOpenGap = node.gapIds.some((id) => state.gapById.get(id)?.status === 'open');
    node.status = !hasOpenGap && node.claimIds.every((id) => state.claimById.get(id)?.factLevel === 'confirmed') ? 'confirmed' : 'needs-review';
  }
  for (const collection of Object.values(state.catalog)) collection.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  for (const collection of Object.values(state.objects)) collection.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function validateSemanticDraft(input) {
  const draft = requireObject(input, '$.semanticDraft');
  if (draft.schemaVersion !== 1) throw composerError('wiki-semantic-draft-invalid', 'semanticDraft.schemaVersion must equal 1.', '$.semanticDraft.schemaVersion');
  for (const forbidden of ['catalog', 'objects', 'relationships', 'governance', 'coverage', 'publication', 'manifest', 'pages', 'files']) {
    if (forbidden in draft) throw composerError('wiki-semantic-final-model-forbidden', `semanticDraft cannot contain final model field ${forbidden}.`, `$.semanticDraft.${forbidden}`);
  }
  requireArray(draft.candidates ?? [], '$.semanticDraft.candidates');
  const knownFields = new Set(['schemaVersion', 'candidates', 'gaps', 'conflicts']);
  for (const key of Object.keys(draft)) {
    if (!knownFields.has(key)) throw composerError('wiki-semantic-draft-invalid', `Unsupported semanticDraft field: ${key}.`, `$.semanticDraft.${key}`);
  }
  return structuredClone(draft);
}

export function composeWikiModelInput(stagedInput) {
  const input = requireObject(stagedInput, '$');
  const draft = validateSemanticDraft(input.semanticDraft);
  const artifacts = requireArray(input.artifacts, '$.artifacts');
  const catalogArtifacts = artifacts.filter((artifact) => artifact.kind === 'catalog-artifact');
  if (catalogArtifacts.length !== 1) throw composerError('wiki-catalog-artifact-required', 'Composer requires exactly one Catalog Artifact.', '$.artifacts');
  const evidenceRegistry = collectArtifactEvidence(artifacts);
  const state = {
    evidenceRegistry,
    catalog: { systems: [], domains: [], modules: [], features: [] },
    objects: Object.fromEntries([...OBJECT_COLLECTIONS.values()].map((collection) => [collection, []])),
    nodeByRef: new Map(), refByKey: new Map(), claimById: new Map(), gapById: new Map(), gapIdByKey: new Map(), relationshipById: new Map(),
    sourceIds: new Set(requireArray(input.sourceResults, '$.sourceResults').map((result) => result.sourceId)),
  };
  makeCatalog(state, catalogArtifacts[0]);

  const candidates = draft.candidates ?? [];
  const identities = candidates.map((raw, index) => {
    const candidate = requireObject(raw, `$.semanticDraft.candidates[${index}]`);
    const identity = candidateIdentity(candidate, `$.semanticDraft.candidates[${index}]`, state);
    if (state.refByKey.has(identity.key)) throw composerError('wiki-semantic-candidate-duplicate', `Duplicate semantic key: ${identity.key}.`, `$.semanticDraft.candidates[${index}]`);
    state.refByKey.set(identity.key, identity.ref);
    state.refByKey.set(identity.ref, identity.ref);
    return identity;
  });
  for (const ref of state.nodeByRef.keys()) state.refByKey.set(ref, ref);
  candidates.forEach((candidate, index) => applyCandidate(state, candidate, identities[index], index));
  candidates.forEach((candidate, index) => addCandidateRelationships(state, candidate, identities[index], index));
  addArtifactClaims(state, artifacts);
  addAdoptedRequirements(state, artifacts);
  addReverseReferences(state);
  finalize(state);
  addDeclaredGaps(state, draft);
  addConflictGaps(state, draft);
  resolveFlowAssessmentGaps(state);
  const builtReview = buildReviewItems({
    catalog: state.catalog,
    objects: state.objects,
    claims: [...state.claimById.values()],
    evidence: [...state.evidenceRegistry.values()],
    gaps: [...state.gapById.values()],
  });
  const reviewItems = addConfirmationDecisions(state, input.confirmationDecisions, builtReview.items);
  finalize(state);

  const composed = structuredClone(input);
  delete composed.semanticDraft;
  delete composed.confirmationDecisions;
  composed.catalog = state.catalog;
  composed.objects = state.objects;
  composed.relationships = [...state.relationshipById.values()].sort((left, right) => left.from.localeCompare(right.from) || left.type.localeCompare(right.type) || left.to.localeCompare(right.to));
  composed.governance = {
    claims: [...state.claimById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    evidence: [...state.evidenceRegistry.values()].sort((left, right) => left.id.localeCompare(right.id)),
    gaps: [...state.gapById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    ...(requireArray(input.confirmationDecisions ?? [], '$.confirmationDecisions').some((item) => item?.target?.kind === 'review-item')
      ? { reviewItems, reviewDiagnostics: builtReview.diagnostics }
      : {}),
    coverage: {},
  };
  return composed;
}

export const __private = { collectArtifactEvidence, hashId, relationId, stableId };
