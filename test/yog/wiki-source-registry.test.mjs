import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WIKI_CONFIG } from '../../skills/yog/lib/config.mjs';
import {
  assertArtifactWithinSource,
  assertWikiSourceConfirmations,
  buildWikiCollectionPlan,
  buildDatabaseMetadataQueries,
  collectDatabaseMetadata,
  buildSourceReadiness,
  confirmWikiConfig,
  createArtifact,
  normalizeArtifact,
  normalizeDatabaseMetadataSnapshot,
  normalizeSourceResult,
  prepareWikiConfig,
  reconcileDatabaseArtifacts,
  sourceScopeFingerprint,
  validateDatabaseMetadataText,
  validateWikiConfig,
} from '../../skills/yog/lib/wiki-source-registry.mjs';

const sha = `sha256:${'a'.repeat(64)}`;
const outputRoot = process.cwd();

function config() {
  const value = {
    schemaVersion: 1,
    language: 'zh-CN',
    knowledgeRoot: 'docs/knowledge',
    codeFactProvider: { type: 'codegraph', status: 'configured' },
    discover: { maxMidLowCandidates: 10 },
    wiki: structuredClone(DEFAULT_WIKI_CONFIG),
  };
  value.wiki.sources.find((source) => source.kind === 'catalog').scope.rootNodeIds = ['commerce'];
  return value;
}

function envelope(kind, sourceId, provider, transportId) {
  return {
    kind: `${kind}-artifact`,
    sourceId,
    capturedAt: '2026-07-14T00:00:00.000Z',
    sourceRevision: sha,
    provenance: { provider, transportIds: [transportId], scopeFingerprint: sha },
  };
}

function catalogArtifact() {
  return createArtifact(envelope('catalog', 'product-catalog', 'menu-json', 'catalog-file'), {
    scope: { confirmedByUser: true, rootNodeIds: ['commerce'] },
    nodes: [
      { id: 'commerce', kind: 'system', parentId: null, name: '交易系统', order: 10, enabled: true, sourceIdentity: { type: 'menu-key', value: 'commerce' }, routeKeys: [], evidenceIds: ['evidence-catalog'] },
      { id: 'order-domain', kind: 'domain', parentId: 'commerce', name: '订单域', order: 20, enabled: true, sourceIdentity: { type: 'menu-key', value: 'order-domain' }, routeKeys: [], evidenceIds: ['evidence-domain'] },
      { id: 'order-module', kind: 'module', parentId: 'order-domain', name: '订单管理', order: 30, enabled: true, sourceIdentity: { type: 'menu-key', value: 'order-module' }, routeKeys: [], evidenceIds: ['evidence-module'] },
      { id: 'order-refund', kind: 'feature', parentId: 'order-module', name: '订单退款', order: 40, enabled: true, sourceIdentity: { type: 'menu-key', value: 'order-refund' }, routeKeys: ['/orders/refund'], evidenceIds: ['evidence-feature'] },
    ],
  });
}

function codeArtifact() {
  return createArtifact(envelope('code', 'current-code', 'git-worktree', 'worktree-files'), {
    repositories: [{ id: 'repo-current', sourceRoot: '.', rootRef: 'source:current-code', commit: 'abc123', dirty: false, surface: 'backend', scope: { include: ['.'], exclude: ['docs/wiki'] } }],
    facts: [{
      id: 'code-fact-refund',
      factKind: 'api',
      locator: { repositoryId: 'repo-current', path: 'src/refund.mjs', precision: 'symbol', startLine: 1, endLine: 5, symbol: 'createRefund' },
      text: '创建退款申请',
      candidateRefs: ['feature:order-refund'],
      evidenceId: 'evidence-code-refund',
    }],
  });
}

function databaseArtifact() {
  return createArtifact(envelope('database', 'primary-database', 'postgres', 'database-introspection'), {
    provider: 'postgres',
    transport: 'read-only-introspection',
    environment: 'test',
    engineVersion: '16',
    capturePolicy: 'metadata-only',
    schemas: [],
    tables: [],
    views: [],
    columns: [],
    constraints: [],
    indexes: [],
    sequences: [],
    triggers: [],
    enums: [],
    accessControls: [],
  });
}

