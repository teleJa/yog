import { createHash } from 'node:crypto';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SHA_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TARGET_KINDS = new Set(['gap', 'review-item']);
const OUTCOMES = new Set(['confirm', 'modify', 'reject', 'defer']);
const RESOLUTION_KINDS = new Set(['set-field', 'set-ref-list', 'confirm-empty']);
const CRITERION_TYPES = new Set(['normal', 'boundary', 'failure']);

function decisionError(code, message, path = '$') {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function text(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) throw decisionError('decision-record-invalid', `${path} must be a non-empty string.`, path);
  return value.trim();
}

function id(value, path) {
  const result = text(value, path);
  if (!ID_PATTERN.test(result)) throw decisionError('decision-record-invalid', `${path} must be a stable lowercase ID.`, path);
  return result;
}

function list(value, path, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw decisionError('decision-record-invalid', `${path} must be an array.`, path);
  return [...new Set(value.map((item, index) => text(item, `${path}[${index}]`)))].sort();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function normalizeProposal(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw decisionError('decision-record-invalid', `${path} must be an object.`, path);
  const criterionType = text(value.criterionType ?? value.branchType, `${path}.criterionType`);
  if (!CRITERION_TYPES.has(criterionType)) throw decisionError('decision-record-invalid', `${path}.criterionType is unsupported.`, `${path}.criterionType`);
  return {
    criterionType,
    given: list(value.given, `${path}.given`, { allowEmpty: false }),
    when: text(value.when, `${path}.when`),
    then: list(value.then, `${path}.then`, { allowEmpty: false }),
  };
}

export function canonicalDecisionContent(raw) {
  const targetValue = raw.target && typeof raw.target === 'object' && !Array.isArray(raw.target) ? raw.target : {};
  const kind = text(targetValue.kind, '$.decision.target.kind');
  if (!TARGET_KINDS.has(kind)) throw decisionError('decision-record-invalid', 'Decision target.kind must be gap or review-item.', '$.decision.target.kind');
  const target = { kind, id: id(targetValue.id, '$.decision.target.id') };
  if (kind === 'review-item') {
    const sourceFingerprint = text(targetValue.sourceFingerprint, '$.decision.target.sourceFingerprint');
    if (!SHA_PATTERN.test(sourceFingerprint)) throw decisionError('decision-record-invalid', 'Review Decision requires a sha256 sourceFingerprint.', '$.decision.target.sourceFingerprint');
    target.sourceFingerprint = sourceFingerprint;
  }
  const outcome = text(raw.outcome, '$.decision.outcome');
  if (!OUTCOMES.has(outcome)) throw decisionError('decision-record-invalid', 'Unsupported Decision outcome.', '$.decision.outcome');
  const answer = raw.answer;
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw decisionError('decision-record-invalid', '$.decision.answer must be an object.', '$.decision.answer');
  const content = {
    decisionId: id(raw.decisionId, '$.decision.decisionId'),
    target,
    outcome,
    answer: structuredClone(answer),
    rationale: text(raw.rationale, '$.decision.rationale'),
    scope: list(raw.scope ?? [], '$.decision.scope'),
    nonScope: list(raw.nonScope ?? [], '$.decision.nonScope'),
    supersedes: list(raw.supersedes ?? [], '$.decision.supersedes'),
  };
  if (kind === 'gap') {
    content.subjectRef = text(raw.subjectRef, '$.decision.subjectRef');
    content.fieldRefs = list(raw.fieldRefs, '$.decision.fieldRefs', { allowEmpty: false });
    if (['confirm', 'modify'].includes(outcome)) {
      const resolution = raw.resolution && typeof raw.resolution === 'object' && !Array.isArray(raw.resolution) ? raw.resolution : {};
      const resolutionKind = text(resolution.kind, '$.decision.resolution.kind');
      if (!RESOLUTION_KINDS.has(resolutionKind)) throw decisionError('decision-record-invalid', 'Unsupported typed resolution.', '$.decision.resolution.kind');
      content.resolution = {
        kind: resolutionKind,
        field: text(resolution.field, '$.decision.resolution.field'),
        ...(resolutionKind === 'confirm-empty' ? {} : { value: structuredClone(resolution.value) }),
      };
    }
  } else if (['confirm', 'modify'].includes(outcome)) {
    content.answer.proposal = normalizeProposal(answer.proposal, '$.decision.answer.proposal');
  }
  return canonical(content);
}

export function decisionFingerprint(raw) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalDecisionContent(raw))).digest('hex')}`;
}

export function normalizeDecisionRecord(raw, { requireConfirmed = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw decisionError('decision-record-invalid', '$.decision must be an object.', '$.decision');
  const content = canonicalDecisionContent(raw);
  const status = text(raw.status ?? 'draft', '$.decision.status');
  if (!['draft', 'confirmed'].includes(status)) throw decisionError('decision-record-invalid', '$.decision.status must be draft or confirmed.', '$.decision.status');
  if (requireConfirmed && status !== 'confirmed') throw decisionError('decision-record-draft', 'Draft Decision cannot enter a Decision Artifact.', '$.decision.status');
  const normalized = { ...content, status };
  if (status === 'confirmed') {
    const expected = decisionFingerprint(content);
    if (raw.decisionFingerprint !== expected) throw decisionError('decision-confirmation-invalid', 'Decision fingerprint does not match the confirmed content.', '$.decision.decisionFingerprint');
    normalized.decisionFingerprint = expected;
    normalized.confirmedBy = text(raw.confirmedBy, '$.decision.confirmedBy');
    normalized.confirmedRole = text(raw.confirmedRole, '$.decision.confirmedRole');
    normalized.confirmedAt = text(raw.confirmedAt, '$.decision.confirmedAt');
    if (Number.isNaN(Date.parse(normalized.confirmedAt))) throw decisionError('decision-record-invalid', '$.decision.confirmedAt must be an ISO timestamp.', '$.decision.confirmedAt');
  }
  return normalized;
}

export function confirmDecisionRecord(raw, { confirmedBy, confirmedRole, confirmedAt }) {
  const draft = normalizeDecisionRecord({ ...raw, status: 'draft' });
  return normalizeDecisionRecord({
    ...draft,
    status: 'confirmed',
    decisionFingerprint: decisionFingerprint(draft),
    confirmedBy,
    confirmedRole,
    confirmedAt,
  }, { requireConfirmed: true });
}

export function activeDecisionIds(rawDecisions) {
  const decisions = rawDecisions.map((decision) => normalizeDecisionRecord(decision, { requireConfirmed: true }));
  const byId = new Map();
  for (const decision of decisions) {
    if (byId.has(decision.decisionId)) throw decisionError('decision-supersedes-invalid', `Duplicate Decision ID: ${decision.decisionId}.`, '$.decisions');
    byId.set(decision.decisionId, decision);
  }
  const superseded = new Set();
  for (const decision of decisions) {
    for (const priorId of decision.supersedes) {
      const prior = byId.get(priorId);
      if (!prior || prior.decisionId === decision.decisionId) throw decisionError('decision-supersedes-invalid', `Decision ${decision.decisionId} supersedes an unknown or self Decision.`, `decision:${decision.decisionId}.supersedes`);
      if (prior.target.kind !== decision.target.kind || prior.target.id !== decision.target.id) {
        throw decisionError('decision-supersedes-invalid', 'A Decision may supersede only an earlier Decision for the same tagged target.', `decision:${decision.decisionId}.supersedes`);
      }
      superseded.add(priorId);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (decisionId) => {
    if (visiting.has(decisionId)) throw decisionError('decision-supersedes-invalid', 'Decision supersedes relation contains a cycle.', `decision:${decisionId}.supersedes`);
    if (visited.has(decisionId)) return;
    visiting.add(decisionId);
    for (const priorId of byId.get(decisionId).supersedes) visit(priorId);
    visiting.delete(decisionId);
    visited.add(decisionId);
  };
  for (const decisionId of byId.keys()) visit(decisionId);
  return new Set([...byId.keys()].filter((decisionId) => !superseded.has(decisionId)));
}

function renderAnswer(answer) {
  return Object.entries(answer).flatMap(([key, value]) => {
    if (Array.isArray(value) && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const columns = [...new Set(value.flatMap((row) => Object.keys(row)))];
      return [`### ${key}`, '', `| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...value.map((row) => `| ${columns.map((column) => String(row[column] ?? '')).join(' | ')} |`), ''];
    }
    if (Array.isArray(value)) return [`### ${key}`, '', ...value.map((item) => `- ${item}`), ''];
    if (value && typeof value === 'object') return [`### ${key}`, '', ...Object.entries(value).map(([childKey, childValue]) => `- ${childKey}：${Array.isArray(childValue) ? childValue.join('；') : childValue}`), ''];
    return [`### ${key}`, '', String(value), ''];
  });
}

