import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildGapGuidance,
  normalizeGapGuidance,
  renderGapResponseGuidance,
  validateGapAnswer,
  validateGapStatus,
} from '../../skills/yog/lib/wiki-gap.mjs';
import {
  activeDecisionIds,
  confirmDecisionRecord,
  decisionFingerprint,
  normalizeDecisionRecord,
  renderDecisionRecord,
} from '../../skills/yog/lib/wiki-decision.mjs';
import { writeConfirmedDecision, writeDraftDecision } from '../../skills/yog/lib/wiki-decision-store.mjs';

function stateGap() {
  return buildGapGuidance({
    type: 'product-decision-gap',
    description: '订单状态流转尚未形成可信产品定义。',
    subjectRefs: ['state-machine:order-state'],
    fieldRefs: ['state-machine:order-state.transitions'],
    subjectName: '订单状态',
  });
}

test('Gap renderer and validator share one responseContract for text, list, and tables', () => {
  const gap = stateGap();
  assert.equal(gap.responseContract.responseType, 'state-mapping');
  assert.deepEqual(gap.responseContract.requiredAnswerItems[0].columns, ['当前状态', '触发条件', '目标状态', '异常处理']);
  const markdown = renderGapResponseGuidance(gap.responseContract);
  for (const column of gap.responseContract.requiredAnswerItems[0].columns) assert.match(markdown, new RegExp(column));
  const answer = {
    transitions: [{ 当前状态: '待支付', 触发条件: '支付成功', 目标状态: '已支付', 异常处理: '保持待支付并提示重试' }],
  };
  assert.deepEqual(validateGapAnswer(gap.responseContract, answer), answer);
  assert.throws(() => validateGapAnswer(gap.responseContract, {}), (error) => error.code === 'wiki-gap-answer-invalid');

  const extended = structuredClone(gap);
  extended.responseContract.requiredAnswerItems.push({
    key: 'exceptions', label: '全局例外', description: '补充不适用该状态规则的场景。', answerType: 'list',
  });
  const normalized = normalizeGapGuidance(extended);
  assert.match(renderGapResponseGuidance(normalized.responseContract), /全局例外/);
  assert.throws(() => validateGapAnswer(normalized.responseContract, answer), (error) => error.path.endsWith('.exceptions'));
  assert.deepEqual(validateGapAnswer(normalized.responseContract, { ...answer, exceptions: ['人工关闭订单'] }).exceptions, ['人工关闭订单']);
});

test('Evidence-required Gap asks for bounded evidence instead of a PM decision', () => {
  const gap = buildGapGuidance({
    type: 'evidence-gap',
    description: '接口错误语义缺少实现或测试证据。',
    subjectRefs: ['interface:refund-api'],
    fieldRefs: ['interface:refund-api.errors'],
    subjectName: '退款接口',
  });
  assert.equal(gap.resolutionMode, 'evidence-required');
  assert.equal(gap.responseContract.guidanceMode, 'evidence-request');
  const rendered = renderGapResponseGuidance(gap.responseContract);
  assert.match(rendered, /产品经理不需要猜测技术事实/);
  assert.match(rendered, /建议来源/);
  assert.throws(() => validateGapAnswer(gap.responseContract, {}), (error) => error.code === 'wiki-gap-answer-invalid');
  assert.throws(() => validateGapStatus('accepted'), (error) => error.code === 'wiki-gap-status-invalid');
});

test('Gap guidance covers every governed field and treats business meaning as a PM decision', () => {
  const gap = buildGapGuidance({
    type: 'business-meaning-gap',
    description: '字段含义和实体关系尚未确认。',
    subjectRefs: ['data-entity:customer'],
    fieldRefs: ['data-entity:customer.fields.businessMeaning', 'data-entity:customer.relationships'],
    subjectName: '客户记录',
  });
  assert.equal(gap.resolutionMode, 'product-decision');
  assert.deepEqual(gap.responseContract.requiredAnswerItems.map((item) => item.label), ['字段业务含义', '数据关系']);
  assert.equal(gap.resolutionCriteria.filter((item) => item.kind === 'field-complete').length, 2);
});