function databaseShapeArtifact(transport, dataType = 'bigint', provider = 'postgres') {
  const environment = ['ddl-file', 'migration-files'].includes(transport) ? 'expected' : 'test';
  return createArtifact(envelope('database', 'primary-database', provider, transport), {
    provider,
    transport,
    environment,
    engineVersion: '16',
    capturePolicy: 'metadata-only',
    schemas: [{ id: 'db-1111111111111111', name: 'public', environment, evidenceId: `evidence-${transport}-schema` }],
    tables: [{ id: 'db-2222222222222222', schemaId: 'db-1111111111111111', name: 'refund_record', kind: 'table', comment: null, evidenceId: `evidence-${transport}-table` }],
    columns: [{ id: 'db-3333333333333333', ownerId: 'db-2222222222222222', name: 'id', dataType, nullable: false, defaultExpression: null, ordinal: 1, comment: null, evidenceId: `evidence-${transport}-column` }],
    views: [], constraints: [], indexes: [], sequences: [], triggers: [], enums: [], accessControls: [],
  });
}

function rebuildArtifact(artifact, mutate) {
  const copy = structuredClone(artifact);
  const { schemaVersion, fingerprint, kind, sourceId, capturedAt, sourceRevision, provenance, ...payload } = copy;
  const nextEnvelope = { kind, sourceId, capturedAt, sourceRevision, provenance };
  mutate(payload, nextEnvelope);
  return createArtifact(nextEnvelope, payload);
}

function result(sourceId, kind, provider, status = 'collected') {
  return {
    sourceId,
    kind,
    provider,
    status,
    required: ['catalog', 'code'].includes(kind),
    capturedAt: status === 'collected' ? '2026-07-14T00:00:00.000Z' : null,
    sourceRevision: status === 'collected' ? sha : null,
    fingerprint: status === 'collected' ? sha : null,
    artifactCount: status === 'collected' ? 1 : 0,
    reasonCode: status === 'collected' ? null : 'source-scope-unconfirmed',
    transportResults: [],
    gapIds: [],
    diagnostics: [],
  };
}

test('Wiki config accepts only wiki.sources[] and validates provider branches', () => {
  const normalized = validateWikiConfig(config());
  assert.equal(normalized.root, 'docs/wiki');
  assert.deepEqual(normalized.sources.map((source) => source.kind).sort(), ['catalog', 'code', 'database', 'requirement', 'spec']);
  assert.equal(normalized.sources.find((source) => source.kind === 'catalog').scope.confirmedByUser, false);
  const legacy = config();
  legacy.wiki.requirementProvider = { provider: 'tapd' };
  assert.throws(() => validateWikiConfig(legacy), (error) => error.code === 'yog-config-schema-invalid');
  const grouped = config();
  grouped.sources = { menus: [] };
  assert.throws(() => validateWikiConfig(grouped), (error) => error.code === 'yog-config-schema-invalid');
  const unsafe = config();
  unsafe.wiki.sources[0].transports[0].paths = ['../catalog.json'];
  assert.throws(() => validateWikiConfig(unsafe), (error) => error.code === 'yog-config-schema-invalid');
  const unknownScope = config();
  unknownScope.wiki.sources.find((source) => source.kind === 'database').scope.surprise = 'accepted';
  assert.throws(() => validateWikiConfig(unknownScope), (error) => error.code === 'yog-config-schema-invalid' && error.path.endsWith('.scope.surprise'));
});

test('Wiki prepare produces a reviewable pending Source plan without authorizing collection', () => {
  const candidate = config();
  const requirement = candidate.wiki.sources.find((source) => source.kind === 'requirement');
  requirement.scope = { confirmedByUser: true, workspaceId: '47387910', projectId: null, workItemIds: ['REQ-1'] };
  const prepared = prepareWikiConfig(candidate, { outputRoot });
  assert.equal(prepared.wiki.sources.every((source) => source.confirmation.status === 'pending'), true);
  assert.equal(prepared.wiki.sources.find((source) => source.kind === 'catalog').scope.confirmedByUser, false);
  assert.equal(prepared.wiki.sources.find((source) => source.kind === 'requirement').scope.confirmedByUser, false);
  assert.equal(
    prepared.wiki.sources.every((source) => source.confirmation.scopeFingerprint === sourceScopeFingerprint(source)),
    true,
  );
  const plan = buildWikiCollectionPlan(prepared, { outputRoot });
  assert.equal(plan.status, 'confirmation-required');
  assert.deepEqual(plan.sources.filter((source) => source.enabled).map((source) => source.sourceId), ['current-code', 'primary-requirements', 'product-catalog']);
  assert.equal(plan.inputFingerprint, prepared.wiki.confirmation.inputFingerprint);
  assert.equal(plan.sources.every((source) => source.confirmationStatus === 'pending'), true);
});

