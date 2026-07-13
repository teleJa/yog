import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { stringifyFrontmatter } from './frontmatter.mjs';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const RUN_ID_PATTERN = /^wiki-[a-z0-9-]+$/;
const FACT_LEVELS = new Set(['confirmed', 'partial', 'needs-review']);
const LOCAL_SOURCE_TYPES = new Set(['code', 'record', 'spec']);
const SOURCE_TYPES = new Set([...LOCAL_SOURCE_TYPES, 'menu', 'requirement']);
const GAP_AUDIENCES = new Set(['product-review', 'internal']);
const SCOPE_MODES = new Set(['menu-scope', 'record-related']);
const REQUIREMENT_QUERY_TIERS = new Set(['explicit', 'menu', 'capability', 'hierarchy']);
const REQUIREMENT_ITEM_ROLES = new Set(['product-requirement', 'development-task', 'test', 'defect']);
const REQUIREMENT_STATUSES = new Set(['completed', 'in-progress', 'terminated', 'unknown']);
const REQUIREMENT_RELEVANCE = new Set(['direct', 'supporting', 'out-of-scope', 'weak']);
const REQUIREMENT_DECISIONS = new Set(['adopted', 'excluded', 'conflict']);
const REQUIREMENT_FACT_KEYS = [
  'purpose',
  'roles',
  'preconditions',
  'capabilities',
  'pageAreas',
  'operations',
  'configuration',
  'businessRules',
  'systemBehavior',
  'limitations',
];
const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/var\/folders\//,
  /\b(?:token|password|passwd|secret)\s*[:=]\s*["']?(?!redacted|unknown|missing)[A-Za-z0-9_+/.=-]{12,}/i,
];

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
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

function assertId(value, path) {
  if (!ID_PATTERN.test(value ?? '')) fail('wiki-mvp-id-invalid', `${path} must be a kebab-case ID.`, path);
}

function assertText(value, path) {
  if (typeof value !== 'string' || value.trim() === '') fail('wiki-mvp-text-required', `${path} must be a non-empty string.`, path);
  return value.trim();
}

function assertArray(value, path) {
  if (!Array.isArray(value)) fail('wiki-mvp-array-required', `${path} must be an array.`, path);
  return value;
}

function assertSafeRelativePath(value, path) {
  assertText(value, path);
  if (isAbsolute(value) || value.includes('\\') || value.split('/').includes('..')) {
    fail('wiki-mvp-path-invalid', `${path} must be a safe relative path.`, path);
  }
  return value;
}