function draftDecision(gapId = 'gap-order-state') {
  return {
    decisionId: `decision-${gapId}`,
    target: { kind: 'gap', id: gapId },
    outcome: 'confirm',
    subjectRef: 'state-machine:order-state',
    fieldRefs: ['state-machine:order-state.transitions'],
    status: 'draft',
    answer: { transitions: [{ 当前状态: '待支付', 触发条件: '支付成功', 目标状态: '已支付', 异常处理: '提示重试' }] },
    rationale: '统一产品状态语义。',
    scope: ['订单支付'],
    nonScope: ['退款状态'],
    supersedes: [],
    resolution: { kind: 'set-field', field: 'transitions', value: [{ from: 'pending', to: 'paid', trigger: 'payment-succeeded' }] },
  };
}

test('Decision confirmation binds semantic content and renders readable Markdown without YAML', () => {
  const draft = draftDecision();
  const confirmed = confirmDecisionRecord(draft, { confirmedBy: '张三', confirmedRole: '产品经理', confirmedAt: '2026-07-16T08:00:00.000Z' });
  assert.equal(confirmed.decisionFingerprint, decisionFingerprint(draft));
  const markdown = renderDecisionRecord(confirmed);
  assert.doesNotMatch(markdown, /^---|```yaml|```json/);
  assert.match(markdown, /## 产品结论/);
  assert.match(markdown, /内容指纹：sha256:/);
  assert.throws(
    () => normalizeDecisionRecord({ ...confirmed, rationale: '被修改的理由' }, { requireConfirmed: true }),
    (error) => error.code === 'decision-confirmation-invalid',
  );
});

test('Decision supersedes keeps only the current exact-target Decision and rejects cycles', () => {
  const oldDecision = confirmDecisionRecord(draftDecision(), { confirmedBy: '张三', confirmedRole: '产品经理', confirmedAt: '2026-07-16T08:00:00.000Z' });
  const nextDecision = confirmDecisionRecord({
    ...draftDecision(), decisionId: 'decision-gap-order-state-v2', supersedes: [oldDecision.decisionId],
  }, { confirmedBy: '李四', confirmedRole: '产品经理', confirmedAt: '2026-07-16T09:00:00.000Z' });
  assert.deepEqual([...activeDecisionIds([oldDecision, nextDecision])], [nextDecision.decisionId]);

  const cycleA = confirmDecisionRecord({
    ...draftDecision(), decisionId: 'decision-cycle-a', supersedes: ['decision-cycle-b'],
  }, { confirmedBy: '张三', confirmedRole: '产品经理', confirmedAt: '2026-07-16T08:00:00.000Z' });
  const cycleB = confirmDecisionRecord({
    ...draftDecision(), decisionId: 'decision-cycle-b', supersedes: ['decision-cycle-a'],
  }, { confirmedBy: '李四', confirmedRole: '产品经理', confirmedAt: '2026-07-16T09:00:00.000Z' });
  assert.throws(() => activeDecisionIds([cycleA, cycleB]), (error) => error.code === 'decision-supersedes-invalid');
});

test('Review Decision freezes an atomic proposal and supports confirm modify reject defer outcomes', () => {
  const sourceFingerprint = `sha256:${'a'.repeat(64)}`;
  const proposal = { criterionType: 'failure', given: ['名称为空'], when: '提交保存', then: ['拒绝保存'] };
  for (const outcome of ['confirm', 'modify', 'reject', 'defer']) {
    const decision = normalizeDecisionRecord({
      decisionId: `decision-review-save-${outcome}`,
      target: { kind: 'review-item', id: 'review-save-empty-name', sourceFingerprint },
      outcome,
      status: 'draft',
      answer: ['confirm', 'modify'].includes(outcome) ? { proposal } : { note: `${outcome} reason` },
      rationale: '逐条审核当前行为。', scope: [], nonScope: [], supersedes: [],
    });
    assert.equal(decision.outcome, outcome);
    if (['confirm', 'modify'].includes(outcome)) assert.deepEqual(decision.answer.proposal, proposal);
  }
  assert.throws(() => normalizeDecisionRecord({
    decisionId: 'decision-review-missing-proposal',
    target: { kind: 'review-item', id: 'review-save-empty-name', sourceFingerprint },
    outcome: 'confirm', status: 'draft', answer: {}, rationale: '缺少快照。', scope: [], nonScope: [], supersedes: [],
  }), (error) => error.code === 'decision-record-invalid');
});

function configureDecisionSource(root) {
  mkdirSync(join(root, '.yog'), { recursive: true });
  writeFileSync(join(root, '.yog/config.json'), JSON.stringify({
    schemaVersion: 1,
    wiki: {
      sources: [{
        id: 'context-specs', kind: 'spec', provider: 'filesystem', enabled: true,
        scope: { paths: ['docs/wiki-inputs/decisions'] }, confirmation: { status: 'confirmed' },
      }],
    },
  }));
}

test('Decision store enforces Source scope, exact draft bytes, and idempotent draft creation', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'yog-gap-decision-'));
  configureDecisionSource(outputRoot);
  const input = { outputRoot, systemId: 'commerce', featureId: 'orders', decision: draftDecision() };
  const first = writeDraftDecision(input);
  const second = writeDraftDecision(input);
  assert.equal(second.path, first.path);
  assert.equal(readFileSync(join(outputRoot, first.path), 'utf8'), first.content);
  const confirmed = writeConfirmedDecision({ ...input, confirmedBy: '张三', confirmedRole: '产品经理', confirmedAt: '2026-07-16T08:00:00.000Z' });
  assert.equal(confirmed.status, 'confirmed');
  assert.match(readFileSync(join(outputRoot, confirmed.path), 'utf8'), /状态：confirmed/);

  const tampered = { ...input, decision: draftDecision('gap-order-rule') };
  const tamperedDraft = writeDraftDecision(tampered);
  writeFileSync(join(outputRoot, tamperedDraft.path), `${tamperedDraft.content}\n被修改`);
  assert.throws(
    () => writeConfirmedDecision({ ...tampered, confirmedBy: '张三', confirmedRole: '产品经理', confirmedAt: '2026-07-16T08:00:00.000Z' }),
    (error) => error.code === 'decision-confirmation-invalid',
  );

  const unconfigured = mkdtempSync(join(tmpdir(), 'yog-gap-decision-unconfigured-'));
  assert.throws(() => writeDraftDecision({ ...input, outputRoot: unconfigured }), (error) => error.code === 'decision-source-not-configured');
});