test('Wiki Source confirmation is bound to the exact enabled Source scope', () => {
  const candidate = config();
  const requirement = candidate.wiki.sources.find((source) => source.kind === 'requirement');
  requirement.scope = { confirmedByUser: false, workspaceId: '47387910', projectId: null, workItemIds: ['REQ-1'] };
  const prepared = prepareWikiConfig(candidate, { outputRoot });
  const confirmed = confirmWikiConfig(prepared, {
    outputRoot,
    inputFingerprint: prepared.wiki.confirmation.inputFingerprint,
    confirmedAt: '2026-07-15T08:00:00.000Z',
    decisions: prepared.wiki.sources.filter((source) => source.enabled).map((source) => ({ sourceId: source.id, decision: 'confirm', scopeFingerprint: source.confirmation.scopeFingerprint })),
  });
  const confirmedSources = validateWikiConfig(confirmed).sources;
  assert.doesNotThrow(() => assertWikiSourceConfirmations(confirmedSources));
  assert.equal(confirmedSources.find((source) => source.kind === 'requirement').scope.confirmedByUser, true);
  confirmedSources.find((source) => source.kind === 'code').scope.roots.push('presentation/operations');
  assert.throws(
    () => assertWikiSourceConfirmations(confirmedSources),
    (error) => error.code === 'wiki-source-scope-unconfirmed' && error.path === '$.wiki.sources.current-code.confirmation',
  );
});

test('Wiki Source confirmation can disable an optional Source but cannot omit an enabled Source decision', () => {
  const prepared = prepareWikiConfig(config(), { outputRoot });
  assert.throws(
    () => confirmWikiConfig(prepared, {
      outputRoot,
      inputFingerprint: prepared.wiki.confirmation.inputFingerprint,
      confirmedAt: '2026-07-15T08:00:00.000Z',
      decisions: [{ sourceId: 'product-catalog', decision: 'confirm', scopeFingerprint: prepared.wiki.sources.find((source) => source.id === 'product-catalog').confirmation.scopeFingerprint }],
    }),
    (error) => error.code === 'wiki-source-scope-unconfirmed',
  );
  const decisions = prepared.wiki.sources.filter((source) => source.enabled).map((source) => ({
    sourceId: source.id,
    decision: source.required ? 'confirm' : 'disable',
    scopeFingerprint: source.confirmation.scopeFingerprint,
  }));
  const confirmed = confirmWikiConfig(prepared, { outputRoot, inputFingerprint: prepared.wiki.confirmation.inputFingerprint, confirmedAt: '2026-07-15T08:00:00.000Z', decisions });
  assert.equal(confirmed.wiki.sources.find((source) => source.kind === 'requirement').enabled, false);
  assert.doesNotThrow(() => assertWikiSourceConfirmations(validateWikiConfig(confirmed).sources));
});

test('Wiki confirmation rejects Source changes after review and is stable for set ordering', () => {
  const candidate = config();
  const code = candidate.wiki.sources.find((source) => source.kind === 'code');
  code.scope.roots = ['services/course', 'presentation/operations', 'services/course'];
  code.scope.exclude = ['docs/wiki', 'node_modules', 'docs/wiki'];
  const prepared = prepareWikiConfig(candidate, { outputRoot });
  const reordered = structuredClone(candidate);
  reordered.wiki.sources.reverse();
  const reorderedCode = reordered.wiki.sources.find((source) => source.kind === 'code');
  reorderedCode.scope.roots.reverse();
  reorderedCode.scope.exclude.reverse();
  const reorderedPrepared = prepareWikiConfig(reordered, { outputRoot });
  assert.equal(reorderedPrepared.wiki.confirmation.inputFingerprint, prepared.wiki.confirmation.inputFingerprint);
  assert.notEqual(
    prepareWikiConfig(candidate, { outputRoot: `${outputRoot}/another-target` }).wiki.confirmation.inputFingerprint,
    prepared.wiki.confirmation.inputFingerprint,
  );

  const reviewedFingerprint = prepared.wiki.confirmation.inputFingerprint;
  prepared.wiki.sources.find((source) => source.kind === 'code').scope.roots.push('services/permission');
  assert.throws(() => confirmWikiConfig(prepared, {
    outputRoot,
    inputFingerprint: reviewedFingerprint,
    confirmedAt: '2026-07-15T08:00:00.000Z',
    decisions: prepared.wiki.sources.filter((source) => source.enabled).map((source) => ({
      sourceId: source.id,
      decision: source.required ? 'confirm' : 'disable',
      scopeFingerprint: source.confirmation.scopeFingerprint,
    })),
  }), (error) => error.code === 'wiki-source-scope-unconfirmed');
});

