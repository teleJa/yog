import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DEFAULT_WIKI_CONFIG } from '../../skills/yog/lib/config.mjs';
import { confirmWikiConfig, createArtifact, prepareWikiConfig } from '../../skills/yog/lib/wiki-source-registry.mjs';
import {
  createSourceArtifactEnvelope,
  stageWikiGenerationInput,
} from '../../skills/yog/lib/wiki-input-orchestrator.mjs';
import { composeWikiModelInput } from '../../skills/yog/lib/wiki-model-composer.mjs';
import { buildProductWiki } from '../../skills/yog/lib/wiki.mjs';
import { confirmDecisionRecord, renderDecisionRecord } from '../../skills/yog/lib/wiki-decision.mjs';

const sha = `sha256:${'a'.repeat(64)}`;

function confirmedConfig(outputRoot, { decisionSource = false } = {}) {
  const candidate = {
    schemaVersion: 1,
    language: 'zh-CN',
    wiki: structuredClone(DEFAULT_WIKI_CONFIG),
  };
  candidate.wiki.sources.find((source) => source.kind === 'catalog').scope.rootNodeIds = ['system-example'];
  if (decisionSource) {
    const source = candidate.wiki.sources.find((item) => item.kind === 'spec');
    source.enabled = true;
    source.scope.paths = ['docs/wiki-inputs/decisions'];
    source.transports[0].enabled = true;
    source.transports[0].paths = ['docs/wiki-inputs/decisions'];
  }
  const prepared = prepareWikiConfig(candidate, { outputRoot });
  return confirmWikiConfig(prepared, {
    outputRoot,
    inputFingerprint: prepared.wiki.confirmation.inputFingerprint,
    confirmedAt: '2026-07-15T08:00:00.000Z',
    decisions: prepared.wiki.sources.filter((source) => source.enabled).map((source) => ({
      sourceId: source.id,
      decision: source.required || (decisionSource && source.kind === 'spec') ? 'confirm' : 'disable',
      scopeFingerprint: source.confirmation.scopeFingerprint,
    })),
  });
}

function collectedInput(config) {
  const capturedAt = '2026-07-15T08:10:00.000Z';
  const catalogSource = config.wiki.sources.find((source) => source.id === 'product-catalog');
  const codeSource = config.wiki.sources.find((source) => source.id === 'current-code');
  const catalogArtifact = createArtifact(createSourceArtifactEnvelope(catalogSource, {
    capturedAt,
    sourceRevision: sha,
    transportIds: ['catalog-file'],
  }), {
    scope: { confirmedByUser: true, rootNodeIds: ['system-example'] },
    nodes: [
      { id: 'system-example', kind: 'system', parentId: null, name: '示例系统', order: 10, enabled: true, sourceIdentity: { type: 'menu-key', value: 'system-example' }, routeKeys: [], evidenceIds: ['evidence-system'] },
      { id: 'domain-example', kind: 'domain', parentId: 'system-example', name: '示例域', order: 20, enabled: true, sourceIdentity: { type: 'menu-key', value: 'domain-example' }, routeKeys: [], evidenceIds: ['evidence-domain'] },
      { id: 'module-example', kind: 'module', parentId: 'domain-example', name: '示例模块', order: 30, enabled: true, sourceIdentity: { type: 'menu-key', value: 'module-example' }, routeKeys: [], evidenceIds: ['evidence-module'] },
      { id: 'feature-example', kind: 'feature', parentId: 'module-example', name: '示例功能', order: 40, enabled: true, sourceIdentity: { type: 'menu-key', value: 'feature-example' }, routeKeys: [], evidenceIds: ['evidence-feature'] },
    ],
  });
  const codeArtifact = createArtifact(createSourceArtifactEnvelope(codeSource, {
    capturedAt,
    sourceRevision: sha,
    transportIds: ['worktree-files'],
  }), {
    repositories: [{ id: 'repo-example', sourceRoot: '.', rootRef: 'source:current-code', commit: 'abc123', dirty: false, surface: 'backend', scope: { include: ['.'], exclude: ['docs/wiki'] } }],
    facts: [{
      id: 'fact-operation',
      factKind: 'operation',
      locator: { repositoryId: 'repo-example', path: 'src/example.mjs', precision: 'symbol', startLine: 1, endLine: 3, symbol: 'inspectExample' },
      text: '示例功能支持检查操作',
      candidateRefs: ['feature:feature-example'],
      evidenceId: 'evidence-operation',
    }],
  });
  const sourceResults = [
    { sourceId: catalogSource.id, kind: catalogSource.kind, provider: catalogSource.provider, status: 'collected', required: true, capturedAt, sourceRevision: sha, fingerprint: sha, artifactCount: 1, reasonCode: null, transportResults: [], gapIds: [], diagnostics: [] },
    { sourceId: codeSource.id, kind: codeSource.kind, provider: codeSource.provider, status: 'collected', required: true, capturedAt, sourceRevision: sha, fingerprint: sha, artifactCount: 1, reasonCode: null, transportResults: [], gapIds: [], diagnostics: [] },
  ];
  return { sourceResults, artifacts: [catalogArtifact, codeArtifact] };
}