function safeFilename(value, fallback) {
  const cleaned = String(value ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || fallback;
}

function git(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function localSourceMetadata(source) {
  const root = resolve(assertText(source.root, `$.sources.${source.id}.root`));
  if (!isAbsolute(source.root) || !existsSync(root) || !statSync(root).isDirectory()) {
    fail('wiki-mvp-source-root-invalid', `Source root for ${source.id} must be an existing absolute directory.`, `$.sources.${source.id}.root`);
  }
  const revision = source.type === 'code' ? git(root, ['rev-parse', 'HEAD']) : null;
  const dirty = source.type === 'code' ? Boolean(git(root, ['status', '--porcelain', '--untracked-files=no'])) : false;
  return {
    runtimeRoot: root,
    public: {
      id: source.id,
      type: source.type,
      name: source.name,
      ...(revision ? { revision } : {}),
      ...(source.type === 'code' ? { dirty } : {}),
    },
  };
}

function assertEnum(value, allowed, path) {
  if (!allowed.has(value)) fail('wiki-mvp-enum-invalid', `${path} has an unsupported value: ${value}.`, path);
  return value;
}

function assertIsoDate(value, path) {
  const text = assertText(value, path);
  if (Number.isNaN(Date.parse(text))) fail('wiki-mvp-date-invalid', `${path} must be an ISO date-time.`, path);
  return text;
}

function normalizeRequirementSource(source, path) {
  const provider = assertText(source.provider, `${path}.provider`);
  assertId(provider, `${path}.provider`);
  const providerLabel = source.providerLabel
    ? assertText(source.providerLabel, `${path}.providerLabel`)
    : provider.toUpperCase();
  const scope = assertText(source.scope, `${path}.scope`);
  if (source.scopeConfirmedByUser !== true) {
    fail('wiki-mvp-requirement-scope-unconfirmed', 'Requirement query scope must be explicitly confirmed by the user.', `${path}.scopeConfirmedByUser`);
  }
  const capturedAt = assertIsoDate(source.capturedAt, `${path}.capturedAt`);
  const transport = assertText(source.transport, `${path}.transport`);
  assertId(transport, `${path}.transport`);
  const queries = assertArray(source.queries, `${path}.queries`).map((rawQuery, index) => {
    const query = objectValue(rawQuery);
    const queryPath = `${path}.queries[${index}]`;
    if (!query) fail('wiki-mvp-requirement-query-invalid', 'Each requirement query must be an object.', queryPath);
    assertId(query.id, `${queryPath}.id`);
    const terms = [...new Set(assertArray(query.terms, `${queryPath}.terms`).map((term, termIndex) => assertText(term, `${queryPath}.terms[${termIndex}]`)))];
    if (terms.length === 0) fail('wiki-mvp-requirement-query-empty', 'Requirement query terms cannot be empty.', `${queryPath}.terms`);
    return {
      id: query.id,
      tier: assertEnum(query.tier, REQUIREMENT_QUERY_TIERS, `${queryPath}.tier`),
      terms,
      featureIds: [...new Set(assertArray(query.featureIds, `${queryPath}.featureIds`))],
    };
  });
  if (queries.length === 0) fail('wiki-mvp-requirement-queries-required', 'A collected requirement source must record its layered queries.', `${path}.queries`);
  const queryIds = new Set();
  for (const [index, query] of queries.entries()) {
    if (queryIds.has(query.id)) fail('wiki-mvp-requirement-query-duplicate', `Duplicate requirement query ID: ${query.id}.`, `${path}.queries[${index}].id`);
    queryIds.add(query.id);
  }
  const candidates = assertArray(source.candidates, `${path}.candidates`).map((rawCandidate, index) => {
    const candidate = objectValue(rawCandidate);
    const candidatePath = `${path}.candidates[${index}]`;
    if (!candidate) fail('wiki-mvp-requirement-candidate-invalid', 'Each requirement candidate must be an object.', candidatePath);
    const parentExternalId = candidate.parentExternalId === null
      ? null
      : assertText(candidate.parentExternalId, `${candidatePath}.parentExternalId`);
    return {
      externalId: assertText(candidate.externalId, `${candidatePath}.externalId`),
      title: assertText(candidate.title, `${candidatePath}.title`),
      itemRole: assertEnum(candidate.itemRole, REQUIREMENT_ITEM_ROLES, `${candidatePath}.itemRole`),
      parentExternalId,
      relationshipVerified: candidate.relationshipVerified === true,
      rawStatus: assertText(candidate.rawStatus, `${candidatePath}.rawStatus`),
      normalizedStatus: assertEnum(candidate.normalizedStatus, REQUIREMENT_STATUSES, `${candidatePath}.normalizedStatus`),
      relevance: assertEnum(candidate.relevance, REQUIREMENT_RELEVANCE, `${candidatePath}.relevance`),
      decision: assertEnum(candidate.decision, REQUIREMENT_DECISIONS, `${candidatePath}.decision`),
      reason: assertText(candidate.reason, `${candidatePath}.reason`),
      featureIds: [...new Set(assertArray(candidate.featureIds, `${candidatePath}.featureIds`))],
      codeEvidenceIds: [...new Set(assertArray(candidate.codeEvidenceIds ?? [], `${candidatePath}.codeEvidenceIds`))],
      evidenceId: candidate.evidenceId ? assertText(candidate.evidenceId, `${candidatePath}.evidenceId`) : null,
    };
  });
  const candidateIds = new Set();
  for (const [index, candidate] of candidates.entries()) {
    if (candidateIds.has(candidate.externalId)) {
      fail('wiki-mvp-requirement-candidate-duplicate', `Duplicate requirement candidate ID: ${candidate.externalId}.`, `${path}.candidates[${index}].externalId`);
    }
    candidateIds.add(candidate.externalId);
  }
  return { provider, providerLabel, scope, scopeConfirmedByUser: true, capturedAt, transport, queries, candidates };
}

function normalizeSources(rawSources) {
  const sources = new Map();
  const publicSources = [];
  for (const [index, raw] of assertArray(rawSources, '$.sources').entries()) {
    const source = objectValue(raw);
    if (!source) fail('wiki-mvp-source-invalid', 'Each source must be an object.', `$.sources[${index}]`);
    assertId(source.id, `$.sources[${index}].id`);
    if (sources.has(source.id)) fail('wiki-mvp-source-duplicate', `Duplicate source ID: ${source.id}.`, `$.sources[${index}].id`);
    if (!SOURCE_TYPES.has(source.type)) fail('wiki-mvp-source-type-invalid', `Unsupported source type: ${source.type}.`, `$.sources[${index}].type`);
    source.name = assertText(source.name, `$.sources[${index}].name`);
    const sourcePath = `$.sources[${index}]`;
    const requirement = source.type === 'requirement' ? normalizeRequirementSource(source, sourcePath) : null;
    const normalized = LOCAL_SOURCE_TYPES.has(source.type)
      ? { ...source, ...localSourceMetadata(source) }
      : {
          ...source,
          ...(requirement ?? {}),
          runtimeRoot: null,
          public: {
            id: source.id,
            type: source.type,
            name: source.name,
            ...(requirement ?? {}),
          },
        };
    sources.set(source.id, normalized);
    publicSources.push(normalized.public);
  }
  if (![...sources.values()].some((source) => source.type === 'menu')) fail('wiki-mvp-menu-source-required', 'A menu source is required.', '$.sources');
  if (![...sources.values()].some((source) => source.type === 'code')) fail('wiki-mvp-code-source-required', 'At least one code source is required.', '$.sources');
  return { sources, publicSources };
}

function normalizeScopeDecision(rawDecision, hasRecordSource) {
  const decision = objectValue(rawDecision);
  if (!decision) fail('wiki-mvp-scope-decision-required', 'An explicit scopeDecision is required.', '$.scopeDecision');
  if (!SCOPE_MODES.has(decision.mode)) fail('wiki-mvp-scope-mode-invalid', `Unsupported scope mode: ${decision.mode}.`, '$.scopeDecision.mode');
  if (decision.confirmedByUser !== true) fail('wiki-mvp-scope-unconfirmed', 'The Wiki generation scope must be confirmed by the user.', '$.scopeDecision.confirmedByUser');
  if (decision.mode === 'record-related' && !hasRecordSource) {
    fail('wiki-mvp-record-scope-without-record', 'record-related scope requires at least one Record source.', '$.scopeDecision.mode');
  }
  return { mode: decision.mode, confirmedByUser: true };
}

function fileInside(root, path) {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return absolute;
}

function normalizeEvidence(rawEvidence, sources) {
  const evidence = [];
  const byId = new Map();
  for (const [index, raw] of assertArray(rawEvidence, '$.evidence').entries()) {
    const item = objectValue(raw);
    if (!item) fail('wiki-mvp-evidence-invalid', 'Each evidence item must be an object.', `$.evidence[${index}]`);
    assertId(item.id, `$.evidence[${index}].id`);
    if (byId.has(item.id)) fail('wiki-mvp-evidence-duplicate', `Duplicate evidence ID: ${item.id}.`, `$.evidence[${index}].id`);
    const source = sources.get(item.sourceId);
    if (!source) fail('wiki-mvp-evidence-source-missing', `Unknown evidence source: ${item.sourceId}.`, `$.evidence[${index}].sourceId`);
    const normalized = {
      id: item.id,
      kind: source.type,
      sourceId: source.id,
      description: assertText(item.description, `$.evidence[${index}].description`),
    };
    if (source.runtimeRoot) {
      const sourcePath = assertSafeRelativePath(item.path, `$.evidence[${index}].path`);
      const absolute = fileInside(source.runtimeRoot, sourcePath);
      if (!absolute || !existsSync(absolute) || !statSync(absolute).isFile()) {
        fail('wiki-mvp-evidence-file-missing', `Evidence file does not exist: ${source.id}:${sourcePath}.`, `$.evidence[${index}].path`);
      }
      const buffer = readFileSync(absolute);
      Object.assign(normalized, { path: sourcePath, sourceHash: sha256(buffer) });
      if (item.startLine !== undefined || item.endLine !== undefined) {
        const lineCount = buffer.toString('utf8').split('\n').length;
        if (!Number.isInteger(item.startLine) || !Number.isInteger(item.endLine) || item.startLine < 1 || item.endLine < item.startLine || item.endLine > lineCount) {
          fail('wiki-mvp-evidence-range-invalid', `Evidence line range is invalid for ${source.id}:${sourcePath}.`, `$.evidence[${index}]`);
        }
        normalized.startLine = item.startLine;
        normalized.endLine = item.endLine;
      }
    } else {
      normalized.locator = assertText(item.locator, `$.evidence[${index}].locator`);
      normalized.sourceHash = sha256(`${normalized.locator}\n${normalized.description}`);
      if (source.type === 'requirement') {
        normalized.externalId = assertText(item.externalId, `$.evidence[${index}].externalId`);
      }
    }
    evidence.push(normalized);
    byId.set(normalized.id, normalized);
  }
  return { evidence, byId };
}

function normalizeFact(raw, path, evidenceById) {
  const fact = typeof raw === 'string' ? { text: raw, level: 'partial', evidenceIds: [] } : objectValue(raw);
  if (!fact) fail('wiki-mvp-fact-invalid', `${path} must be a fact object or string.`, path);
  const normalized = {
    text: assertText(fact.text, `${path}.text`),
    level: fact.level ?? 'partial',
    evidenceIds: [...new Set(assertArray(fact.evidenceIds ?? [], `${path}.evidenceIds`))],
  };
  if (!FACT_LEVELS.has(normalized.level)) fail('wiki-mvp-fact-level-invalid', `Unsupported fact level: ${normalized.level}.`, `${path}.level`);
  for (const evidenceId of normalized.evidenceIds) {
    if (!evidenceById.has(evidenceId)) fail('wiki-mvp-fact-evidence-missing', `Unknown evidence ID: ${evidenceId}.`, `${path}.evidenceIds`);
  }
  if (normalized.level === 'confirmed' && normalized.evidenceIds.length === 0) {
    fail('wiki-mvp-confirmed-evidence-required', 'Confirmed facts require evidence.', path);
  }
  return normalized;
}

function normalizeFacts(value, path, evidenceById) {
  return assertArray(value ?? [], path).map((fact, index) => normalizeFact(fact, `${path}[${index}]`, evidenceById));
}

function normalizeFeatureGroups(rawGroups, evidenceById) {
  const groupIds = new Set();
  const featureIds = new Set();
  const featuresById = new Map();
  const groups = assertArray(rawGroups, '$.featureGroups').map((rawGroup, groupIndex) => {
    const group = objectValue(rawGroup);
    if (!group) fail('wiki-mvp-group-invalid', 'Each feature group must be an object.', `$.featureGroups[${groupIndex}]`);
    assertId(group.id, `$.featureGroups[${groupIndex}].id`);
    if (groupIds.has(group.id)) fail('wiki-mvp-group-duplicate', `Duplicate feature group ID: ${group.id}.`, `$.featureGroups[${groupIndex}].id`);
    groupIds.add(group.id);
    const normalizedGroup = {
      id: group.id,
      name: assertText(group.name, `$.featureGroups[${groupIndex}].name`),
      menuEvidenceIds: normalizeAuthorityEvidence(group.menuEvidenceIds, `$.featureGroups[${groupIndex}].menuEvidenceIds`, evidenceById, 'menu'),
      features: [],
    };
    normalizedGroup.features = assertArray(group.features, `$.featureGroups[${groupIndex}].features`).map((rawFeature, featureIndex) => {
      const feature = objectValue(rawFeature);
      const base = `$.featureGroups[${groupIndex}].features[${featureIndex}]`;
      if (!feature) fail('wiki-mvp-feature-invalid', 'Each feature must be an object.', base);
      assertId(feature.id, `${base}.id`);
      if (featureIds.has(feature.id)) fail('wiki-mvp-feature-duplicate', `Duplicate feature ID: ${feature.id}.`, `${base}.id`);
      featureIds.add(feature.id);
      const normalized = {
        id: feature.id,
        groupId: group.id,
        name: assertText(feature.name, `${base}.name`),
        menuEvidenceIds: normalizeAuthorityEvidence(feature.menuEvidenceIds, `${base}.menuEvidenceIds`, evidenceById, 'menu'),
        requirementEvidenceIds: normalizeOptionalAuthorityEvidence(feature.requirementEvidenceIds, `${base}.requirementEvidenceIds`, evidenceById, 'requirement'),
        route: feature.route ? assertText(feature.route, `${base}.route`) : null,
        purpose: normalizeFacts(feature.purpose, `${base}.purpose`, evidenceById),
        roles: normalizeFacts(feature.roles, `${base}.roles`, evidenceById),
        preconditions: normalizeFacts(feature.preconditions, `${base}.preconditions`, evidenceById),
        capabilities: normalizeFacts(feature.capabilities, `${base}.capabilities`, evidenceById),
        pageAreas: normalizeFacts(feature.pageAreas, `${base}.pageAreas`, evidenceById),
        operations: normalizeFacts(feature.operations, `${base}.operations`, evidenceById),
        configuration: normalizeFacts(feature.configuration, `${base}.configuration`, evidenceById),
        businessRules: normalizeFacts(feature.businessRules, `${base}.businessRules`, evidenceById),
        systemBehavior: normalizeFacts(feature.systemBehavior, `${base}.systemBehavior`, evidenceById),
        limitations: normalizeFacts(feature.limitations, `${base}.limitations`, evidenceById),
        implementation: normalizeFacts(feature.implementation, `${base}.implementation`, evidenceById),
        gapIds: [...new Set(assertArray(feature.gapIds ?? [], `${base}.gapIds`))],
      };
      for (const requiredKey of ['purpose', 'capabilities', 'pageAreas', 'operations', 'systemBehavior']) {
        if (normalized[requiredKey].length === 0) {
          fail('wiki-mvp-product-model-incomplete', `Feature ${feature.id} requires product content for ${requiredKey}.`, `${base}.${requiredKey}`);
        }
      }
      featuresById.set(normalized.id, normalized);
      return normalized;
    });
    if (normalizedGroup.features.length === 0) fail('wiki-mvp-group-empty', `Feature group ${group.id} has no second-level features.`, `$.featureGroups[${groupIndex}].features`);
    return normalizedGroup;
  });
  if (groups.length === 0) fail('wiki-mvp-menu-empty', 'At least one feature group is required.', '$.featureGroups');
  return { groups, groupIds, featureIds, featuresById };
}

function normalizeAuthorityEvidence(value, path, evidenceById, expectedKind) {
  const evidenceIds = [...new Set(assertArray(value, path))];
  if (evidenceIds.length === 0) fail('wiki-mvp-authority-evidence-required', `${path} requires ${expectedKind} evidence.`, path);
  for (const evidenceId of evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence || evidence.kind !== expectedKind) {
      fail('wiki-mvp-authority-evidence-invalid', `${path} must reference only ${expectedKind} evidence.`, path);
    }
  }
  return evidenceIds;
}

function normalizeOptionalAuthorityEvidence(value, path, evidenceById, expectedKind) {
  const evidenceIds = [...new Set(assertArray(value ?? [], path))];
  for (const evidenceId of evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence || evidence.kind !== expectedKind) {
      fail('wiki-mvp-authority-evidence-invalid', `${path} must reference only ${expectedKind} evidence.`, path);
    }
  }
  return evidenceIds;
}