test('Source results require registered statuses and deterministic reason codes', () => {
  const collected = normalizeSourceResult(result('product-catalog', 'catalog', 'menu-json'));
  assert.equal(collected.reasonCode, null);
  const skipped = normalizeSourceResult(result('primary-requirements', 'requirement', 'tapd', 'skipped-no-input'));
  assert.equal(skipped.reasonCode, 'source-scope-unconfirmed');
  assert.throws(() => normalizeSourceResult({ ...skipped, reasonCode: null }), (error) => error.code === 'source-result-invalid');
  assert.throws(() => normalizeSourceResult({ ...collected, status: 'unknown' }), (error) => error.code === 'source-result-invalid');
  const configured = validateWikiConfig(config()).sources;
  const catalogSource = configured.find((source) => source.kind === 'catalog');
  assert.throws(() => normalizeSourceResult(collected, catalogSource), (error) => error.code === 'source-result-invalid');
  const databaseSource = configured.find((source) => source.kind === 'database');
  assert.throws(() => normalizeSourceResult(result('primary-database', 'database', 'postgres'), databaseSource), (error) => error.code === 'source-result-invalid');
});

test('Core Artifacts preserve source authority and reject sensitive Database payloads', () => {
  assert.equal(normalizeArtifact(catalogArtifact()).nodes.length, 4);
  const normalizedCode = normalizeArtifact(codeArtifact());
  assert.equal(normalizedCode.facts[0].factKind, 'api');
  assert.deepEqual(normalizeArtifact(normalizedCode), normalizedCode);
  assert.equal(normalizeArtifact(databaseArtifact()).capturePolicy, 'metadata-only');
  const brokenHierarchy = catalogArtifact();
  brokenHierarchy.nodes[3].parentId = 'order-domain';
  brokenHierarchy.fingerprint = createArtifact(envelope('catalog', 'product-catalog', 'menu-json', 'catalog-file'), {
    scope: brokenHierarchy.scope,
    nodes: brokenHierarchy.nodes,
  }).fingerprint;
  assert.throws(() => normalizeArtifact(brokenHierarchy), (error) => error.code === 'source-artifact-invalid');
  const leaked = databaseArtifact();
  leaked.rows = [{ email: 'customer@example.test' }];
  leaked.fingerprint = createArtifact(envelope('database', 'primary-database', 'postgres', 'database-introspection'), {
    ...leaked,
    fingerprint: undefined,
  }).fingerprint;
  assert.throws(() => normalizeArtifact(leaked), (error) => error.code === 'source-sensitive-data-detected');
  const wrongExpectedEnvironment = databaseShapeArtifact('migration-files');
  wrongExpectedEnvironment.environment = 'test';
  wrongExpectedEnvironment.fingerprint = createArtifact(envelope('database', 'primary-database', 'postgres', 'migration-files'), {
    ...wrongExpectedEnvironment,
    fingerprint: undefined,
  }).fingerprint;
  assert.throws(() => normalizeArtifact(wrongExpectedEnvironment), (error) => error.code === 'source-artifact-invalid');
  const wrongDeployedEnvironment = databaseShapeArtifact('schema-dump');
  wrongDeployedEnvironment.environment = 'expected';
  wrongDeployedEnvironment.fingerprint = createArtifact(envelope('database', 'primary-database', 'postgres', 'schema-dump'), {
    ...wrongDeployedEnvironment,
    fingerprint: undefined,
  }).fingerprint;
  assert.throws(() => normalizeArtifact(wrongDeployedEnvironment), (error) => error.code === 'source-artifact-invalid');
});

