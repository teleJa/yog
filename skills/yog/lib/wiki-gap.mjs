const GAP_STATUSES = new Set(['open', 'resolved']);
const RESOLUTION_MODES = new Set(['evidence-required', 'product-decision', 'conflict-resolution']);
const GUIDANCE_MODES = new Set(['pm-answer', 'evidence-request']);
const BLOCKING_STAGES = new Set(['baseline', 'design', 'development', 'release']);
const ANSWER_TYPES = new Set(['text', 'list', 'rule-table', 'state-mapping', 'acceptance-set']);

export const GAP_FIELD_LABELS = new Map([
  ['ownerRefs', '负责人'],
  ['purpose', '产品目标'],
  ['scope', '范围'],
  ['nonScope', '非范围'],
  ['operationRefs', '用户操作'],
  ['requirementRefs', '基线需求'],
  ['acceptanceCriteriaRefs', '验收标准'],
  ['dataSourceAssessment', '数据源适用性'],
  ['stateMode', '状态模式'],
  ['states', '状态定义'],
  ['transitions', '状态流转'],
  ['unresolvedTransitions', '待确认流转'],
  ['rules', '业务规则'],
  ['conditions', '规则条件'],
  ['effects', '规则结果'],
  ['exceptions', '规则例外'],
  ['metricType', '指标类型'],
  ['baseline', '指标基线'],
  ['target', '指标目标'],
  ['errors', '错误语义'],
  ['endpoints', '接口定义'],
  ['fields', '字段定义'],
  ['relationships', '数据关系'],
  ['fieldCoverage', '字段覆盖'],
  ['businessMeaning', '字段业务含义'],
  ['auth', '授权规则'],
  ['retry', '重试策略'],
  ['timeout', '超时策略'],
  ['configurationRefs', '配置项'],
  ['filters', '统计过滤口径'],
  ['responsibilities', '角色职责'],
  ['rows', '权限执行规则'],
  ['metricRefs', '成功指标'],
  ['dataEntityRefs', '数据实体'],
]);

function gapError(code, message, path = '$') {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function text(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) throw gapError('wiki-gap-contract-invalid', `${path} must be a non-empty string.`, path);
  return value.trim();
}

function stringList(value, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw gapError('wiki-gap-contract-invalid', `${path} must be a non-empty array.`, path);
  return [...new Set(value.map((item, index) => text(item, `${path}[${index}]`)))].sort();
}

function orderedStringList(value, path) {
  if (!Array.isArray(value) || value.length === 0) throw gapError('wiki-gap-contract-invalid', `${path} must be a non-empty array.`, path);
  return [...new Set(value.map((item, index) => text(item, `${path}[${index}]`)))];
}

function rootField(fieldRefs = [], subjectRefs = []) {
  const fieldRef = fieldRefs[0] ?? '';
  const subject = subjectRefs.find((ref) => fieldRef.startsWith(`${ref}.`));
  if (!subject) return 'definition';
  const relative = fieldRef.slice(subject.length + 1);
  if (relative === 'fields.businessMeaning') return 'businessMeaning';
  return relative.split('.')[0];
}

function answerTypeFor(field) {
  if (['transitions', 'states', 'unresolvedTransitions'].includes(field)) return 'state-mapping';
  if (['rules', 'conditions', 'effects', 'exceptions'].includes(field)) return 'rule-table';
  if (['acceptanceCriteriaRefs', 'gwt'].includes(field)) return 'acceptance-set';
  if (field.endsWith('Refs') || ['scope', 'nonScope', 'responsibilities'].includes(field)) return 'list';
  return 'text';
}

function tableColumns(answerType) {
  if (answerType === 'state-mapping') return ['当前状态', '触发条件', '目标状态', '异常处理'];
  if (answerType === 'rule-table') return ['适用条件', '执行规则', '例外情况'];
  if (answerType === 'acceptance-set') return ['验收场景', '前置条件', '操作', '预期结果'];
  return [];
}