function normalizeScenarios(rawScenarios, context) {
  const scenarioIds = new Set();
  return assertArray(rawScenarios ?? [], '$.scenarios').map((rawScenario, index) => {
    const scenario = objectValue(rawScenario);
    const base = `$.scenarios[${index}]`;
    if (!scenario) fail('wiki-mvp-scenario-invalid', 'Each scenario must be an object.', base);
    assertId(scenario.id, `${base}.id`);
    if (scenarioIds.has(scenario.id)) fail('wiki-mvp-scenario-duplicate', `Duplicate scenario ID: ${scenario.id}.`, `${base}.id`);
    scenarioIds.add(scenario.id);
    if (!context.groupIds.has(scenario.groupId)) fail('wiki-mvp-scenario-group-missing', `Unknown feature group: ${scenario.groupId}.`, `${base}.groupId`);
    const featureIds = [...new Set(assertArray(scenario.featureIds, `${base}.featureIds`))];
    if (featureIds.length === 0 || featureIds.some((id) => !context.featureIds.has(id) || context.featuresById.get(id).groupId !== scenario.groupId)) {
      fail('wiki-mvp-scenario-feature-invalid', 'Scenario featureIds must reference features in the same feature group.', `${base}.featureIds`);
    }
    const steps = assertArray(scenario.steps, `${base}.steps`).map((rawStep, stepIndex) => {
      const step = objectValue(rawStep);
      const stepPath = `${base}.steps[${stepIndex}]`;
      if (!step) fail('wiki-mvp-step-invalid', 'Each scenario step must be an object.', stepPath);
      return {
        id: assertText(step.id, `${stepPath}.id`),
        action: assertText(step.action, `${stepPath}.action`),
        result: normalizeFact(step.result, `${stepPath}.result`, context.evidenceById),
      };
    });
    if (steps.length === 0) fail('wiki-mvp-scenario-steps-required', 'A Record scenario must contain steps.', `${base}.steps`);
    return {
      id: scenario.id,
      groupId: scenario.groupId,
      featureIds,
      name: assertText(scenario.name, `${base}.name`),
      recordEvidenceIds: normalizeAuthorityEvidence(scenario.recordEvidenceIds, `${base}.recordEvidenceIds`, context.evidenceById, 'record'),
      goal: normalizeFacts(scenario.goal, `${base}.goal`, context.evidenceById),
      roles: normalizeFacts(scenario.roles, `${base}.roles`, context.evidenceById),
      preconditions: normalizeFacts(scenario.preconditions, `${base}.preconditions`, context.evidenceById),
      steps,
      keyConfigurations: normalizeFacts(scenario.keyConfigurations, `${base}.keyConfigurations`, context.evidenceById),
      outcomes: normalizeFacts(scenario.outcomes, `${base}.outcomes`, context.evidenceById),
      usageNotes: normalizeFacts(scenario.usageNotes, `${base}.usageNotes`, context.evidenceById),
      gapIds: [...new Set(assertArray(scenario.gapIds ?? [], `${base}.gapIds`))],
    };
  });
}