test('Artifact payloads cannot exceed the confirmed Catalog, Code, or Requirement scope', () => {
  const sourceConfig = config();
  sourceConfig.wiki.sources.find((source) => source.kind === 'requirement').scope = {
    confirmedByUser: true,
    workspaceId: '47387910',
    projectId: null,
    workItemIds: ['REQ-1'],
  };
  const sources = validateWikiConfig(sourceConfig).sources;

  const catalog = catalogArtifact();
  const catalogOutsideRoot = createArtifact(envelope('catalog', 'product-catalog', 'menu-json', 'catalog-file'), {
    scope: catalog.scope,
    nodes: [
      ...catalog.nodes,
      { id: 'unrelated', kind: 'system', parentId: null, name: '无关系统', order: 50, enabled: true, sourceIdentity: { type: 'menu-key', value: 'unrelated' }, routeKeys: [], evidenceIds: ['evidence-unrelated'] },
    ],
  });
  assert.throws(
    () => assertArtifactWithinSource(normalizeArtifact(catalogOutsideRoot), sources.find((source) => source.kind === 'catalog')),
    (error) => error.code === 'wiki-source-scope-unconfirmed' && /outside confirmed roots/.test(error.message),
  );

  const code = codeArtifact();
  code.facts[0].locator.path = 'docs/wiki/private.md';
  const codeInsideExclude = createArtifact(envelope('code', 'current-code', 'git-worktree', 'worktree-files'), {
    repositories: code.repositories,
    facts: code.facts,
  });
  assert.throws(
    () => assertArtifactWithinSource(normalizeArtifact(codeInsideExclude), sources.find((source) => source.kind === 'code')),
    (error) => error.code === 'wiki-source-scope-unconfirmed' && /inside an excluded/.test(error.message),
  );

  const requirementOutsideIds = createArtifact(envelope('requirement', 'primary-requirements', 'tapd', 'tapd-mcp'), {
    scope: { confirmedByUser: true, workspaceId: '47387910', projectId: null, workItemIds: ['REQ-1'] },
    queries: [{ id: 'query-explicit', tier: 'explicit', terms: ['REQ-1'], featureRefs: ['feature:order-refund'] }],
    items: [{
      externalId: 'REQ-2',
      itemType: 'product-requirement',
      normalizedStatus: 'completed',
      relevance: 'out-of-scope',
      decision: 'excluded',
      relationshipVerified: false,
      featureRefs: [],
      codeEvidenceIds: [],
    }],
  });
  assert.throws(
    () => assertArtifactWithinSource(normalizeArtifact(requirementOutsideIds), sources.find((source) => source.kind === 'requirement')),
    (error) => error.code === 'wiki-source-scope-unconfirmed' && /REQ-2/.test(error.message),
  );
});

test('Spec filesystem input normalizes as Expected supporting evidence without claiming Current facts', () => {
  const artifact = createArtifact(envelope('spec', 'context-specs', 'filesystem', 'spec-files'), {
    documents: [{
      id: 'course-project',
      path: 'aiworkspace/system-context/project/domains/course-project.md',
      title: 'course-project',
      contentHash: sha,
      evidenceId: 'evidence-course-project',
    }],
    statements: [{
      id: 'statement-course-boundary',
      documentId: 'course-project',
      statementKind: 'scope',
      layer: 'expected',
      text: '课程域包含项目、营期、课程和营期客户线索',
      candidateRefs: ['feature:training-camp', 'feature:course-library'],
      evidenceId: 'evidence-course-project',
    }],
  });
  const normalized = normalizeArtifact(artifact);
  assert.equal(normalized.kind, 'spec-artifact');
  assert.equal(normalized.statements[0].layer, 'expected');
  const wrongLayer = structuredClone(artifact);
  wrongLayer.statements[0].layer = 'current';
  wrongLayer.fingerprint = createArtifact({
    kind: wrongLayer.kind,
    sourceId: wrongLayer.sourceId,
    capturedAt: wrongLayer.capturedAt,
    sourceRevision: wrongLayer.sourceRevision,
    provenance: wrongLayer.provenance,
  }, { documents: wrongLayer.documents, statements: wrongLayer.statements }).fingerprint;
  assert.throws(() => normalizeArtifact(wrongLayer), (error) => error.code === 'source-artifact-invalid');
});