function modeFor(type, field) {
  if (type === 'conflict-gap') return 'conflict-resolution';
  if (type === 'product-decision-gap' || type === 'acceptance-gap' || type === 'business-meaning-gap') return 'product-decision';
  if (type === 'data-source-gap' && field === 'dataSourceAssessment') return 'product-decision';
  return 'evidence-required';
}

function blockingStageFor(type, field) {
  if (['purpose', 'scope', 'nonScope', 'requirementRefs'].includes(field)) return 'baseline';
  if (['acceptanceCriteriaRefs', 'states', 'transitions', 'rules', 'conditions', 'effects'].includes(field)) return 'design';
  if (['errors', 'endpoints', 'fields', 'relationships', 'fieldCoverage', 'dataSourceAssessment'].includes(field)) return 'development';
  return 'release';
}

function pmResponseContract(fields) {
  const items = fields.map(({ field, label }) => {
    const answerType = answerTypeFor(field);
    const columns = tableColumns(answerType);
    return {
      key: field === 'definition' ? 'answer' : field,
      label,
      description: `说明${label}的明确结论、适用边界以及必要的例外。`,
      answerType,
      ...(columns.length > 0 ? { columns } : {}),
    };
  });
  return {
    guidanceMode: 'pm-answer',
    responseType: items[0].answerType,
    answerPrompt: `请用产品语言补充“${fields.map((item) => item.label).join('、')}”，不要根据代码、数据库字段或历史迭代自行推测。`,
    requiredAnswerItems: items,
  };
}

function evidenceResponseContract(fields) {
  return {
    guidanceMode: 'evidence-request',
    evidencePrompt: `请补充能够直接证明“${fields.map((item) => item.label).join('、')}”的限定范围证据；产品经理不需要猜测技术事实。`,
    requiredEvidenceItems: fields.map(({ field, label }) => ({
      key: field === 'definition' ? 'evidence' : field,
      label: `${label}证据`,
      description: `证据必须能定位到目标对象的${label}，并满足对应 Current 或 Observed Authority。`,
      sourceKinds: ['code', 'test', 'database', 'requirement', 'spec'],
    })),
  };
}

export function buildGapGuidance({ type, description, subjectRefs = [], fieldRefs = [], subjectName = '该产品对象', overrides = {} }) {
  const fields = [...new Set((fieldRefs.length > 0 ? fieldRefs : ['']).map((fieldRef) => rootField([fieldRef], subjectRefs)))]
    .map((field) => ({ field, label: GAP_FIELD_LABELS.get(field) ?? '产品定义' }));
  const field = fields[0].field;
  const labels = fields.map((item) => item.label).join('、');
  const resolutionMode = overrides.resolutionMode ?? modeFor(type, field);
  const responseContract = overrides.responseContract ?? (resolutionMode === 'evidence-required'
    ? evidenceResponseContract(fields)
    : pmResponseContract(fields));
  return normalizeGapGuidance({
    title: overrides.title ?? `${subjectName}的${labels}需要补齐`,
    question: overrides.question ?? (resolutionMode === 'evidence-required'
      ? `${subjectName}的${labels}需要补充哪些可信证据？`
      : `请确认${subjectName}的${labels}应如何定义？`),
    context: overrides.context ?? description,
    decisionImpact: overrides.decisionImpact ?? `缺少该结论会阻断${subjectName}的${labels}进入可信产品基线。`,
    resolutionMode,
    responseContract,
    suggestedSourceKinds: overrides.suggestedSourceKinds ?? (resolutionMode === 'evidence-required'
      ? ['code', 'test', 'database', 'requirement', 'spec']
      : ['human-confirmation', 'requirement', 'spec']),
    blockingStage: overrides.blockingStage ?? blockingStageFor(type, field),
    resolutionCriteria: overrides.resolutionCriteria ?? [
      ...fieldRefs.map((fieldRef, index) => ({ kind: 'field-complete', label: `${fields[index]?.label ?? labels}已通过 typed resolver 写入目标对象`, fieldRef })),
      { kind: 'claim-supported', label: resolutionMode === 'evidence-required' ? '目标事实具有匹配 Authority 的证据' : '产品结论具有有效的人工确认 Evidence' },
    ],
  });
}

