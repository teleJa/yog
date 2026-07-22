import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewItems, validateReviewItems } from '../../skills/yog/lib/wiki-review.mjs';

function fact(value, evidenceIds = ['evidence-api']) {
  return { value, level: 'confirmed', evidenceIds };
}

function baseInput() {
  const feature = {
    id: 'course-library', kind: 'feature', name: '课程库', operationRefs: ['operation:save-course'],
    ruleRefs: [], stateMachineRefs: [], permissionRefs: [], interfaceRefs: [], flowRefs: [], dataEntityRefs: [],
  };
  const operation = {
    id: 'save-course', kind: 'operation', name: '保存课程', actorRefs: ['role:operator'],
    action: fact('保存课程'), preconditions: [fact('课程名称已填写')], outcomes: [fact('课程保存成功')],
    errorOutcomes: [fact('名称为空时拒绝保存')], claimIds: ['claim-save'], evidenceIds: ['evidence-api'],
  };
  const role = { id: 'operator', kind: 'role', name: '运营人员' };
  return {
    catalog: { systems: [], domains: [], modules: [], features: [feature] },
    objects: {
      pages: [], operations: [operation], scenarios: [], flows: [], stateMachines: [], rules: [], roles: [role],
      permissions: [], dataEntities: [], metrics: [], interfaces: [], requirements: [], acceptanceCriteria: [], versions: [],
    },
    claims: [{ id: 'claim-save', subjectRef: 'operation:save-course', layer: 'current', factLevel: 'confirmed', text: '保存课程', evidenceIds: ['evidence-api'] }],
    evidence: [{ id: 'evidence-api', precision: 'symbol', repositorySurface: 'backend' }],
    gaps: [],
  };
}

test('ReviewItem generation creates one atomic item per normal or failure outcome', () => {
  const input = baseInput();
  const result = buildReviewItems(input);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.proposal.branchType).sort(), ['failure', 'normal']);
  assert.equal(result.items.every((item) => item.sourceFactLevel === 'confirmed'), true);
  assert.equal(result.items.every((item) => item.observedSurfaces.includes('backend')), true);
  assert.equal(result.items.some((item) => item.question.startsWith('运营人员执行')), true);
  assert.equal(result.items.some((item) => item.question.includes('role:operator')), false);
  assert.deepEqual(result.diagnostics, { rawCandidateCount: 2, reviewItemCount: 2, mergedCandidateCount: 0, suppressedCandidateCount: 0 });
});

test('ReviewItem generation suppresses file-only or needs-review behavior proof', () => {
  const fileOnly = baseInput();
  fileOnly.evidence[0].precision = 'file';
  assert.deepEqual(buildReviewItems(fileOnly).items, []);

  const uncertain = baseInput();
  uncertain.claims[0].factLevel = 'needs-review';
  assert.deepEqual(buildReviewItems(uncertain).items, []);
});

test('Permission observations aggregate compatible enforcement layers without borrowing evidence', () => {
  const input = baseInput();
  input.catalog.features[0].operationRefs = [];
  input.catalog.features[0].permissionRefs = ['permission:manage-course'];
  input.objects.permissions.push({
    id: 'manage-course', kind: 'permission', name: '课程管理权限', claimIds: ['claim-permission'], evidenceIds: ['evidence-ui', 'evidence-api'],
    rows: [
      { roleRef: 'role:operator', resourceRef: 'feature:course-library', action: '保存课程', condition: '拥有课程管理权限', decision: 'allow', enforcementLayer: 'ui', claimIds: ['claim-permission'], evidenceIds: ['evidence-ui'] },
      { roleRef: 'role:operator', resourceRef: 'feature:course-library', action: '保存课程', condition: '拥有课程管理权限', decision: 'allow', enforcementLayer: 'api', claimIds: ['claim-permission'], evidenceIds: ['evidence-api'] },
    ],
  });
  input.claims = [{ id: 'claim-permission', subjectRef: 'permission:manage-course', layer: 'current', factLevel: 'confirmed', text: '课程管理权限', evidenceIds: ['evidence-ui', 'evidence-api'] }];
  input.evidence = [
    { id: 'evidence-ui', precision: 'symbol', repositorySurface: 'frontend' },
    { id: 'evidence-api', precision: 'symbol', repositorySurface: 'backend' },
  ];
  const result = buildReviewItems(input);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].observedSurfaces, ['api', 'backend', 'frontend', 'ui']);
  assert.deepEqual(result.items[0].evidenceIds, ['evidence-api', 'evidence-ui']);
});

test('ReviewItem validator rejects semantic duplication and fingerprint drift', () => {
  const input = baseInput();
  const items = buildReviewItems(input).items;
  const context = {
    refSet: new Set(['feature:course-library', 'operation:save-course', 'role:operator']),
    claimById: new Map(input.claims.map((item) => [item.id, item])),
    evidenceById: new Map(input.evidence.map((item) => [item.id, item])),
    gapById: new Map(),
  };
  assert.equal(validateReviewItems(items, context).length, 2);
  assert.throws(() => validateReviewItems([items[0], structuredClone(items[0])], context), (error) => error.code === 'wiki-review-duplicate');
  const changed = structuredClone(items[0]);
  changed.proposal.then = ['其他结果'];
  assert.throws(() => validateReviewItems([changed], context), (error) => error.code === 'wiki-review-fingerprint-invalid');
});

test('Flow async behavior and Data sensitivity create product-review candidates without exposing field inventory', () => {
  const input = baseInput();
  input.catalog.features[0].operationRefs = [];
  input.catalog.features[0].flowRefs = ['flow:publish-course'];
  input.catalog.features[0].dataEntityRefs = ['data-entity:course-record'];
  input.objects.flows.push({
    id: 'publish-course', kind: 'flow', name: '发布课程', trigger: fact('运营发布课程'), exceptionPaths: [],
    edges: [{ from: 'publish', to: 'notify', label: '异步通知观看端', condition: '发布成功', interactionType: 'async', claimIds: ['claim-flow'], evidenceIds: ['evidence-api'] }],
    claimIds: ['claim-flow'], evidenceIds: ['evidence-api'],
  });
  input.objects.dataEntities.push({
    id: 'course-record', kind: 'data-entity', name: '课程记录', sensitivity: fact('内部敏感'), fields: [{ name: 'id' }],
    claimIds: ['claim-data'], evidenceIds: ['evidence-api'],
  });
  input.claims = [
    { id: 'claim-flow', subjectRef: 'flow:publish-course', layer: 'current', factLevel: 'confirmed', text: '异步通知观看端', evidenceIds: ['evidence-api'] },
    { id: 'claim-data', subjectRef: 'data-entity:course-record', layer: 'current', factLevel: 'confirmed', text: '课程记录为内部敏感', evidenceIds: ['evidence-api'] },
  ];
  const result = buildReviewItems(input);
  assert.equal(result.items.some((item) => item.observedBehavior.includes('async')), true);
  assert.equal(result.items.some((item) => item.question.includes('数据敏感性')), true);
  assert.equal(result.items.some((item) => item.question.includes('字段')), false);
});