test('PostgreSQL and MySQL Database transports normalize to one metadata-only Artifact shape', () => {
  for (const provider of ['postgres', 'mysql']) {
    for (const transport of ['ddl-file', 'migration-files', 'schema-dump', 'read-only-introspection']) {
      const artifact = normalizeArtifact(databaseShapeArtifact(transport, 'bigint', provider));
      assert.equal(artifact.provider, provider);
      assert.equal(artifact.transport, transport);
      assert.equal(artifact.capturePolicy, 'metadata-only');
      assert.deepEqual(
        ['schemas', 'tables', 'views', 'columns', 'constraints', 'indexes', 'sequences', 'triggers', 'enums', 'accessControls'].filter((key) => Array.isArray(artifact[key])),
        ['schemas', 'tables', 'views', 'columns', 'constraints', 'indexes', 'sequences', 'triggers', 'enums', 'accessControls'],
      );
    }
  }
});

test('Database Artifacts require closed schema, owner, and object references', () => {
  const cases = [
    rebuildArtifact(databaseShapeArtifact('read-only-introspection'), (payload) => {
      payload.tables[0].schemaId = 'db-aaaaaaaaaaaaaaaa';
    }),
    rebuildArtifact(databaseShapeArtifact('read-only-introspection'), (payload) => {
      payload.columns[0].ownerId = 'db-bbbbbbbbbbbbbbbb';
    }),
    rebuildArtifact(databaseShapeArtifact('read-only-introspection'), (payload) => {
      payload.constraints.push({
        id: 'db-4444444444444444',
        ownerId: 'db-2222222222222222',
        type: 'foreign-key',
        columnIds: ['db-3333333333333333'],
        referencedObjectId: 'db-cccccccccccccccc',
        referencedColumnIds: [],
        expression: null,
        evidenceId: 'evidence-read-only-introspection',
      });
    }),
  ];
  for (const artifact of cases) {
    assert.throws(
      () => normalizeArtifact(artifact),
      (error) => error.code === 'source-artifact-invalid' && /unknown/.test(error.message),
    );
  }
});

test('Database Artifact transport ID must resolve to its declared transport type', () => {
  const sourceConfig = config();
  const databaseSource = sourceConfig.wiki.sources.find((source) => source.kind === 'database');
  databaseSource.enabled = true;
  databaseSource.scope = {
    confirmedByUser: true,
    environment: 'test',
    includeSchemas: ['public'],
    excludeSchemas: ['pg_catalog', 'information_schema'],
  };
  databaseSource.transports = [{
    id: 'migration-files',
    type: 'migration-files',
    enabled: true,
    priority: 10,
    paths: ['db/migrations'],
  }];
  const source = validateWikiConfig(sourceConfig).sources.find((item) => item.kind === 'database');
  const mismatched = rebuildArtifact(databaseShapeArtifact('read-only-introspection'), (_payload, artifactEnvelope) => {
    artifactEnvelope.provenance.transportIds = ['migration-files'];
  });
  assert.throws(
    () => assertArtifactWithinSource(normalizeArtifact(mismatched), source),
    (error) => error.code === 'wiki-source-scope-unconfirmed' && /transport type/.test(error.message),
  );
});

test('Database metadata plans are read-only for PostgreSQL and MySQL', () => {
  for (const provider of ['postgres', 'mysql']) {
    const plan = buildDatabaseMetadataQueries(provider, { includeSchemas: ['public'], excludeSchemas: ['information_schema'], statementTimeoutMs: 5000 });
    assert.equal(plan.readOnly, true);
    assert.equal(plan.statements.length > 0, true);
    assert.equal(plan.statements.every((statement) => /^SELECT\b/i.test(statement)), true);
    assert.equal(plan.statements.some((statement) => /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i.test(statement)), false);
    assert.equal(plan.statements.every((statement) => /information_schema|pg_catalog/i.test(statement)), true);
    assert.match(plan.transaction.begin, /TRANSACTION READ ONLY/);
    assert.equal(plan.transaction.rollback, 'ROLLBACK');
  }
  assert.throws(() => buildDatabaseMetadataQueries('postgres', { includeSchemas: ['pg_catalog'] }), (error) => error.code === 'database-scope-invalid');
  assert.throws(() => buildDatabaseMetadataQueries('mysql', { includeSchemas: ['mysql'] }), (error) => error.code === 'database-scope-invalid');
});