function genericPublicInput(outputRoot, options = {}) {
  const config = confirmedConfig(outputRoot, options);
  const collected = collectedInput(config);
  return {
    config,
    outputRoot,
    runId: 'wiki-generic-compose-test',
    generatedAt: '2026-07-15T08:20:00.000Z',
    sourceResults: collected.sourceResults,
    artifacts: collected.artifacts,
    semanticDraft: {
      schemaVersion: 1,
      candidates: [{
        key: 'inspect-example',
        kind: 'operation',
        name: '检查示例',
        subjectRefs: ['feature:feature-example'],
        confirmedEmptyFields: ['actorRefs', 'preconditions', 'errorOutcomes'],
        fields: {
          action: '检查示例状态',
          actorRefs: [],
          preconditions: [],
          outcomes: ['返回检查结果'],
          errorOutcomes: [],
        },
        claims: [{
          key: 'current-behavior',
          layer: 'current',
          factLevel: 'confirmed',
          text: '示例功能支持检查操作',
          evidenceRefs: ['evidence-operation'],
        }],
      }],
    },
  };
}

test('Source Artifact envelopes inherit the exact confirmed scope fingerprint', () => {
  const config = confirmedConfig(mkdtempSync(`${tmpdir()}/yog-wiki-envelope-`));
  const source = config.wiki.sources.find((item) => item.id === 'current-code');
  const envelope = createSourceArtifactEnvelope(source, {
    capturedAt: '2026-07-15T08:10:00.000Z',
    sourceRevision: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    transportIds: ['worktree-files'],
  });
  assert.equal(envelope.provenance.scopeFingerprint, source.confirmation.scopeFingerprint);
  assert.equal(envelope.provenance.provider, 'git-worktree');
});

test('Source Artifact envelopes reject capture before Source confirmation', () => {
  const config = confirmedConfig(mkdtempSync(`${tmpdir()}/yog-wiki-envelope-time-`));
  const source = config.wiki.sources.find((item) => item.id === 'current-code');
  assert.throws(
    () => createSourceArtifactEnvelope(source, {
      capturedAt: '2026-07-15T07:59:59.999Z',
      sourceRevision: sha,
      transportIds: ['worktree-files'],
    }),
    (error) => error.code === 'wiki-source-scope-unconfirmed' && error.path === '$.capturedAt',
  );
});