export function normalizeGapGuidance(value, path = '$.gap') {
  const resolutionMode = text(value.resolutionMode, `${path}.resolutionMode`);
  if (!RESOLUTION_MODES.has(resolutionMode)) throw gapError('wiki-gap-contract-invalid', `${path}.resolutionMode is unsupported.`, `${path}.resolutionMode`);
  const blockingStage = text(value.blockingStage, `${path}.blockingStage`);
  if (!BLOCKING_STAGES.has(blockingStage)) throw gapError('wiki-gap-contract-invalid', `${path}.blockingStage is unsupported.`, `${path}.blockingStage`);
  const responseContract = structuredClone(value.responseContract);
  if (!responseContract || typeof responseContract !== 'object' || Array.isArray(responseContract)) throw gapError('wiki-gap-contract-invalid', `${path}.responseContract must be an object.`, `${path}.responseContract`);
  const guidanceMode = text(responseContract.guidanceMode, `${path}.responseContract.guidanceMode`);
  if (!GUIDANCE_MODES.has(guidanceMode)) throw gapError('wiki-gap-contract-invalid', `${path}.responseContract.guidanceMode is unsupported.`, `${path}.responseContract.guidanceMode`);
  if (resolutionMode === 'evidence-required' && guidanceMode !== 'evidence-request') throw gapError('wiki-gap-contract-invalid', 'evidence-required Gap must use evidence-request guidance.', `${path}.responseContract.guidanceMode`);
  if (resolutionMode !== 'evidence-required' && guidanceMode !== 'pm-answer') throw gapError('wiki-gap-contract-invalid', 'Decision Gap must use pm-answer guidance.', `${path}.responseContract.guidanceMode`);
  if (guidanceMode === 'pm-answer') {
    responseContract.responseType = text(responseContract.responseType, `${path}.responseContract.responseType`);
    if (!ANSWER_TYPES.has(responseContract.responseType)) throw gapError('wiki-gap-contract-invalid', 'Unsupported responseType.', `${path}.responseContract.responseType`);
    responseContract.answerPrompt = text(responseContract.answerPrompt, `${path}.responseContract.answerPrompt`);
    if (!Array.isArray(responseContract.requiredAnswerItems) || responseContract.requiredAnswerItems.length === 0) throw gapError('wiki-gap-contract-invalid', 'pm-answer requires requiredAnswerItems.', `${path}.responseContract.requiredAnswerItems`);
    responseContract.requiredAnswerItems = responseContract.requiredAnswerItems.map((raw, index) => {
      const itemPath = `${path}.responseContract.requiredAnswerItems[${index}]`;
      const answerType = text(raw.answerType, `${itemPath}.answerType`);
      if (!ANSWER_TYPES.has(answerType)) throw gapError('wiki-gap-contract-invalid', 'Unsupported answerType.', `${itemPath}.answerType`);
      const columns = tableColumns(answerType).length > 0 ? orderedStringList(raw.columns, `${itemPath}.columns`) : [];
      return { key: text(raw.key, `${itemPath}.key`), label: text(raw.label, `${itemPath}.label`), description: text(raw.description, `${itemPath}.description`), answerType, ...(columns.length > 0 ? { columns } : {}) };
    });
    delete responseContract.requiredEvidenceItems;
    delete responseContract.evidencePrompt;
  } else {
    responseContract.evidencePrompt = text(responseContract.evidencePrompt, `${path}.responseContract.evidencePrompt`);
    if (!Array.isArray(responseContract.requiredEvidenceItems) || responseContract.requiredEvidenceItems.length === 0) throw gapError('wiki-gap-contract-invalid', 'evidence-request requires requiredEvidenceItems.', `${path}.responseContract.requiredEvidenceItems`);
    responseContract.requiredEvidenceItems = responseContract.requiredEvidenceItems.map((raw, index) => {
      const itemPath = `${path}.responseContract.requiredEvidenceItems[${index}]`;
      return { key: text(raw.key, `${itemPath}.key`), label: text(raw.label, `${itemPath}.label`), description: text(raw.description, `${itemPath}.description`), sourceKinds: stringList(raw.sourceKinds, `${itemPath}.sourceKinds`) };
    });
    delete responseContract.requiredAnswerItems;
    delete responseContract.answerPrompt;
    delete responseContract.responseType;
  }
  if (!Array.isArray(value.resolutionCriteria) || value.resolutionCriteria.length === 0) throw gapError('wiki-gap-contract-invalid', `${path}.resolutionCriteria must be non-empty.`, `${path}.resolutionCriteria`);
  return {
    title: text(value.title, `${path}.title`),
    question: text(value.question, `${path}.question`),
    context: text(value.context, `${path}.context`),
    decisionImpact: text(value.decisionImpact, `${path}.decisionImpact`),
    resolutionMode,
    responseContract,
    suggestedSourceKinds: stringList(value.suggestedSourceKinds, `${path}.suggestedSourceKinds`),
    blockingStage,
    resolutionCriteria: value.resolutionCriteria.map((raw, index) => ({
      ...structuredClone(raw),
      kind: text(raw.kind, `${path}.resolutionCriteria[${index}].kind`),
      label: text(raw.label, `${path}.resolutionCriteria[${index}].label`),
    })),
  };
}