test('Generic Database collector normalizes allowlisted metadata and always rolls back', async () => {
  const calls = [];
  const rows = {
    schemas: [{ name: 'public' }],
    tables: [{ table_schema: 'public', table_name: 'widget', table_type: 'BASE TABLE' }],
    views: [],
    columns: [{ table_schema: 'public', table_name: 'widget', column_name: 'id', ordinal_position: 1, is_nullable: 'NO', data_type: 'bigint', column_default: null }],
    constraints: [{ constraint_schema: 'public', table_name: 'widget', constraint_name: 'widget_pk', constraint_type: 'PRIMARY KEY', column_name: 'id', ordinal_position: 1 }],
    indexes: [{ table_schema: 'public', table_name: 'widget', index_name: 'widget_pk', non_unique: 0, column_name: 'id', seq_in_index: 1 }],
  };
  const payload = await collectDatabaseMetadata({
    sourceId: 'primary-database',
    provider: 'mysql',
    environment: 'test',
    engineVersion: '8.4',
    includeSchemas: ['public'],
    excludeSchemas: ['information_schema'],
    statementTimeoutMs: 5000,
    maxObjects: 20,
    execute: async (statement, context) => {
      calls.push({ statement, context });
      return context.phase === 'metadata' ? rows[context.name] : [];
    },
  });
  assert.equal(payload.capturePolicy, 'metadata-only');
  assert.equal(payload.tables.length, 1);
  assert.equal(payload.columns.length, 1);
  assert.equal(payload.constraints[0].columnIds[0], payload.columns[0].id);
  assert.equal(calls[0].context.phase, 'begin');
  assert.equal(calls.at(-1).context.phase, 'rollback');
  assert.equal(calls.filter((call) => call.context.phase === 'metadata').every((call) => /^SELECT\b/.test(call.statement)), true);
  assert.deepEqual(normalizeDatabaseMetadataSnapshot({
    sourceId: 'primary-database', provider: 'mysql', environment: 'test', engineVersion: '8.4', includeSchemas: ['public'], maxObjects: 20, snapshot: rows,
  }), payload);
});

test('Generic Database collector rolls back when metadata collection fails', async () => {
  const phases = [];
  await assert.rejects(
    collectDatabaseMetadata({
      sourceId: 'primary-database', provider: 'postgres', environment: 'test', engineVersion: '16',
      includeSchemas: ['public'], excludeSchemas: ['information_schema'],
      execute: async (_statement, context) => {
        phases.push(context.phase);
        if (context.phase === 'metadata') throw new Error('query failed');
        return [];
      },
    }),
    /query failed/,
  );
  assert.deepEqual(phases, ['begin', 'metadata', 'rollback']);
});

test('Offline Database metadata rejects DML and data-bearing dump statements', () => {
  for (const provider of ['postgres', 'mysql']) {
    for (const transport of ['ddl-file', 'migration-files', 'schema-dump']) {
      const accepted = validateDatabaseMetadataText('CREATE TABLE refund_record (id bigint primary key);', { provider, transport });
      assert.equal(accepted.capturePolicy, 'metadata-only');
      assert.match(accepted.contentHash, /^sha256:[a-f0-9]{64}$/);
      assert.throws(
        () => validateDatabaseMetadataText('CREATE TABLE refund_record (id bigint); INSERT INTO refund_record VALUES (1);', { provider, transport }),
        (error) => error.code === 'source-sensitive-data-detected',
      );
    }
  }
  assert.throws(
    () => validateDatabaseMetadataText('COPY refund_record FROM STDIN;', { provider: 'postgres', transport: 'schema-dump' }),
    (error) => error.code === 'source-sensitive-data-detected',
  );
});

