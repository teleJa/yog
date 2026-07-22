import { createHash } from 'node:crypto';

export const REVIEW_KINDS = new Set([
  'acceptance-criterion',
  'business-rule',
  'permission-policy',
  'state-transition',
  'interface-error',
  'baseline-drift',
]);
export const REVIEW_STATUSES = new Set(['pending', 'confirmed', 'modified', 'rejected', 'deferred', 'drift']);
export const REVIEW_PRIORITIES = new Set(['P0', 'P1', 'P2']);
export const REVIEW_BRANCH_TYPES = new Set(['normal', 'boundary', 'failure']);

function reviewError(code, message, path = '$') {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function hash(prefix, value) {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function text(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) return text(value.text ?? value.value);
  return value === null || value === undefined ? '' : String(value).trim();
}

function texts(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function ids(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.length > 0))].sort();
}

function normalizeToken(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function semanticKey(parts) {
  return parts.map((part) => Array.isArray(part) ? part.map(normalizeToken).sort().join(',') : normalizeToken(part)).join('|');
}

export function reviewItemId(key) {
  return hash('review', key);
}

export function reviewItemFingerprint(item) {
  return sha256(JSON.stringify(canonical({
    semanticKey: item.semanticKey,
    observedBehavior: item.observedBehavior,
    sourceFactLevel: item.sourceFactLevel,
    observedSurfaces: [...item.observedSurfaces].sort(),
    proposal: item.proposal,
  })));
}

function factEvidenceIds(value) {
  if (Array.isArray(value)) return ids(value.flatMap(factEvidenceIds));
  return ids(value?.evidenceIds);
}

function factClaimIds(value) {
  if (Array.isArray(value)) return ids(value.flatMap(factClaimIds));
  return ids(value?.claimIds);
}

function currentProof(node, extraValues, claimById, evidenceById) {
  const claimIds = ids([...(node.claimIds ?? []), ...extraValues.flatMap(factClaimIds)]);
  const currentClaims = claimIds.map((id) => claimById.get(id)).filter((claim) => claim?.layer === 'current');
  if (currentClaims.length === 0 || currentClaims.some((claim) => claim.factLevel === 'needs-review')) return null;
  const sourceFactLevel = currentClaims.some((claim) => claim.factLevel === 'partial') ? 'partial' : 'confirmed';
  const evidenceIds = ids([
    ...(node.evidenceIds ?? []),
    ...extraValues.flatMap(factEvidenceIds),
    ...currentClaims.flatMap((claim) => claim.evidenceIds ?? []),
  ]);
  const evidence = evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
  if (evidence.length === 0 || evidence.every((item) => item.precision === 'file')) return null;
  const observedSurfaces = ids(evidence.map((item) => item.repositorySurface ?? item.surface ?? 'unknown'));
  return { claimIds: currentClaims.map((claim) => claim.id).sort(), evidenceIds, sourceFactLevel, observedSurfaces };
}

function monetaryRisk(...values) {
  return /红包|积分|优惠券|支付|退款|金额|余额|账务/.test(values.flatMap((value) => Array.isArray(value) ? value : [value]).map(text).join(' '));
}

function priorityFor(kind, values, { terminal = false, conflict = false } = {}) {
  if (conflict || terminal || monetaryRisk(...values)) return { priority: 'P0', reasonCodes: ids([
    conflict ? 'baseline-current-conflict' : null,
    terminal ? 'terminal-state' : null,
    monetaryRisk(...values) ? 'money-or-benefit' : null,
  ].filter(Boolean)) };
  const reasonByKind = {
    'acceptance-criterion': ['user-visible', 'main-operation'],
    'business-rule': ['business-rule'],
    'permission-policy': ['permission'],
    'state-transition': ['state-transition'],
    'interface-error': ['exception'],
    'baseline-drift': ['baseline-current-conflict'],
  };
  return { priority: 'P1', reasonCodes: reasonByKind[kind] ?? ['product-decision'] };
}

function candidate({ featureRef, subjectRefs, reviewKind, keyParts, question, observedBehavior, proposal, proof, gapIds = [], priorityOptions = {} }) {
  const normalizedProposal = {
    branchType: proposal.branchType,
    given: texts(proposal.given),
    when: text(proposal.when),
    then: texts(proposal.then),
  };
  if (!REVIEW_BRANCH_TYPES.has(normalizedProposal.branchType) || !normalizedProposal.when || normalizedProposal.then.length === 0) return null;
  const key = semanticKey([featureRef, reviewKind, ...keyParts]);
  const ranked = priorityFor(reviewKind, [question, observedBehavior, proposal.given, proposal.when, proposal.then], priorityOptions);
  const item = {
    id: reviewItemId(key),
    featureRef,
    subjectRefs: ids([featureRef, ...subjectRefs]),
    reviewKind,
    semanticKey: key,
    question,
    observedBehavior,
    sourceFactLevel: proof.sourceFactLevel,
    observedSurfaces: proof.observedSurfaces,
    proposal: normalizedProposal,
    priority: ranked.priority,
    reasonCodes: ranked.reasonCodes,
    sourceClaimIds: proof.claimIds,
    gapIds: ids(gapIds),
    evidenceIds: proof.evidenceIds,
    status: 'pending',
  };
  item.sourceFingerprint = reviewItemFingerprint(item);
  return item;
}

function mergeCandidates(items) {
  const byKey = new Map();
  for (const item of items) {
    const existing = byKey.get(item.semanticKey);
    if (!existing) {
      byKey.set(item.semanticKey, structuredClone(item));
      continue;
    }
    existing.subjectRefs = ids([...existing.subjectRefs, ...item.subjectRefs]);
    existing.sourceClaimIds = ids([...existing.sourceClaimIds, ...item.sourceClaimIds]);
    existing.evidenceIds = ids([...existing.evidenceIds, ...item.evidenceIds]);
    existing.gapIds = ids([...existing.gapIds, ...item.gapIds]);
    existing.observedSurfaces = ids([...existing.observedSurfaces, ...item.observedSurfaces]);
    existing.reasonCodes = ids([...existing.reasonCodes, ...item.reasonCodes]);
    if (item.sourceFactLevel === 'partial') existing.sourceFactLevel = 'partial';
    if (item.priority < existing.priority) existing.priority = item.priority;
    existing.sourceFingerprint = reviewItemFingerprint(existing);
  }
  return [...byKey.values()];
}

function featureGaps(featureRef, subjectRef, gaps) {
  return gaps.filter((gap) => gap.status === 'open' && gap.subjectRefs.some((ref) => [featureRef, subjectRef].includes(ref))).map((gap) => gap.id);
}

export function buildReviewItems({ catalog, objects, claims, evidence, gaps = [] }) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const byRef = new Map([...Object.values(catalog).flat(), ...Object.values(objects).flat()].map((node) => [`${node.kind}:${node.id}`, node]));
  const raw = [];
  let suppressedCandidateCount = 0;
  const add = (value) => value ? raw.push(value) : suppressedCandidateCount += 1;

  for (const feature of catalog.features) {
    const featureRef = `feature:${feature.id}`;
    for (const operationRef of feature.operationRefs ?? []) {
      const operation = byRef.get(operationRef);
      if (!operation) continue;
      const actorRefs = ids(operation.actorRefs);
      const actorNames = actorRefs.map((ref) => byRef.get(ref)?.name ?? ref);
      const preconditions = texts(operation.preconditions);
      for (const outcome of operation.outcomes ?? []) {
        const proof = currentProof(operation, [operation.action, operation.preconditions, outcome], claimById, evidenceById);
        add(proof && candidate({
          featureRef,
          subjectRefs: [operationRef],
          reviewKind: 'acceptance-criterion',
          keyParts: [actorRefs, preconditions, operation.action, outcome, 'normal'],
          question: `${actorNames.join('、') || '目标用户'}执行“${text(operation.action)}”时，是否应产生“${text(outcome)}”？`,
          observedBehavior: `当前实现中，“${text(operation.action)}”会产生“${text(outcome)}”。`,
          proposal: { branchType: 'normal', given: preconditions, when: operation.action, then: [outcome] },
          proof,
          gapIds: featureGaps(featureRef, operationRef, gaps),
        }));
      }
      for (const outcome of operation.errorOutcomes ?? []) {
        const proof = currentProof(operation, [operation.action, operation.preconditions, outcome], claimById, evidenceById);
        add(proof && candidate({
          featureRef,
          subjectRefs: [operationRef],
          reviewKind: 'acceptance-criterion',
          keyParts: [actorRefs, preconditions, operation.action, outcome, 'failure'],
          question: `执行“${text(operation.action)}”失败时，是否应表现为“${text(outcome)}”？`,
          observedBehavior: `当前实现记录的失败结果是“${text(outcome)}”。`,
          proposal: { branchType: 'failure', given: preconditions, when: operation.action, then: [outcome] },
          proof,
          gapIds: featureGaps(featureRef, operationRef, gaps),
        }));
      }
    }

    for (const ruleRef of feature.ruleRefs ?? []) {
      const rule = byRef.get(ruleRef);
      if (!rule) continue;
      for (const effect of rule.effects ?? []) {
        const proof = currentProof(rule, [rule.trigger, rule.conditions, effect], claimById, evidenceById);
        add(proof && candidate({
          featureRef,
          subjectRefs: [ruleRef],
          reviewKind: 'business-rule',
          keyParts: [rule.trigger, rule.conditions, effect],
          question: `当“${text(rule.trigger)}”且满足“${texts(rule.conditions).join('；') || '既定条件'}”时，是否应“${text(effect)}”？`,
          observedBehavior: `当前规则实现为：${texts(rule.conditions).join('；') || '无额外条件'} → ${text(effect)}。`,
          proposal: { branchType: 'normal', given: rule.conditions, when: rule.trigger, then: [effect] },
          proof,
          gapIds: featureGaps(featureRef, ruleRef, gaps),
        }));
      }
    }

    for (const machineRef of feature.stateMachineRefs ?? []) {
      const machine = byRef.get(machineRef);
      if (!machine) continue;
      const outgoing = new Set((machine.transitions ?? []).map((transition) => transition.from));
      for (const transition of machine.transitions ?? []) {
        const proof = currentProof(machine, [transition], claimById, evidenceById);
        const from = machine.states?.find((state) => state.id === transition.from)?.label ?? transition.from;
        const to = machine.states?.find((state) => state.id === transition.to)?.label ?? transition.to;
        add(proof && candidate({
          featureRef,
          subjectRefs: [machineRef],
          reviewKind: 'state-transition',
          keyParts: [transition.from, transition.to, transition.trigger],
          question: `“${text(from)}”状态在“${text(transition.trigger)}”后，是否应转为“${text(to)}”？`,
          observedBehavior: `当前实现存在状态转换：${text(from)} → ${text(to)}。`,
          proposal: { branchType: 'normal', given: [`当前状态为${text(from)}`], when: transition.trigger, then: [`状态变更为${text(to)}`] },
          proof,
          gapIds: featureGaps(featureRef, machineRef, gaps),
          priorityOptions: { terminal: !outgoing.has(transition.to) },
        }));
      }
    }

    for (const permissionRef of feature.permissionRefs ?? []) {
      const permission = byRef.get(permissionRef);
      if (!permission) continue;
      const groups = new Map();
      for (const row of permission.rows ?? []) {
        const key = semanticKey([row.roleRef, row.resourceRef, row.action, row.condition, row.decision]);
        const group = groups.get(key) ?? { rows: [], key };
        group.rows.push(row);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        const first = group.rows[0];
        const proof = currentProof(permission, group.rows, claimById, evidenceById);
        if (proof) proof.observedSurfaces = ids([...proof.observedSurfaces, ...group.rows.map((row) => row.enforcementLayer)]);
        add(proof && candidate({
          featureRef,
          subjectRefs: [permissionRef, first.resourceRef, first.roleRef],
          reviewKind: 'permission-policy',
          keyParts: [first.roleRef, first.resourceRef, first.action, first.condition, first.decision],
          question: `${first.roleRef}是否应在“${text(first.condition)}”条件下${first.decision === 'allow' ? '允许' : '禁止'}“${text(first.action)}”？`,
          observedBehavior: `当前 ${ids(group.rows.map((row) => row.enforcementLayer)).join('、')} 层实现为 ${first.decision}。`,
          proposal: { branchType: first.decision === 'allow' ? 'normal' : 'failure', given: [first.condition], when: first.action, then: [first.decision === 'allow' ? '允许执行' : '拒绝执行'] },
          proof,
          gapIds: featureGaps(featureRef, permissionRef, gaps),
        }));
      }
    }

    for (const interfaceRef of feature.interfaceRefs ?? []) {
      const api = byRef.get(interfaceRef);
      if (!api) continue;
      for (const endpoint of api.endpoints ?? []) {
        for (const error of endpoint.errors ?? []) {
          const proof = currentProof(api, [endpoint, error], claimById, evidenceById);
          add(proof && candidate({
            featureRef,
            subjectRefs: [interfaceRef],
            reviewKind: 'interface-error',
            keyParts: [endpoint.method, endpoint.path, error.code, error.condition, error.meaning],
            question: `调用“${endpoint.name}”遇到“${error.condition}”时，是否应返回“${error.meaning}”？`,
            observedBehavior: `当前接口错误 ${error.code} 表示“${error.meaning}”。`,
            proposal: { branchType: 'failure', given: [error.condition], when: `${endpoint.method} ${endpoint.path}`, then: [error.meaning] },
            proof,
            gapIds: featureGaps(featureRef, interfaceRef, gaps),
          }));
        }
      }
    }

    for (const flowRef of feature.flowRefs ?? []) {
      const flow = byRef.get(flowRef);
      if (!flow) continue;
      for (const exception of flow.exceptionPaths ?? []) {
        const proof = currentProof(flow, [exception], claimById, evidenceById);
        const exceptionText = text(exception.description ?? exception.label ?? exception);
        add(proof && exceptionText && candidate({
          featureRef,
          subjectRefs: [flowRef],
          reviewKind: 'acceptance-criterion',
          keyParts: [flow.trigger, exceptionText, 'failure'],
          question: `“${text(flow.name)}”发生“${exceptionText}”时，产品是否应按当前异常路径处理？`,
          observedBehavior: `当前流程记录的异常路径是“${exceptionText}”。`,
          proposal: { branchType: 'failure', given: [exceptionText], when: flow.trigger, then: [exceptionText] },
          proof,
          gapIds: featureGaps(featureRef, flowRef, gaps),
        }));
      }
      for (const edge of flow.edges ?? []) {
        if (!['async', 'callback', 'schedule'].includes(edge.interactionType)) continue;
        const proof = currentProof(flow, [edge], claimById, evidenceById);
        add(proof && candidate({
          featureRef,
          subjectRefs: [flowRef],
          reviewKind: 'acceptance-criterion',
          keyParts: [edge.from, edge.to, edge.interactionType, edge.condition, edge.label],
          question: `“${text(edge.label)}”这一步是否应采用${text(edge.interactionType)}方式继续业务流程？`,
          observedBehavior: `当前流程以 ${text(edge.interactionType)} 方式执行“${text(edge.label)}”。`,
          proposal: { branchType: 'normal', given: [edge.condition], when: edge.label, then: [`进入${text(edge.to)}步骤`] },
          proof,
          gapIds: featureGaps(featureRef, flowRef, gaps),
        }));
      }
    }

    for (const entityRef of feature.dataEntityRefs ?? []) {
      const entity = byRef.get(entityRef);
      const sensitivity = text(entity?.sensitivity);
      if (!entity || !sensitivity || /unknown|待确认|未知/i.test(sensitivity)) continue;
      const proof = currentProof(entity, [entity.sensitivity], claimById, evidenceById);
      add(proof && candidate({
        featureRef,
        subjectRefs: [entityRef],
        reviewKind: 'business-rule',
        keyParts: ['data-sensitivity', sensitivity],
        question: `“${text(entity.name)}”是否应按“${sensitivity}”级别管理数据敏感性？`,
        observedBehavior: `当前数据定义标记为“${sensitivity}”。`,
        proposal: { branchType: 'normal', given: [`处理${text(entity.name)}`], when: '读取、写入或导出数据', then: [`按${sensitivity}级别实施保护`] },
        proof,
        gapIds: featureGaps(featureRef, entityRef, gaps),
      }));
    }
  }

  const items = mergeCandidates(raw).sort((left, right) => left.priority.localeCompare(right.priority)
    || left.featureRef.localeCompare(right.featureRef) || left.id.localeCompare(right.id));
  return {
    items,
    diagnostics: {
      rawCandidateCount: raw.length + suppressedCandidateCount,
      reviewItemCount: items.length,
      mergedCandidateCount: raw.length - items.length,
      suppressedCandidateCount,
    },
  };
}