test('Generation staging rejects Source Results and Artifacts captured before confirmation', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-stage-time-`);
  const config = confirmedConfig(outputRoot);
  const collected = collectedInput(config);
  const input = {
    config,
    outputRoot,
    sourceResults: collected.sourceResults,
    artifacts: collected.artifacts,
  };
  const earlyResults = structuredClone(input);
  earlyResults.sourceResults[0].capturedAt = '2026-07-15T07:59:59.999Z';
  assert.throws(
    () => stageWikiGenerationInput(earlyResults),
    (error) => error.code === 'wiki-source-scope-unconfirmed' && error.path === '$.sourceResult.capturedAt',
  );

  const earlyArtifactInput = structuredClone(input);
  const current = earlyArtifactInput.artifacts[0];
  const { schemaVersion, fingerprint, kind, sourceId, sourceRevision, provenance, capturedAt, ...payload } = current;
  earlyArtifactInput.artifacts[0] = createArtifact({
    kind,
    sourceId,
    sourceRevision,
    provenance,
    capturedAt: '2026-07-15T07:59:59.999Z',
  }, payload);
  assert.throws(
    () => stageWikiGenerationInput(earlyArtifactInput),
    (error) => error.code === 'wiki-source-scope-unconfirmed' && error.path === '$.artifact.capturedAt',
  );
});

test('Generation staging derives configured Sources and Wiki root only from confirmed config', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-stage-`);
  const config = confirmedConfig(outputRoot);
  const collected = collectedInput(config);
  const staged = stageWikiGenerationInput({
    config,
    outputRoot,
    runId: 'wiki-stage-test',
    generatedAt: '2026-07-15T08:10:00.000Z',
    sourceResults: collected.sourceResults,
    artifacts: collected.artifacts,
    semanticDraft: { schemaVersion: 1, candidates: [] },
  });
  assert.equal(staged.wikiRoot, 'docs/wiki');
  assert.deepEqual(staged.configuredSources, config.wiki.sources);
  assert.equal(staged.inputConfirmation.inputFingerprint, config.wiki.confirmation.inputFingerprint);
  assert.equal('config' in staged, false);
});

test('Generation staging rejects final canonical fields from public callers', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-stage-final-model-`);
  const config = confirmedConfig(outputRoot);
  const collected = collectedInput(config);
  assert.throws(
    () => stageWikiGenerationInput({
      config,
      outputRoot,
      sourceResults: collected.sourceResults,
      artifacts: collected.artifacts,
      semanticDraft: { schemaVersion: 1, candidates: [] },
      catalog: { systems: [], domains: [], modules: [], features: [] },
    }),
    (error) => error.code === 'wiki-public-final-model-forbidden' && error.path === '$.catalog',
  );
});

test('Generic composer builds a validator-ready model from Artifacts and semanticDraft', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-compose-`);
  const publicInput = genericPublicInput(outputRoot);
  const first = composeWikiModelInput(stageWikiGenerationInput(publicInput));
  const second = composeWikiModelInput(stageWikiGenerationInput(publicInput));
  assert.deepEqual(second, first);
  assert.equal(first.catalog.features[0].operationRefs.includes('operation:inspect-example'), true);
  assert.equal(first.governance.coverage && Object.keys(first.governance.coverage).length, 0);
  assert.equal(first.governance.gaps.some((gap) => gap.fieldRefs.includes('feature:feature-example.acceptanceCriteriaRefs')), true);
  for (const field of ['pageRefs', 'scenarioRefs', 'flowRefs', 'stateMachineRefs', 'ruleRefs', 'roleRefs', 'permissionRefs', 'dataEntityRefs', 'metricRefs', 'interfaceRefs', 'versionRefs']) {
    assert.equal(first.governance.gaps.some((gap) => gap.fieldRefs.includes(`feature:feature-example.${field}`)), false, field);
  }
  const build = buildProductWiki(first);
  assert.equal(build.model.kind, 'yog-product-wiki-model');
  assert.equal(build.model.objects.operations[0].id, 'inspect-example');
  assert.notEqual(build.model.governance.publication.status, 'publishable');
});