test('Database Artifact reconciliation reports Expected versus Deployed schema drift without choosing a winner', () => {
  const aligned = reconcileDatabaseArtifacts([
    databaseShapeArtifact('ddl-file'),
    databaseShapeArtifact('schema-dump'),
  ]);
  assert.equal(aligned[0].status, 'aligned');
  assert.deepEqual(aligned[0].conflictCollections, []);
  const conflict = reconcileDatabaseArtifacts([
    databaseShapeArtifact('migration-files', 'bigint'),
    databaseShapeArtifact('read-only-introspection', 'varchar'),
  ]);
  assert.equal(conflict[0].status, 'conflict');
  assert.deepEqual(conflict[0].conflictCollections, ['columns']);
});

test('Readiness enforces Catalog plus Code and applies Database per Feature', () => {
  const readyConfig = config();
  readyConfig.wiki.sources.find((source) => source.kind === 'catalog').scope.confirmedByUser = true;
  readyConfig.wiki.sources.find((source) => source.kind === 'requirement').scope = {
    confirmedByUser: false,
    workspaceId: 'workspace-example',
    projectId: null,
    workItemIds: [],
  };
  const databaseSource = readyConfig.wiki.sources.find((source) => source.kind === 'database');
  databaseSource.enabled = true;
  databaseSource.scope = { confirmedByUser: true, environment: 'test', includeSchemas: ['public'], excludeSchemas: ['pg_catalog', 'information_schema'] };
  databaseSource.transports[0].enabled = true;
  const prepared = prepareWikiConfig(readyConfig, { outputRoot });
  const confirmed = confirmWikiConfig(prepared, {
    outputRoot,
    inputFingerprint: prepared.wiki.confirmation.inputFingerprint,
    confirmedAt: '2026-07-13T23:55:00.000Z',
    decisions: prepared.wiki.sources.filter((source) => source.enabled).map((source) => ({
      sourceId: source.id,
      decision: 'confirm',
      scopeFingerprint: source.confirmation.scopeFingerprint,
    })),
  });
  const sources = validateWikiConfig(confirmed).sources;
  const artifacts = [catalogArtifact(), codeArtifact(), databaseArtifact()].map((artifact) => {
    const source = sources.find((item) => item.id === artifact.sourceId);
    const { schemaVersion, fingerprint, kind, sourceId, capturedAt, sourceRevision, provenance, ...payload } = artifact;
    return createArtifact({ kind, sourceId, capturedAt, sourceRevision, provenance: { ...provenance, scopeFingerprint: source.confirmation.scopeFingerprint } }, payload);
  });
  const sourceResults = [
    result('product-catalog', 'catalog', 'menu-json'),
    result('current-code', 'code', 'git-worktree'),
    result('primary-requirements', 'requirement', 'tapd', 'skipped-no-input'),
    result('primary-database', 'database', 'postgres'),
  ];
  const features = [{ id: 'order-refund', gapIds: [], dataSourceAssessment: { applicability: 'applicable', reason: '持久化退款状态', evidenceIds: ['evidence-code-refund'], databaseSourceIds: ['primary-database'], gapIds: [] } }];
  const readiness = buildSourceReadiness({ configuredSources: sources, sourceResults, artifacts, features, now: new Date('2026-07-14T01:00:00.000Z') });
  assert.equal(readiness.status, 'degraded');
  assert.equal(readiness.featureResults[0].databaseStatus, 'ready');
  assert.equal(readiness.featureResults[0].requirementStatus, 'missing');
  const withoutCode = buildSourceReadiness({
    configuredSources: sources,
    sourceResults: sourceResults.map((item) => item.kind === 'code' ? result('current-code', 'code', 'git-worktree', 'failed') : item),
    artifacts: artifacts.filter((item) => item.kind !== 'code-artifact'),
    features,
  });
  assert.equal(withoutCode.status, 'blocked');
  assert.deepEqual(withoutCode.codeSourceIds, []);
  const staticFeature = [{ id: 'help', gapIds: [], dataSourceAssessment: { applicability: 'not-applicable', reason: '纯静态帮助页', evidenceIds: ['evidence-code-refund'], databaseSourceIds: [], gapIds: [] } }];
  const staticReadiness = buildSourceReadiness({ configuredSources: sources, sourceResults, artifacts, features: staticFeature });
  assert.equal(staticReadiness.featureResults[0].databaseStatus, 'not-applicable');
  assert.throws(
    () => buildSourceReadiness({ configuredSources: sources, sourceResults, artifacts: artifacts.slice(0, 2), features }),
    (error) => error.code === 'source-result-invalid',
  );
});
