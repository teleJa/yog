import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_WIKI_CONFIG } from '../../skills/yog/lib/config.mjs';
import {
  buildWikiInputConfirmation,
  confirmWikiConfig,
  createArtifact,
  prepareWikiConfig,
} from '../../skills/yog/lib/wiki-source-registry.mjs';
import { buildCatalogIndexProjections, buildFlowIndexProjections, buildProductWiki, generateProductWiki, __private } from '../../skills/yog/lib/wiki.mjs';
import { syncProductWiki, updateProductWiki, verifyProductWiki } from '../../skills/yog/lib/wiki-lifecycle.mjs';
import { preflightWiki } from '../../skills/yog/lib/query-contract.mjs';
import { buildGapGuidance } from '../../skills/yog/lib/wiki-gap.mjs';

const sha = `sha256:${'b'.repeat(64)}`;
const retiredWikiOwner = ['yog', ['wiki', 'mvp'].join('-')].join(':');

function actionableGap(raw) {
  return {
    ...raw,
    ...buildGapGuidance({
      type: raw.type,
      description: raw.description,
      subjectRefs: raw.subjectRefs,
      fieldRefs: raw.fieldRefs ?? [],
      subjectName: '目标对象',
    }),
    resolutionEvidenceIds: raw.resolutionEvidenceIds ?? [],
    resolvedByDecisionId: raw.resolvedByDecisionId ?? null,
  };
}

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'yog-mode4-'));
  mkdirSync(join(root, '.git'));
  return root;
}

function wikiMarkdown(root) {
  const wikiRoot = join(root, 'docs/wiki');
  const files = new Map();
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), path);
      else if (entry.isFile() && path.endsWith('.md')) files.set(path, readFileSync(join(directory, entry.name), 'utf8'));
    }
  };
  visit(wikiRoot);
  return files;
}

function wikiTreeSnapshot(root) {
  const wikiRoot = join(root, 'docs/wiki');
  const files = new Map();
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), path);
      else if (entry.isFile()) {
        const absolute = join(directory, entry.name);
        files.set(path, {
          hash: createHash('sha256').update(readFileSync(absolute)).digest('hex'),
          mtimeMs: statSync(absolute).mtimeMs,
        });
      }
    }
  };
  visit(wikiRoot);
  return files;
}

function baseNode(id, kind, name, overrides = {}) {
  return {
    id,
    kind,
    name,
    status: 'confirmed',
    ownerRefs: [],
    subjectRefs: [],
    relationRefs: [],
    claimIds: [],
    evidenceIds: [],
    gapIds: [],
    confirmedEmptyFields: [],
    versionRefs: [],
    order: 10,
    ...overrides,
  };
}

function fact(text, evidenceIds, level = 'confirmed') {
  return { text, level, evidenceIds };
}

function artifactEnvelope(kind, sourceId, provider, transportId) {
  return {
    kind: `${kind}-artifact`,
    sourceId,
    capturedAt: '2026-07-14T10:00:00.000Z',
    sourceRevision: sha,
    provenance: { provider, transportIds: [transportId], scopeFingerprint: sha },
  };
}

function sourceResult(sourceId, kind, provider, status = 'collected') {
  return {
    sourceId,
    kind,
    provider,
    status,
    required: ['catalog', 'code'].includes(kind),
    capturedAt: status === 'collected' ? '2026-07-14T10:00:00.000Z' : null,
    sourceRevision: status === 'collected' ? sha : null,
    fingerprint: status === 'collected' ? sha : null,
    artifactCount: status === 'collected' ? 1 : 0,
    reasonCode: status === 'collected' ? null : 'source-scope-unconfirmed',
    transportResults: [],
    gapIds: [],
    diagnostics: [],
  };
}

function authorizeFixture(input) {
  const candidate = {
    schemaVersion: 1,
    language: 'zh-CN',
    wiki: { root: input.wikiRoot, sources: structuredClone(input.configuredSources) },
  };
  const prepared = prepareWikiConfig(candidate, { outputRoot: input.outputRoot });
  const confirmed = confirmWikiConfig(prepared, {
    outputRoot: input.outputRoot,
    inputFingerprint: prepared.wiki.confirmation.inputFingerprint,
    confirmedAt: '2026-07-14T09:55:00.000Z',
    decisions: prepared.wiki.sources.filter((source) => source.enabled).map((source) => ({
      sourceId: source.id,
      decision: 'confirm',
      scopeFingerprint: source.confirmation.scopeFingerprint,
    })),
  });
  input.configuredSources = confirmed.wiki.sources;
  input.inputConfirmation = buildWikiInputConfirmation({
    outputRoot: input.outputRoot,
    wikiRoot: input.wikiRoot,
    sources: input.configuredSources,
    confirmation: confirmed.wiki.confirmation,
  });
  input.artifacts = input.artifacts.map((artifact) => {
    const source = input.configuredSources.find((item) => item.id === artifact.sourceId);
    const { schemaVersion, fingerprint, kind, sourceId, capturedAt, sourceRevision, provenance, ...payload } = artifact;
    return createArtifact({
      kind,
      sourceId,
      capturedAt,
      sourceRevision,
      provenance: { ...provenance, scopeFingerprint: source.confirmation.scopeFingerprint },
    }, payload);
  });
  return input;
}

function databaseSchemaArtifact(transport, dataType) {
  const environment = ['ddl-file', 'migration-files'].includes(transport) ? 'expected' : 'test';
  const transportId = transport === 'read-only-introspection' ? 'database-introspection' : transport;
  const evidenceSuffix = environment === 'expected' ? 'expected' : 'deployed';
  return createArtifact(artifactEnvelope('database', 'primary-database', 'postgres', transportId), {
    provider: 'postgres',
    transport,
    environment,
    engineVersion: '16',
    capturePolicy: 'metadata-only',
    schemas: [{ id: 'db-1111111111111111', name: 'public', environment, evidenceId: `evidence-database-schema-${evidenceSuffix}` }],
    tables: [{ id: 'db-2222222222222222', schemaId: 'db-1111111111111111', name: 'refund_record', kind: 'table', comment: null, evidenceId: `evidence-database-table-${evidenceSuffix}` }],
    columns: [{ id: 'db-3333333333333333', ownerId: 'db-2222222222222222', name: 'status', dataType, nullable: false, defaultExpression: null, ordinal: 1, comment: null, evidenceId: `evidence-database-column-${evidenceSuffix}` }],
    views: [],
    constraints: [],
    indexes: [],
    sequences: [],
    triggers: [],
    enums: [],
    accessControls: [{ id: 'db-6666666666666666', subject: 'organization-role', objectId: 'db-2222222222222222', privilege: 'INSERT', policyExpression: 'organization_scope', evidenceId: `evidence-database-access-${evidenceSuffix}` }],
  });
}

function relation(from, type, to, claimId, evidenceId) {
  return { id: __private.relationId(from, type, to), from, type, to, claimIds: [claimId], evidenceIds: [evidenceId] };
}