test('Generic composer binds Flow structure to selected Claim and Evidence instead of copying candidate proof', () => {
  const input = genericPublicInput(mkdtempSync(`${tmpdir()}/yog-wiki-compose-flow-`));
  input.semanticDraft.candidates.push({
    key: 'inspect-flow',
    kind: 'flow',
    name: '示例检查流程',
    subjectRefs: ['feature:feature-example'],
    confirmedEmptyFields: ['exceptionPaths'],
    fields: {
      goal: '完成示例状态检查',
      scope: ['检查并返回结果'],
      nonScope: ['修改示例状态'],
      trigger: '用户发起检查',
      entryRefs: ['inspect-example'],
      phases: [{ id: 'main', label: '主流程', order: 1, claimKeys: ['current-path'], evidenceRefs: ['evidence-operation'] }],
      lanes: [{ id: 'service', label: '示例服务', laneType: 'primary-system', subjectRef: 'system:system-example', order: 1, claimKeys: ['current-path'], evidenceRefs: ['evidence-operation'] }],
      nodes: [
        { id: 'inspect', label: '检查状态', laneId: 'service', phaseId: 'main', nodeType: 'service-action', claimKeys: ['current-path'], evidenceRefs: ['evidence-operation'] },
        { id: 'return', label: '返回结果', laneId: 'service', phaseId: 'main', nodeType: 'result', claimKeys: ['current-path'], evidenceRefs: ['evidence-operation'] },
      ],
      edges: [{ id: 'return-result', from: 'inspect', to: 'return', label: '异步检查完成', pathType: 'main', interactionType: 'async', condition: '检查任务完成', claimKeys: ['current-path'], evidenceRefs: ['evidence-operation'] }],
      exceptionPaths: [],
      stateMachineRefs: [],
      interaction: { sequenceGroups: [], participants: [], messages: [] },
      viewAssessments: {
        state: { applicability: 'not-applicable', reason: '只读检查不改变业务状态', evidenceRefs: ['evidence-operation'], gapIds: [] },
        sequence: { applicability: 'not-applicable', reason: '单服务本地流程', evidenceRefs: ['evidence-operation'], gapIds: [] },
      },
    },
    claims: [
      { key: 'expected-goal', layer: 'expected', factLevel: 'confirmed', text: '流程目标是完成示例检查', evidenceRefs: ['evidence-feature'] },
      { key: 'current-path', layer: 'current', factLevel: 'confirmed', text: '检查与返回路径已实现', evidenceRefs: ['evidence-operation'] },
    ],
  });
  const composed = composeWikiModelInput(stageWikiGenerationInput(input));
  const flow = composed.objects.flows[0];
  assert.deepEqual(flow.nodes[0].evidenceIds, ['evidence-operation']);
  assert.equal(flow.nodes[0].claimIds.length, 1);
  assert.equal('claimKeys' in flow.nodes[0], false);
  assert.equal('evidenceRefs' in flow.nodes[0], false);
  assert.equal(composed.governance.gaps.some((gap) => gap.fieldRefs.includes('flow:inspect-flow.stateMachineRefs')), false);
  assert.doesNotThrow(() => buildProductWiki(composed));

  const unrelated = structuredClone(input);
  unrelated.semanticDraft.candidates[1].fields.nodes[0].claimKeys = ['expected-goal'];
  assert.throws(
    () => composeWikiModelInput(stageWikiGenerationInput(unrelated)),
    (error) => error.code === 'wiki-semantic-structured-proof-invalid' && error.path.includes('.fields.nodes[0]'),
  );

  const unknownSequence = structuredClone(input);
  unknownSequence.semanticDraft.candidates[1].fields.viewAssessments.sequence = {
    applicability: 'unknown',
    reason: '尚无调用顺序证据',
    evidenceRefs: [],
    gapKeys: ['sequence-evidence'],
  };
  unknownSequence.semanticDraft.gaps = [{
    key: 'sequence-evidence',
    type: 'evidence-gap',
    severity: 'P1',
    description: '需要补充示例检查的调用顺序证据',
    subjects: ['inspect-flow'],
    fields: ['interaction'],
    evidenceRefs: [],
  }];
  const unknownComposed = composeWikiModelInput(stageWikiGenerationInput(unknownSequence));
  const assessment = unknownComposed.objects.flows[0].viewAssessments.sequence;
  assert.equal(assessment.gapIds.length, 1);
  assert.equal('gapKeys' in assessment, false);
  const unknownBuild = buildProductWiki(unknownComposed);
  const flowPage = unknownBuild.files.find((file) => file.path.includes('/业务流程/') && file.path.endsWith('示例检查流程.md')).content;
  assert.doesNotMatch(flowPage, /sequenceDiagram/);
  assert.match(flowPage, /尚无调用顺序证据/);
});

