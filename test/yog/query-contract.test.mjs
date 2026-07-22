import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  classifyMismatch,
  combineQueryResults,
  evaluateWikiAuditGate,
  evaluateCodeGraphCoverage,
  filterKnowledgeDocuments,
  filterWikiFacts,
  buildFlowQueryReadSet,
  buildReviewQueryReadSet,
  preflightKnowledge,
  preflightWiki,
  queryResultStatus,
  writeDailyAudit,
} from '../../skills/yog/lib/query-contract.mjs';
import {
  buildCatalogIndexProjections,
  buildFlowIndexProjections,
  buildGapIndexProjections,
  buildReviewIndexProjections,
} from '../../skills/yog/lib/wiki.mjs';
import { wikiInputFingerprint } from '../../skills/yog/lib/wiki-source-registry.mjs';

const retiredWikiOwner = ['yog', ['wiki', 'mvp'].join('-')].join(':');

function tempRepo(prefix = 'yog-query-') {
  const repoRoot = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(repoRoot, '.git'));
  return repoRoot;
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function validKnowledge(repoRoot) {
  mkdirSync(join(repoRoot, '.yog'), { recursive: true });
  writeJson(join(repoRoot, '.yog/config.json'), { schemaVersion: 1, knowledgeRoot: 'docs/knowledge', codeFactProvider: { type: 'codegraph', status: 'configured' } });
  mkdirSync(join(repoRoot, 'docs/knowledge/contexts/refund'), { recursive: true });
  writeFileSync(join(repoRoot, 'docs/knowledge/INDEX.md'), '# Index\n');
  writeFileSync(join(repoRoot, 'docs/knowledge/CONTEXT-MAP.md'), '# Context Map\n');
  writeFileSync(join(repoRoot, 'docs/knowledge/contexts/refund/CONTEXT.md'), '# Refund\n');
  writeJson(join(repoRoot, 'docs/knowledge/index.json'), {
    schemaVersion: 1,
    kind: 'global',
    entries: [{ id: 'refund', path: 'docs/knowledge/contexts/refund/CONTEXT.md' }],
  });
}