export function validateGapAnswer(responseContract, answer, path = '$.answer') {
  const contract = normalizeGapGuidance({
    title: '合同校验', question: '合同校验？', context: '合同校验。', decisionImpact: '合同校验。',
    resolutionMode: responseContract.guidanceMode === 'evidence-request' ? 'evidence-required' : 'product-decision',
    responseContract, suggestedSourceKinds: ['spec'], blockingStage: 'baseline', resolutionCriteria: [{ kind: 'contract', label: '回答完整' }],
  }, '$.responseContract').responseContract;
  if (contract.guidanceMode !== 'pm-answer') throw gapError('wiki-gap-answer-invalid', 'Evidence-request Gap cannot be answered as a PM decision.', path);
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw gapError('wiki-gap-answer-invalid', `${path} must be an object.`, path);
  for (const item of contract.requiredAnswerItems) {
    const value = answer[item.key];
    const itemPath = `${path}.${item.key}`;
    if (item.answerType === 'text') text(value, itemPath);
    else if (item.answerType === 'list') stringList(value, itemPath);
    else {
      if (!Array.isArray(value) || value.length === 0) throw gapError('wiki-gap-answer-invalid', `${itemPath} must contain at least one row.`, itemPath);
      for (const [rowIndex, row] of value.entries()) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw gapError('wiki-gap-answer-invalid', `${itemPath}[${rowIndex}] must be an object.`, `${itemPath}[${rowIndex}]`);
        for (const column of item.columns) text(row[column], `${itemPath}[${rowIndex}].${column}`);
      }
    }
  }
  return structuredClone(answer);
}

function table(headers) {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, `| ${headers.map(() => '<请填写>').join(' | ')} |`].join('\n');
}

export function renderGapResponseGuidance(responseContract) {
  if (responseContract.guidanceMode === 'evidence-request') {
    return [responseContract.evidencePrompt, '', ...responseContract.requiredEvidenceItems.map((item) => `- **${item.label}**：${item.description}（建议来源：${item.sourceKinds.join('、')}）`)].join('\n');
  }
  const lines = [responseContract.answerPrompt];
  for (const item of responseContract.requiredAnswerItems) {
    lines.push('', `#### ${item.label}`, '', item.description, '');
    if (item.answerType === 'text') lines.push('> 请在此填写明确结论：');
    else if (item.answerType === 'list') lines.push('- <请填写一项；如确认没有，请明确写“无”及适用边界>');
    else lines.push(table(item.columns));
  }
  return lines.join('\n');
}

export function validateGapStatus(status, path = '$.status') {
  if (!GAP_STATUSES.has(status)) throw gapError('wiki-gap-status-invalid', `${path} must be open or resolved.`, path);
  return status;
}

export function isGapMarkdownPath(path) {
  return path === '质量治理/待确认问题.md' || path.startsWith('质量治理/待确认问题/');
}