test('Evidence registry rejects one Evidence ID reused across Catalog locations', () => {
  const input = genericPublicInput(mkdtempSync(`${tmpdir()}/yog-wiki-compose-shared-evidence-`));
  const catalog = input.artifacts.find((artifact) => artifact.kind === 'catalog-artifact');
  const { schemaVersion, fingerprint, kind, sourceId, capturedAt, sourceRevision, provenance, ...payload } = catalog;
  payload.nodes = payload.nodes.map((node) => ({ ...node, evidenceIds: ['evidence-catalog-shared'] }));
  input.artifacts[input.artifacts.indexOf(catalog)] = createArtifact({ kind, sourceId, capturedAt, sourceRevision, provenance }, payload);
  input.semanticDraft.candidates = [];
  assert.throws(
    () => stageWikiGenerationInput(input),
    (error) => error.code === 'source-artifact-invalid' && /Catalog Evidence ID/.test(error.message),
  );
});

test('Generic composer rejects missing Evidence, wrong authority, and Catalog mutation', () => {
  const missing = genericPublicInput(mkdtempSync(`${tmpdir()}/yog-wiki-compose-missing-evidence-`));
  missing.semanticDraft.candidates[0].claims[0].evidenceRefs = ['evidence-not-collected'];
  assert.throws(
    () => composeWikiModelInput(stageWikiGenerationInput(missing)),
    (error) => error.code === 'wiki-semantic-evidence-missing' && error.path.endsWith('.evidenceRefs[0]'),
  );

  const wrongAuthority = genericPublicInput(mkdtempSync(`${tmpdir()}/yog-wiki-compose-wrong-authority-`));
  wrongAuthority.semanticDraft.candidates[0].claims[0].layer = 'expected';
  assert.throws(
    () => composeWikiModelInput(stageWikiGenerationInput(wrongAuthority)),
    (error) => error.code === 'wiki-semantic-evidence-authority-invalid' && error.path.endsWith('.evidenceRefs'),
  );

  const renamed = genericPublicInput(mkdtempSync(`${tmpdir()}/yog-wiki-compose-catalog-rename-`));
  renamed.semanticDraft.candidates.push({
    kind: 'feature', ref: 'feature:feature-example', name: '被改名的功能', fields: {}, claims: [],
  });
  assert.throws(
    () => composeWikiModelInput(stageWikiGenerationInput(renamed)),
    (error) => error.code === 'wiki-semantic-catalog-authority-invalid' && error.path.endsWith('.name'),
  );
});

test('Generic composer keeps Expected and Current Claims separate and materializes declared conflicts', () => {
  const input = genericPublicInput(mkdtempSync(`${tmpdir()}/yog-wiki-compose-conflict-`));
  input.semanticDraft.conflicts = [{
    key: 'feature-purpose-conflict',
    subject: 'feature:feature-example',
    field: 'purpose',
    description: '目录目标与当前代码行为需要产品确认。',
    evidenceRefs: ['evidence-feature', 'evidence-operation'],
  }];
  const composed = composeWikiModelInput(stageWikiGenerationInput(input));
  const featureClaims = composed.governance.claims.filter((claim) => claim.subjectRef === 'feature:feature-example');
  assert.deepEqual([...new Set(featureClaims.map((claim) => claim.layer))].sort(), ['current', 'expected']);
  const conflict = composed.governance.gaps.find((gap) => gap.type === 'conflict-gap');
  assert.deepEqual(conflict.fieldRefs, ['feature:feature-example.purpose']);
  assert.deepEqual(conflict.evidenceIds, ['evidence-feature', 'evidence-operation']);
});