function normalizeGaps(rawGaps, validRefs) {
  const gapIds = new Set();
  return assertArray(rawGaps ?? [], '$.gaps').map((rawGap, index) => {
    const gap = objectValue(rawGap);
    const base = `$.gaps[${index}]`;
    if (!gap) fail('wiki-mvp-gap-invalid', 'Each gap must be an object.', base);
    assertId(gap.id, `${base}.id`);
    if (gapIds.has(gap.id)) fail('wiki-mvp-gap-duplicate', `Duplicate gap ID: ${gap.id}.`, `${base}.id`);
    gapIds.add(gap.id);
    const refs = [...new Set(assertArray(gap.subjectRefs ?? [], `${base}.subjectRefs`))];
    for (const ref of refs) {
      if (!validRefs.has(ref)) fail('wiki-mvp-gap-subject-missing', `Unknown gap subject: ${ref}.`, `${base}.subjectRefs`);
    }
    const audience = gap.audience ?? 'product-review';
    if (!GAP_AUDIENCES.has(audience)) fail('wiki-mvp-gap-audience-invalid', `Unsupported gap audience: ${audience}.`, `${base}.audience`);
    return {
      id: gap.id,
      title: assertText(gap.title, `${base}.title`),
      description: assertText(gap.description, `${base}.description`),
      audience,
      subjectRefs: refs,
    };
  });
}

function featureProductFacts(feature) {
  return REQUIREMENT_FACT_KEYS.flatMap((key) => feature[key]);
}