function fixture(outputRoot = tempRoot()) {
  const configuredSources = structuredClone(DEFAULT_WIKI_CONFIG.sources);
  configuredSources.find((source) => source.id === 'product-catalog').scope = { confirmedByUser: true, rootNodeIds: ['commerce'] };
  const databaseSource = configuredSources.find((source) => source.id === 'primary-database');
  databaseSource.enabled = true;
  databaseSource.scope = { confirmedByUser: true, environment: 'test', includeSchemas: ['public'], excludeSchemas: ['pg_catalog', 'information_schema'] };
  databaseSource.transports[0].enabled = true;
  configuredSources.find((source) => source.id === 'primary-requirements').scope = {
    confirmedByUser: false,
    workspaceId: 'workspace-example',
    projectId: null,
    workItemIds: [],
  };
  const relSystemDomain = relation('system:commerce', 'contains', 'domain:orders', 'claim-catalog', 'evidence-catalog-domain');
  const relDomainModule = relation('domain:orders', 'contains', 'module:order-management', 'claim-catalog', 'evidence-catalog-module');
  const relModuleFeature = relation('module:order-management', 'contains', 'feature:order-refund', 'claim-catalog', 'evidence-catalog-feature');
  const relRuleFeature = relation('rule:refund-window', 'applies-to', 'feature:order-refund', 'claim-rule', 'evidence-code-rule');
  const relPermissionFeature = relation('permission:refund-permission', 'applies-to', 'feature:order-refund', 'claim-permission', 'evidence-code-permission');
  const relFeatureEntity = relation('feature:order-refund', 'writes', 'data-entity:refund-record', 'claim-feature', 'evidence-code-data-use');
  const relMetricFeature = relation('metric:refund-rate', 'measures', 'feature:order-refund', 'claim-metric', 'evidence-code-metric');
  const relFeatureInterface = relation('feature:order-refund', 'exposes', 'interface:refund-api', 'claim-interface', 'evidence-code-interface');
  const relationships = [relSystemDomain, relDomainModule, relModuleFeature, relRuleFeature, relPermissionFeature, relFeatureEntity, relMetricFeature, relFeatureInterface];

  const catalogArtifact = createArtifact(artifactEnvelope('catalog', 'product-catalog', 'menu-json', 'catalog-file'), {
    scope: { confirmedByUser: true, rootNodeIds: ['commerce'] },
    nodes: [
      { id: 'commerce', kind: 'system', parentId: null, name: '交易系统', order: 10, enabled: true, sourceIdentity: { type: 'menu-key', value: 'commerce' }, routeKeys: [], evidenceIds: ['evidence-catalog-system'] },
      { id: 'orders', kind: 'domain', parentId: 'commerce', name: '订单域', order: 20, enabled: true, sourceIdentity: { type: 'menu-key', value: 'orders' }, routeKeys: [], evidenceIds: ['evidence-catalog-domain'] },
      { id: 'order-management', kind: 'module', parentId: 'orders', name: '订单管理', order: 30, enabled: true, sourceIdentity: { type: 'menu-key', value: 'order-management' }, routeKeys: [], evidenceIds: ['evidence-catalog-module'] },
      { id: 'order-refund', kind: 'feature', parentId: 'order-management', name: '订单退款', order: 40, enabled: true, sourceIdentity: { type: 'menu-key', value: 'order-refund' }, routeKeys: ['/orders/refund'], evidenceIds: ['evidence-catalog-feature'] },
    ],
  });
  const codeArtifact = createArtifact(artifactEnvelope('code', 'current-code', 'git-worktree', 'worktree-files'), {
    repositories: [
      { id: 'repo-current', sourceRoot: '.', rootRef: 'source:current-code', commit: 'abc123', dirty: false, surface: 'backend', scope: { include: ['.'], exclude: ['docs/wiki'] } },
      { id: 'repo-frontend', sourceRoot: '.', rootRef: 'source:current-code', commit: 'abc123', dirty: false, surface: 'frontend', scope: { include: ['.'], exclude: ['docs/wiki'] } },
    ],
    facts: [
      { id: 'code-fact-refund', factKind: 'api', locator: { repositoryId: 'repo-current', path: 'src/refund.mjs', precision: 'symbol', startLine: 1, endLine: 20, symbol: 'createRefund' }, text: '创建退款申请', candidateRefs: ['feature:order-refund'], evidenceId: 'evidence-code-interface' },
      { id: 'code-fact-rule', factKind: 'validation', locator: { repositoryId: 'repo-current', path: 'src/refund.mjs', precision: 'symbol', startLine: 21, endLine: 30, symbol: 'validateRefundWindow' }, text: '校验退款时间窗', candidateRefs: ['rule:refund-window'], evidenceId: 'evidence-code-rule' },
      { id: 'code-fact-permission', factKind: 'validation', locator: { repositoryId: 'repo-current', path: 'src/refund.mjs', precision: 'symbol', startLine: 31, endLine: 40, symbol: 'authorizeRefund' }, text: '校验退款接口权限', candidateRefs: ['permission:refund-permission'], evidenceId: 'evidence-code-permission' },
      { id: 'code-fact-ui', factKind: 'operation', locator: { repositoryId: 'repo-frontend', path: 'src/refund-ui.mjs', precision: 'symbol', startLine: 1, endLine: 10, symbol: 'showRefundButton' }, text: '显示退款提交入口', candidateRefs: ['operation:submit-refund'], evidenceId: 'evidence-code-permission-ui' },
      { id: 'code-fact-metric', factKind: 'task', locator: { repositoryId: 'repo-current', path: 'src/refund.mjs', precision: 'symbol', startLine: 41, endLine: 50, symbol: 'calculateRefundRate' }, text: '计算退款率', candidateRefs: ['metric:refund-rate'], evidenceId: 'evidence-code-metric' },
      { id: 'code-fact-data-use', factKind: 'database-usage', locator: { repositoryId: 'repo-current', path: 'src/refund.mjs', precision: 'symbol', startLine: 51, endLine: 60, symbol: 'saveRefundRecord' }, text: '写入退款记录', candidateRefs: ['data-entity:refund-record'], evidenceId: 'evidence-code-data-use' },
    ],
  });
  const databaseArtifact = createArtifact(artifactEnvelope('database', 'primary-database', 'postgres', 'database-introspection'), {
    provider: 'postgres', transport: 'read-only-introspection', environment: 'test', engineVersion: '16', capturePolicy: 'metadata-only',
    schemas: [{ id: 'db-1111111111111111', name: 'public', environment: 'test', evidenceId: 'evidence-database-schema' }],
    tables: [{ id: 'db-2222222222222222', schemaId: 'db-1111111111111111', name: 'refund_record', kind: 'table', comment: null, evidenceId: 'evidence-database-table' }],
    views: [],
    columns: [{ id: 'db-3333333333333333', ownerId: 'db-2222222222222222', name: 'status', dataType: 'varchar', nullable: false, defaultExpression: null, ordinal: 1, comment: null, evidenceId: 'evidence-database' }],
    constraints: [], indexes: [], sequences: [], triggers: [], enums: [], accessControls: [
      { id: 'db-6666666666666666', subject: 'organization-role', objectId: 'db-2222222222222222', privilege: 'INSERT', policyExpression: 'organization_scope', evidenceId: 'evidence-database-access' },
    ],
  });

  const evidence = [
    { id: 'evidence-catalog-system', sourceId: 'product-catalog', authority: 'human-confirmation', permissionLayers: ['product'], precision: 'catalog-node', description: '交易系统目录节点', locator: 'catalog:commerce' },
    { id: 'evidence-catalog-domain', sourceId: 'product-catalog', authority: 'human-confirmation', permissionLayers: ['product'], precision: 'catalog-node', description: '订单域目录节点', locator: 'catalog:orders' },
    { id: 'evidence-catalog-module', sourceId: 'product-catalog', authority: 'human-confirmation', permissionLayers: ['product'], precision: 'catalog-node', description: '订单管理目录节点', locator: 'catalog:order-management' },
    { id: 'evidence-catalog-feature', sourceId: 'product-catalog', authority: 'human-confirmation', permissionLayers: ['product'], precision: 'catalog-node', description: '订单退款目录节点', locator: 'catalog:order-refund' },
    { id: 'evidence-code-rule', sourceId: 'current-code', authority: 'implementation-fact', permissionLayers: ['api'], precision: 'symbol', factKind: 'validation', repositorySurface: 'backend', description: '退款时间窗校验', locator: 'code:repo-current:src/refund.mjs:21-30' },
    { id: 'evidence-code-permission', sourceId: 'current-code', authority: 'implementation-fact', permissionLayers: ['api'], precision: 'symbol', factKind: 'validation', repositorySurface: 'backend', description: '退款接口鉴权', locator: 'code:repo-current:src/refund.mjs:31-40' },
    { id: 'evidence-code-permission-ui', sourceId: 'current-code', authority: 'implementation-fact', permissionLayers: ['ui'], precision: 'symbol', factKind: 'operation', repositorySurface: 'frontend', description: '退款按钮可见性', locator: 'code:repo-frontend:src/refund-ui.mjs:1-10' },
    { id: 'evidence-code-metric', sourceId: 'current-code', authority: 'implementation-fact', permissionLayers: [], precision: 'symbol', factKind: 'task', repositorySurface: 'backend', description: '退款率计算', locator: 'code:repo-current:src/refund.mjs:41-50' },
    { id: 'evidence-code-interface', sourceId: 'current-code', authority: 'implementation-fact', permissionLayers: ['api'], precision: 'symbol', factKind: 'api', repositorySurface: 'backend', description: '退款接口', locator: 'code:repo-current:src/refund.mjs:1-20' },
    { id: 'evidence-code-data-use', sourceId: 'current-code', authority: 'implementation-fact', permissionLayers: ['data'], precision: 'symbol', factKind: 'database-usage', repositorySurface: 'backend', description: '写入退款记录', locator: 'code:repo-current:src/refund.mjs:51-60' },
    { id: 'evidence-database-schema', sourceId: 'primary-database', authority: 'data-structure-fact', permissionLayers: [], precision: 'metadata-object', factKind: 'database:schemas', artifactObjectRef: 'db-1111111111111111', description: 'public schema', locator: 'database:test:schemas:db-1111111111111111' },
    { id: 'evidence-database-table', sourceId: 'primary-database', authority: 'data-structure-fact', permissionLayers: [], precision: 'metadata-object', factKind: 'database:tables', artifactObjectRef: 'db-2222222222222222', description: '退款记录表', locator: 'database:test:tables:db-2222222222222222' },
    { id: 'evidence-database', sourceId: 'primary-database', authority: 'data-structure-fact', permissionLayers: [], precision: 'metadata-object', factKind: 'database:columns', artifactObjectRef: 'db-3333333333333333', description: '退款状态字段', locator: 'database:test:columns:db-3333333333333333' },
    { id: 'evidence-database-access', sourceId: 'primary-database', authority: 'data-structure-fact', permissionLayers: ['data'], precision: 'metadata-object', factKind: 'database:accessControls', artifactObjectRef: 'db-6666666666666666', description: '退款记录组织范围访问控制', locator: 'database:test:accessControls:db-6666666666666666' },
  ];
  const claims = [
    { id: 'claim-catalog', subjectRef: 'system:commerce', layer: 'expected', factLevel: 'confirmed', text: '交易系统包含订单域和订单退款功能', evidenceIds: ['evidence-catalog-system'] },
    { id: 'claim-feature', subjectRef: 'feature:order-refund', layer: 'current', factLevel: 'confirmed', text: '系统支持创建订单退款申请', evidenceIds: ['evidence-code-interface'] },
    { id: 'claim-rule', subjectRef: 'rule:refund-window', layer: 'current', factLevel: 'confirmed', text: '订单完成后七天内可退款', evidenceIds: ['evidence-code-rule'] },
    { id: 'claim-permission', subjectRef: 'permission:refund-permission', layer: 'current', factLevel: 'confirmed', text: '客服主管可提交退款', evidenceIds: ['evidence-code-permission'] },
    { id: 'claim-permission-product', subjectRef: 'permission:refund-permission', layer: 'expected', factLevel: 'confirmed', text: '客服主管承担退款管理职责', evidenceIds: ['evidence-catalog-feature'] },
    { id: 'claim-permission-ui', subjectRef: 'permission:refund-permission', layer: 'current', factLevel: 'confirmed', text: '客服主管可见退款提交入口', evidenceIds: ['evidence-code-permission-ui'] },
    { id: 'claim-permission-data', subjectRef: 'permission:refund-permission', layer: 'current', factLevel: 'confirmed', text: '退款记录按组织范围隔离', evidenceIds: ['evidence-database-access'] },
    { id: 'claim-data', subjectRef: 'data-entity:refund-record', layer: 'current', factLevel: 'confirmed', text: '退款申请写入退款记录', evidenceIds: ['evidence-database'] },
    { id: 'claim-metric', subjectRef: 'metric:refund-rate', layer: 'current', factLevel: 'confirmed', text: '系统计算退款率', evidenceIds: ['evidence-code-metric'] },
    { id: 'claim-interface', subjectRef: 'interface:refund-api', layer: 'current', factLevel: 'confirmed', text: '退款接口创建申请', evidenceIds: ['evidence-code-interface'] },
  ];
  const gaps = [actionableGap({ id: 'gap-requirement', type: 'acceptance-gap', audience: 'product-review', severity: 'P1', status: 'open', description: '缺少已完成需求与验收标准', subjectRefs: ['feature:order-refund'], fieldRefs: ['feature:order-refund.acceptanceCriteriaRefs', 'feature:order-refund.requirementRefs'], evidenceIds: [] })];
  const catalog = {
    systems: [baseNode('commerce', 'system', '交易系统', { sourceIdentity: { type: 'menu-key', value: 'commerce' }, parentRef: null, positioning: fact('交易与订单履约平台', ['evidence-catalog-system']), boundary: [fact('负责订单交易，不负责支付清算', ['evidence-catalog-system'])], domainRefs: ['domain:orders'], ownerRefs: ['role:customer-service-manager'], relationRefs: [relSystemDomain.id], claimIds: ['claim-catalog'], evidenceIds: ['evidence-catalog-system'] })],
    domains: [baseNode('orders', 'domain', '订单域', { sourceIdentity: { type: 'menu-key', value: 'orders' }, parentRef: 'system:commerce', boundary: [fact('负责订单生命周期', ['evidence-catalog-domain'])], moduleRefs: ['module:order-management'], relationRefs: [relSystemDomain.id, relDomainModule.id], claimIds: ['claim-catalog'], evidenceIds: ['evidence-catalog-domain'], order: 20 })],
    modules: [baseNode('order-management', 'module', '订单管理', { sourceIdentity: { type: 'menu-key', value: 'order-management' }, parentRef: 'domain:orders', featureRefs: ['feature:order-refund'], entryRefs: [], confirmedEmptyFields: ['entryRefs'], relationRefs: [relDomainModule.id, relModuleFeature.id], claimIds: ['claim-catalog'], evidenceIds: ['evidence-catalog-module'], order: 30 })],
    features: [baseNode('order-refund', 'feature', '订单退款', {
      sourceIdentity: { type: 'menu-key', value: 'order-refund' }, parentRef: 'module:order-management', purpose: [fact('为已完成订单提供退款入口', ['evidence-code-interface'])],
      dataSourceAssessment: { applicability: 'applicable', reason: '退款申请需要持久化', evidenceIds: ['evidence-code-interface'], databaseSourceIds: ['primary-database'], gapIds: [] },
      pageRefs: [], operationRefs: ['operation:submit-refund'], scenarioRefs: [], flowRefs: [], stateMachineRefs: [], ruleRefs: ['rule:refund-window'], roleRefs: ['role:customer-service-manager'], permissionRefs: ['permission:refund-permission'], dataEntityRefs: ['data-entity:refund-record'], metricRefs: ['metric:refund-rate'], interfaceRefs: ['interface:refund-api'], requirementRefs: [], acceptanceCriteriaRefs: [], versionRefs: [],
      confirmedEmptyFields: ['pageRefs', 'scenarioRefs', 'flowRefs', 'stateMachineRefs', 'versionRefs'],
      relationRefs: [relModuleFeature.id, relRuleFeature.id, relPermissionFeature.id, relFeatureEntity.id, relMetricFeature.id, relFeatureInterface.id], claimIds: ['claim-feature'], evidenceIds: ['evidence-code-interface'], gapIds: ['gap-requirement'], order: 40,
    })],
  };
  const objects = {
    pages: [],
    operations: [baseNode('submit-refund', 'operation', '提交退款申请', { action: fact('提交退款申请', ['evidence-code-interface']), actorRefs: ['role:customer-service-manager'], preconditions: [fact('订单已完成', ['evidence-code-interface'])], outcomes: [fact('创建退款记录', ['evidence-code-interface'])], errorOutcomes: [fact('不可退款时拒绝', ['evidence-code-interface'])], ownerRefs: ['feature:order-refund'], subjectRefs: ['feature:order-refund'], claimIds: ['claim-feature'], evidenceIds: ['evidence-code-interface'] })],
    scenarios: [], flows: [], stateMachines: [],
    rules: [baseNode('refund-window', 'rule', '退款时间窗', { trigger: fact('提交退款申请', ['evidence-code-rule']), conditions: [fact('订单完成时间不超过七天', ['evidence-code-rule'])], effects: [fact('允许创建退款申请', ['evidence-code-rule'])], priority: 10, exceptions: [], configurationRefs: [], confirmedEmptyFields: ['exceptions', 'configurationRefs'], subjectRefs: ['feature:order-refund'], relationRefs: [relRuleFeature.id], claimIds: ['claim-rule'], evidenceIds: ['evidence-code-rule'] })],
    roles: [baseNode('customer-service-manager', 'role', '客服主管', { roleType: 'business', responsibilities: [fact('审核退款申请', ['evidence-code-permission'])], scopeRefs: ['feature:order-refund'], operationRefs: ['operation:submit-refund'], claimIds: ['claim-permission'], evidenceIds: ['evidence-code-permission'] })],
    permissions: [baseNode('refund-permission', 'permission', '退款权限矩阵', { rows: [
      { roleRef: 'role:customer-service-manager', resourceRef: 'feature:order-refund', action: '管理退款', enforcementLayer: 'product', dataScope: 'organization', condition: '订单退款职责', decision: 'allow', claimIds: ['claim-permission-product'], evidenceIds: ['evidence-catalog-feature'] },
      { roleRef: 'role:customer-service-manager', resourceRef: 'operation:submit-refund', action: '显示提交按钮', enforcementLayer: 'ui', dataScope: 'organization', condition: '页面可访问', decision: 'allow', claimIds: ['claim-permission-ui'], evidenceIds: ['evidence-code-permission-ui'] },
      { roleRef: 'role:customer-service-manager', resourceRef: 'operation:submit-refund', action: '提交退款', enforcementLayer: 'api', dataScope: 'organization', condition: 'order-completed', decision: 'allow', claimIds: ['claim-permission'], evidenceIds: ['evidence-code-permission'] },
      { roleRef: 'role:customer-service-manager', resourceRef: 'data-entity:refund-record', action: '写入退款记录', enforcementLayer: 'data', dataScope: 'organization', condition: 'tenant-filtered', decision: 'allow', claimIds: ['claim-permission-data'], evidenceIds: ['evidence-database-access'] },
    ], subjectRefs: ['feature:order-refund'], relationRefs: [relPermissionFeature.id], claimIds: ['claim-permission', 'claim-permission-product', 'claim-permission-ui', 'claim-permission-data'], evidenceIds: ['evidence-code-permission', 'evidence-code-permission-ui', 'evidence-catalog-feature', 'evidence-database-access'] })],
    dataEntities: [baseNode('refund-record', 'data-entity', '退款记录', { storageRefs: ['database:primary-database'], storageName: 'public.refund_record', databaseObjectRefs: ['db-2222222222222222'], fields: [{ name: 'status', type: 'varchar', nullable: false, columnRef: 'db-3333333333333333', businessMeaning: '退款申请状态', claimIds: ['claim-data'], evidenceIds: ['evidence-database'] }], constraints: [], indexes: [], relationships: [], fieldCoverage: 'complete', sensitivity: fact('内部业务数据', ['evidence-database']), readerRefs: [], writerRefs: ['feature:order-refund'], confirmedEmptyFields: ['constraints', 'indexes', 'relationships', 'readerRefs'], subjectRefs: ['feature:order-refund'], relationRefs: [relFeatureEntity.id], claimIds: ['claim-data'], evidenceIds: ['evidence-database'] })],
    metrics: [baseNode('refund-rate', 'metric', '退款率', { metricType: 'product-success', formula: fact('退款订单数/完成订单数', ['evidence-code-metric']), unit: 'percent', dimensions: [fact('业务日期', ['evidence-code-metric'])], filters: [], timeWindow: 'day', baseline: fact('当前退款率基线', ['evidence-code-metric']), target: fact('退款率目标值', ['evidence-code-metric']), sourceRefs: ['data-entity:refund-record'], refreshPolicy: 'daily', confirmedEmptyFields: ['filters'], ownerRefs: ['role:customer-service-manager'], subjectRefs: ['feature:order-refund'], relationRefs: [relMetricFeature.id], claimIds: ['claim-metric'], evidenceIds: ['evidence-code-metric'] })],
    interfaces: [baseNode('refund-api', 'interface', '创建退款接口', { providerRef: 'system:commerce', consumerRefs: [], protocol: 'HTTP', endpoints: [{ id: 'submit-refund', name: '提交退款', method: 'POST', path: '/refund', auth: 'service-token', request: 'CreateRefundRequest', response: 'RefundResponse', errors: [{ code: 'ORDER_NOT_REFUNDABLE', condition: '订单不满足退款条件', meaning: '拒绝退款申请', claimIds: ['claim-interface'], evidenceIds: ['evidence-code-interface'] }], idempotency: 'orderId', claimIds: ['claim-interface'], evidenceIds: ['evidence-code-interface'] }], auth: 'service-token', input: { orderId: 'string' }, output: { refundId: 'string' }, errors: [{ code: 'ORDER_NOT_REFUNDABLE', claimIds: ['claim-interface'], evidenceIds: ['evidence-code-interface'] }], idempotency: 'orderId', timeout: '3s', retry: 'none', version: 'v1', confirmedEmptyFields: ['consumerRefs'], subjectRefs: ['feature:order-refund'], relationRefs: [relFeatureInterface.id], claimIds: ['claim-interface'], evidenceIds: ['evidence-code-interface'] })],
    requirements: [], acceptanceCriteria: [], versions: [],
  };
  return authorizeFixture({
    schemaVersion: 1,
    outputRoot,
    wikiRoot: 'docs/wiki',
    runId: 'wiki-mode4-test',
    generatedAt: '2026-07-14T10:00:00.000Z',
    now: '2026-07-14T11:00:00.000Z',
    configuredSources,
    sourceResults: [sourceResult('product-catalog', 'catalog', 'menu-json'), sourceResult('current-code', 'code', 'git-worktree'), sourceResult('primary-requirements', 'requirement', 'tapd', 'skipped-no-input'), sourceResult('primary-database', 'database', 'postgres')],
    artifacts: [catalogArtifact, codeArtifact, databaseArtifact],
    catalog,
    objects,
    relationships,
    governance: { claims, evidence, gaps, coverage: {} },
  });
}