test('Confirmed Decision Artifacts resolve one exact Gap and add only Expected Claims', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-compose-confirmation-`);
  const initial = composeWikiModelInput(stageWikiGenerationInput(genericPublicInput(outputRoot)));
  const gap = initial.governance.gaps.find((item) => item.fieldRefs.includes('feature:feature-example.purpose'));
  assert.ok(gap);

  const input = genericPublicInput(outputRoot, { decisionSource: true });
  const specSource = input.config.wiki.sources.find((source) => source.kind === 'spec');
  const draft = {
    decisionId: 'decision-feature-purpose',
    target: { kind: 'gap', id: gap.id },
    outcome: 'confirm',
    subjectRef: 'feature:feature-example',
    fieldRefs: gap.fieldRefs,
    status: 'draft',
    answer: { purpose: '示例功能用于验证通用 Composer。' },
    rationale: '形成可复用的产品目标基线。',
    scope: ['示例功能'],
    nonScope: ['其他系统'],
    supersedes: [],
    resolution: { kind: 'set-field', field: 'purpose', value: '示例功能用于验证通用 Composer。' },
  };
  const decision = confirmDecisionRecord(draft, { confirmedBy: '产品经理', confirmedRole: 'PM', confirmedAt: '2026-07-15T08:15:00.000Z' });
  const content = renderDecisionRecord(decision);
  const artifact = createArtifact(createSourceArtifactEnvelope(specSource, {
    capturedAt: '2026-07-15T08:16:00.000Z',
    sourceRevision: sha,
    transportIds: ['spec-files'],
    artifactKind: 'decision-artifact',
  }), {
    document: {
      path: `docs/wiki-inputs/decisions/system-example/feature-example/${gap.id}.md`,
      title: '示例功能产品目标确认',
      contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    },
    decision,
    evidenceId: 'evidence-feature-purpose-decision',
  });
  input.sourceResults.push({
    sourceId: specSource.id, kind: specSource.kind, provider: specSource.provider, status: 'collected', required: false,
    capturedAt: '2026-07-15T08:16:00.000Z', sourceRevision: sha, fingerprint: sha, artifactCount: 1,
    reasonCode: null, transportResults: [], gapIds: [], diagnostics: [],
  });
  input.artifacts.push(artifact);
  input.confirmationDecisions = [{
    key: 'confirm-feature-purpose',
    target: { kind: 'gap', id: gap.id },
    subject: 'feature:feature-example',
    text: '示例功能用于验证通用 Composer。',
    evidenceRefs: ['evidence-feature-purpose-decision'],
    decisionFingerprint: decision.decisionFingerprint,
  }];
  const composed = composeWikiModelInput(stageWikiGenerationInput(input));
  const resolved = composed.governance.gaps.find((item) => item.id === gap.id);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.resolvedByDecisionId, decision.decisionId);
  assert.equal(composed.catalog.features[0].purpose, '示例功能用于验证通用 Composer。');
  assert.equal(composed.governance.claims.some((claim) => claim.text === '示例功能用于验证通用 Composer。' && claim.layer === 'expected'), true);
  assert.doesNotThrow(() => buildProductWiki(composed));

  const spoofedResolution = structuredClone(composed);
  spoofedResolution.catalog.features[0].purpose = '未经过人工确认的其他目标。';
  assert.throws(
    () => buildProductWiki(spoofedResolution),
    (error) => error.code === 'wiki-gap-resolution-invalid' && error.path === 'feature:feature-example.purpose',
  );

  const partialClaim = structuredClone(input);
  partialClaim.confirmationDecisions[0].factLevel = 'partial';
  assert.throws(
    () => composeWikiModelInput(stageWikiGenerationInput(partialClaim)),
    (error) => error.code === 'wiki-gap-resolution-invalid' && error.path === '$.confirmationDecisions[0].factLevel',
  );

  const unsupported = structuredClone(input);
  unsupported.confirmationDecisions[0].evidenceRefs = ['evidence-operation'];
  assert.throws(
    () => composeWikiModelInput(stageWikiGenerationInput(unsupported)),
    (error) => error.code === 'wiki-decision-resolution-invalid' && error.path === '$.confirmationDecisions[0].evidenceRefs',
  );
});

test('ReviewItem Decision confirms one proposal into Human Expected Claim and Atomic Acceptance Criteria', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-review-confirmation-`);
  const addRuleCandidate = (value) => value.semanticDraft.candidates.push({
    key: 'reviewable-inspection-rule',
    kind: 'rule',
    name: '可审核检查规则',
    subjectRefs: ['feature:feature-example'],
    confirmedEmptyFields: ['exceptions', 'configurationRefs'],
    fields: {
      trigger: '发起示例检查', conditions: ['示例存在'], effects: ['返回当前状态'], priority: 10,
      exceptions: [], configurationRefs: [],
    },
    claims: [{ layer: 'current', factLevel: 'confirmed', text: '示例存在时返回当前状态', evidenceRefs: ['evidence-operation'] }],
  });
  const initialInput = genericPublicInput(outputRoot);
  addRuleCandidate(initialInput);
  const initialModel = composeWikiModelInput(stageWikiGenerationInput(initialInput));
  const initialBuild = buildProductWiki(initialModel);
  const reviewItem = initialBuild.model.governance.reviewItems.find((item) => item.reviewKind === 'business-rule');
  assert.ok(reviewItem);

  const input = genericPublicInput(outputRoot, { decisionSource: true });
  addRuleCandidate(input);
  const specSource = input.config.wiki.sources.find((source) => source.kind === 'spec');
  const draft = {
    decisionId: `decision-${reviewItem.id}`,
    target: { kind: 'review-item', id: reviewItem.id, sourceFingerprint: reviewItem.sourceFingerprint },
    outcome: 'confirm',
    status: 'draft',
    answer: { proposal: {
      criterionType: reviewItem.proposal.branchType,
      given: reviewItem.proposal.given,
      when: reviewItem.proposal.when,
      then: reviewItem.proposal.then,
    } },
    rationale: '确认当前主路径为产品基线。',
    scope: ['示例功能'],
    nonScope: [],
    supersedes: [],
  };
  const decision = confirmDecisionRecord(draft, { confirmedBy: '产品经理', confirmedRole: 'PM', confirmedAt: '2026-07-15T08:15:00.000Z' });
  const content = renderDecisionRecord(decision);
  const artifact = createArtifact(createSourceArtifactEnvelope(specSource, {
    capturedAt: '2026-07-15T08:16:00.000Z',
    sourceRevision: sha,
    transportIds: ['spec-files'],
    artifactKind: 'decision-artifact',
  }), {
    document: {
      path: `docs/wiki-inputs/decisions/system-example/feature-example/${reviewItem.id}.md`,
      title: '示例功能原子验收确认',
      contentHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    },
    decision,
    evidenceId: 'evidence-review-decision',
  });
  input.sourceResults.push({
    sourceId: specSource.id, kind: specSource.kind, provider: specSource.provider, status: 'collected', required: false,
    capturedAt: '2026-07-15T08:16:00.000Z', sourceRevision: sha, fingerprint: sha, artifactCount: 1,
    reasonCode: null, transportResults: [], gapIds: [], diagnostics: [],
  });
  input.artifacts.push(artifact);
  input.confirmationDecisions = [{
    target: { kind: 'review-item', id: reviewItem.id, sourceFingerprint: reviewItem.sourceFingerprint },
    evidenceRefs: ['evidence-review-decision'],
    decisionFingerprint: decision.decisionFingerprint,
  }];
  const composed = composeWikiModelInput(stageWikiGenerationInput(input));
  const applied = composed.governance.reviewItems.find((item) => item.id === reviewItem.id);
  assert.equal(applied.status, 'confirmed');
  assert.equal(applied.decisionId, decision.decisionId);
  const criterion = composed.objects.acceptanceCriteria.find((item) => item.decisionId === decision.decisionId);
  assert.equal(criterion.criterionType, reviewItem.proposal.branchType);
  assert.deepEqual(criterion.then, reviewItem.proposal.then);
  assert.equal(composed.governance.claims.some((claim) => claim.subjectRef === `acceptance-criteria:${criterion.id}` && claim.layer === 'expected'), true);
  assert.doesNotThrow(() => buildProductWiki(composed));

  const stale = structuredClone(input);
  stale.semanticDraft.candidates.find((candidate) => candidate.key === 'reviewable-inspection-rule').claims[0].factLevel = 'partial';
  const drifted = composeWikiModelInput(stageWikiGenerationInput(stale));
  assert.equal(drifted.governance.reviewItems.find((item) => item.id === reviewItem.id).status, 'drift');
  assert.equal(drifted.governance.gaps.some((gap) => gap.type === 'conflict-gap' && gap.severity === 'P0'), true);
});