function validateRequirementSources({ sources, evidenceById, featuresById, gaps }) {
  const featureIds = new Set(featuresById.keys());
  const requirementEvidence = [...evidenceById.values()].filter((evidence) => evidence.kind === 'requirement');
  for (const source of sources.values()) {
    if (source.type !== 'requirement') continue;
    for (const [queryIndex, query] of source.queries.entries()) {
      for (const featureId of query.featureIds) {
        if (!featureIds.has(featureId)) {
          fail('wiki-mvp-requirement-query-feature-missing', `Unknown feature ID in requirement query: ${featureId}.`, `$.sources.${source.id}.queries[${queryIndex}].featureIds`);
        }
      }
    }
    for (const [candidateIndex, candidate] of source.candidates.entries()) {
      const path = `$.sources.${source.id}.candidates[${candidateIndex}]`;
      for (const featureId of candidate.featureIds) {
        if (!featureIds.has(featureId)) fail('wiki-mvp-requirement-candidate-feature-missing', `Unknown feature ID: ${featureId}.`, `${path}.featureIds`);
      }
      for (const evidenceId of candidate.codeEvidenceIds) {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence || evidence.kind !== 'code') {
          fail('wiki-mvp-requirement-code-evidence-invalid', 'Requirement cross-validation must reference code evidence.', `${path}.codeEvidenceIds`);
        }
      }
      if (candidate.decision === 'adopted') {
        if (candidate.itemRole !== 'product-requirement') {
          fail('wiki-mvp-requirement-item-role-invalid', 'Only product requirements can be adopted as requirement evidence.', `${path}.itemRole`);
        }
        if (candidate.normalizedStatus !== 'completed') {
          fail('wiki-mvp-requirement-status-not-adoptable', 'Only completed requirements can be adopted as current product evidence.', `${path}.normalizedStatus`);
        }
        if (!['direct', 'supporting'].includes(candidate.relevance)) {
          fail('wiki-mvp-requirement-relevance-not-adoptable', 'Adopted requirements must be direct or supporting matches.', `${path}.relevance`);
        }
        if (!candidate.relationshipVerified) {
          fail('wiki-mvp-requirement-hierarchy-unverified', 'Adopted requirements require verified platform hierarchy fields.', `${path}.relationshipVerified`);
        }
        if (candidate.featureIds.length === 0) {
          fail('wiki-mvp-requirement-feature-required', 'Adopted requirements must map to at least one confirmed menu feature.', `${path}.featureIds`);
        }
        if (candidate.codeEvidenceIds.length === 0) {
          fail('wiki-mvp-requirement-code-evidence-required', 'Adopted requirements require current code cross-validation.', `${path}.codeEvidenceIds`);
        }
        if (!candidate.evidenceId) {
          fail('wiki-mvp-requirement-evidence-required', 'Adopted requirements require a stable evidence record.', `${path}.evidenceId`);
        }
        const evidence = evidenceById.get(candidate.evidenceId);
        if (!evidence || evidence.kind !== 'requirement' || evidence.sourceId !== source.id || evidence.externalId !== candidate.externalId) {
          fail('wiki-mvp-requirement-evidence-invalid', 'Adopted requirement evidence must match its source and external ID.', `${path}.evidenceId`);
        }
        if (!/^https?:\/\//.test(evidence.locator)) {
          fail('wiki-mvp-requirement-link-invalid', 'Adopted requirement evidence requires a stable HTTP(S) link.', `${path}.evidenceId`);
        }
        evidence.requirement = {
          provider: source.provider,
          providerLabel: source.providerLabel,
          externalId: candidate.externalId,
          title: candidate.title,
          itemRole: candidate.itemRole,
          parentExternalId: candidate.parentExternalId,
          rawStatus: candidate.rawStatus,
          normalizedStatus: candidate.normalizedStatus,
          capturedAt: source.capturedAt,
          transport: source.transport,
        };
        for (const featureId of candidate.featureIds) {
          const feature = featuresById.get(featureId);
          if (!feature.requirementEvidenceIds.includes(candidate.evidenceId)) {
            fail('wiki-mvp-requirement-feature-join-missing', `Feature ${featureId} does not reference adopted requirement ${candidate.externalId}.`, `${path}.featureIds`);
          }
          const hasCrossValidatedClaim = featureProductFacts(feature).some((fact) => fact.evidenceIds.includes(candidate.evidenceId)
            && candidate.codeEvidenceIds.some((evidenceId) => fact.evidenceIds.includes(evidenceId)));
          if (!hasCrossValidatedClaim) {
            fail('wiki-mvp-requirement-claim-cross-validation-required', `Feature ${featureId} must cite the adopted requirement and current code together in at least one product fact.`, `feature:${featureId}`);
          }
        }
      }
      if (candidate.decision === 'conflict') {
        const hasProductGap = gaps.some((gap) => gap.audience === 'product-review'
          && candidate.featureIds.some((featureId) => gap.subjectRefs.includes(`feature:${featureId}`)));
        if (!hasProductGap) {
          fail('wiki-mvp-requirement-conflict-gap-required', 'Requirement/code conflicts require a product-review gap.', path);
        }
      }
    }
    for (const evidence of requirementEvidence.filter((item) => item.sourceId === source.id)) {
      const candidate = source.candidates.find((item) => item.externalId === evidence.externalId);
      if (!candidate) {
        fail('wiki-mvp-requirement-candidate-missing', `Requirement evidence has no retrieval candidate: ${evidence.externalId}.`, `evidence:${evidence.id}`);
      }
    }
  }
  for (const feature of featuresById.values()) {
    for (const fact of featureProductFacts(feature)) {
      for (const evidenceId of fact.evidenceIds) {
        const evidence = evidenceById.get(evidenceId);
        if (evidence.kind !== 'requirement') continue;
        const source = sources.get(evidence.sourceId);
        const candidate = source.candidates.find((item) => item.externalId === evidence.externalId);
        if (!candidate || candidate.decision !== 'adopted' || !candidate.featureIds.includes(feature.id)
          || !feature.requirementEvidenceIds.includes(evidenceId)) {
          fail('wiki-mvp-requirement-fact-not-adopted', 'Product facts can cite only requirements adopted for the same feature.', `feature:${feature.id}`);
        }
      }
    }
    for (const evidenceId of feature.requirementEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      const source = sources.get(evidence.sourceId);
      const candidate = source.candidates.find((item) => item.externalId === evidence.externalId);
      if (!candidate || candidate.decision !== 'adopted' || !candidate.featureIds.includes(feature.id)) {
        fail('wiki-mvp-requirement-not-adopted', `Feature ${feature.id} references a requirement that did not pass the adoption gate.`, `feature:${feature.id}`);
      }
    }
  }
}