function withThreeViewFlow(input) {
  input.governance.claims.push(
    { id: 'claim-flow-goal', subjectRef: 'flow:refund-flow', layer: 'expected', factLevel: 'confirmed', text: '客服提交退款并异步通知后续处理', evidenceIds: ['evidence-catalog-feature'] },
    { id: 'claim-flow-current', subjectRef: 'flow:refund-flow', layer: 'current', factLevel: 'confirmed', text: '退款提交与通知链路已实现', evidenceIds: ['evidence-code-interface'] },
    { id: 'claim-refund-state', subjectRef: 'state-machine:refund-state', layer: 'current', factLevel: 'confirmed', text: '退款申请从待提交转为已提交', evidenceIds: ['evidence-code-interface'] },
  );
  const feature = input.catalog.features[0];
  feature.flowRefs = ['flow:refund-flow'];
  feature.stateMachineRefs = ['state-machine:refund-state'];
  feature.confirmedEmptyFields = feature.confirmedEmptyFields.filter((field) => !['flowRefs', 'stateMachineRefs'].includes(field));
  input.objects.stateMachines.push(baseNode('refund-state', 'state-machine', '退款申请状态', {
    businessObjectRef: 'data-entity:refund-record',
    dimension: fact('退款申请处理状态', ['evidence-code-interface']),
    stateMode: 'persisted',
    states: [
      { id: 'pending', label: '待提交', claimIds: ['claim-refund-state'], evidenceIds: ['evidence-code-interface'] },
      { id: 'submitted', label: '已提交', claimIds: ['claim-refund-state'], evidenceIds: ['evidence-code-interface'] },
    ],
    transitions: [{ from: 'pending', to: 'submitted', trigger: '退款申请创建成功', claimIds: ['claim-refund-state'], evidenceIds: ['evidence-code-interface'] }],
    unresolvedTransitions: [],
    completeness: 'complete',
    confirmedEmptyFields: ['unresolvedTransitions'],
    subjectRefs: ['feature:order-refund'],
    claimIds: ['claim-refund-state'],
    evidenceIds: ['evidence-code-interface'],
  }));
  input.objects.flows.push(baseNode('refund-flow', 'flow', '退款提交与通知流程', {
    goal: fact('创建退款申请并通知异步处理', ['evidence-catalog-feature']),
    scope: [fact('退款申请提交与事件发布', ['evidence-catalog-feature'])],
    nonScope: [fact('支付渠道退款执行', ['evidence-catalog-feature'])],
    trigger: fact('客服提交退款申请', ['evidence-code-interface']),
    entryRefs: ['operation:submit-refund'],
    phases: [{ id: 'submit', label: '提交申请', order: 1, claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] }],
    lanes: [
      { id: 'operator', label: '客服主管', laneType: 'actor', subjectRef: 'role:customer-service-manager', order: 1, claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
      { id: 'commerce', label: '交易系统', laneType: 'primary-system', subjectRef: 'system:commerce', order: 2, claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
      { id: 'event-bus', label: '退款事件总线', laneType: 'async-infrastructure', subjectRef: 'interface:refund-api', order: 3, claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
    ],
    nodes: [
      { id: 'submit-action', label: '提交退款申请', laneId: 'operator', phaseId: 'submit', nodeType: 'user-action', claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
      { id: 'create-record', label: '创建退款记录', laneId: 'commerce', phaseId: 'submit', nodeType: 'service-action', claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
      { id: 'publish-event', label: '发布退款已提交事件', laneId: 'event-bus', phaseId: 'submit', nodeType: 'result', claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
    ],
    edges: [
      { id: 'submit-request', from: 'submit-action', to: 'create-record', label: '提交申请', pathType: 'main', interactionType: 'sync', condition: '订单满足退款条件', claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
      { id: 'publish-notification', from: 'create-record', to: 'publish-event', label: '发布事件', pathType: 'main', interactionType: 'async', condition: '退款记录创建成功', claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
    ],
    exceptionPaths: [],
    stateMachineRefs: ['state-machine:refund-state'],
    interaction: {
      sequenceGroups: [{ id: 'main', label: '主路径', phaseId: 'submit', pathType: 'main', order: 1, claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] }],
      participants: [
        { id: 'actor', laneId: 'operator', participantType: 'actor', order: 1, claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
        { id: 'service', laneId: 'commerce', participantType: 'service', order: 2, claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
        { id: 'bus', laneId: 'event-bus', participantType: 'message-bus', order: 3, claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
      ],
      messages: [
        { id: 'request', groupId: 'main', from: 'actor', to: 'service', order: 1, label: '提交退款申请', messageType: 'request', edgeRef: 'submit-request', interfaceRef: 'interface:refund-api', ruleRefs: [], claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
        { id: 'response', groupId: 'main', from: 'service', to: 'actor', order: 2, label: '返回退款申请编号', messageType: 'response', interfaceRef: 'interface:refund-api', ruleRefs: [], claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
        { id: 'event', groupId: 'main', from: 'service', to: 'bus', order: 3, label: '发布退款已提交事件', messageType: 'event', edgeRef: 'publish-notification', ruleRefs: [], claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] },
      ],
    },
    viewAssessments: {
      state: { applicability: 'applicable', reason: '退款申请维护持久化状态', evidenceIds: ['evidence-code-interface'], gapIds: [] },
      sequence: { applicability: 'applicable', reason: '流程包含同步请求与异步事件', evidenceIds: ['evidence-code-interface'], gapIds: [] },
    },
    confirmedEmptyFields: ['exceptionPaths'],
    ownerRefs: ['feature:order-refund'],
    subjectRefs: ['feature:order-refund'],
    claimIds: ['claim-flow-goal', 'claim-flow-current'],
    evidenceIds: ['evidence-catalog-feature', 'evidence-code-interface'],
  }));
  return input;
}

function withCompleteRequirement(input) {
  const feature = input.catalog.features[0];
  const requirementEvidence = { id: 'evidence-requirement', sourceId: 'primary-requirements', authority: 'requirement-statement', permissionLayers: ['product'], precision: 'requirement-item', description: '已完成的退款产品需求', locator: 'requirement:REQ-REFUND-001' };
  input.governance.evidence.push(requirementEvidence);
  input.governance.claims.push(
    { id: 'claim-requirement', subjectRef: 'requirement:refund-requirement', layer: 'expected', factLevel: 'confirmed', text: '支持已完成订单退款', evidenceIds: ['evidence-requirement'] },
    { id: 'claim-acceptance', subjectRef: 'acceptance-criteria:refund-submit', layer: 'expected', factLevel: 'confirmed', text: '退款提交验收标准', evidenceIds: ['evidence-requirement'] },
  );
  const requirementRelation = relation('feature:order-refund', 'specified-by', 'requirement:refund-requirement', 'claim-requirement', 'evidence-requirement');
  const acceptanceRelation = relation('feature:order-refund', 'specified-by', 'acceptance-criteria:refund-submit', 'claim-acceptance', 'evidence-requirement');
  input.relationships.push(requirementRelation, acceptanceRelation);
  feature.requirementRefs = ['requirement:refund-requirement'];
  feature.acceptanceCriteriaRefs = ['acceptance-criteria:refund-submit'];
  feature.relationRefs.push(requirementRelation.id, acceptanceRelation.id);
  feature.gapIds = [];
  input.governance.gaps = [];
  input.objects.requirements.push(baseNode('refund-requirement', 'requirement', '订单退款需求', {
    provider: 'tapd',
    externalId: 'REQ-REFUND-001',
    normalizedStatus: 'completed',
    scopeType: 'baseline',
    scopeRef: 'feature:order-refund',
    featureRefs: ['feature:order-refund'],
    relationRefs: [requirementRelation.id],
    claimIds: ['claim-requirement'],
    evidenceIds: ['evidence-requirement'],
  }));
  input.objects.acceptanceCriteria.push(baseNode('refund-submit', 'acceptance-criteria', '提交退款申请', {
    featureRef: 'feature:order-refund',
    requirementRef: 'requirement:refund-requirement',
    decisionId: null,
    operationRefs: ['operation:submit-refund'],
    criterionType: 'normal',
    given: ['订单满足退款条件'],
    when: '客服主管提交退款申请',
    then: ['创建退款申请'],
    relationRefs: [acceptanceRelation.id],
    claimIds: ['claim-acceptance'],
    evidenceIds: ['evidence-requirement'],
  }));
  const requirementSource = input.configuredSources.find((source) => source.id === 'primary-requirements');
  requirementSource.enabled = true;
  requirementSource.scope = { confirmedByUser: true, workspaceId: 'workspace-example', projectId: null, workItemIds: ['REQ-REFUND-001'] };
  input.sourceResults[input.sourceResults.findIndex((result) => result.sourceId === 'primary-requirements')] = sourceResult('primary-requirements', 'requirement', 'tapd');
  input.artifacts.push(createArtifact(artifactEnvelope('requirement', 'primary-requirements', 'tapd', 'tapd-mcp'), {
    scope: { confirmedByUser: true, workspaceId: 'workspace-example', projectId: null, workItemIds: ['REQ-REFUND-001'] },
    queries: [{ id: 'query-refund', tier: 'explicit', terms: ['REQ-REFUND-001'], featureRefs: ['feature:order-refund'] }],
    items: [{
      externalId: 'REQ-REFUND-001',
      title: '订单退款需求',
      itemType: 'product-requirement',
      normalizedStatus: 'completed',
      relevance: 'direct',
      decision: 'adopted',
      relationshipVerified: true,
      featureRefs: ['feature:order-refund'],
      evidenceId: 'evidence-requirement',
      codeEvidenceIds: ['evidence-code-interface'],
    }],
  }));
  return authorizeFixture(input);
}

function withoutDatabaseArtifact(input, status = 'skipped-unavailable') {
  input.sourceResults[input.sourceResults.findIndex((result) => result.sourceId === 'primary-database')] = sourceResult('primary-database', 'database', 'postgres', status);
  input.artifacts = input.artifacts.filter((artifact) => artifact.kind !== 'database-artifact');
  input.governance.evidence = input.governance.evidence.filter((evidence) => evidence.sourceId !== 'primary-database');
  input.governance.evidence = input.governance.evidence.filter((evidence) => evidence.id !== 'evidence-code-metric');
  const codeArtifactIndex = input.artifacts.findIndex((artifact) => artifact.kind === 'code-artifact');
  if (codeArtifactIndex >= 0) {
    const current = input.artifacts[codeArtifactIndex];
    const { schemaVersion, fingerprint, kind, sourceId, capturedAt, sourceRevision, provenance, ...payload } = current;
    payload.facts = payload.facts.filter((fact) => fact.evidenceId !== 'evidence-code-metric');
    input.artifacts[codeArtifactIndex] = createArtifact({ kind, sourceId, capturedAt, sourceRevision, provenance }, payload);
  }
  input.governance.claims = input.governance.claims.filter((claim) => !['claim-data', 'claim-metric', 'claim-permission-data'].includes(claim.id));
  const removedRelations = new Set(input.relationships.filter((item) => (item.type === 'writes' && item.to === 'data-entity:refund-record') || item.type === 'measures').map((item) => item.id));
  input.relationships = input.relationships.filter((item) => !removedRelations.has(item.id));
  input.catalog.features[0].dataEntityRefs = [];
  input.catalog.features[0].metricRefs = [];
  input.catalog.features[0].confirmedEmptyFields.push('dataEntityRefs', 'metricRefs');
  input.catalog.features[0].relationRefs = input.catalog.features[0].relationRefs.filter((id) => !removedRelations.has(id));
  input.objects.permissions[0].rows = input.objects.permissions[0].rows.filter((row) => row.enforcementLayer !== 'data');
  input.objects.permissions[0].claimIds = input.objects.permissions[0].claimIds.filter((id) => id !== 'claim-permission-data');
  input.objects.permissions[0].evidenceIds = input.objects.permissions[0].evidenceIds.filter((id) => id !== 'evidence-database-access');
  input.objects.dataEntities = [];
  input.objects.metrics = [];
  return input;
}

function withDatabaseDrift(input) {
  const databaseSource = input.configuredSources.find((source) => source.id === 'primary-database');
  databaseSource.transports.push({
    id: 'migration-files',
    type: 'migration-files',
    enabled: true,
    priority: 5,
    paths: ['db/migrations'],
  });
  input.artifacts = input.artifacts.filter((artifact) => artifact.kind !== 'database-artifact');
  input.artifacts.push(
    databaseSchemaArtifact('migration-files', 'bigint'),
    databaseSchemaArtifact('read-only-introspection', 'varchar'),
  );
  input.governance.evidence = input.governance.evidence.filter((evidence) => evidence.sourceId !== 'primary-database');
  for (const artifact of input.artifacts.filter((item) => item.kind === 'database-artifact')) {
    for (const collection of ['schemas', 'tables', 'columns', 'accessControls']) {
      for (const item of artifact[collection]) input.governance.evidence.push({
        id: item.evidenceId,
        sourceId: artifact.sourceId,
        authority: 'data-structure-fact',
        permissionLayers: collection === 'accessControls' ? ['data'] : [],
        precision: 'metadata-object',
        factKind: `database:${collection}`,
        artifactObjectRef: item.id,
        description: `${artifact.environment} ${collection}`,
        locator: `database:${artifact.environment}:${collection}:${item.id}`,
      });
    }
  }
  const deployedColumnEvidence = 'evidence-database-column-deployed';
  const deployedAccessEvidence = 'evidence-database-access-deployed';
  input.governance.claims.find((claim) => claim.id === 'claim-data').evidenceIds = [deployedColumnEvidence];
  input.governance.claims.find((claim) => claim.id === 'claim-permission-data').evidenceIds = [deployedAccessEvidence];
  const dataEntity = input.objects.dataEntities[0];
  dataEntity.fields[0].evidenceIds = [deployedColumnEvidence];
  dataEntity.sensitivity.evidenceIds = [deployedColumnEvidence];
  dataEntity.evidenceIds = [deployedColumnEvidence];
  const permission = input.objects.permissions[0];
  permission.rows.find((row) => row.enforcementLayer === 'data').evidenceIds = [deployedAccessEvidence];
  permission.evidenceIds = permission.evidenceIds.map((id) => id === 'evidence-database-access' ? deployedAccessEvidence : id);
  input.sourceResults.find((result) => result.sourceId === 'primary-database').artifactCount = 2;
  return authorizeFixture(input);
}

function withDatabaseMetadataObject(input, collection, item) {
  const index = input.artifacts.findIndex((artifact) => artifact.kind === 'database-artifact');
  const current = input.artifacts[index];
  const { schemaVersion, fingerprint, kind, sourceId, capturedAt, sourceRevision, provenance, ...payload } = current;
  payload[collection] = [...payload[collection], item];
  input.artifacts[index] = createArtifact({ kind, sourceId, capturedAt, sourceRevision, provenance }, payload);
  input.governance.evidence.push({
    id: item.evidenceId,
    sourceId,
    authority: 'data-structure-fact',
    permissionLayers: collection === 'accessControls' ? ['data'] : [],
    precision: 'metadata-object',
    factKind: `database:${collection}`,
    artifactObjectRef: item.id,
    description: `${collection} metadata`,
    locator: `database:${current.environment}:${collection}:${item.id}`,
  });
  return input;
}

function withFeaturePageAndObservationMetric(input) {
  const codeArtifactIndex = input.artifacts.findIndex((artifact) => artifact.kind === 'code-artifact');
  const current = input.artifacts[codeArtifactIndex];
  const { schemaVersion, fingerprint, kind, sourceId, capturedAt, sourceRevision, provenance, ...payload } = current;
  payload.facts = [...payload.facts,
    { id: 'code-fact-page', factKind: 'page', locator: { repositoryId: 'repo-frontend', path: 'src/refund-ui.mjs', precision: 'symbol', startLine: 11, endLine: 20, symbol: 'RefundManagementPage' }, text: '退款管理页面', candidateRefs: ['page:refund-management'], evidenceId: 'evidence-code-page' },
    { id: 'code-fact-observation', factKind: 'task', locator: { repositoryId: 'repo-current', path: 'src/refund.mjs', precision: 'symbol', startLine: 61, endLine: 70, symbol: 'countRefundRequests' }, text: '统计退款申请数量', candidateRefs: ['metric:refund-request-count'], evidenceId: 'evidence-code-observation' },
  ];
  input.artifacts[codeArtifactIndex] = createArtifact({ kind, sourceId, capturedAt, sourceRevision, provenance }, payload);
  input.governance.evidence.push(
    { id: 'evidence-code-page', sourceId: 'current-code', authority: 'implementation-fact', permissionLayers: ['ui'], precision: 'symbol', factKind: 'page', repositorySurface: 'frontend', description: '退款管理页面', locator: 'code:repo-frontend:src/refund-ui.mjs:11-20' },
    { id: 'evidence-code-observation', sourceId: 'current-code', authority: 'implementation-fact', permissionLayers: [], precision: 'symbol', factKind: 'task', repositorySurface: 'backend', description: '退款申请数量统计', locator: 'code:repo-current:src/refund.mjs:61-70' },
  );
  input.governance.claims.push(
    { id: 'claim-page', subjectRef: 'page:refund-management', layer: 'current', factLevel: 'confirmed', text: '系统提供退款管理页面', evidenceIds: ['evidence-code-page'] },
    { id: 'claim-observation', subjectRef: 'metric:refund-request-count', layer: 'current', factLevel: 'confirmed', text: '系统统计退款申请数量', evidenceIds: ['evidence-code-observation'] },
  );
  input.objects.pages.push(baseNode('refund-management', 'page', '退款管理页', {
    route: fact('/orders/refund', ['evidence-code-page']),
    areas: [fact('退款申请列表', ['evidence-code-page'])],
    operationRefs: ['operation:submit-refund'],
    ownerRefs: ['feature:order-refund'],
    subjectRefs: ['feature:order-refund'],
    claimIds: ['claim-page'],
    evidenceIds: ['evidence-code-page'],
  }));
  input.objects.metrics.push(baseNode('refund-request-count', 'metric', '退款申请数量', {
    metricType: 'implementation-count',
    formula: fact('退款申请记录数量', ['evidence-code-observation']),
    unit: 'count',
    dimensions: [fact('业务日期', ['evidence-code-observation'])],
    filters: [],
    timeWindow: 'day',
    baseline: null,
    target: null,
    sourceRefs: ['data-entity:refund-record'],
    refreshPolicy: 'daily',
    confirmedEmptyFields: ['filters', 'baseline', 'target'],
    ownerRefs: ['role:customer-service-manager'],
    subjectRefs: ['feature:order-refund'],
    claimIds: ['claim-observation'],
    evidenceIds: ['evidence-code-observation'],
  }));
  const feature = input.catalog.features[0];
  feature.pageRefs = ['page:refund-management'];
  feature.metricRefs.push('metric:refund-request-count');
  feature.confirmedEmptyFields = feature.confirmedEmptyFields.filter((field) => field !== 'pageRefs');
  return input;
}

test('Mode 4 build renders T16-T21 directory and current managed metadata', () => {
  const build = buildProductWiki(fixture());
  const paths = build.files.map((file) => file.path);
  assert.equal(build.manifest.managedBy, 'yog:wiki');
  assert.equal(build.model.kind, 'yog-product-wiki-model');
  assert.deepEqual(build.model.inputConfirmation, build.model.sourceSnapshot.inputConfirmation);
  assert.deepEqual(build.manifest.inputConfirmation, build.model.inputConfirmation);
  assert.equal(build.model.sourceReadiness.status, 'degraded');
  assert.equal(paths.includes('AGENTS.md'), true);
  assert.equal(paths.includes('目录.md'), true);
  assert.equal(paths.includes('产品目录/交易系统/系统总览.md'), true);
  assert.equal(paths.includes('产品目录/交易系统/订单域/订单管理/订单退款.md'), true);
  assert.equal(paths.some((path) => path.startsWith('知识对象/业务规则/')), true);
  assert.equal(paths.some((path) => path.startsWith('知识对象/数据字典/')), true);
  assert.equal(paths.some((path) => path.startsWith('知识对象/指标口径/')), true);
  assert.equal(paths.some((path) => path.startsWith('知识对象/接口集成/')), true);
  assert.equal(paths.some((path) => path.startsWith('知识对象/角色权限/')), true);
  assert.equal(paths.includes('质量治理/目录覆盖与质量报告.md'), true);
  assert.equal(paths.includes('质量治理/待确认问题.md'), false);
  assert.equal(paths.includes('质量治理/待确认问题/commerce/order-refund.md'), false);
  assert.match(build.files.find((file) => file.path === '目录.md').content, /\[产品审核\]\(质量治理\/产品审核\.md\)/);
  assert.equal(paths.includes('_meta/relationships.json'), true);
  assert.equal(paths.includes('_meta/gaps.json'), true);
  assert.equal(paths.includes('_meta/gaps/commerce.json'), false);
  const catalogIndex = JSON.parse(build.files.find((file) => file.path === '_meta/catalog.json').content);
  assert.equal(catalogIndex.kind, 'yog-product-wiki-catalog-index');
  assert.equal('pages' in catalogIndex, false);
  assert.equal('catalog' in catalogIndex, false);
  assert.deepEqual(catalogIndex.systems.map((system) => system.catalogPath), ['_meta/catalog/commerce.json']);
  const systemCatalog = JSON.parse(build.files.find((file) => file.path === '_meta/catalog/commerce.json').content);
  assert.equal(systemCatalog.kind, 'yog-product-wiki-system-catalog');
  assert.equal(systemCatalog.system.ref, 'system:commerce');
  assert.equal(systemCatalog.entries.some((entry) => entry.ref === 'feature:order-refund' && entry.pagePath.endsWith('/订单退款.md')), true);
  assert.equal(systemCatalog.entries.some((entry) => entry.ref === 'rule:refund-window' && entry.featureRefs.includes('feature:order-refund')), true);
  assert.equal(build.manifest.projections.some((projection) => projection.path === '_meta/catalog/commerce.json'), true);
  const gapIndex = JSON.parse(build.files.find((file) => file.path === '_meta/gaps.json').content);
  assert.equal(gapIndex.kind, 'yog-product-wiki-gap-index');
  assert.deepEqual(gapIndex.systems, []);
  assert.equal(build.files.some((file) => file.path.startsWith('质量治理/待确认问题/')), false);
  const featurePage = build.files.find((file) => file.path.endsWith('/订单退款.md')).content;
  const systemPage = build.files.find((file) => file.path.endsWith('/系统总览.md')).content;
  assert.doesNotMatch(featurePage, /gap-requirement/);
  assert.doesNotMatch(systemPage, /gap-requirement/);
  assert.doesNotMatch(featurePage, /待确认问题（1 项）/);
  assert.match(featurePage, /下一批待产品确认/);
  const featureEvidenceRefs = [...featurePage.matchAll(/^- \[E(\d+)\]/gm)].map((match) => Number(match[1]));
  assert.deepEqual(featureEvidenceRefs, featureEvidenceRefs.map((_, index) => index + 1));
  const coveragePage = build.files.find((file) => file.path === '质量治理/目录覆盖与质量报告.md').content;
  assert.match(coveragePage, /Current Implementation 完整映射/);
  assert.match(coveragePage, /Historical Requirement Readiness/);
  assert.match(coveragePage, /Approved Product Baseline/);
  assert.match(coveragePage, /产品审核进度/);
  assert.match(coveragePage, /缺口口径/);
  assert.match(coveragePage, /ReviewItem 去重诊断/);
  assert.match(coveragePage, /任务可用性/);
  assert.doesNotMatch(coveragePage, /PRD 行为验收覆盖|Acceptance Coverage|行为总数/);
  const agentGuidance = build.files.find((file) => file.path === 'AGENTS.md').content;
  assert.match(agentGuidance, /pageId: wiki-agent-guidance/);
  assert.match(agentGuidance, /pageType: agent-guidance/);
  assert.match(agentGuidance, /先读取 `_meta\/catalog\.json`/);
  assert.match(agentGuidance, /不要全文读取、输出或 `cat _meta\/model\.json`/);
  assert.match(agentGuidance, /不要一次性全文加载 Claims、Relationships 或 Evidence/);
  assert.match(agentGuidance, /`_meta\/gaps\.json`/);
  assert.match(agentGuidance, /`_meta\/reviews\.json`/);
  assert.match(agentGuidance, /每次只处理一个 ReviewItem/);
  assert.equal(build.model.pages.some((page) => page.path === 'AGENTS.md'), true);
  assert.equal(build.manifest.pages.some((page) => page.path === 'AGENTS.md'), true);
  const prd = build.files.find((file) => file.path.endsWith('/订单退款.md')).content;
  assert.match(prd, /## 01 功能全貌/);
  assert.match(prd, /## 02 当前实现/);
  assert.match(prd, /## 06 下一批待产品确认/);
  assert.equal(build.files.some((file) => file.path === '质量治理/产品审核/commerce/order-refund.md'), true);
  assert.equal(build.files.some((file) => file.path === '_meta/reviews.json'), true);
  assert.match(prd, /<a id="review-/);
  assert.doesNotMatch(JSON.stringify(build.model), /\/Users\//);
});

test('Feature Page, Operation, and non-success Metric are routed to stable anchors without standalone files', () => {
  const build = buildProductWiki(withFeaturePageAndObservationMetric(fixture()));
  const paths = build.files.map((file) => file.path);
  assert.equal(paths.some((path) => path.startsWith('知识对象/页面与操作/')), false);
  assert.equal(paths.some((path) => path.includes('refund-request-count')), false);
  assert.equal(paths.some((path) => path.includes('refund-rate')), true);
  const featurePage = build.files.find((file) => file.path.endsWith('/订单退款.md'));
  assert.match(featurePage.content, /### 页面入口/);
  assert.match(featurePage.content, /<a id="page-refund-management"><\/a>/);
  assert.match(featurePage.content, /<a id="operation-submit-refund"><\/a>/);
  assert.match(featurePage.content, /<a id="metric-refund-request-count"><\/a>/);
  assert.match(featurePage.content, /非产品成功指标/);
  const shard = JSON.parse(build.files.find((file) => file.path === '_meta/catalog/commerce.json').content);
  const pageEntry = shard.entries.find((entry) => entry.ref === 'page:refund-management');
  assert.equal(pageEntry.pagePath, featurePage.path);
  assert.equal(pageEntry.anchor, 'page-refund-management');
  assert.equal(featurePage.content.match(/code:repo-current:src\/refund\.mjs:1-20/g)?.length, 1);
  assert.match(featurePage.content, /\[E\d+\]/);
  assert.match(featurePage.content, /## 证据索引/);
});

test('Inline object without Feature, Flow, or System route fails closed', () => {
  const input = withFeaturePageAndObservationMetric(fixture());
  input.objects.pages[0].subjectRefs = [];
  input.objects.pages[0].ownerRefs = [];
  input.catalog.features[0].pageRefs = [];
  input.catalog.features[0].confirmedEmptyFields.push('pageRefs');
  assert.throws(() => buildProductWiki(input), (error) => error.code === 'wiki-object-projection-route-missing');
});

test('Catalog index splits by System and marks shared entry pointers without duplicating models', () => {
  const model = structuredClone(buildProductWiki(fixture()).model);
  model.catalog.systems.push({
    id: 'support', kind: 'system', name: '支持系统', status: 'confirmed', order: 50,
    domainRefs: ['domain:support-domain'], ownerRefs: [],
  });
  model.catalog.domains.push({
    id: 'support-domain', kind: 'domain', name: '支持域', status: 'confirmed', order: 60,
    parentRef: 'system:support', moduleRefs: ['module:support-module'], ownerRefs: [],
  });
  model.catalog.modules.push({
    id: 'support-module', kind: 'module', name: '支持模块', status: 'confirmed', order: 70,
    parentRef: 'domain:support-domain', featureRefs: ['feature:support-case'], ownerRefs: [], entryRefs: [],
  });
  model.catalog.features.push({
    id: 'support-case', kind: 'feature', name: '支持工单', status: 'confirmed', order: 80,
    parentRef: 'module:support-module', pageRefs: [], operationRefs: [], scenarioRefs: [], flowRefs: [],
    stateMachineRefs: [], ruleRefs: [], roleRefs: ['role:customer-service-manager'], permissionRefs: [],
    dataEntityRefs: [], metricRefs: [], interfaceRefs: [], requirementRefs: [], acceptanceCriteriaRefs: [], versionRefs: [],
  });

  const projections = buildCatalogIndexProjections(model);
  const root = projections.find((projection) => projection.path === '_meta/catalog.json').value;
  assert.deepEqual(root.systems.map((system) => system.catalogPath), [
    '_meta/catalog/commerce.json',
    '_meta/catalog/support.json',
  ]);
  const commerce = projections.find((projection) => projection.path === '_meta/catalog/commerce.json').value;
  const support = projections.find((projection) => projection.path === '_meta/catalog/support.json').value;
  assert.equal(commerce.entries.find((entry) => entry.ref === 'role:customer-service-manager').shared, true);
  assert.equal(support.entries.find((entry) => entry.ref === 'role:customer-service-manager').shared, true);
  assert.equal(support.entries.find((entry) => entry.ref === 'feature:support-case').pagePath, '产品目录/支持系统/支持域/支持模块/支持工单.md');
  assert.equal('purpose' in support.entries.find((entry) => entry.ref === 'feature:support-case'), false);

  model.catalog.features[0].flowRefs = ['flow:shared-service-flow'];
  model.catalog.features[1].flowRefs = ['flow:shared-service-flow'];
  model.objects.flows.push({
    id: 'shared-service-flow', kind: 'flow', name: '跨系统协作流程', status: 'confirmed', order: 90,
    goal: '完成跨系统协作', entryRefs: [], lanes: [], subjectRefs: ['feature:order-refund', 'feature:support-case'],
  });
  const flowProjections = buildFlowIndexProjections(model);
  const flowRoot = flowProjections.find((projection) => projection.path === '_meta/flows.json').value;
  assert.deepEqual(flowRoot.systems.map((system) => system.flowCatalogPath), ['_meta/flows/commerce.json', '_meta/flows/support.json']);
  for (const path of ['_meta/flows/commerce.json', '_meta/flows/support.json']) {
    const entry = flowProjections.find((projection) => projection.path === path).value.entries[0];
    assert.equal(entry.ref, 'flow:shared-service-flow');
    assert.equal(entry.shared, true);
    assert.equal('nodes' in entry, false);
  }
});

test('Mode 4 library entry rejects direct calls without the exact confirmed input target', () => {
  const missing = fixture();
  delete missing.inputConfirmation;
  assert.throws(() => buildProductWiki(missing), (error) => error.code === 'wiki-source-scope-unconfirmed');

  const moved = fixture();
  moved.outputRoot = tempRoot();
  assert.throws(() => buildProductWiki(moved), (error) => error.code === 'wiki-source-scope-unconfirmed');

  const unknownSourceField = fixture();
  unknownSourceField.configuredSources[0].unexpected = true;
  assert.throws(() => buildProductWiki(unknownSourceField), (error) => error.code === 'yog-config-schema-invalid');
});

test('Mode 4 renders dedicated readable Role, Permission, Data, Interface, and Flow pages', () => {
  const input = withThreeViewFlow(fixture());
  const build = buildProductWiki(input);
  const markdownObjects = build.files.filter((file) => file.path.startsWith('知识对象/') && file.path.endsWith('.md'));
  assert.equal(markdownObjects.some((file) => file.path.includes('/角色权限/') && file.path.includes('customer-service-manager')), true);
  assert.equal(markdownObjects.some((file) => file.path.includes('/角色权限/') && file.content.includes('| 角色 | 资源 | 操作 | 执行层 |')), true);
  assert.equal(markdownObjects.some((file) => file.path.includes('/数据字典/') && file.content.includes('| 字段 | 类型 | 可空 |')), true);
  assert.equal(markdownObjects.some((file) => file.path.includes('/接口集成/') && file.content.includes('| Method | Path | 用途 |')), true);
  assert.equal(markdownObjects.some((file) => file.path.includes('/业务流程/') && file.content.includes('```mermaid\nflowchart LR')), true);
  assert.equal(markdownObjects.some((file) => file.content.includes('```json')), false);
  assert.equal(markdownObjects.some((file) => /\b(?:claimIds|evidenceIds)\b/.test(file.content.replace(/^---[\s\S]*?---\n/, ''))), false);
});

test('Mode 4 renders one evidenced Flow into overview, Current state, sequence, directory, and two-level indexes', () => {
  const build = buildProductWiki(withThreeViewFlow(fixture()));
  const flowPage = build.files.find((file) => file.path.includes('/业务流程/') && file.path.endsWith('退款提交与通知流程.md'));
  assert.ok(flowPage);
  for (const heading of ['业务目标与范围', '证据状态', '完整业务流程图', '核心状态流转', '系统协作时序', '入口与参与者', '主路径、分支与异常', '关键业务节点', '证据', '待确认问题']) {
    assert.match(flowPage.content, new RegExp(`## ${heading}`));
  }
  assert.match(flowPage.content, /flowchart LR/);
  assert.match(flowPage.content, /stateDiagram-v2/);
  assert.match(flowPage.content, /sequenceDiagram/);
  assert.match(flowPage.content, /发布退款已提交事件［event］/);
  assert.match(flowPage.content, /async/);
  assert.doesNotMatch(flowPage.content.replace(/^---[\s\S]*?---\n/, ''), /claim-flow|evidence-code/);

  const statePage = build.files.find((file) => file.path.includes('/状态模型/'));
  const stateBlock = (content) => content.match(/```mermaid\nstateDiagram-v2[\s\S]*?```/)?.[0];
  assert.equal(stateBlock(flowPage.content), stateBlock(statePage.content));

  const directory = build.files.find((file) => file.path === '知识对象/业务流程/目录.md').content;
  assert.match(directory, /退款提交与通知流程/);
  const flowIndex = JSON.parse(build.files.find((file) => file.path === '_meta/flows.json').content);
  assert.deepEqual(flowIndex.systems, [{ systemRef: 'system:commerce', flowCount: 1, flowCatalogPath: '_meta/flows/commerce.json' }]);
  const flowShard = JSON.parse(build.files.find((file) => file.path === '_meta/flows/commerce.json').content);
  assert.equal(flowShard.entries[0].ref, 'flow:refund-flow');
  assert.equal('nodes' in flowShard.entries[0], false);
  assert.equal(build.manifest.projections.some((projection) => projection.path === '_meta/flows/commerce.json'), true);
  assert.deepEqual(build.model.governance.coverage.flows.overview, { covered: 1, total: 1, rate: 100, coveredRefs: ['flow:refund-flow'], uncoveredRefs: [] });
  assert.equal(build.model.governance.coverage.flows.state.covered, 1);
  assert.equal(build.model.governance.coverage.flows.sequence.covered, 1);
  assert.match(build.files.find((file) => file.path.endsWith('/系统总览.md')).content, /核心业务流程/);
  assert.match(build.files.find((file) => file.path.endsWith('/订单退款.md')).content, /退款提交与通知流程/);
});

test('System-level Flow is discoverable without creating or renaming a Catalog Feature', () => {
  const input = withThreeViewFlow(fixture());
  input.catalog.features[0].flowRefs = [];
  input.catalog.features[0].confirmedEmptyFields.push('flowRefs');
  input.objects.flows[0].ownerRefs = [];
  input.objects.flows[0].subjectRefs = ['system:commerce'];
  const build = buildProductWiki(input);
  assert.deepEqual(build.model.catalog.features.map((feature) => feature.name), ['订单退款']);
  const systemPage = build.files.find((file) => file.path === '产品目录/交易系统/系统总览.md').content;
  assert.match(systemPage, /退款提交与通知流程/);
  assert.match(systemPage, /页面与操作已按业务流程聚合/);
  assert.doesNotMatch(systemPage, /暂无已确认页面入口|暂无已确认功能操作/);
  assert.match(build.files.find((file) => file.path === '知识对象/业务流程/目录.md').content, /退款提交与通知流程/);
  const flowShard = JSON.parse(build.files.find((file) => file.path === '_meta/flows/commerce.json').content);
  assert.equal(flowShard.entries.some((entry) => entry.name === '退款提交与通知流程'), true);
});

test('Flow depth gate rejects a three-node local template and accepts a three-node callback flow', () => {
  const template = withThreeViewFlow(fixture());
  const templateFlow = template.objects.flows[0];
  templateFlow.lanes = templateFlow.lanes.filter((lane) => ['operator', 'commerce'].includes(lane.id));
  templateFlow.nodes.find((node) => node.id === 'publish-event').laneId = 'commerce';
  templateFlow.edges.find((edge) => edge.id === 'publish-notification').interactionType = 'local';
  templateFlow.stateMachineRefs = [];
  templateFlow.viewAssessments.state = { applicability: 'not-applicable', reason: '模板不维护独立状态', evidenceIds: ['evidence-code-interface'], gapIds: [] };
  templateFlow.interaction = { sequenceGroups: [], participants: [], messages: [] };
  templateFlow.viewAssessments.sequence = { applicability: 'not-applicable', reason: '模板无系统协作时序', evidenceIds: ['evidence-code-interface'], gapIds: [] };
  template.objects.stateMachines = [];
  template.governance.claims = template.governance.claims.filter((claim) => claim.id !== 'claim-refund-state');
  template.catalog.features[0].stateMachineRefs = [];
  template.catalog.features[0].confirmedEmptyFields.push('stateMachineRefs');
  assert.throws(() => buildProductWiki(template), (error) => error.code === 'wiki-flow-business-depth-insufficient');

  const callback = withThreeViewFlow(fixture());
  callback.objects.flows[0].interaction.messages.push({
    id: 'callback', groupId: 'main', from: 'bus', to: 'service', order: 4,
    label: '回调退款事件处理结果', messageType: 'callback', causationMessageRef: 'event',
    ruleRefs: [], claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'],
  });
  assert.doesNotThrow(() => buildProductWiki(callback));
});

test('Mode 4 Flow validation fails closed for phase, message proof, callback causation, and Mermaid injection', () => {
  const missingPhase = withThreeViewFlow(fixture());
  missingPhase.objects.flows[0].nodes[0].phaseId = 'missing';
  assert.throws(() => buildProductWiki(missingPhase), (error) => error.code === 'wiki-flow-phase-reference-missing' && error.path.endsWith('.phaseId'));

  const missingEvidence = withThreeViewFlow(fixture());
  missingEvidence.objects.flows[0].interaction.messages[0].evidenceIds = [];
  assert.throws(() => buildProductWiki(missingEvidence), (error) => error.code === 'wiki-structured-entry-evidence-required' && error.path.includes('.interaction.messages[0]'));

  const invalidCallback = withThreeViewFlow(fixture());
  invalidCallback.objects.flows[0].interaction.messages.push({ id: 'callback', groupId: 'main', from: 'bus', to: 'service', order: 4, label: '回调处理结果', messageType: 'callback', ruleRefs: [], claimIds: ['claim-flow-current'], evidenceIds: ['evidence-code-interface'] });
  assert.throws(() => buildProductWiki(invalidCallback), (error) => error.code === 'wiki-flow-callback-cause-invalid');

  const inventedGuarantee = withThreeViewFlow(fixture());
  inventedGuarantee.objects.flows[0].interaction.messages[2].label = '发布事件并保证重复投递幂等';
  assert.throws(() => buildProductWiki(inventedGuarantee), (error) => error.code === 'wiki-flow-message-guarantee-evidence-required');

  const hostile = withThreeViewFlow(fixture());
  hostile.objects.flows[0].nodes[0].label = '提交"]\nInjected --> node["危险';
  const page = buildProductWiki(hostile).files.find((file) => file.path.includes('/业务流程/') && file.path.endsWith('退款提交与通知流程.md')).content;
  assert.doesNotMatch(page, /提交"]\nInjected/);
  assert.match(page, /提交'］ Injected --＞ node［'危险/);

  const partial = withThreeViewFlow(fixture());
  partial.governance.claims.find((claim) => claim.id === 'claim-flow-current').factLevel = 'partial';
  const partialBuild = buildProductWiki(partial);
  const partialPage = partialBuild.files.find((file) => file.path.includes('/业务流程/') && file.path.endsWith('退款提交与通知流程.md')).content;
  assert.match(partialPage, /部分确认/);
  assert.match(partialPage, /classDef partial/);
  assert.equal(partialBuild.model.governance.coverage.flows.overview.covered, 0);
  assert.equal(partialBuild.model.governance.coverage.flows.state.covered, 1);
  assert.equal(partialBuild.model.governance.coverage.flows.sequence.covered, 0);

  const needsReview = withThreeViewFlow(fixture());
  needsReview.governance.claims.find((claim) => claim.id === 'claim-flow-current').factLevel = 'needs-review';
  assert.throws(() => buildProductWiki(needsReview), (error) => error.code === 'wiki-flow-current-path-required');
});

test('Mode 4 requires governed empty fields and computes subject-level page publication', () => {
  const missingGap = fixture();
  missingGap.objects.metrics[0].confirmedEmptyFields = [];
  assert.throws(() => buildProductWiki(missingGap), (error) => error.code === 'wiki-object-field-gap-required');

  const missingOwner = fixture();
  missingOwner.catalog.systems[0].ownerRefs = [];
  const ownerOptionalBuild = buildProductWiki(missingOwner);
  const systemPage = ownerOptionalBuild.files.find((file) => file.path.endsWith('/系统总览.md')).content;
  assert.match(systemPage, /负责人：待确认/);
  assert.equal(ownerOptionalBuild.model.governance.gaps.some((gap) => gap.fieldRefs.some((field) => field.endsWith('.ownerRefs'))), false);

  const build = buildProductWiki(fixture());
  const featurePage = build.files.find((file) => file.path.endsWith('/订单退款.md')).content;
  const rolePage = build.files.find((file) => file.path.includes('/角色权限/') && file.path.includes('customer-service-manager')).content;
  assert.match(featurePage, /status: product-review-draft/);
  assert.match(rolePage, /status: publishable/);
  assert.notEqual(build.manifest.publication.status, 'publishable');
});

test('Mode 4 PRD completeness requires baseline requirements and Operation acceptance coverage', () => {
  const partialHistory = withCompleteRequirement(fixture());
  partialHistory.objects.requirements[0].scopeType = 'enhancement';
  partialHistory.governance.gaps.push(actionableGap({ id: 'gap-partial-history', type: 'acceptance-gap', audience: 'product-review', severity: 'P1', status: 'open', description: '历史增强需求不能代表功能基线', subjectRefs: ['feature:order-refund'], fieldRefs: ['feature:order-refund.acceptanceCriteriaRefs'], evidenceIds: ['evidence-requirement'] }));
  partialHistory.catalog.features[0].gapIds.push('gap-partial-history');
  const partialBuild = buildProductWiki(partialHistory);
  assert.equal(partialBuild.model.governance.coverage.featurePrd.complete, 0);
  assert.doesNotMatch(partialBuild.files.find((file) => file.path.endsWith('/订单退款.md')).content, /行为验收覆盖矩阵/);

  const uncovered = withCompleteRequirement(fixture());
  uncovered.objects.acceptanceCriteria[0].operationRefs = [];
  assert.throws(() => buildProductWiki(uncovered), (error) => error.code === 'wiki-object-field-gap-required');

  const unconfirmedDefinition = withCompleteRequirement(fixture());
  unconfirmedDefinition.governance.claims.find((claim) => claim.id === 'claim-acceptance').factLevel = 'partial';
  const unconfirmedBuild = buildProductWiki(unconfirmedDefinition);
  assert.equal(unconfirmedBuild.model.governance.coverage.featurePrd.complete, 0);
  assert.match(unconfirmedBuild.files.find((file) => file.path.endsWith('/订单退款.md')).content, /status: product-review-draft/);
});

test('Mode 4 validator rejects source authority, relationship direction, and data assessment aliases', () => {
  const authority = fixture();
  authority.governance.evidence.find((item) => item.id === 'evidence-database').authority = 'implementation-fact';
  assert.throws(() => buildProductWiki(authority), (error) => error.code === 'wiki-evidence-authority-invalid');
  const direction = fixture();
  const target = direction.relationships.find((item) => item.type === 'contains');
  [target.from, target.to] = [target.to, target.from];
  target.id = __private.relationId(target.from, target.type, target.to);
  assert.throws(() => buildProductWiki(direction), (error) => error.code === 'wiki-relationship-direction-invalid');
  const alias = fixture();
  const feature = alias.catalog.features[0];
  feature.dataApplicability = feature.dataSourceAssessment;
  delete feature.dataSourceAssessment;
  assert.throws(() => buildProductWiki(alias), (error) => error.code === 'wiki-object-field-required');
  const databaseOverreach = fixture();
  databaseOverreach.governance.claims.find((claim) => claim.id === 'claim-rule').evidenceIds = ['evidence-database'];
  assert.throws(() => buildProductWiki(databaseOverreach), (error) => error.code === 'wiki-evidence-authority-subject-invalid');
});

test('Evidence validator rejects frontend API promotion, file-level behavior confirmation, and Database field mismatch', () => {
  const frontendAsApi = withFeaturePageAndObservationMetric(fixture());
  frontendAsApi.governance.evidence.find((evidence) => evidence.id === 'evidence-code-page').permissionLayers = ['api'];
  assert.throws(() => buildProductWiki(frontendAsApi), (error) => error.code === 'wiki-evidence-artifact-mismatch');

  const fileLevel = fixture();
  const codeArtifactIndex = fileLevel.artifacts.findIndex((artifact) => artifact.kind === 'code-artifact');
  const current = fileLevel.artifacts[codeArtifactIndex];
  const { schemaVersion, fingerprint, kind, sourceId, capturedAt, sourceRevision, provenance, ...payload } = current;
  payload.facts = payload.facts.map((fact) => fact.evidenceId === 'evidence-code-interface'
    ? { ...fact, locator: { repositoryId: 'repo-current', path: 'src/refund.mjs', precision: 'file' } }
    : fact);
  fileLevel.artifacts[codeArtifactIndex] = createArtifact({ kind, sourceId, capturedAt, sourceRevision, provenance }, payload);
  const fileEvidence = fileLevel.governance.evidence.find((evidence) => evidence.id === 'evidence-code-interface');
  fileEvidence.precision = 'file';
  fileEvidence.locator = 'code:repo-current:src/refund.mjs';
  assert.throws(() => buildProductWiki(fileLevel), (error) => error.code === 'wiki-evidence-precision-invalid');

  const wrongColumn = fixture();
  wrongColumn.objects.dataEntities[0].fields[0].evidenceIds = ['evidence-database-table'];
  assert.throws(() => buildProductWiki(wrongColumn), (error) => error.code === 'wiki-data-field-evidence-mismatch');
});

test('Mode 4 State Machine validates registered modes, evidenced states, and transition topology', () => {
  const input = fixture();
  const stateRelation = relation('state-machine:refund-lifecycle', 'applies-to', 'feature:order-refund', 'claim-state', 'evidence-code-rule');
  input.relationships.push(stateRelation);
  input.governance.claims.push({ id: 'claim-state', subjectRef: 'state-machine:refund-lifecycle', layer: 'current', factLevel: 'confirmed', text: '退款申请从草稿进入已提交', evidenceIds: ['evidence-code-rule'] });
  input.catalog.features[0].stateMachineRefs = ['state-machine:refund-lifecycle'];
  input.catalog.features[0].confirmedEmptyFields = input.catalog.features[0].confirmedEmptyFields.filter((field) => field !== 'stateMachineRefs');
  input.catalog.features[0].relationRefs.push(stateRelation.id);
  input.objects.stateMachines.push(baseNode('refund-lifecycle', 'state-machine', '退款申请生命周期', {
    businessObjectRef: 'data-entity:refund-record',
    dimension: fact('申请状态', ['evidence-code-rule']),
    stateMode: 'persisted',
    states: [
      { id: 'draft', label: '草稿', claimIds: ['claim-state'], evidenceIds: ['evidence-code-rule'] },
      { id: 'submitted', label: '已提交', claimIds: ['claim-state'], evidenceIds: ['evidence-code-rule'] },
    ],
    transitions: [{ from: 'draft', to: 'submitted', trigger: '提交退款申请', claimIds: ['claim-state'], evidenceIds: ['evidence-code-rule'] }],
    unresolvedTransitions: [],
    completeness: 'complete',
    confirmedEmptyFields: ['unresolvedTransitions'],
    subjectRefs: ['feature:order-refund'],
    relationRefs: [stateRelation.id],
    claimIds: ['claim-state'],
    evidenceIds: ['evidence-code-rule'],
  }));
  const build = buildProductWiki(input);
  assert.equal(build.files.some((file) => file.path.startsWith('知识对象/状态模型/')), true);
  assert.match(build.files.find((file) => file.path.startsWith('知识对象/状态模型/')).content, /```mermaid\nstateDiagram-v2/);

  const broken = structuredClone(input);
  broken.objects.stateMachines[0].transitions[0].to = 'approved';
  assert.throws(() => buildProductWiki(broken), (error) => error.code === 'wiki-state-reference-missing');
  const incomplete = structuredClone(input);
  incomplete.objects.stateMachines[0].unresolvedTransitions = [{ description: '撤回终点待确认' }];
  incomplete.objects.stateMachines[0].confirmedEmptyFields = [];
  assert.throws(() => buildProductWiki(incomplete), (error) => error.code === 'wiki-state-completeness-invalid');
});

test('Mode 4 validates structured entry evidence and Atomic Acceptance Criteria joins', () => {
  const complete = withCompleteRequirement(fixture());
  const build = buildProductWiki(complete);
  assert.equal(build.manifest.publication.status, 'publishable');
  const prd = build.files.find((file) => file.path.endsWith('/订单退款.md')).content;
  assert.match(prd, /类型：normal/);
  assert.match(prd, /Given：订单满足退款条件/);
  assert.match(prd, /Then：创建退款申请/);
  const coverage = build.files.find((file) => file.path === '质量治理/目录覆盖与质量报告.md').content;
  assert.match(coverage, /1\/1/);
  assert.match(coverage, /publishable/);

  const incomplete = withCompleteRequirement(fixture());
  incomplete.objects.acceptanceCriteria[0].then = [];
  assert.throws(() => buildProductWiki(incomplete), (error) => error.code === 'wiki-object-field-gap-required');

  const permissionWithoutEvidence = fixture();
  permissionWithoutEvidence.objects.permissions[0].rows[0].evidenceIds = [];
  assert.throws(() => buildProductWiki(permissionWithoutEvidence), (error) => error.code === 'wiki-structured-entry-evidence-required');

  const frontendEvidenceAsApi = fixture();
  const apiRow = frontendEvidenceAsApi.objects.permissions[0].rows.find((row) => row.enforcementLayer === 'api');
  apiRow.claimIds = ['claim-permission-ui'];
  apiRow.evidenceIds = ['evidence-code-permission-ui'];
  assert.throws(() => buildProductWiki(frontendEvidenceAsApi), (error) => error.code === 'wiki-permission-evidence-layer-invalid');

  const dataFieldWithUnknownClaim = fixture();
  dataFieldWithUnknownClaim.objects.dataEntities[0].fields[0].claimIds = ['claim-missing'];
  assert.throws(() => buildProductWiki(dataFieldWithUnknownClaim), (error) => error.code === 'wiki-claim-reference-missing');

  for (const field of ['name', 'auth', 'request', 'response', 'idempotency']) {
    const emptyEndpointField = fixture();
    emptyEndpointField.objects.interfaces[0].endpoints[0][field] = '';
    assert.throws(() => buildProductWiki(emptyEndpointField), (error) => error.code === 'wiki-model-invalid');
  }
  for (const field of ['condition', 'meaning']) {
    const emptyErrorField = fixture();
    emptyErrorField.objects.interfaces[0].endpoints[0].errors[0][field] = '';
    assert.throws(() => buildProductWiki(emptyErrorField), (error) => error.code === 'wiki-model-invalid');
  }

  const incompletePermission = withCompleteRequirement(fixture());
  incompletePermission.objects.permissions[0].rows = incompletePermission.objects.permissions[0].rows.filter((row) => row.enforcementLayer === 'api');
  const incompletePermissionBuild = buildProductWiki(incompletePermission);
  assert.equal(incompletePermissionBuild.manifest.publication.status, 'partially-publishable');
  assert.deepEqual(incompletePermissionBuild.model.governance.coverage.permissions.missingEnforcementLayers, ['product', 'ui', 'data']);
  assert.deepEqual(incompletePermissionBuild.manifest.publication.blockingObjectRefs, ['permission:refund-permission']);
});

test('Mode 4 computes Permission coverage per applicable Role and downgrades incomplete Permission pages', () => {
  const multiRole = withCompleteRequirement(fixture());
  multiRole.objects.roles.push(baseNode('refund-viewer', 'role', '退款查看人员', {
    roleType: 'business',
    responsibilities: [fact('查看退款申请', ['evidence-code-permission'])],
    scopeRefs: ['feature:order-refund'],
    operationRefs: ['operation:submit-refund'],
    claimIds: ['claim-permission'],
    evidenceIds: ['evidence-code-permission'],
  }));
  multiRole.catalog.features[0].roleRefs.push('role:refund-viewer');
  multiRole.objects.permissions[0].rows.push({
    roleRef: 'role:refund-viewer',
    resourceRef: 'feature:order-refund',
    action: '查看退款',
    enforcementLayer: 'product',
    dataScope: 'organization',
    condition: '具备退款查看职责',
    decision: 'allow',
    claimIds: ['claim-permission-product'],
    evidenceIds: ['evidence-catalog-feature'],
  });

  const build = buildProductWiki(multiRole);
  const permissions = build.model.governance.coverage.permissions;
  const viewerCoverage = permissions.permissionRoleCoverage.find((item) => item.roleRef === 'role:refund-viewer');
  assert.deepEqual(permissions.enforcementLayers, { product: 2, ui: 1, api: 1, data: 1 });
  assert.deepEqual(viewerCoverage.missingEnforcementLayers, ['ui', 'api', 'data']);
  assert.equal(viewerCoverage.complete, false);
  assert.equal(permissions.complete, false);
  assert.deepEqual(build.manifest.publication.blockingObjectRefs, ['permission:refund-permission']);
  const permissionPage = build.files.find((file) => file.path.includes('/角色权限/') && file.path.includes('refund-permission')).content;
  assert.match(permissionPage, /status: product-review-draft/);
  const coveragePage = build.files.find((file) => file.path === '质量治理/目录覆盖与质量报告.md').content;
  assert.match(coveragePage, /退款权限矩阵 \| 退款查看人员 \| 有（1） \| 缺失 \| 缺失 \| 缺失/);
  assert.match(coveragePage, /权限覆盖结论：不完整/);

  const zeroRows = withCompleteRequirement(fixture());
  zeroRows.objects.roles.push(baseNode('refund-viewer', 'role', '退款查看人员', {
    roleType: 'business',
    responsibilities: [fact('查看退款申请', ['evidence-code-permission'])],
    scopeRefs: ['feature:order-refund'],
    operationRefs: ['operation:submit-refund'],
    claimIds: ['claim-permission'],
    evidenceIds: ['evidence-code-permission'],
  }));
  const zeroRowsBuild = buildProductWiki(zeroRows);
  assert.deepEqual(zeroRowsBuild.model.governance.coverage.permissions.uncoveredRoleRefs, ['role:refund-viewer']);
  assert.deepEqual(zeroRowsBuild.model.governance.coverage.permissions.permissionRoleCoverage
    .find((item) => item.roleRef === 'role:refund-viewer').missingEnforcementLayers, ['product', 'ui', 'api', 'data']);
  assert.deepEqual(zeroRowsBuild.manifest.publication.blockingObjectRefs, ['permission:refund-permission']);

  const unrelatedRole = withCompleteRequirement(fixture());
  unrelatedRole.objects.roles.push(baseNode('platform-auditor', 'role', '平台审计人员', {
    roleType: 'internal',
    responsibilities: [fact('审计系统配置', ['evidence-code-permission'])],
    scopeRefs: ['system:commerce'],
    operationRefs: [],
    confirmedEmptyFields: ['operationRefs'],
    claimIds: ['claim-permission'],
    evidenceIds: ['evidence-code-permission'],
  }));
  const unrelatedBuild = buildProductWiki(unrelatedRole);
  assert.equal(unrelatedBuild.model.governance.coverage.permissions.declaredRoles, 2);
  assert.equal(unrelatedBuild.model.governance.coverage.permissions.totalRoles, 1);
  assert.deepEqual(unrelatedBuild.model.governance.coverage.permissions.uncoveredRoleRefs, []);
  assert.equal(unrelatedBuild.model.governance.coverage.permissions.complete, true);
  assert.equal(unrelatedBuild.manifest.publication.status, 'publishable');

  const operationScope = withCompleteRequirement(fixture());
  operationScope.objects.permissions[0].subjectRefs = ['operation:submit-refund'];
  operationScope.objects.permissions[0].rows.forEach((row) => { row.resourceRef = 'operation:submit-refund'; });
  const operationBuild = buildProductWiki(operationScope);
  assert.deepEqual(operationBuild.model.governance.coverage.permissions.permissionDetails[0].applicableRoleRefs, ['role:customer-service-manager']);
  assert.equal(operationBuild.model.governance.coverage.permissions.complete, true);

  const borrowedLayers = withCompleteRequirement(fixture());
  borrowedLayers.objects.permissions[0].subjectRefs = ['operation:submit-refund'];
  const borrowedBuild = buildProductWiki(borrowedLayers);
  assert.equal(borrowedBuild.model.governance.coverage.permissions.enforcementLayers.product, 0);
  assert.equal(borrowedBuild.model.governance.coverage.permissions.enforcementLayers.data, 0);
  assert.equal(borrowedBuild.model.governance.coverage.permissions.outOfScopeRows, 2);
  assert.deepEqual(borrowedBuild.model.governance.coverage.permissions.permissionDetails[0].outOfScopeResourceRefs, ['data-entity:refund-record', 'feature:order-refund']);
  assert.equal(borrowedBuild.model.governance.coverage.permissions.complete, false);
  assert.deepEqual(borrowedBuild.manifest.publication.blockingObjectRefs, ['permission:refund-permission']);

  const systemScope = withCompleteRequirement(fixture());
  systemScope.objects.permissions[0].subjectRefs = ['system:commerce'];
  systemScope.objects.roles[0].scopeRefs = ['system:commerce'];
  systemScope.objects.interfaces[0].subjectRefs = ['system:commerce'];
  const apiRow = systemScope.objects.permissions[0].rows.find((row) => row.enforcementLayer === 'api');
  apiRow.resourceRef = 'interface:refund-api';
  systemScope.objects.permissions[0].rows = [apiRow];
  const systemScopeBuild = buildProductWiki(systemScope);
  assert.equal(systemScopeBuild.model.governance.coverage.permissions.enforcementLayers.api, 1);
  assert.equal(systemScopeBuild.model.governance.coverage.permissions.outOfScopeRows, 0);
  assert.deepEqual(systemScopeBuild.model.governance.coverage.permissions.permissionDetails[0].outOfScopeResourceRefs, []);

  const noPermission = withCompleteRequirement(fixture());
  const permissionRelationIds = new Set(noPermission.relationships
    .filter((item) => item.from === 'permission:refund-permission')
    .map((item) => item.id));
  noPermission.relationships = noPermission.relationships.filter((item) => !permissionRelationIds.has(item.id));
  noPermission.catalog.features[0].relationRefs = noPermission.catalog.features[0].relationRefs
    .filter((id) => !permissionRelationIds.has(id));
  noPermission.catalog.features[0].permissionRefs = [];
  noPermission.catalog.features[0].confirmedEmptyFields.push('permissionRefs');
  noPermission.objects.permissions = [];
  noPermission.governance.claims = noPermission.governance.claims
    .filter((claim) => !['claim-permission-product', 'claim-permission-ui', 'claim-permission-data'].includes(claim.id));
  noPermission.governance.claims.find((claim) => claim.id === 'claim-permission').subjectRef = 'role:customer-service-manager';
  const noPermissionBuild = buildProductWiki(noPermission);
  assert.equal(noPermissionBuild.model.governance.coverage.permissions.totalPermissions, 0);
  assert.equal(noPermissionBuild.model.governance.coverage.permissions.complete, true);
  assert.deepEqual(noPermissionBuild.model.governance.coverage.risks.permissionCoverageBlockingRefs, []);
  assert.equal(noPermissionBuild.manifest.publication.status, 'publishable');
});

test('Mode 4 treats partial Permission Claims and direct Open Gaps as incomplete coverage', () => {
  const partialClaim = withCompleteRequirement(fixture());
  partialClaim.governance.claims.find((claim) => claim.id === 'claim-permission').factLevel = 'partial';
  const partialBuild = buildProductWiki(partialClaim);
  assert.equal(partialBuild.model.governance.coverage.permissions.permissionDetails[0].claimsConfirmed, false);
  assert.equal(partialBuild.model.governance.coverage.permissions.complete, false);
  assert.match(partialBuild.files.find((file) => file.path.includes('refund-permission')).content, /status: product-review-draft/);

  const partialRowClaim = withCompleteRequirement(fixture());
  partialRowClaim.governance.claims.push({ id: 'claim-row-partial', subjectRef: 'operation:submit-refund', layer: 'current', factLevel: 'partial', text: '退款按钮权限仍待确认', evidenceIds: ['evidence-code-permission'] });
  partialRowClaim.objects.permissions[0].rows[0].claimIds = ['claim-row-partial'];
  const partialRowBuild = buildProductWiki(partialRowClaim);
  assert.equal(partialRowBuild.model.governance.coverage.permissions.permissionDetails[0].rowClaimsConfirmed, false);
  assert.equal(partialRowBuild.model.governance.coverage.permissions.complete, false);

  const orphanPermissionClaim = withCompleteRequirement(fixture());
  orphanPermissionClaim.governance.claims.push({ id: 'claim-permission-orphan', subjectRef: 'permission:refund-permission', layer: 'current', factLevel: 'confirmed', text: '未被权限对象引用的孤立 Claim', evidenceIds: ['evidence-code-permission'] });
  orphanPermissionClaim.objects.permissions[0].claimIds = ['claim-feature'];
  orphanPermissionClaim.objects.permissions[0].rows.forEach((row) => { row.claimIds = ['claim-feature']; });
  const orphanBuild = buildProductWiki(orphanPermissionClaim);
  assert.equal(orphanBuild.model.governance.coverage.permissions.permissionDetails[0].directClaimsConfirmed, false);
  assert.equal(orphanBuild.model.governance.coverage.permissions.complete, false);

  const partialStatus = withCompleteRequirement(fixture());
  partialStatus.objects.permissions[0].status = 'partial';
  const partialStatusBuild = buildProductWiki(partialStatus);
  assert.equal(partialStatusBuild.model.governance.coverage.permissions.permissionDetails[0].permissionStatusConfirmed, false);
  assert.equal(partialStatusBuild.model.governance.coverage.permissions.complete, false);

  const directGap = withCompleteRequirement(fixture());
  directGap.governance.gaps.push(actionableGap({
    id: 'gap-permission-api',
    type: 'evidence-gap',
    audience: 'product-review',
    severity: 'P1',
    status: 'open',
    description: '接口权限证据待确认',
    subjectRefs: ['permission:refund-permission'],
    fieldRefs: ['permission:refund-permission.rows'],
    evidenceIds: ['evidence-code-permission'],
  }));
  const gapBuild = buildProductWiki(directGap);
  assert.deepEqual(gapBuild.model.governance.coverage.permissions.permissionDetails[0].openGapIds, ['gap-permission-api']);
  assert.equal(gapBuild.model.governance.coverage.permissions.complete, false);
});

test('Mode 4 governance report deduplicates risk text and routes Gap details to shards', () => {
  const input = fixture();
  const productGap = structuredClone(input.governance.gaps[0]);
  productGap.id = 'gap-product-definition';
  productGap.type = 'product-decision-gap';
  productGap.title = '订单退款的产品目标需要补齐';
  productGap.question = '请确认订单退款的产品目标应如何定义？';
  productGap.fieldRefs = ['feature:order-refund.purpose'];
  const duplicate = structuredClone(productGap);
  duplicate.id = 'gap-requirement-duplicate';
  input.governance.gaps.push(productGap, duplicate);
  input.catalog.features[0].gapIds.push(productGap.id, duplicate.id);

  const build = buildProductWiki(input);
  const coveragePage = build.files.find((file) => file.path === '质量治理/目录覆盖与质量报告.md').content;
  const title = productGap.title;
  const featurePage = build.files.find((file) => file.path.endsWith('/订单退款.md')).content;
  assert.match(coveragePage, /P1：产品基线（2 项）/);
  assert.doesNotMatch(coveragePage, new RegExp(`P1：${title}`));
  assert.equal((featurePage.match(new RegExp(`- P1：${title}`, 'g')) ?? []).length, 1);
  assert.match(featurePage, new RegExp(`- P1：${title}（2 项）`));
  const taskSection = coveragePage.split('## 9. 缺口任务')[1].split('## 10. 发布结论')[0];
  assert.match(taskSection, /待处理：2（P0 0 \/ P1 2 \/ P2 0）/);
  assert.match(taskSection, /分片：1/);
  assert.match(taskSection, /\[查看待确认问题\]\(待确认问题\.md\)/);
  assert.doesNotMatch(taskSection, new RegExp(title));
  const publicationSection = coveragePage.split('## 10. 发布结论')[1];
  assert.match(publicationSection, /阻断问题：3（产品 3 \/ 数据 0 \/ 研发 0）/);
  assert.doesNotMatch(publicationSection, new RegExp(title));
});

test('Mode 4 complete Data Entity projects every captured constraint and index', () => {
  const missingConstraint = withDatabaseMetadataObject(fixture(), 'constraints', {
    id: 'db-4444444444444444', ownerId: 'db-2222222222222222', type: 'PRIMARY KEY', columnIds: ['db-3333333333333333'], referencedObjectId: null, referencedColumnIds: [], expression: null, evidenceId: 'evidence-database-constraint',
  });
  assert.throws(() => buildProductWiki(missingConstraint), (error) => error.code === 'wiki-data-constraint-coverage-incomplete');

  const missingIndex = withDatabaseMetadataObject(fixture(), 'indexes', {
    id: 'db-5555555555555555', ownerId: 'db-2222222222222222', unique: true, columnIds: ['db-3333333333333333'], expression: null, predicate: null, evidenceId: 'evidence-database-index',
  });
  assert.throws(() => buildProductWiki(missingIndex), (error) => error.code === 'wiki-data-index-coverage-incomplete');
});

test('T21 refuses publishable when a critical shared object lacks independent evidence', () => {
  const input = withCompleteRequirement(fixture());
  const rule = input.objects.rules[0];
  rule.exceptions = [fact('特批场景由人工复核', ['evidence-code-rule'])];
  rule.configurationRefs = ['feature:order-refund'];
  rule.confirmedEmptyFields = [];
  rule.evidenceIds = [];
  const build = buildProductWiki(input);
  assert.equal(build.manifest.publication.status, 'partially-publishable');
  assert.deepEqual(build.manifest.publication.blockingObjectRefs, ['rule:refund-window']);
  const coverage = build.files.find((file) => file.path === '质量治理/目录覆盖与质量报告.md').content;
  assert.match(coverage, /关键对象缺少独立证据：退款时间窗/);
});

test('Mode 4 source gates block failed Code and degrade bounded Requirement or Database gaps', () => {
  const failedCode = fixture();
  failedCode.sourceResults[failedCode.sourceResults.findIndex((result) => result.sourceId === 'current-code')] = sourceResult('current-code', 'code', 'git-worktree', 'failed');
  failedCode.artifacts = failedCode.artifacts.filter((artifact) => artifact.kind !== 'code-artifact');
  assert.throws(() => buildProductWiki(failedCode), (error) => error.code === 'wiki-source-readiness-blocked');
  assert.equal(existsSync(join(failedCode.outputRoot, 'docs/wiki')), false);

  for (const status of ['skipped-no-input', 'skipped-unavailable', 'skipped-unauthenticated']) {
    const noRequirement = fixture();
    noRequirement.sourceResults[noRequirement.sourceResults.findIndex((result) => result.sourceId === 'primary-requirements')] = sourceResult('primary-requirements', 'requirement', 'tapd', status);
    const build = buildProductWiki(noRequirement);
    assert.equal(build.model.sourceReadiness.status, 'degraded');
    assert.equal(build.model.governance.publication.status, 'partially-publishable');
  }

  const missingDatabase = withoutDatabaseArtifact(fixture());
  missingDatabase.governance.gaps.push(actionableGap({ id: 'gap-database', type: 'data-source-gap', audience: 'product-review', severity: 'P1', status: 'open', description: '缺少数据库元数据', subjectRefs: ['feature:order-refund'], evidenceIds: [] }));
  missingDatabase.catalog.features[0].gapIds.push('gap-database');
  missingDatabase.catalog.features[0].dataSourceAssessment.gapIds.push('gap-database');
  const degraded = buildProductWiki(missingDatabase);
  assert.equal(degraded.model.sourceReadiness.featureResults[0].databaseStatus, 'missing');
  assert.equal(degraded.model.sourceReadiness.featureResults[0].outcome, 'blocked');

  const staticFeature = withoutDatabaseArtifact(fixture(), 'skipped-no-input');
  staticFeature.catalog.features[0].dataSourceAssessment = { applicability: 'not-applicable', reason: '纯静态查询入口', evidenceIds: ['evidence-code-interface'], databaseSourceIds: [], gapIds: [] };
  assert.equal(buildProductWiki(staticFeature).model.sourceReadiness.featureResults[0].databaseStatus, 'not-applicable');

  const unknownDatabase = fixture();
  unknownDatabase.governance.gaps.push(actionableGap({ id: 'gap-database-applicability', type: 'product-decision-gap', audience: 'product-review', severity: 'P1', status: 'open', description: '是否依赖数据库尚待确认', subjectRefs: ['feature:order-refund'], evidenceIds: [] }));
  unknownDatabase.catalog.features[0].gapIds.push('gap-database-applicability');
  unknownDatabase.catalog.features[0].dataSourceAssessment = { applicability: 'unknown', reason: '尚未确认数据持久化边界', evidenceIds: [], databaseSourceIds: [], gapIds: ['gap-database-applicability'] };
  const unknownBuild = buildProductWiki(unknownDatabase);
  assert.equal(unknownBuild.model.sourceReadiness.featureResults[0].databaseStatus, 'unknown');
  assert.equal(unknownBuild.model.sourceReadiness.featureResults[0].outcome, 'blocked');
});

test('Expected and Deployed schema drift requires an exact Gap and blocks complete publication', () => {
  const missingGap = withDatabaseDrift(withCompleteRequirement(fixture()));
  assert.throws(() => buildProductWiki(missingGap), (error) => error.code === 'wiki-data-gap-required');

  const wrongGap = withDatabaseDrift(withCompleteRequirement(fixture()));
  wrongGap.governance.gaps.push(actionableGap({ id: 'gap-orm', type: 'orm-schema-conflict', audience: 'product-review', severity: 'P1', status: 'open', description: 'ORM 与部署结构不一致', subjectRefs: ['feature:order-refund'], evidenceIds: [] }));
  wrongGap.catalog.features[0].gapIds.push('gap-orm');
  wrongGap.catalog.features[0].dataSourceAssessment.gapIds.push('gap-orm');
  assert.throws(() => buildProductWiki(wrongGap), (error) => error.code === 'wiki-data-gap-required');

  const input = withDatabaseDrift(withCompleteRequirement(fixture()));
  input.governance.gaps.push(actionableGap({ id: 'gap-schema-drift', type: 'schema-drift-gap', audience: 'product-review', severity: 'P1', status: 'open', description: 'Expected 与 Deployed 的字段类型不一致', subjectRefs: ['feature:order-refund'], evidenceIds: ['evidence-database-column-deployed'] }));
  input.catalog.features[0].gapIds.push('gap-schema-drift');
  input.catalog.features[0].dataSourceAssessment.gapIds.push('gap-schema-drift');
  const build = buildProductWiki(input);
  assert.equal(build.model.sourceReadiness.databaseReconciliations[0].status, 'conflict');
  assert.deepEqual(build.model.sourceReadiness.databaseReconciliations[0].conflictCollections, ['columns']);
  assert.equal(build.model.sourceReadiness.featureResults[0].databaseStatus, 'conflict');
  assert.notEqual(build.manifest.publication.status, 'publishable');
  assert.match(build.files.find((file) => file.path === '质量治理/目录覆盖与质量报告.md').content, /P1：产品基线（1 项）/);
});

test('Mode 4 freezes Database governance Gap types', () => {
  const input = withCompleteRequirement(fixture());
  const gaps = [
    ['gap-orm', 'orm-schema-conflict', 'feature:order-refund'],
    ['gap-unused-data', 'unused-data-object-gap', 'data-entity:refund-record'],
    ['gap-business-meaning', 'business-meaning-gap', 'data-entity:refund-record'],
    ['gap-database-access', 'database-access-gap', 'permission:refund-permission'],
  ];
  for (const [id, type, subjectRef] of gaps) {
    input.governance.gaps.push(actionableGap({ id, type, audience: 'product-review', severity: 'P1', status: 'open', description: `${type} 待处理`, subjectRefs: [subjectRef], evidenceIds: [] }));
    const [, objectId] = subjectRef.split(':');
    const node = Object.values(input.objects).flat().find((item) => item.id === objectId);
    if (node) node.gapIds.push(id);
    else input.catalog.features.find((item) => item.id === objectId).gapIds.push(id);
  }
  const build = buildProductWiki(input);
  assert.deepEqual(build.model.governance.gaps.map((gap) => gap.type), ['business-meaning-gap', 'database-access-gap', 'orm-schema-conflict', 'unused-data-object-gap']);
  assert.notEqual(build.manifest.publication.status, 'publishable');

  const unknown = fixture();
  unknown.governance.gaps[0].type = 'database-maybe-gap';
  assert.throws(() => buildProductWiki(unknown), (error) => error.code === 'wiki-gap-type-invalid');
});

test('Mode 4 generator publishes only current Yog Wiki ownership', () => {
  const input = fixture();
  const generated = generateProductWiki(input);
  assert.equal(generated.ok, true);
  assert.equal(JSON.parse(readFileSync(join(input.outputRoot, 'docs/wiki/_meta/manifest.json'), 'utf8')).managedBy, 'yog:wiki');
  const preflight = preflightWiki({ repoRoot: input.outputRoot });
  assert.equal(preflight.result_status, 'partial', JSON.stringify(preflight.issues, null, 2));
  const replaced = generateProductWiki({ ...fixture(input.outputRoot), runId: 'wiki-mode4-replace' });
  assert.equal(replaced.operation, 'replace');
  const oldRoot = tempRoot();
  mkdirSync(join(oldRoot, 'docs/wiki/_meta'), { recursive: true });
  writeFileSync(join(oldRoot, 'docs/wiki/_meta/manifest.json'), JSON.stringify({ schemaVersion: 1, managedBy: retiredWikiOwner }));
  assert.throws(() => generateProductWiki(fixture(oldRoot)), (error) => error.code === 'wiki-root-unmanaged');
});

test('Mode 4 verify is read-only and reports page tampering and stale Database sources', () => {
  const input = fixture();
  generateProductWiki(input);
  const valid = verifyProductWiki({ outputRoot: input.outputRoot, wikiRoot: input.wikiRoot, now: input.now });
  assert.equal(valid.result_status, 'valid');

  const pagePath = join(input.outputRoot, 'docs/wiki/产品目录/交易系统/订单域/订单管理/订单退款.md');
  writeFileSync(pagePath, `${readFileSync(pagePath, 'utf8')}\n被篡改\n`);
  const before = wikiTreeSnapshot(input.outputRoot);
  const invalid = verifyProductWiki({ outputRoot: input.outputRoot, wikiRoot: input.wikiRoot, now: '2026-07-16T12:00:00.000Z' });
  const after = wikiTreeSnapshot(input.outputRoot);
  assert.equal(invalid.result_status, 'invalid-wiki');
  assert.equal(invalid.findings.some((item) => item.code === 'wiki-page-hash-mismatch'), true);
  assert.equal(invalid.findings.some((item) => item.code === 'wiki-source-stale' && item.path.endsWith('/primary-database')), true);
  assert.deepEqual(after, before);
});

test('Mode 4 verify rejects Markdown that no longer matches the deterministic renderer', () => {
  const input = fixture();
  generateProductWiki(input);
  const pageRelativePath = '产品目录/交易系统/订单域/订单管理/订单退款.md';
  const pagePath = join(input.outputRoot, 'docs/wiki', pageRelativePath);
  const modelPath = join(input.outputRoot, 'docs/wiki/_meta/model.json');
  const manifestPath = join(input.outputRoot, 'docs/wiki/_meta/manifest.json');
  const tamperedPage = `${readFileSync(pagePath, 'utf8')}\n旧版 JSON 正文\n`;
  writeFileSync(pagePath, tamperedPage);
  const tamperedPageHash = `sha256:${createHash('sha256').update(tamperedPage).digest('hex')}`;
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  model.pages.find((page) => page.path === pageRelativePath).contentHash = tamperedPageHash;
  const modelContent = `${JSON.stringify(model, null, 2)}\n`;
  writeFileSync(modelPath, modelContent);
  const modelHash = `sha256:${createHash('sha256').update(modelContent).digest('hex')}`;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.pages.find((page) => page.path === pageRelativePath).contentHash = tamperedPageHash;
  manifest.modelHash = modelHash;
  manifest.projections.find((projection) => projection.path === '_meta/model.json').contentHash = modelHash;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = verifyProductWiki({ outputRoot: input.outputRoot, wikiRoot: input.wikiRoot, now: input.now });
  assert.equal(result.result_status, 'invalid-wiki');
  assert.equal(result.findings.some((item) => item.code === 'wiki-page-projection-drift'), true);
});

test('Mode 4 verify rejects incomplete Manifest projection sets', () => {
  const input = fixture();
  generateProductWiki(input);
  const manifestPath = join(input.outputRoot, 'docs/wiki/_meta/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.projections = manifest.projections.filter((projection) => projection.path !== '_meta/relationships.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = verifyProductWiki({ outputRoot: input.outputRoot, wikiRoot: input.wikiRoot, now: input.now });
  assert.equal(result.result_status, 'invalid-wiki');
  assert.equal(result.findings.some((item) => item.code === 'wiki-projection-set-mismatch'), true);
});

test('Mode 4 verify rejects Manifest identity drift and unmanaged extra files', () => {
  const input = fixture();
  generateProductWiki(input);
  const manifestPath = join(input.outputRoot, 'docs/wiki/_meta/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.runId = 'forged-run';
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(input.outputRoot, 'docs/wiki/unmanaged.md'), '# unmanaged\n');
  const result = verifyProductWiki({ outputRoot: input.outputRoot, wikiRoot: input.wikiRoot, now: input.now });
  assert.equal(result.result_status, 'invalid-wiki');
  assert.equal(result.findings.some((item) => item.code === 'wiki-manifest-projection-drift'), true);
  assert.equal(result.findings.some((item) => item.code === 'wiki-managed-files-mismatch'), true);
});

test('Mode 4 verify rejects a Source Snapshot id that no longer matches its content', () => {
  const input = fixture();
  generateProductWiki(input);
  const modelPath = join(input.outputRoot, 'docs/wiki/_meta/model.json');
  const manifestPath = join(input.outputRoot, 'docs/wiki/_meta/manifest.json');
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  model.sourceSnapshot.sources[0].sourceRevision = 'forged-revision';
  const modelContent = `${JSON.stringify(model, null, 2)}\n`;
  writeFileSync(modelPath, modelContent);
  const modelHash = `sha256:${createHash('sha256').update(modelContent).digest('hex')}`;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.modelHash = modelHash;
  manifest.projections.find((projection) => projection.path === '_meta/model.json').contentHash = modelHash;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = verifyProductWiki({ outputRoot: input.outputRoot, wikiRoot: input.wikiRoot, now: input.now });
  assert.equal(result.result_status, 'invalid-wiki');
  assert.equal(result.findings.some((item) => item.code === 'wiki-source-snapshot-invalid'), true);
});

test('Mode 4 verify rejects coverage and publication contradictions even when hashes are updated', () => {
  const input = fixture();
  generateProductWiki(input);
  const modelPath = join(input.outputRoot, 'docs/wiki/_meta/model.json');
  const manifestPath = join(input.outputRoot, 'docs/wiki/_meta/manifest.json');
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  model.governance.coverage.featurePrd.complete = model.governance.coverage.featurePrd.total;
  const modelContent = `${JSON.stringify(model, null, 2)}\n`;
  writeFileSync(modelPath, modelContent);
  const modelHash = `sha256:${createHash('sha256').update(modelContent).digest('hex')}`;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.modelHash = modelHash;
  manifest.projections.find((projection) => projection.path === '_meta/model.json').contentHash = modelHash;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = verifyProductWiki({ outputRoot: input.outputRoot, wikiRoot: input.wikiRoot, now: input.now });
  assert.equal(result.result_status, 'invalid-wiki');
  assert.equal(result.findings.some((item) => item.code === 'wiki-coverage-contradiction'), true);
});

test('Mode 4 sync preserves every Markdown byte', () => {
  const input = fixture();
  generateProductWiki(input);
  const before = wikiMarkdown(input.outputRoot);
  const result = syncProductWiki({
    outputRoot: input.outputRoot,
    wikiRoot: input.wikiRoot,
    runId: 'wiki-mode4-synced',
    generatedAt: '2026-07-14T12:00:00.000Z',
    now: input.now,
  });
  assert.deepEqual(result.changedPages, []);
  assert.deepEqual(wikiMarkdown(input.outputRoot), before);
});

test('Mode 4 sync refuses to bless tampered Markdown', () => {
  const input = fixture();
  generateProductWiki(input);
  const pagePath = join(input.outputRoot, 'docs/wiki/产品目录/交易系统/订单域/订单管理/订单退款.md');
  writeFileSync(pagePath, `${readFileSync(pagePath, 'utf8')}\n未经模型的修改\n`);
  const before = wikiTreeSnapshot(input.outputRoot);
  assert.throws(
    () => syncProductWiki({ outputRoot: input.outputRoot, wikiRoot: input.wikiRoot, now: input.now }),
    (error) => error.code === 'wiki-maintenance-preflight-invalid',
  );
  assert.deepEqual(wikiTreeSnapshot(input.outputRoot), before);
});

test('Mode 4 update propagates a shared Rule change through Feature, System, and T21', () => {
  const input = fixture();
  generateProductWiki(input);
  const before = wikiMarkdown(input.outputRoot);
  const next = fixture(input.outputRoot);
  next.runId = 'wiki-mode4-updated';
  next.objects.rules[0].effects[0].text = '允许创建一次退款申请';
  const result = updateProductWiki(next);
  const rulePage = result.affectedPages.find((path) => path.startsWith('知识对象/业务规则/'));
  assert.ok(rulePage);
  assert.equal(result.affectedPages.includes('产品目录/交易系统/订单域/订单管理/订单退款.md'), true);
  assert.equal(result.affectedPages.includes('产品目录/交易系统/系统总览.md'), true);
  assert.equal(result.affectedPages.includes('质量治理/目录覆盖与质量报告.md'), true);
  assert.equal(result.impactRefs.includes('rule:refund-window'), true);
  assert.equal(result.impactRefs.includes('feature:order-refund'), true);
  assert.equal(result.impactRefs.includes('system:commerce'), true);
  const after = wikiMarkdown(input.outputRoot);
  for (const path of result.unaffectedPages) assert.equal(after.get(path), before.get(path));
  assert.notEqual(after.get(rulePage), before.get(rulePage));
});

test('Mode 4 update propagates an inline Page change to its Feature and System while preserving unrelated page bytes', () => {
  const input = withFeaturePageAndObservationMetric(fixture());
  generateProductWiki(input);
  const before = wikiMarkdown(input.outputRoot);
  const next = withFeaturePageAndObservationMetric(fixture(input.outputRoot));
  next.runId = 'wiki-mode4-inline-page-updated';
  next.objects.pages[0].route.text = '/orders/refunds';
  const result = updateProductWiki(next);
  assert.equal(result.affectedPages.some((path) => path.startsWith('知识对象/页面与操作/')), false);
  assert.equal(result.affectedPages.includes('产品目录/交易系统/订单域/订单管理/订单退款.md'), true);
  assert.equal(result.affectedPages.includes('产品目录/交易系统/系统总览.md'), true);
  assert.equal(result.affectedPages.includes('质量治理/目录覆盖与质量报告.md'), true);
  assert.equal(result.impactRefs.includes('page:refund-management'), true);
  const after = wikiMarkdown(input.outputRoot);
  for (const path of result.unaffectedPages) assert.equal(after.get(path), before.get(path));
  assert.equal(after.get('知识对象/业务规则/refund-window-退款时间窗.md'), before.get('知识对象/业务规则/refund-window-退款时间窗.md'));
});

test('Generic object projection omits empty sections, summarizes confirmed empties, and expands each Evidence once', () => {
  const build = buildProductWiki(fixture());
  const metricPage = build.files.find((file) => file.path.includes('/指标口径/') && file.path.includes('refund-rate'));
  assert.doesNotMatch(metricPage.content, /## 过滤条件/);
  assert.match(metricPage.content, /## 已确认无/);
  assert.match(metricPage.content, /过滤条件/);
  assert.equal(metricPage.content.match(/code:repo-current:src\/refund\.mjs:41-50/g)?.length, 1);
  assert.match(metricPage.content, /## 证据索引/);
});

test('Mode 4 update propagates a Flow message change to its Flow, Feature, System, and T21 only', () => {
  const input = withThreeViewFlow(fixture());
  generateProductWiki(input);
  const before = wikiMarkdown(input.outputRoot);
  const next = withThreeViewFlow(fixture(input.outputRoot));
  next.runId = 'wiki-mode4-flow-updated';
  next.objects.flows[0].interaction.messages[2].label = '发布退款申请已提交事件';
  const result = updateProductWiki(next);
  const flowPage = result.affectedPages.find((path) => path.includes('/业务流程/') && path.endsWith('退款提交与通知流程.md'));
  assert.ok(flowPage);
  assert.equal(result.affectedPages.includes('产品目录/交易系统/订单域/订单管理/订单退款.md'), true);
  assert.equal(result.affectedPages.includes('产品目录/交易系统/系统总览.md'), true);
  assert.equal(result.affectedPages.includes('质量治理/目录覆盖与质量报告.md'), true);
  assert.equal(result.impactRefs.includes('flow:refund-flow'), true);
  assert.equal(result.impactRefs.includes('feature:order-refund'), true);
  assert.equal(result.impactRefs.includes('system:commerce'), true);
  const after = wikiMarkdown(input.outputRoot);
  for (const path of result.unaffectedPages) assert.equal(after.get(path), before.get(path));
  assert.notEqual(after.get(flowPage), before.get(flowPage));
  const statePage = [...after.keys()].find((path) => path.includes('/状态模型/'));
  assert.equal(after.get(statePage), before.get(statePage));
});

export { fixture };