test('Requirement adapter never promotes an adopted historical item to baseline implicitly', () => {
  const input = genericPublicInput(mkdtempSync(`${tmpdir()}/yog-wiki-compose-requirement-`));
  const staged = stageWikiGenerationInput(input);
  staged.sourceResults.push({ sourceId: 'primary-requirements', kind: 'requirement', provider: 'tapd' });
  staged.artifacts.push(createArtifact({
    kind: 'requirement-artifact',
    sourceId: 'primary-requirements',
    capturedAt: '2026-07-15T08:10:00.000Z',
    sourceRevision: sha,
    provenance: { provider: 'tapd', transportIds: ['tapd-mcp'], scopeFingerprint: sha },
  }, {
    scope: { confirmedByUser: true, workspaceId: 'workspace-example', projectId: null, workItemIds: ['REQ-001'] },
    queries: [{ id: 'query-req', tier: 'explicit', terms: ['REQ-001'], featureRefs: ['feature:feature-example'] }],
    items: [{
      externalId: 'REQ-001', title: '历史增强需求', itemType: 'product-requirement', normalizedStatus: 'completed',
      relevance: 'direct', decision: 'adopted', relationshipVerified: true,
      featureRefs: ['feature:feature-example'], evidenceId: 'evidence-requirement', codeEvidenceIds: ['evidence-operation'],
    }],
  }));
  const composed = composeWikiModelInput(staged);
  assert.equal(composed.objects.requirements[0].scopeType, 'enhancement');
  assert.equal(composed.catalog.features[0].requirementRefs.length, 1);
  assert.equal(composed.governance.gaps.some((gap) => gap.type === 'acceptance-gap' && gap.subjectRefs.includes('feature:feature-example')), true);
});