function relativeLink(fromPath, toPath) {
  return posix.relative(posix.dirname(fromPath), toPath);
}

function renderFacts({ facts, subjectRef, section, claims, claimIds, evidenceIds }) {
  if (facts.length === 0) return '- 待产品评审补充。';
  return facts.map((fact, index) => {
    const id = `claim-${subjectRef.split(':')[1]}-${section}-${index + 1}`.replace(/-+/g, '-');
    const claim = { id, text: fact.text, level: fact.level, evidenceIds: fact.evidenceIds, subjectRefs: [subjectRef] };
    claims.push(claim);
    claimIds.push(id);
    fact.evidenceIds.forEach((evidenceId) => evidenceIds.add(evidenceId));
    return `<!-- yog:claim:${id} -->\n- ${fact.text}`;
  }).join('\n');
}

function renderGaps(subjectRef, gaps) {
  const related = gaps.filter((gap) => gap.audience === 'product-review' && gap.subjectRefs.includes(subjectRef));
  if (related.length === 0) return '- 暂无。';
  return related.map((gap) => `- **${gap.title}**：${gap.description}`).join('\n');
}

function requirementEvidenceLabel(evidence) {
  if (!evidence.requirement) return evidence.description;
  const { providerLabel, externalId, normalizedStatus, title } = evidence.requirement;
  const status = normalizedStatus === 'completed' ? '已结束' : '待确认';
  return `${providerLabel} ${externalId}（${status}）：${title}`;
}

function pageMarker(id) {
  return `<!-- yog:wiki:generated schema=1 page-id=${id} -->`;
}

function pageFrontmatter(metadata) {
  return stringifyFrontmatter({
    schemaVersion: 1,
    status: 'product-review-draft',
    generatedBy: 'yog:wiki-mvp',
    ...metadata,
  }).trimEnd();
}

function renderFeaturePage(group, feature, scenarios, gaps, claims, evidenceById) {
  const path = `产品功能/${safeFilename(group.name, group.id)}/${safeFilename(feature.name, feature.id)}.md`;
  const claimIds = [];
  const evidenceIds = new Set([...group.menuEvidenceIds, ...feature.menuEvidenceIds, ...feature.requirementEvidenceIds]);
  const section = (title, key) => `## ${title}\n\n${renderFacts({ facts: feature[key], subjectRef: `feature:${feature.id}`, section: key.toLowerCase(), claims, claimIds, evidenceIds })}`;
  const relatedScenarios = scenarios.filter((scenario) => scenario.featureIds.includes(feature.id));
  const scenarioSection = relatedScenarios.length === 0
    ? null
    : `## 典型业务流程\n\n${relatedScenarios.map((scenario) => {
      const target = `用户场景/${safeFilename(group.name, group.id)}/${safeFilename(scenario.name, scenario.id)}.md`;
      return `- [${scenario.name}](${relativeLink(path, target)})`;
    }).join('\n')}`;
  const route = feature.route ? `\n- 页面路由：\`${feature.route}\`` : '';
  const pageId = `feature-${feature.id}`;
  const relatedScenarioIds = relatedScenarios.map((scenario) => `scenario-${scenario.id}`);
  const requirementSection = feature.requirementEvidenceIds.length === 0
    ? null
    : `## 需求来源\n\n${feature.requirementEvidenceIds.map((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return /^https?:\/\//.test(evidence.locator)
        ? `- [${requirementEvidenceLabel(evidence)}](${evidence.locator})`
        : `- ${requirementEvidenceLabel(evidence)}（${evidence.locator}）`;
    }).join('\n')}`;
  const content = [
    pageFrontmatter({
      pageId,
      pageType: 'feature',
      title: feature.name,
      featureGroupId: group.id,
      featureGroup: group.name,
      featureId: feature.id,
      menuPath: [group.name, feature.name],
      ...(feature.route ? { route: feature.route } : {}),
      relatedScenarioIds,
      requirementEvidenceIds: feature.requirementEvidenceIds,
    }),
    pageMarker(pageId),
    `# ${feature.name}`,
    section('功能概览', 'purpose'),
    section('功能清单', 'capabilities'),
    section('适用角色', 'roles'),
    section('使用条件', 'preconditions'),
    section('页面与入口', 'pageAreas'),
    section('操作说明', 'operations'),
    section('配置说明', 'configuration'),
    section('业务规则', 'businessRules'),
    section('系统处理结果', 'systemBehavior'),
    section('限制与注意事项', 'limitations'),
    ...(requirementSection ? [requirementSection] : []),
    ...(scenarioSection ? [scenarioSection] : []),
    `## 技术关联\n\n${renderFacts({ facts: feature.implementation, subjectRef: `feature:${feature.id}`, section: 'implementation', claims, claimIds, evidenceIds })}${route}`,
    `## 产品评审事项\n\n${renderGaps(`feature:${feature.id}`, gaps)}`,
  ].join('\n\n');
  return {
    id: pageId,
    kind: 'feature',
    status: 'product-review-draft',
    title: feature.name,
    path,
    featureGroupId: group.id,
    featureId: feature.id,
    relatedScenarioIds,
    requirementEvidenceIds: feature.requirementEvidenceIds,
    claimIds,
    evidenceIds: [...evidenceIds],
    content: `${content}\n`,
  };
}