export function renderDecisionRecord(raw) {
  const decision = normalizeDecisionRecord(raw);
  return [
    '# 产品决策记录',
    '', `- 决策编号：${decision.decisionId}`, `- 目标类型：${decision.target.kind}`, `- 目标编号：${decision.target.id}`,
    ...(decision.target.sourceFingerprint ? [`- 行为指纹：${decision.target.sourceFingerprint}`] : []),
    `- 处理结果：${decision.outcome}`, `- 状态：${decision.status}`,
    ...(decision.status === 'confirmed' ? [`- 内容指纹：${decision.decisionFingerprint}`, `- 确认人：${decision.confirmedBy}（${decision.confirmedRole}）`, `- 确认时间：${decision.confirmedAt}`] : []),
    '', '## 产品结论', '', ...renderAnswer(decision.answer),
    '## 决策理由', '', decision.rationale,
    '', '## 适用范围', '', ...(decision.scope.length ? decision.scope.map((item) => `- ${item}`) : ['- 无']),
    '', '## 非适用范围', '', ...(decision.nonScope.length ? decision.nonScope.map((item) => `- ${item}`) : ['- 无']),
    '', '## 替代关系', '', ...(decision.supersedes.length ? decision.supersedes.map((item) => `- ${item}`) : ['- 无']),
    ...(decision.resolution ? ['', '## 机器执行边界', '', `- typed resolver：${decision.resolution.kind}`, `- 字段：${decision.resolution.field}`] : []),
  ].join('\n') + '\n';
}

export function assertDecisionContentHash(value, path = '$.artifact.document.contentHash') {
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) throw decisionError('source-artifact-invalid', `${path} must be sha256.`, path);
  return value;
}