test('Public generate and update scripts compose complete next models internally', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-public-lifecycle-`);
  const generateInput = genericPublicInput(outputRoot);
  const generated = spawnSync(process.execPath, ['skills/yog/scripts/generate-wiki.mjs'], {
    cwd: process.cwd(), input: JSON.stringify(generateInput), encoding: 'utf8',
  });
  assert.equal(generated.status, 0, generated.stdout || generated.stderr);
  const generatedResult = JSON.parse(generated.stdout);
  assert.equal(generatedResult.ok, true);

  const updateInput = structuredClone(generateInput);
  updateInput.runId = 'wiki-generic-update-test';
  updateInput.generatedAt = '2026-07-15T08:30:00.000Z';
  updateInput.semanticDraft.candidates.push({
    key: 'inspection-rule',
    kind: 'rule',
    name: '检查规则',
    subjectRefs: ['feature:feature-example'],
    confirmedEmptyFields: ['exceptions', 'configurationRefs'],
    fields: {
      trigger: '发起示例检查',
      conditions: ['示例存在'],
      effects: ['返回当前状态'],
      priority: 10,
      exceptions: [],
      configurationRefs: [],
    },
    claims: [{
      layer: 'current', factLevel: 'confirmed', text: '检查操作返回当前状态', evidenceRefs: ['evidence-operation'],
    }],
    relationships: [{
      type: 'applies-to', to: 'feature:feature-example', layer: 'current', factLevel: 'confirmed',
      text: '检查规则适用于示例功能', evidenceRefs: ['evidence-operation'],
    }],
  });
  const updated = spawnSync(process.execPath, ['skills/yog/scripts/update-wiki.mjs'], {
    cwd: process.cwd(), input: JSON.stringify(updateInput), encoding: 'utf8',
  });
  assert.equal(updated.status, 0, updated.stdout || updated.stderr);
  const updatedResult = JSON.parse(updated.stdout);
  assert.equal(updatedResult.ok, true);
  assert.equal(updatedResult.affectedPages.some((path) => path.includes('检查规则')), true);
});

test('Generation staging rejects a Source scope changed after confirmation', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-stage-`);
  const config = confirmedConfig(outputRoot);
  config.wiki.sources.find((item) => item.id === 'current-code').scope.roots.push('presentation/operations');
  assert.throws(
    () => stageWikiGenerationInput({ config, outputRoot }),
    (error) => error.code === 'wiki-source-scope-unconfirmed',
  );
});

test('Generation staging rejects reuse of a confirmed config for another output target', () => {
  const confirmedRoot = mkdtempSync(`${tmpdir()}/yog-wiki-confirmed-`);
  const config = confirmedConfig(confirmedRoot);
  assert.throws(
    () => stageWikiGenerationInput({ config, outputRoot: mkdtempSync(`${tmpdir()}/yog-wiki-other-`) }),
    (error) => error.code === 'wiki-source-scope-unconfirmed',
  );
});