function renderScenarioPage(group, scenario, featuresById, claims) {
  const path = `用户场景/${safeFilename(group.name, group.id)}/${safeFilename(scenario.name, scenario.id)}.md`;
  const claimIds = [];
  const evidenceIds = new Set(scenario.recordEvidenceIds);
  const render = (title, key) => `## ${title}\n\n${renderFacts({ facts: scenario[key], subjectRef: `scenario:${scenario.id}`, section: key.toLowerCase(), claims, claimIds, evidenceIds })}`;
  const steps = scenario.steps.map((step, index) => {
    const rendered = renderFacts({ facts: [step.result], subjectRef: `scenario:${scenario.id}`, section: `step-${index + 1}`, claims, claimIds, evidenceIds });
    return `### ${index + 1}. ${step.action}\n\n${rendered}`;
  }).join('\n\n');
  const featureLinks = scenario.featureIds.map((featureId) => {
    const feature = featuresById.get(featureId);
    const target = `产品功能/${safeFilename(group.name, group.id)}/${safeFilename(feature.name, feature.id)}.md`;
    return `- [${feature.name}](${relativeLink(path, target)})`;
  }).join('\n');
  const pageId = `scenario-${scenario.id}`;
  const content = [
    pageFrontmatter({
      pageId,
      pageType: 'scenario',
      title: scenario.name,
      featureGroupId: group.id,
      featureGroup: group.name,
      scenarioId: scenario.id,
      menuPath: [group.name],
      relatedFeatureIds: scenario.featureIds,
    }),
    pageMarker(pageId),
    `# ${scenario.name}`,
    render('业务目标', 'goal'),
    render('适用角色', 'roles'),
    render('使用条件', 'preconditions'),
    `## 操作流程\n\n${steps}`,
    render('关键配置', 'keyConfigurations'),
    render('完成后的结果', 'outcomes'),
    render('使用提示', 'usageNotes'),
    `## 关联功能\n\n${featureLinks}`,
  ].join('\n\n');
  return {
    id: pageId,
    kind: 'scenario',
    status: 'product-review-draft',
    title: scenario.name,
    path,
    featureGroupId: group.id,
    scenarioId: scenario.id,
    relatedFeatureIds: scenario.featureIds,
    claimIds,
    evidenceIds: [...evidenceIds],
    content: `${content}\n`,
  };
}

function renderGapPage(gaps) {
  const subjectRefs = [...new Set(gaps.flatMap((gap) => gap.subjectRefs))];
  const content = [
    pageFrontmatter({ pageId: 'open-questions', pageType: 'open-question', title: '待确认问题', subjectRefs }),
    pageMarker('open-questions'),
    '# 待确认问题',
    ...gaps.map((gap) => `## ${gap.title}\n\n${gap.description}\n\n关联对象：${gap.subjectRefs.map((ref) => `\`${ref}\``).join('、') || '未指定'}`),
  ].join('\n\n');
  return { id: 'open-questions', kind: 'open-question', status: 'product-review-draft', title: '待确认问题', path: '待确认问题.md', subjectRefs, claimIds: [], evidenceIds: [], content: `${content}\n` };
}

function renderIndex(groups, featurePages, scenarioPages, gapPage, scopeMode) {
  const featureIds = groups.flatMap((group) => group.features.map((feature) => feature.id));
  const scenarioIds = scenarioPages.map((page) => page.scenarioId);
  const lines = [
    pageFrontmatter({
      pageId: 'index',
      pageType: 'index',
      title: '产品手册目录',
      scopeMode,
      featureGroupIds: groups.map((group) => group.id),
      featureIds,
      scenarioIds,
    }),
    pageMarker('index'),
    '# 产品手册目录',
    '',
    '> 本手册只覆盖用户确认的菜单范围。',
  ];
  for (const group of groups) {
    lines.push('', `## ${group.name}`, '', '### 产品功能');
    for (const feature of group.features) {
      const page = featurePages.find((candidate) => candidate.id === `feature-${feature.id}`);
      lines.push(`- [${feature.name}](${page.path})`);
    }
    const scenarios = scenarioPages.filter((page) => page.groupId === group.id);
    if (scenarios.length > 0) {
      lines.push('', '### 用户场景');
      scenarios.forEach((page) => lines.push(`- [${page.title}](${page.path})`));
    }
  }
  if (gapPage) lines.push('', `- [待确认问题](${gapPage.path})`);
  return { id: 'index', kind: 'index', status: 'product-review-draft', title: '产品手册目录', path: '目录.md', scopeMode, featureGroupIds: groups.map((group) => group.id), featureIds, scenarioIds, claimIds: [], evidenceIds: [], content: `${lines.join('\n')}\n` };
}

function validateRenderedFiles(files) {
  const issues = [];
  const paths = new Set(files.map((file) => file.path));
  for (const file of files) {
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(file.content))) {
      issues.push(issue('wiki-mvp-sensitive-content', 'Generated content contains a sensitive or machine-local value.', file.path, 'P0'));
    }
    for (const match of file.content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(file.path), target));
      if (!paths.has(resolved)) issues.push(issue('wiki-mvp-link-broken', `Broken internal link: ${target}.`, file.path));
    }
  }
  if (issues.length > 0) fail('wiki-mvp-render-invalid', 'Rendered Wiki failed validation.', '$.pages', issues);
}

function validateSensitiveFiles(files) {
  const issues = files
    .filter((file) => SENSITIVE_PATTERNS.some((pattern) => pattern.test(file.content)))
    .map((file) => issue('wiki-mvp-sensitive-content', 'Generated content contains a sensitive or machine-local value.', file.path, 'P0'));
  if (issues.length > 0) fail('wiki-mvp-sensitive-output', 'Generated Wiki contains sensitive output.', '$.files', issues);
}