test('Review Decision confirmation rejects a stale behavior fingerprint before persistence', () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'yog-review-decision-'));
  configureDecisionSource(outputRoot);
  const sourceFingerprint = `sha256:${'b'.repeat(64)}`;
  const decision = {
    decisionId: 'decision-review-save-empty-name',
    target: { kind: 'review-item', id: 'review-save-empty-name', sourceFingerprint },
    outcome: 'confirm', status: 'draft',
    answer: { proposal: { criterionType: 'failure', given: ['名称为空'], when: '提交保存', then: ['拒绝保存'] } },
    rationale: '确认保存校验。', scope: [], nonScope: [], supersedes: [],
  };
  const input = { outputRoot, systemId: 'course-system', featureId: 'course-library', decision };
  writeDraftDecision(input);
  assert.throws(() => writeConfirmedDecision({
    ...input,
    currentSourceFingerprint: `sha256:${'c'.repeat(64)}`,
    confirmedBy: '张三', confirmedRole: '产品经理', confirmedAt: '2026-07-16T08:00:00.000Z',
  }), (error) => error.code === 'wiki-review-source-fingerprint-mismatch');
  assert.equal(writeConfirmedDecision({
    ...input,
    currentSourceFingerprint: sourceFingerprint,
    confirmedBy: '张三', confirmedRole: '产品经理', confirmedAt: '2026-07-16T08:00:00.000Z',
  }).status, 'confirmed');
});