export function validateReviewItems(rawItems, { refSet, claimById, evidenceById, gapById }) {
  const idsSeen = new Set();
  const keysSeen = new Set();
  return (Array.isArray(rawItems) ? rawItems : []).map((raw, index) => {
    const path = `$.governance.reviewItems[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw reviewError('wiki-review-item-invalid', `${path} must be an object.`, path);
    if (!REVIEW_KINDS.has(raw.reviewKind)) throw reviewError('wiki-review-kind-invalid', `Unsupported reviewKind: ${raw.reviewKind}.`, `${path}.reviewKind`);
    if (!REVIEW_STATUSES.has(raw.status)) throw reviewError('wiki-review-status-invalid', `Unsupported review status: ${raw.status}.`, `${path}.status`);
    if (!REVIEW_PRIORITIES.has(raw.priority)) throw reviewError('wiki-review-priority-invalid', `Unsupported review priority: ${raw.priority}.`, `${path}.priority`);
    if (!['confirmed', 'partial'].includes(raw.sourceFactLevel)) throw reviewError('wiki-review-fact-level-invalid', 'ReviewItem sourceFactLevel must be confirmed or partial.', `${path}.sourceFactLevel`);
    if (!raw.proposal || !REVIEW_BRANCH_TYPES.has(raw.proposal.branchType) || texts(raw.proposal.then).length === 0 || !text(raw.proposal.when)) {
      throw reviewError('wiki-review-proposal-invalid', 'ReviewItem requires one atomic Given/When/Then proposal.', `${path}.proposal`);
    }
    if (idsSeen.has(raw.id) || keysSeen.has(raw.semanticKey)) throw reviewError('wiki-review-duplicate', 'ReviewItem id and semanticKey must be unique.', path);
    if (raw.id !== reviewItemId(raw.semanticKey)) throw reviewError('wiki-review-id-invalid', 'ReviewItem id must derive from semanticKey.', `${path}.id`);
    idsSeen.add(raw.id);
    keysSeen.add(raw.semanticKey);
    if (!refSet.has(raw.featureRef) || !(raw.subjectRefs ?? []).every((ref) => refSet.has(ref))) throw reviewError('wiki-review-subject-missing', 'ReviewItem references an unknown subject.', `${path}.subjectRefs`);
    const sourceClaims = ids(raw.sourceClaimIds).map((id) => claimById.get(id));
    if (sourceClaims.length === 0 || sourceClaims.some((claim) => !claim || claim.layer !== 'current' || claim.factLevel === 'needs-review')) {
      throw reviewError('wiki-review-current-proof-invalid', 'ReviewItem requires confirmed/partial Current Claims.', `${path}.sourceClaimIds`);
    }
    const evidence = ids(raw.evidenceIds).map((id) => evidenceById.get(id));
    if (evidence.length === 0 || evidence.some((item) => !item) || evidence.every((item) => item.precision === 'file')) {
      throw reviewError('wiki-review-evidence-invalid', 'ReviewItem requires non-file Current Evidence.', `${path}.evidenceIds`);
    }
    if (ids(raw.gapIds).some((id) => !gapById.has(id))) throw reviewError('wiki-review-gap-missing', 'ReviewItem references an unknown Gap.', `${path}.gapIds`);
    const normalized = {
      ...structuredClone(raw),
      subjectRefs: ids(raw.subjectRefs),
      observedSurfaces: ids(raw.observedSurfaces),
      reasonCodes: ids(raw.reasonCodes),
      sourceClaimIds: ids(raw.sourceClaimIds),
      gapIds: ids(raw.gapIds),
      evidenceIds: ids(raw.evidenceIds),
      proposal: { branchType: raw.proposal.branchType, given: texts(raw.proposal.given), when: text(raw.proposal.when), then: texts(raw.proposal.then) },
    };
    if (normalized.sourceFingerprint !== reviewItemFingerprint(normalized)) throw reviewError('wiki-review-fingerprint-invalid', 'ReviewItem sourceFingerprint does not match its semantic content.', `${path}.sourceFingerprint`);
    return normalized;
  }).sort((left, right) => left.priority.localeCompare(right.priority) || left.featureRef.localeCompare(right.featureRef) || left.id.localeCompare(right.id));
}