export function buildMvpWiki(input) {
  if (!objectValue(input)) fail('wiki-mvp-input-invalid', 'Input must be an object.');
  if (input.schemaVersion !== 1) fail('wiki-mvp-version-invalid', 'schemaVersion must equal 1.', '$.schemaVersion');
  const language = input.language ?? 'zh-CN';
  if (language !== 'zh-CN') fail('wiki-mvp-language-invalid', 'MVP currently supports zh-CN only.', '$.language');
  assertText(input.outputRoot, '$.outputRoot');
  if (!isAbsolute(input.outputRoot) || !existsSync(input.outputRoot) || !statSync(input.outputRoot).isDirectory()) {
    fail('wiki-mvp-output-root-invalid', 'outputRoot must be an existing absolute directory.', '$.outputRoot');
  }
  const wikiRoot = input.wikiRoot ?? 'docs/wiki';
  assertSafeRelativePath(wikiRoot, '$.wikiRoot');
  const runId = input.runId ?? `wiki-${Date.now()}`;
  if (!RUN_ID_PATTERN.test(runId)) fail('wiki-mvp-run-id-invalid', 'runId must match wiki-[a-z0-9-]+.', '$.runId');
  const { sources, publicSources } = normalizeSources(input.sources);
  const scopeDecision = normalizeScopeDecision(input.scopeDecision, [...sources.values()].some((source) => source.type === 'record'));
  const { evidence, byId: evidenceById } = normalizeEvidence(input.evidence, sources);
  const featureContext = normalizeFeatureGroups(input.featureGroups, evidenceById);
  const scenarios = normalizeScenarios(input.scenarios, { ...featureContext, evidenceById });
  const validRefs = new Set([
    ...[...featureContext.featureIds].map((id) => `feature:${id}`),
    ...scenarios.map((scenario) => `scenario:${scenario.id}`),
  ]);
  const gaps = normalizeGaps(input.gaps, validRefs);
  const knownGapIds = new Set(gaps.map((gap) => gap.id));
  for (const feature of featureContext.featuresById.values()) {
    feature.gapIds.forEach((id) => { if (!knownGapIds.has(id)) fail('wiki-mvp-gap-reference-missing', `Unknown gap ID: ${id}.`, `feature:${feature.id}`); });
  }
  scenarios.forEach((scenario) => scenario.gapIds.forEach((id) => { if (!knownGapIds.has(id)) fail('wiki-mvp-gap-reference-missing', `Unknown gap ID: ${id}.`, `scenario:${scenario.id}`); }));
  validateRequirementSources({ sources, evidenceById, featuresById: featureContext.featuresById, gaps });

  const claims = [];
  const featurePages = featureContext.groups.flatMap((group) => group.features.map((feature) => renderFeaturePage(group, feature, scenarios, gaps, claims, evidenceById)));
  const scenarioPages = scenarios.map((scenario) => {
    const group = featureContext.groups.find((candidate) => candidate.id === scenario.groupId);
    return { ...renderScenarioPage(group, scenario, featureContext.featuresById, claims), groupId: group.id };
  });
  const productReviewGaps = gaps.filter((gap) => gap.audience === 'product-review');
  const gapPage = productReviewGaps.length > 0 ? renderGapPage(productReviewGaps) : null;
  const indexPage = renderIndex(featureContext.groups, featurePages, scenarioPages, gapPage, scopeDecision.mode);
  const markdownPages = [indexPage, ...featurePages, ...scenarioPages, ...(gapPage ? [gapPage] : [])];
  validateRenderedFiles(markdownPages);

  const catalog = {
    schemaVersion: 1,
    pages: markdownPages.map(({ content, groupId, ...page }) => ({ ...page, contentHash: sha256(content) })),
  };
  const claimsDocument = { schemaVersion: 1, claims };
  const evidenceDocument = { schemaVersion: 1, evidence };
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    managedBy: 'yog:wiki-mvp',
    generatorVersion: '0.2.0-mvp',
    runId,
    generatedAt,
    language,
    reviewStatus: 'product-review-draft',
    wikiRoot,
    scope: {
      mode: scopeDecision.mode,
      featureGroupIds: featureContext.groups.map((group) => group.id),
      featureIds: [...featureContext.featureIds],
      scenarioIds: scenarios.map((scenario) => scenario.id),
      sourceIds: publicSources.map((source) => source.id),
    },
    sources: publicSources,
    pages: catalog.pages,
    gaps,
  };
  const files = markdownPages.map((page) => ({ path: page.path, content: page.content }));
  files.push(
    { path: '_meta/catalog.json', content: `${JSON.stringify(catalog, null, 2)}\n` },
    { path: '_meta/claims.json', content: `${JSON.stringify(claimsDocument, null, 2)}\n` },
    { path: '_meta/evidence.json', content: `${JSON.stringify(evidenceDocument, null, 2)}\n` },
    { path: '_meta/manifest.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
  );
  validateSensitiveFiles(files);
  return { outputRoot: resolve(input.outputRoot), wikiRoot, runId, files, manifest, issues: [] };
}

function writeFiles(root, files) {
  for (const file of files) {
    assertSafeRelativePath(file.path, '$.files.path');
    const absolute = fileInside(root, file.path);
    if (!absolute) fail('wiki-mvp-write-path-invalid', `File path escapes staging: ${file.path}.`, '$.files');
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.content);
  }
}

export function publishMvpWiki(build) {
  const runRoot = join(build.outputRoot, '.yog', 'runs', 'wiki', build.runId);
  const stagingWiki = join(runRoot, 'staging', 'wiki');
  const backupWiki = join(runRoot, 'backup', 'wiki');
  const formalWiki = resolve(build.outputRoot, build.wikiRoot);
  const formalRel = relative(build.outputRoot, formalWiki);
  if (formalRel === '..' || formalRel.startsWith(`..${sep}`) || isAbsolute(formalRel)) {
    fail('wiki-mvp-output-path-invalid', 'wikiRoot escapes outputRoot.', '$.wikiRoot');
  }
  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(stagingWiki, { recursive: true });
  writeFiles(stagingWiki, build.files);

  let replaced = false;
  if (existsSync(formalWiki)) {
    const manifestPath = join(formalWiki, '_meta', 'manifest.json');
    let current;
    try {
      current = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      fail('wiki-mvp-root-unmanaged', 'Existing wikiRoot has no valid Yog MVP manifest.', build.wikiRoot);
    }
    if (current.managedBy !== 'yog:wiki-mvp') fail('wiki-mvp-root-unmanaged', 'Existing wikiRoot is not managed by Yog Wiki MVP.', build.wikiRoot);
    mkdirSync(dirname(backupWiki), { recursive: true });
    renameSync(formalWiki, backupWiki);
    replaced = true;
  }
  try {
    mkdirSync(dirname(formalWiki), { recursive: true });
    renameSync(stagingWiki, formalWiki);
  } catch (error) {
    if (replaced && existsSync(backupWiki) && !existsSync(formalWiki)) renameSync(backupWiki, formalWiki);
    throw error;
  }
  return {
    ok: true,
    operation: replaced ? 'replace' : 'create',
    runId: build.runId,
    wikiRoot: build.wikiRoot,
    written: build.files.map((file) => file.path).sort(),
    backupPath: replaced ? relative(build.outputRoot, backupWiki).split(sep).join('/') : null,
    manifestPath: `${build.wikiRoot}/_meta/manifest.json`,
    issues: build.issues,
  };
}

export function generateMvpWiki(input) {
  return publishMvpWiki(buildMvpWiki(input));
}

export function formatMvpError(error) {
  return {
    schemaVersion: 1,
    ok: false,
    issues: error.issues ?? [issue(error.code ?? 'wiki-mvp-generation-failed', error.message, error.path ?? '$')],
  };
}