function validWiki(repoRoot, { runId = 'wiki-query-test', claimIds = ['claim-refund'], expiresAt = null } = {}) {
  const meta = join(repoRoot, 'docs/wiki/_meta');
  mkdirSync(meta, { recursive: true });
  const pagePath = '产品目录/测试系统/测试域/测试模块/Refund.md';
  const systemPagePath = '产品目录/测试系统/系统总览.md';
  const pageContent = [
    '---',
    'schemaVersion: 1',
    'pageId: feature-refund',
    'pageType: feature',
    'title: Refund',
    'status: product-review-draft',
    'generatedBy: yog:wiki',
    'subjectRefs:',
    '  - feature:refund',
    'claimIds:',
    ...claimIds.map((id) => `  - ${id}`),
    'evidenceIds:',
    '  - evidence-refund',
    'relatedObjectRefs: []',
    'sourceSnapshotId: sha256:snapshot',
    '---',
    '# Refund',
    '',
  ].join('\n');
  mkdirSync(dirname(join(repoRoot, 'docs/wiki', pagePath)), { recursive: true });
  writeFileSync(join(repoRoot, 'docs/wiki', pagePath), pageContent);
  const systemPageContent = [
    '---',
    'schemaVersion: 1',
    'pageId: system-test-system',
    'pageType: system-overview',
    'title: 测试系统',
    'status: product-review-draft',
    'generatedBy: yog:wiki',
    'subjectRefs:',
    '  - system:test-system',
    'claimIds: []',
    'evidenceIds: []',
    'relatedObjectRefs: []',
    'sourceSnapshotId: sha256:snapshot',
    '---',
    '# 测试系统',
    '',
  ].join('\n');
  writeFileSync(join(repoRoot, 'docs/wiki', systemPagePath), systemPageContent);
  const pages = [
    { path: pagePath, contentHash: `sha256:${createHash('sha256').update(pageContent).digest('hex')}` },
    { path: systemPagePath, contentHash: `sha256:${createHash('sha256').update(systemPageContent).digest('hex')}` },
  ].sort((left, right) => left.path.localeCompare(right.path));
  const claims = claimIds.map((id) => ({ id, factLevel: 'confirmed', layer: 'current', subjectRef: 'feature:refund', text: id, evidenceIds: ['evidence-refund'] }));
  const evidence = [{ id: 'evidence-refund', sourceId: 'current-code', authority: 'implementation-fact' }];
  const catalog = {
    systems: [{ id: 'test-system', kind: 'system', name: '测试系统', status: 'confirmed', order: 10, domainRefs: ['domain:test-domain'], ownerRefs: [] }],
    domains: [{ id: 'test-domain', kind: 'domain', name: '测试域', status: 'confirmed', order: 20, parentRef: 'system:test-system', moduleRefs: ['module:test-module'], ownerRefs: [] }],
    modules: [{ id: 'test-module', kind: 'module', name: '测试模块', status: 'confirmed', order: 30, parentRef: 'domain:test-domain', featureRefs: ['feature:refund'], entryRefs: [], ownerRefs: [] }],
    features: [{ id: 'refund', kind: 'feature', name: 'Refund', status: 'confirmed', order: 40, parentRef: 'module:test-module', claimIds, evidenceIds: ['evidence-refund'], gapIds: [], relationRefs: [] }],
  };
  const objects = {
    pages: [], operations: [], scenarios: [], flows: [], stateMachines: [], rules: [], roles: [], permissions: [],
    dataEntities: [], metrics: [], interfaces: [], requirements: [], acceptanceCriteria: [], versions: [],
  };
  const sourceReadiness = { status: 'ready', catalogSourceIds: ['product-catalog'], codeSourceIds: ['current-code'], featureResults: [], blockingIssueIds: [] };
  const publication = { status: 'publishable', blockingGapIds: [] };
  const confirmationSources = [{
    sourceId: 'current-code',
    kind: 'code',
    provider: 'git-worktree',
    enabled: true,
    required: true,
    scopeFingerprint: `sha256:${'a'.repeat(64)}`,
  }];
  const inputConfirmation = {
    status: 'confirmed',
    inputFingerprint: wikiInputFingerprint({ outputRoot: repoRoot, wikiRoot: 'docs/wiki', sources: confirmationSources }),
    confirmedAt: '2026-07-14T00:00:00Z',
    sources: confirmationSources,
  };
  const sourceSnapshot = {
    id: 'sha256:snapshot',
    inputConfirmation,
    sources: expiresAt ? [{ sourceId: 'current-code', kind: 'code', provider: 'git-worktree', status: 'collected', expiresAt }] : [],
    artifactFingerprints: [],
  };
  const model = {
    schemaVersion: 1,
    kind: 'yog-product-wiki-model',
    pages,
    runId,
    generatedAt: '2026-07-14T00:00:00Z',
    inputConfirmation,
    sources: [{ sourceId: 'current-code', kind: 'code', provider: 'git-worktree', status: 'collected' }],
    sourceReadiness,
    sourceSnapshot,
    catalog,
    objects,
    relationships: [],
    governance: { claims, evidence, gaps: [], coverage: {}, publication },
  };
  const modelContent = `${JSON.stringify(model, null, 2)}\n`;
  writeFileSync(join(meta, 'model.json'), modelContent);
  const projections = {
    '_meta/model.json': modelContent,
    '_meta/claims.json': `${JSON.stringify({ schemaVersion: 1, claims }, null, 2)}\n`,
    '_meta/evidence.json': `${JSON.stringify({ schemaVersion: 1, evidence }, null, 2)}\n`,
    '_meta/relationships.json': `${JSON.stringify({ schemaVersion: 1, relationships: [] }, null, 2)}\n`,
    '_meta/state-machines.json': `${JSON.stringify({ schemaVersion: 1, stateMachines: [] }, null, 2)}\n`,
    '_meta/coverage.json': `${JSON.stringify({
      schemaVersion: 1,
      sourceReadiness,
      publication,
      coverage: {},
      counts: { systems: 1, domains: 1, modules: 1, features: 1, objects: 0 },
    }, null, 2)}\n`,
  };
  for (const { path, content } of buildCatalogIndexProjections(model)) projections[path] = content;
  for (const { path, content } of buildFlowIndexProjections(model)) projections[path] = content;
  for (const { path, content } of buildGapIndexProjections(model)) projections[path] = content;
  for (const { path, content } of buildReviewIndexProjections(model)) projections[path] = content;
  for (const [path, content] of Object.entries(projections)) {
    const absolute = join(repoRoot, 'docs/wiki', path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  writeJson(join(meta, 'manifest.json'), {
    schemaVersion: 1,
    managedBy: 'yog:wiki',
    kind: 'yog-product-wiki-manifest',
    runId,
    generatedAt: '2026-07-14T00:00:00Z',
    wikiRoot: 'docs/wiki',
    modelHash: `sha256:${createHash('sha256').update(modelContent).digest('hex')}`,
    sourceSnapshotId: sourceSnapshot.id,
    sourceReadiness: 'ready',
    inputConfirmation,
    publication,
    pages,
    projections: Object.entries(projections).map(([path, content]) => ({ path, contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}` })),
  });
}

function currentWikiIdentity(repoRoot) {
  const content = readFileSync(join(repoRoot, 'docs/wiki/_meta/manifest.json'), 'utf8');
  return {
    wikiRunId: JSON.parse(content).runId,
    manifestHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
  };
}

test('Knowledge preflight distinguishes missing, unmanaged, invalid, stale, and valid roots', () => {
  const missing = tempRepo();
  assert.equal(preflightKnowledge({ repoRoot: missing }).result_status, 'not-initialized');

  const unmanaged = tempRepo();
  mkdirSync(join(unmanaged, 'docs/knowledge'), { recursive: true });
  assert.equal(preflightKnowledge({ repoRoot: unmanaged }).result_status, 'not-managed');

  const invalid = tempRepo();
  mkdirSync(join(invalid, '.yog'), { recursive: true });
  mkdirSync(join(invalid, 'docs/knowledge'), { recursive: true });
  writeJson(join(invalid, '.yog/config.json'), { schemaVersion: 1, knowledgeRoot: 'docs/knowledge' });
  const invalidResult = preflightKnowledge({ repoRoot: invalid });
  assert.equal(invalidResult.result_status, 'invalid-knowledge');
  assert.equal(invalidResult.issues.some((item) => item.code === 'index-missing'), true);

  const valid = tempRepo();
  validKnowledge(valid);
  assert.equal(preflightKnowledge({ repoRoot: valid }).result_status, 'ok');
  const stale = preflightKnowledge({ repoRoot: valid, indexFresh: false });
  assert.equal(stale.result_status, 'invalid-knowledge');
  assert.equal(stale.issues.some((item) => item.code === 'index-stale'), true);
});

test('Knowledge preflight fails closed on broken index references and invalid config', () => {
  const repoRoot = tempRepo();
  validKnowledge(repoRoot);
  const indexPath = join(repoRoot, 'docs/knowledge/index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.entries[0].path = 'docs/knowledge/contexts/missing/CONTEXT.md';
  writeJson(indexPath, index);
  assert.equal(preflightKnowledge({ repoRoot }).issues.some((item) => item.code === 'broken-reference'), true);

  writeJson(join(repoRoot, '.yog/config.json'), { schemaVersion: 2, knowledgeRoot: 'docs/knowledge' });
  assert.equal(preflightKnowledge({ repoRoot }).issues.some((item) => item.code === 'config-schema-invalid'), true);
});

test('Wiki preflight distinguishes unavailable, unmanaged, invalid, and valid roots', () => {
  const missing = tempRepo();
  assert.equal(preflightWiki({ repoRoot: missing }).result_status, 'unavailable');

  const unmanaged = tempRepo();
  mkdirSync(join(unmanaged, 'docs/wiki/_meta'), { recursive: true });
  writeJson(join(unmanaged, 'docs/wiki/_meta/manifest.json'), { schemaVersion: 1, managedBy: 'someone-else' });
  assert.equal(preflightWiki({ repoRoot: unmanaged }).result_status, 'not-managed');

  const retired = tempRepo();
  mkdirSync(join(retired, 'docs/wiki/_meta'), { recursive: true });
  writeJson(join(retired, 'docs/wiki/_meta/manifest.json'), { schemaVersion: 1, managedBy: retiredWikiOwner });
  assert.equal(preflightWiki({ repoRoot: retired }).result_status, 'not-managed');

  const invalid = tempRepo();
  mkdirSync(join(invalid, 'docs/wiki'), { recursive: true });
  const invalidResult = preflightWiki({ repoRoot: invalid, explicitOwnership: true });
  assert.equal(invalidResult.result_status, 'invalid-wiki');
  assert.equal(invalidResult.issues.some((item) => item.code === 'manifest-missing'), true);

  const valid = tempRepo();
  validWiki(valid);
  assert.equal(preflightWiki({ repoRoot: valid }).result_status, 'ok');
});

test('Flow query read set stays within one System shard and excludes the canonical model', () => {
  const readSet = buildFlowQueryReadSet({
    systemRef: 'system:commerce',
    flowRef: 'flow:refund',
    catalogIndex: { systems: [
      { ref: 'system:commerce', catalogPath: '_meta/catalog/commerce.json' },
      { ref: 'system:support', catalogPath: '_meta/catalog/support.json' },
    ] },
    flowIndex: { systems: [
      { systemRef: 'system:commerce', flowCatalogPath: '_meta/flows/commerce.json' },
      { systemRef: 'system:support', flowCatalogPath: '_meta/flows/support.json' },
    ] },
    systemFlowIndex: { entries: [{ ref: 'flow:refund', pagePath: '知识对象/业务流程/refund.md' }] },
  });
  assert.equal(readSet.includes('_meta/model.json'), false);
  assert.equal(readSet.includes('_meta/catalog/support.json'), false);
  assert.equal(readSet.includes('_meta/flows/support.json'), false);
  assert.equal(readSet.includes('_meta/flows/commerce.json'), true);
  assert.equal(readSet.includes('知识对象/业务流程/refund.md'), true);
});

test('Review query read set stays within one System and one Feature review shard', () => {
  const readSet = buildReviewQueryReadSet({
    systemRef: 'system:course-system',
    featureRef: 'feature:course-library',
    catalogIndex: { systems: [{ ref: 'system:course-system', catalogPath: '_meta/catalog/course-system.json' }] },
    systemCatalog: { entries: [{ ref: 'feature:course-library', pagePath: '产品目录/课程系统/课程库.md' }] },
    reviewIndex: { systems: [{ ref: 'system:course-system', reviewCatalogPath: '_meta/reviews/course-system.json' }] },
    systemReviewIndex: { entries: [{ featureRef: 'feature:course-library', pagePath: '质量治理/产品审核/course-system/course-library.md' }] },
  });
  assert.deepEqual(readSet, [
    '_meta/manifest.json', '_meta/catalog.json', '_meta/catalog/course-system.json',
    '_meta/reviews.json', '_meta/reviews/course-system.json',
    '质量治理/产品审核/course-system/course-library.md', '产品目录/课程系统/课程库.md', '_meta/coverage.json',
  ]);
  assert.equal(readSet.includes('_meta/model.json'), false);
});

test('Wiki preflight rejects projection and reference mismatches', () => {
  const repoRoot = tempRepo();
  validWiki(repoRoot);
  const claimsPath = join(repoRoot, 'docs/wiki/_meta/claims.json');
  const claims = JSON.parse(readFileSync(claimsPath, 'utf8'));
  claims.claims[0].evidenceIds = ['missing'];
  writeJson(claimsPath, claims);
  const result = preflightWiki({ repoRoot });
  assert.equal(result.result_status, 'invalid-wiki');
  assert.equal(result.issues.some((item) => item.code === 'projection-mismatch'), true);
});

test('Wiki preflight rejects a rehashed System catalog that no longer matches the canonical model', () => {
  const repoRoot = tempRepo();
  validWiki(repoRoot);
  const rootPath = join(repoRoot, 'docs/wiki/_meta/catalog.json');
  const rootCatalog = JSON.parse(readFileSync(rootPath, 'utf8'));
  const shardPath = join(repoRoot, 'docs/wiki', rootCatalog.systems[0].catalogPath);
  const shard = JSON.parse(readFileSync(shardPath, 'utf8'));
  shard.entries[0].name = 'Tampered';
  writeJson(shardPath, shard);
  const shardContent = readFileSync(shardPath, 'utf8');
  rootCatalog.systems[0].catalogHash = `sha256:${createHash('sha256').update(shardContent).digest('hex')}`;
  writeJson(rootPath, rootCatalog);

  const manifestPath = join(repoRoot, 'docs/wiki/_meta/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const path of ['_meta/catalog.json', rootCatalog.systems[0].catalogPath]) {
    const content = readFileSync(join(repoRoot, 'docs/wiki', path), 'utf8');
    manifest.projections.find((projection) => projection.path === path).contentHash = `sha256:${createHash('sha256').update(content).digest('hex')}`;
  }
  writeJson(manifestPath, manifest);

  const result = preflightWiki({ repoRoot });
  assert.equal(result.result_status, 'invalid-wiki');
  assert.equal(result.issues.some((item) => item.code === 'projection-mismatch'), true);
  assert.equal(result.issues.some((item) => item.code === 'projection-hash-mismatch'), false);
});

test('Wiki preflight rejects missing or inconsistent input confirmation summaries', () => {
  const missingRoot = tempRepo('yog-wiki-confirmation-missing-');
  validWiki(missingRoot);
  const modelPath = join(missingRoot, 'docs/wiki/_meta/model.json');
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  delete model.inputConfirmation;
  writeJson(modelPath, model);
  const missing = preflightWiki({ repoRoot: missingRoot });
  assert.equal(missing.result_status, 'invalid-wiki');
  assert.equal(missing.issues.some((item) => item.code === 'input-confirmation-invalid'), true);

  const mismatchRoot = tempRepo('yog-wiki-confirmation-mismatch-');
  validWiki(mismatchRoot);
  const manifestPath = join(mismatchRoot, 'docs/wiki/_meta/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.inputConfirmation.confirmedAt = '2026-07-14T00:01:00Z';
  writeJson(manifestPath, manifest);
  const mismatch = preflightWiki({ repoRoot: mismatchRoot });
  assert.equal(mismatch.result_status, 'invalid-wiki');
  assert.equal(mismatch.issues.some((item) => item.code === 'input-confirmation-mismatch'), true);
});

test('Wiki preflight blocks Claims backed only by stale Sources', () => {
  const repoRoot = tempRepo('yog-wiki-stale-source-');
  validWiki(repoRoot, { expiresAt: '2026-07-13T00:00:00.000Z' });
  const result = preflightWiki({ repoRoot, now: '2026-07-14T00:00:00.000Z' });
  assert.equal(result.result_status, 'invalid-wiki');
  assert.deepEqual(result.blockedClaimIds, ['claim-refund']);
  assert.deepEqual(result.staleSourceIds, ['current-code']);
});

test('Wiki Audit gate blocks matching P0/P1 findings at Claim or whole-Wiki scope', () => {
  const partialRepo = tempRepo('yog-wiki-gate-partial-');
  validWiki(partialRepo, { claimIds: ['claim-refund', 'claim-policy'] });
  const partialIdentity = currentWikiIdentity(partialRepo);
  writeDailyAudit({
    repoRoot: partialRepo,
    auditRoot: 'docs/wiki-audits',
    reportType: 'wiki-integrity-audit',
    period: '2026-07-14',
    findings: [{
      code: 'knowledge-reference-stale',
      severity: 'P1',
      ...partialIdentity,
      affectedClaimIds: ['claim-refund'],
      expected: 'verified Knowledge evidence',
      actual: 'stale',
    }],
  });
  const partial = preflightWiki({ repoRoot: partialRepo, auditRoot: 'docs/wiki-audits' });
  assert.equal(partial.result_status, 'partial');
  assert.deepEqual(partial.blockedClaimIds, ['claim-refund']);
  assert.equal(partial.wholeWikiBlocked, false);

  const blockedRepo = tempRepo('yog-wiki-gate-all-');
  validWiki(blockedRepo, { claimIds: ['claim-refund', 'claim-policy'] });
  const blockedIdentity = currentWikiIdentity(blockedRepo);
  writeDailyAudit({
    repoRoot: blockedRepo,
    auditRoot: 'docs/wiki-audits',
    reportType: 'wiki-integrity-audit',
    period: '2026-07-14',
    findings: [{
      code: 'source-snapshot-invalid',
      severity: 'P0',
      ...blockedIdentity,
      affectedClaimIds: ['claim-refund', 'claim-policy'],
      expected: 'current source snapshot',
      actual: 'invalid',
    }],
  });
  const blocked = preflightWiki({ repoRoot: blockedRepo, auditRoot: 'docs/wiki-audits' });
  assert.equal(blocked.result_status, 'invalid-wiki');
  assert.deepEqual(blocked.blockedClaimIds, ['claim-policy', 'claim-refund']);
  assert.equal(blocked.wholeWikiBlocked, true);
});

test('Wiki Audit gate honors resolutions and ignores findings for old Wiki runs', () => {
  const repoRoot = tempRepo('yog-wiki-gate-resolution-');
  validWiki(repoRoot);
  const identity = currentWikiIdentity(repoRoot);
  const finding = writeDailyAudit({
    repoRoot,
    auditRoot: 'docs/wiki-audits',
    reportType: 'wiki-integrity-audit',
    period: '2026-07-14',
    findings: [{
      code: 'knowledge-reference-stale',
      severity: 'P1',
      ...identity,
      affectedClaimIds: ['claim-refund'],
      expected: 'verified Knowledge evidence',
      actual: 'stale',
    }],
  });
  const fingerprint = finding.written[0].fingerprint;
  writeDailyAudit({
    repoRoot,
    auditRoot: 'docs/wiki-audits',
    reportType: 'wiki-integrity-audit',
    period: '2026-07-15',
    resolutions: [{ fingerprint, ...identity, conclusion: 'resolved after recheck' }],
  });
  assert.equal(preflightWiki({ repoRoot, auditRoot: 'docs/wiki-audits' }).result_status, 'ok');

  writeDailyAudit({
    repoRoot,
    auditRoot: 'docs/wiki-audits',
    reportType: 'wiki-integrity-audit',
    period: '2026-07-16',
    findings: [{
      code: 'old-run-invalid',
      severity: 'P0',
      wikiRunId: 'wiki-old-run',
      manifestHash: identity.manifestHash,
      expected: 'old run valid',
      actual: 'invalid',
    }],
  });
  assert.equal(preflightWiki({ repoRoot, auditRoot: 'docs/wiki-audits' }).result_status, 'ok');
});

test('Wiki Audit gate fails closed on malformed managed Audit blocks', () => {
  const repoRoot = tempRepo('yog-wiki-gate-malformed-');
  validWiki(repoRoot);
  const identity = currentWikiIdentity(repoRoot);
  const auditRoot = join(repoRoot, 'docs/wiki-audits');
  mkdirSync(auditRoot, { recursive: true });
  writeFileSync(join(auditRoot, '2026-07-14.md'), [
    '<!-- yog:audit:finding:broken -->',
    '```json',
    '{not-json}',
    '```',
    '<!-- /yog:audit:finding -->',
  ].join('\n'));

  const gate = evaluateWikiAuditGate({ repoRoot, auditRoot: 'docs/wiki-audits', ...identity, claimIds: ['claim-refund'] });
  assert.equal(gate.result_status, 'invalid-wiki');
  assert.equal(gate.wholeWikiBlocked, true);
  assert.equal(gate.issues.some((item) => item.code === 'audit-malformed'), true);
  assert.equal(preflightWiki({ repoRoot, auditRoot: 'docs/wiki-audits' }).result_status, 'invalid-wiki');
});

test('confidence filters exclude low-confidence governance objects', () => {
  const knowledge = filterKnowledgeDocuments([
    { id: 'v', status: 'verified' },
    { id: 'd', status: 'draft' },
    { id: 's', status: 'stale' },
    { id: 'n', status: 'needs-review' },
    { id: 'a', kind: 'adr', status: 'accepted' },
  ]);
  assert.deepEqual(knowledge.allowed.map((item) => item.id), ['v', 'd', 'a']);
  assert.deepEqual(knowledge.rejected.map((item) => item.id), ['s', 'n']);
  assert.equal(knowledge.result_status, 'partial');
  assert.equal(filterKnowledgeDocuments([{ status: 'stale' }]).result_status, 'not-found');

  const wiki = filterWikiFacts([
    { id: 'c', factLevel: 'confirmed' },
    { id: 'p', factLevel: 'partial' },
    { id: 'n', factLevel: 'needs-review' },
    { id: 'g', fact_level: 'gap' },
  ]);
  assert.deepEqual(wiki.allowed.map((item) => item.id), ['c', 'p']);
  assert.deepEqual(wiki.rejected.map((item) => item.id), ['n', 'g']);
  assert.equal(wiki.result_status, 'partial');
});

test('CodeGraph coverage and result status obey strict identity, revision, and dirty-path gates', () => {
  const base = { provider: { type: 'codegraph', status: 'configured' }, queryOk: true, repoIdentityMatch: true, graphRevision: 'abc', headRevision: 'abc' };
  assert.equal(evaluateCodeGraphCoverage(base).coverage_status, 'covered');
  assert.equal(evaluateCodeGraphCoverage({ ...base, repoIdentityMatch: false }).coverage_status, 'not-covered');
  assert.equal(evaluateCodeGraphCoverage({ ...base, graphRevision: 'old' }).coverage_status, 'not-covered');
  assert.equal(evaluateCodeGraphCoverage({ ...base, graphRevision: undefined }).coverage_status, 'unknown');
  assert.equal(evaluateCodeGraphCoverage({ ...base, relevantDirtyPaths: ['src/a.ts'] }).coverage_status, 'not-covered');
  assert.equal(evaluateCodeGraphCoverage({ ...base, relevantDirtyPaths: ['src/a.ts'], liveWorktreeCovered: true }).coverage_status, 'covered');
  assert.equal(classifyMismatch({ coverageStatus: 'covered', directConflict: true }), 'confirmed-conflict');
  assert.equal(classifyMismatch({ coverageStatus: 'covered', changeSignal: true }), 'possible-stale');
  assert.equal(classifyMismatch({ coverageStatus: 'unknown', directConflict: true }), 'insufficient-evidence');
  assert.equal(queryResultStatus({ usedDraft: true }), 'partial');
  assert.equal(queryResultStatus({ mismatchType: 'confirmed-conflict' }), 'partial');
  assert.equal(queryResultStatus({ terminalStatus: 'invalid-knowledge', usedDraft: true }), 'invalid-knowledge');
  assert.equal(queryResultStatus({}), 'ok');
  assert.equal(combineQueryResults('ok', 'ok'), 'ok');
  assert.equal(combineQueryResults('ok', 'not-found'), 'partial');
  assert.equal(combineQueryResults('partial', 'partial'), 'partial');
  assert.equal(combineQueryResults('not-found', 'not-managed'), 'failed');
});

test('Knowledge Audit upserts same-day findings and keeps historical files immutable', () => {
  const repoRoot = tempRepo('yog-audit-');
  const finding = { type: 'drift', affectedObject: 'refund', expected: 'old', actual: 'new', mismatch_type: 'confirmed-conflict' };
  const first = writeDailyAudit({ repoRoot, auditRoot: 'docs/knowledge/audits', reportType: 'audit', period: '2026-07-14', findings: [finding], commit: 'abc' });
  const firstContent = readFileSync(join(repoRoot, first.path), 'utf8');
  const second = writeDailyAudit({ repoRoot, auditRoot: 'docs/knowledge/audits', reportType: 'audit', period: '2026-07-14', findings: [finding], commit: 'def' });
  const secondContent = readFileSync(join(repoRoot, second.path), 'utf8');
  assert.equal((secondContent.match(/<!-- yog:audit:finding:/g) ?? []).length, 1);
  assert.match(secondContent, /"occurrence_count": 2/);
  assert.match(secondContent, /"first_seen_commit": "abc"/);
  assert.match(secondContent, /"last_seen_commit": "def"/);
  assert.match(secondContent, /## 代码一致性检测/);
  const fingerprint = second.written[0].fingerprint;
  writeDailyAudit({ repoRoot, auditRoot: 'docs/knowledge/audits', reportType: 'audit', period: '2026-07-15', resolutions: [{ fingerprint, conclusion: 'resolved' }], commit: 'ghi' });
  assert.equal(readFileSync(join(repoRoot, first.path), 'utf8'), secondContent);
  assert.notEqual(firstContent, secondContent);
  const resolution = readFileSync(join(repoRoot, 'docs/knowledge/audits/2026-07-15.md'), 'utf8');
  assert.equal((resolution.match(/<!-- yog:audit:resolution:/g) ?? []).length, 1);
  assert.match(resolution, /RES-/);

  writeDailyAudit({ repoRoot, auditRoot: 'docs/knowledge/audits', reportType: 'audit', period: '2026-07-15', resolutions: [{ fingerprint, conclusion: 'resolved' }], commit: 'ghi' });
  assert.equal(readFileSync(join(repoRoot, 'docs/knowledge/audits/2026-07-15.md'), 'utf8'), resolution);
});

test('Audit keeps Drift and integrity findings in their own sections', () => {
  const repoRoot = tempRepo('yog-audit-sections-');
  writeDailyAudit({
    repoRoot,
    auditRoot: 'docs/knowledge/audits',
    reportType: 'audit',
    period: '2026-07-14',
    findings: [
      { type: 'drift', affectedObject: 'refund-a', expected: 'old-a', actual: 'new-a' },
      { issue_id: 'KINT-CUSTOM', code: 'index-missing', path: 'docs/knowledge/index.json', expected: 'index', actual: 'missing' },
      { type: 'drift', affectedObject: 'refund-b', expected: 'old-b', actual: 'new-b' },
    ],
  });
  const content = readFileSync(join(repoRoot, 'docs/knowledge/audits/2026-07-14.md'), 'utf8');
  const driftStart = content.indexOf('## 代码一致性检测');
  const integrityStart = content.indexOf('## 结构完整性检测');
  assert.ok(driftStart >= 0 && integrityStart > driftStart);
  const driftSection = content.slice(driftStart, integrityStart);
  const integritySection = content.slice(integrityStart);
  assert.equal((driftSection.match(/### DRIFT-/g) ?? []).length, 2);
  assert.doesNotMatch(driftSection, /KINT-CUSTOM/);
  assert.match(integritySection, /### KINT-CUSTOM/);
});

test('Wiki integrity Audit stays outside docs/wiki and reports concurrent writer lock', () => {
  const repoRoot = tempRepo('yog-wiki-audit-');
  const output = writeDailyAudit({
    repoRoot,
    auditRoot: 'docs/wiki-audits',
    reportType: 'wiki-integrity-audit',
    period: '2026-07-14',
    wikiRoot: 'docs/wiki',
    findings: [{ code: 'manifest-missing', path: 'docs/wiki/_meta/manifest.json', expected: 'manifest', actual: 'missing' }],
  });
  assert.equal(output.path, 'docs/wiki-audits/2026-07-14.md');
  assert.equal(existsSync(join(repoRoot, 'docs/wiki/2026-07-14.md')), false);
  const content = readFileSync(join(repoRoot, output.path), 'utf8');
  assert.match(content, /report_type: wiki-integrity-audit/);
  assert.match(content, /status: invalid/);
  assert.match(content, /WINT-/);
  assert.match(content, /未扫描 Wiki 页面/);
  assert.match(content, /未生成 Wiki/);
  assert.match(content, /未修改 `docs\/wiki` 源文件/);
  assert.match(content, /未输出产品结论/);
  writeFileSync(join(repoRoot, `${output.path}.lock`), 'locked');
  assert.throws(() => writeDailyAudit({ repoRoot, auditRoot: 'docs/wiki-audits', reportType: 'wiki-integrity-audit', period: '2026-07-14' }), { code: 'audit-concurrent-update' });
});
