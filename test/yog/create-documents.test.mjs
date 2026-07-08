import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();

function tempRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-create-'));
  mkdirSync(join(repoRoot, '.git'));
  spawnSync(process.execPath, [join(root, 'skills/yog/scripts/init.mjs')], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot }),
    encoding: 'utf8',
  });
  return repoRoot;
}

function initGitHead(repoRoot) {
  spawnSync('git', ['init'], { cwd: repoRoot, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot, encoding: 'utf8' });
  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\n');
  spawnSync('git', ['add', 'README.md'], { cwd: repoRoot, encoding: 'utf8' });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, encoding: 'utf8' });
}

function runScript(repoRoot, name, payload) {
  return spawnSync(process.execPath, [join(root, `skills/yog/scripts/${name}.mjs`)], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, payload }),
    encoding: 'utf8',
  });
}

function capabilityPlan(contextId, capabilities) {
  return {
    contextId,
    capabilityCandidates: capabilities.map((capability) => ({
      capabilityId: capability.capabilityId,
      name: capability.name,
      summary: capability.summary,
      entryPaths: capability.entryPaths ?? [`${capability.name.replace(/\s+/g, '')}Controller#entry`],
      serviceRoots: capability.serviceRoots ?? [],
      dataObjects: capability.dataObjects ?? [],
      externalDependencies: capability.externalDependencies ?? [],
      operations: capability.operations ?? [capability.name],
      confidence: 'draft',
    })),
  };
}

test('create-candidate rejects missing real body before writing', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: '',
  });
  assert.equal(result.status, 2);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund.md')), false);
});

test('create scripts require target repository templates', () => {
  const repoRoot = tempRepo();
  rmSync(join(repoRoot, 'docs/knowledge/templates/candidate.md'));
  const result = runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Repeated customer refund signals from support requests.',
  });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).issues[0].path, 'docs/knowledge/templates/candidate.md');
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund.md')), false);
});

test('create-candidate detects duplicate by slug and name without writing', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Repeated customer refund signals from support requests.',
  }).status, 0);
  const second = runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Another refund signal.',
  });
  assert.equal(second.status, 3);
  assert.deepEqual(JSON.parse(second.stdout).duplicates[0].matchedFields, ['slug', 'name']);
});

test('create-candidate detects duplicates by keywords and possible contexts', () => {
  const repoRoot = tempRepo();
  const first = runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    keywords: ['refund', 'after-sales'],
    possible_contexts: ['order'],
    body: 'Repeated customer refund signals from support requests.',
  });
  assert.equal(first.status, 0);
  const second = runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund-case',
    name: 'Refund Case',
    summary: 'Refund boundary candidate.',
    keywords: ['after-sales'],
    possible_contexts: ['order'],
    body: 'Another refund signal.',
  });
  assert.equal(second.status, 3);
  assert.deepEqual(JSON.parse(second.stdout).duplicates[0].matchedFields, ['keywords', 'possible_contexts']);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund-case.md')), false);
});

test('create-candidate writes optional duplicate-confirmed fields', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    keywords: ['refund', 'after-sales'],
    possible_contexts: ['order'],
    confirmDuplicate: true,
    body: 'Repeated customer refund signals from support requests.',
  });
  assert.equal(result.status, 0);
  const text = readFileSync(join(repoRoot, 'docs/knowledge/candidates/refund.md'), 'utf8');
  assert.match(text, /keywords: \[refund, after-sales\]/);
  assert.match(text, /possible_contexts: \[order\]/);
});

test('create-context writes agent guidance sections and review metadata', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
    whenToUse: '- Use when order lifecycle changes are requested.',
    routingRules: '- Route API changes to order controllers.',
    commonMisjudgments: '- Misjudgment: Refund settlement belongs here.\n  Correct: Payment settlement is external.',
    capabilityMatrix: '| 能力 | 作用 | 主要入口 | 适用场景 | 不适用场景 |\n| --- | --- | --- | --- | --- |\n| Refund | Handle refunds | RefundController | Refund request | Payment settlement |',
  });
  assert.equal(result.status, 0);
  const contextText = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/CONTEXT.md'), 'utf8');
  assert.match(contextText, /guidance_reviewed_at: \d{4}-\d{2}-\d{2}/);
  assert.match(contextText, /## 何时使用\n\n- Use when order lifecycle changes are requested\./);
  assert.match(contextText, /## 需求路由规则\n\n- Route API changes to order controllers\./);
  assert.match(contextText, /## 常见误判\n\n- Misjudgment: Refund settlement belongs here\./);
  assert.match(contextText, /## 能力清单\n\n\| 能力 \| 作用 \| 主要入口 \| 适用场景 \| 不适用场景 \|/);
  const readmeText = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/README.md'), 'utf8');
  assert.match(readmeText, /## 能力清单\n\n\| 能力 \| 作用 \| 主要入口 \| 适用场景 \| 不适用场景 \|/);
});

test('create-capability and evidence write development guidance and metadata', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  }).status, 0);
  assert.equal(runScript(repoRoot, 'create-capability', {
    contextId: 'order',
    capabilityId: 'refund',
    name: 'Refund',
    summary: 'Handle refunds.',
    responsibilities: 'Refund request business flow.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund starts from a customer request and ends with after-sales status update.',
    reuseGuidance: '- Reuse RefundController and RefundService.',
    doNotReuseGuidance: '- Do not bypass refund status checks.',
    confirmationRequired: '- Confirm payment gateway callback semantics.',
    commonMisjudgments: '- Misjudgment: direct DB update is enough.\n  Correct: use service workflow.',
    developmentVerification: '- Run refund request API regression.',
  }).status, 0);
  const capabilityText = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/capabilities/refund.md'), 'utf8');
  assert.match(capabilityText, /guidance_reviewed_at: \d{4}-\d{2}-\d{2}/);
  assert.match(capabilityText, /## Agent 开发指引\n\n### 优先复用\n\n- Reuse RefundController and RefundService\./);
  assert.match(capabilityText, /### 不要复用\n\n- Do not bypass refund status checks\./);
  assert.match(capabilityText, /### 停下来确认\n\n- Confirm payment gateway callback semantics\./);
  const agentGuidance = capabilityText.match(/## Agent 开发指引\n\n(?<body>[\s\S]*?)\n\n## 常见误判/).groups.body;
  assert.equal(agentGuidance.match(/### 优先复用/g).length, 1);
  assert.equal(agentGuidance.match(/### 不要复用/g).length, 1);
  assert.equal(agentGuidance.match(/### 停下来确认/g).length, 1);
  assert.equal(agentGuidance.match(/### 开发任务拆分/g).length, 1);
  assert.equal(agentGuidance.match(/### 验证方式/g).length, 1);
  assert.match(capabilityText, /## 常见误判\n\n- Misjudgment: direct DB update is enough\./);
  assert.equal(runScript(repoRoot, 'create-evidence', {
    contextId: 'order',
    capabilityId: 'refund',
    evidenceKind: 'routes',
    name: 'Refund routes',
    summary: 'HTTP routes that enter the refund workflow.',
    source: 'repository',
    repo_commit: 'abc123',
    generated_at: '2026-07-08T00:00:00.000Z',
    generator: 'manual',
    generation_evidence: 'Reviewed route files in current repository.',
    body: 'Route POST /refunds starts refund request handling.',
    entryPaths: '- src/refund/controller.js',
    routes: '- POST /refunds',
    developmentVerification: '- Exercise POST /refunds with valid and invalid payloads.',
    limitations: '- Test fixture does not execute runtime HTTP calls.',
  }).status, 0);
  const evidenceText = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/evidence/refund-routes.md'), 'utf8');
  assert.match(evidenceText, /repo_commit: abc123/);
  assert.match(evidenceText, /generated_at: 2026-07-08T00:00:00.000Z/);
  assert.match(evidenceText, /## 生成证据\n\nReviewed route files in current repository\./);
  assert.match(evidenceText, /## 开发验证建议\n\n- Exercise POST \/refunds with valid and invalid payloads\./);
});

test('create-candidate fills candidate sections and writes code symbols', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'create-candidate', {
    candidateId: 'course-link',
    name: 'Course Link',
    summary: 'Course link boundary candidate.',
    keywords: ['course'],
    possibleContexts: ['course-live'],
    code_symbols: ['CourseLinkController#createCourseLink'],
    identity_symbols: ['CourseLinkController#createCourseLink'],
    supporting_symbols: ['CourseLinkService#createFeiShuCourseLink'],
    body: '- controller-route-agent: Course link route signal.',
    businessMeaning: '负责课程直播链接入口识别。',
    evidence: '- symbol: CourseLinkController#createCourseLink',
    openQuestions: '- 需确认是否覆盖群链接。',
  });
  assert.equal(result.status, 0);
  const text = readFileSync(join(repoRoot, 'docs/knowledge/candidates/course-link.md'), 'utf8');
  assert.match(text, /code_symbols: \[CourseLinkController#createCourseLink\]/);
  assert.match(text, /identity_symbols: \[CourseLinkController#createCourseLink\]/);
  assert.match(text, /supporting_symbols: \[CourseLinkService#createFeiShuCourseLink\]/);
  assert.match(text, /## 触发信号\n\n- controller-route-agent: Course link route signal\./);
  assert.match(text, /## 可能的业务含义\n\n负责课程直播链接入口识别。/);
  assert.match(text, /## 可能归属的上下文\n\n- course-live/);
  assert.match(text, /## 相关证据\n\n- symbol: CourseLinkController#createCourseLink/);
  assert.match(text, /## 为什么暂不创建正式 Context\n\nneeds-review/);
  assert.match(text, /## 需要确认的问题\n\n- 需确认是否覆盖群链接。/);
  assert.match(text, /## 处理结果\n\n待 review \/ promote/);
});

test('create-candidate updates an existing duplicate candidate', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'course-link-old',
    name: 'Course Link Old',
    summary: 'Course link boundary candidate.',
    keywords: ['course'],
    possible_contexts: ['course-live'],
    code_symbols: ['CourseLinkController#createCourseLink'],
    body: '- controller-route-agent: Existing route signal.',
    evidence: '- symbol: CourseLinkController#createCourseLink',
  }).status, 0);
  const result = runScript(repoRoot, 'create-candidate', {
    updateExisting: true,
    updateCandidateId: 'course-link-old',
    confirmDuplicate: true,
    candidateId: 'course-link-new',
    name: 'Course Link New',
    summary: 'Course link boundary candidate.',
    keywords: ['feishu'],
    possible_contexts: ['feishu-integration'],
    code_symbols: ['CourseLinkService#createFeiShuCourseLink'],
    identity_symbols: ['CourseLinkService#createFeiShuCourseLink'],
    supporting_symbols: ['CourseLinkMapper#save'],
    body: '- service-flow-agent: New service flow signal.',
    evidence: '- symbol: CourseLinkService#createFeiShuCourseLink',
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.updated, true);
  assert.equal(output.created, false);
  assert.equal(output.candidateId, 'course-link-old');
  const text = readFileSync(join(repoRoot, 'docs/knowledge/candidates/course-link-old.md'), 'utf8');
  assert.match(text, /keywords: \[course, feishu\]/);
  assert.match(text, /possible_contexts: \[course-live, feishu-integration\]/);
  assert.match(text, /code_symbols: \[CourseLinkController#createCourseLink, CourseLinkService#createFeiShuCourseLink\]/);
  assert.match(text, /identity_symbols: \[CourseLinkService#createFeiShuCourseLink\]/);
  assert.match(text, /supporting_symbols: \[CourseLinkMapper#save\]/);
  assert.match(text, /Existing route signal/);
  assert.match(text, /New service flow signal/);
});

test('create-candidate confirmation does not overwrite an existing slug', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Original refund signal.',
  }).status, 0);
  const result = runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    confirmDuplicate: true,
    body: 'Replacement text should not be written.',
  });
  assert.equal(result.status, 1);
  const text = readFileSync(join(repoRoot, 'docs/knowledge/candidates/refund.md'), 'utf8');
  assert.match(text, /Original refund signal/);
  assert.doesNotMatch(text, /Replacement text should not be written/);
});

test('create-context creates formal context and removes template context item', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  assert.equal(result.status, 0);
  assert.match(readFileSync(join(repoRoot, 'docs/knowledge/CONTEXT-MAP.md'), 'utf8'), /- order: Order - Order lifecycle/);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/order/CONTEXT.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/order/README.md')), true);
  const contextText = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/CONTEXT.md'), 'utf8');
  assert.match(contextText, /## 负责什么\n\nOwn order lifecycle language\./);
  assert.match(contextText, /## 不负责什么\n\nPayment settlement internals\./);
  assert.match(contextText, /## 核心业务语言\n\n核心术语围绕/);
  assert.match(contextText, /## 避免混用\n\nPayment settlement internals\./);
  assert.match(contextText, /## 相关上下文\n\n暂无已确认相关上下文/);
  assert.match(contextText, /## 未确认问题\n\n暂无未确认问题/);
  const readmeText = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/README.md'), 'utf8');
  assert.match(readmeText, /## 业务边界\n\n负责：Own order lifecycle language\./);
  assert.match(readmeText, /## 主要能力\n\n暂无已确认主要能力/);
});

test('create-context writes multiline boundaries as single-line CONTEXT-MAP summaries', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'create-context', {
    contextId: 'course-link',
    name: 'Course Link',
    summary: 'Course link lifecycle and cache boundary.',
    responsibilities: '- Create course links\n- Reuse Feishu link cache\n- Separate personal and group links',
    nonResponsibilities: '- Course content authoring\n- Feishu platform account lifecycle',
    body: 'Course link context covers link creation, cache reuse, and send-scope vocabulary.',
  });
  assert.equal(result.status, 0);
  const contextMap = readFileSync(join(repoRoot, 'docs/knowledge/CONTEXT-MAP.md'), 'utf8');
  assert.match(contextMap, /  - Responsibilities: Create course links; Reuse Feishu link cache; Separate personal and group links\n/);
  assert.match(contextMap, /  - Non-responsibilities: Course content authoring; Feishu platform account lifecycle\n/);
  assert.doesNotMatch(contextMap, /\n- Reuse Feishu link cache\n/);
  assert.equal(runScript(repoRoot, 'sync', {}).status, 0);
});

test('create-context does not overwrite existing context source files', () => {
  const repoRoot = tempRepo();
  mkdirSync(join(repoRoot, 'docs/knowledge/contexts/order'), { recursive: true });
  writeFileSync(join(repoRoot, 'docs/knowledge/contexts/order/CONTEXT.md'), '# Existing\n\nKeep this content.\n');
  const result = runScript(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  assert.equal(result.status, 1);
  assert.match(readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/CONTEXT.md'), 'utf8'), /Keep this content/);
});

test('promote-candidate rejects routes-only promotion unless shallow draft is explicit', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    keywords: ['refund'],
    possible_contexts: ['order'],
    body: 'Refund appears repeatedly in support requests and after-sales process reviews.',
  }).status, 0);
  const capabilities = [
    {
      capabilityId: 'refund-request',
      name: 'Refund Request',
      summary: 'Handle refund request intake and handoff.',
      responsibilities: 'Own refund request business flow and status vocabulary.',
      nonResponsibilities: 'Payment gateway settlement internals.',
      body: 'Refund request starts from customer after-sales intent, records the request, and hands off to fulfillment review.',
      entryPaths: ['RefundController#create'],
      evidence: [
        {
          evidenceKind: 'routes',
          name: 'Refund request routes',
          summary: 'HTTP routes that enter refund request handling.',
          source: 'repository',
          generator: 'subagent-codegraph',
          generation_evidence: 'CodeGraph inspected refund route and service entry points.',
          body: 'Refund request route evidence links the HTTP entry to the refund request service.',
          routes: '- POST /refunds',
        },
      ],
    },
  ];
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260708-promote-candidate-refund-shallow-blocked',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology, after-sales handoff, and status vocabulary.',
    capabilityPlan: capabilityPlan('refund', capabilities),
    capabilities,
  });
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.match(output.issues[0].message, /routes-only promotion is a shallow draft/);
  assert.equal(output.promotionMode, 'blocked-shallow-draft');
  assert.equal(output.shallowDraft, true);
  assert.equal(output.qualityIssues.some((issue) => issue.code === 'routes-only'), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/refund/CONTEXT.md')), false);
});

test('promote-candidate creates explicit shallow draft context records change and removes candidate', () => {
  const repoRoot = tempRepo();
  const candidate = runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    keywords: ['refund'],
    possible_contexts: ['order'],
    body: 'Refund appears repeatedly in support requests and after-sales process reviews.',
  });
  assert.equal(candidate.status, 0);
  const capabilities = [
    {
      capabilityId: 'refund-request',
      name: 'Refund Request',
      summary: 'Handle refund request intake and handoff.',
      responsibilities: 'Own refund request business flow and status vocabulary.',
      nonResponsibilities: 'Payment gateway settlement internals.',
      body: 'Refund request starts from customer after-sales intent, records the request, and hands off to fulfillment review.',
      entryPaths: ['RefundController#create'],
      evidence: [
        {
          evidenceKind: 'routes',
          name: 'Refund request routes',
          summary: 'HTTP routes that enter refund request handling.',
          source: 'repository',
          generator: 'subagent-codegraph',
          generation_evidence: 'CodeGraph inspected refund route and service entry points.',
          body: 'Refund request route evidence links the HTTP entry to the refund request service.',
          generationMethod: 'Parallel agent scan using CodeGraph call evidence.',
          entryPaths: '- src/refund/controller.js',
          routes: '- POST /refunds',
          callRelations: '- RefundController -> RefundRequestService',
          dataMessages: '- refund_requests table',
          limitations: '- Unit test fixture uses representative paths.',
        },
      ],
    },
  ];
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260630-promote-candidate-refund',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology, after-sales handoff, and status vocabulary.',
    allowShallowDraft: true,
    capabilityPlan: capabilityPlan('refund', capabilities),
    capabilities,
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.candidatePath, 'docs/knowledge/candidates/refund.md');
  assert.equal(output.candidateRemoved, true);
  assert.equal(output.contextPath, 'docs/knowledge/contexts/refund/CONTEXT.md');
  assert.deepEqual(output.capabilityPaths, ['docs/knowledge/contexts/refund/capabilities/refund-request.md']);
  assert.deepEqual(output.evidencePaths, ['docs/knowledge/contexts/refund/evidence/refund-request-routes.md']);
  assert.equal(output.docsCount, 2);
  assert.equal(output.qualityIssues.some((issue) => issue.code === 'routes-only'), true);
  assert.deepEqual(output.evidenceDepth['refund-request'], { routes: true, callFlow: false, data: false, external: false });
  assert.equal(output.statusDecisions.some((decision) => decision.id === 'refund-request' && decision.status === 'draft'), true);
  assert.equal(output.shallowDraft, true);
  assert.equal(output.promotionMode, 'shallow-draft');
  assert.deepEqual(output.unknownRepoCommitEvidence, [
    {
      path: 'docs/knowledge/contexts/refund/evidence/refund-request-routes.md',
      capability: 'refund-request',
      evidenceKind: 'routes',
      reason: 'git-head-unavailable',
    },
  ]);
  assert.equal(output.changePath, 'docs/knowledge/changes/20260630-promote-candidate-refund.md');
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund.md')), false);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/refund/CONTEXT.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/refund/capabilities/refund-request.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/refund/evidence/refund-request-routes.md')), true);
  const change = readFileSync(join(repoRoot, 'docs/knowledge/changes/20260630-promote-candidate-refund.md'), 'utf8');
  assert.match(change, /# Promote Candidate: Refund/);
  assert.match(change, /source_ref: docs\/knowledge\/candidates\/refund\.md/);
  assert.match(change, /changed_paths: \[docs\/knowledge\/candidates\/refund\.md, docs\/knowledge\/contexts\/refund\/CONTEXT\.md, docs\/knowledge\/contexts\/refund\/README\.md, docs\/knowledge\/contexts\/refund\/capabilities\/refund-request\.md, docs\/knowledge\/contexts\/refund\/evidence\/refund-request-routes\.md\]/);
  assert.match(change, /Candidate `docs\/knowledge\/candidates\/refund\.md` was promoted/);
  assert.match(change, /docs\/knowledge\/contexts\/refund\/capabilities\/refund-request\.md/);
  assert.match(change, /docs\/knowledge\/contexts\/refund\/evidence\/refund-request-routes\.md/);
  assert.match(change, /## Promote 质量报告/);
  assert.match(change, /promotionMode: shallow-draft/);
  assert.match(change, /"code": "routes-only"/);
  assert.match(change, /"callFlow": false/);
  const capability = readFileSync(join(repoRoot, 'docs/knowledge/contexts/refund/capabilities/refund-request.md'), 'utf8');
  assert.match(capability, /待补充 call-flow evidence/);
  assert.doesNotMatch(capability, /Refund request starts from customer after-sales intent/);
  assert.match(capability, /evidence: \[docs\/knowledge\/contexts\/refund\/evidence\/refund-request-routes\.md\]/);
  assert.match(capability, /## 关键业务对象\n\n- refund_requests table/);
  assert.match(capability, /## 上下游关系\n\n仅入口路由，缺调用因果：\n- POST \/refunds/);
  assert.match(capability, /## 代码事实入口\n\n- src\/refund\/controller\.js/);
  assert.match(capability, /## 验证方式\n\n当前为 draft；升级 verified 前需要补充测试、人工确认或生产证据。/);
  assert.doesNotMatch(capability, /Parallel agent scan using CodeGraph call evidence/);
  assert.match(capability, /## 未确认问题\n\n- Unit test fixture uses representative paths\./);
  const contextText = readFileSync(join(repoRoot, 'docs/knowledge/contexts/refund/CONTEXT.md'), 'utf8');
  assert.match(contextText, /## 负责什么\n\nOwn refund business language\./);
  assert.match(contextText, /## 核心业务语言\n\n- Refund Request: Handle refund request intake and handoff\./);
  assert.match(contextText, /## 避免混用\n\nPayment gateway settlement\./);
  const readme = readFileSync(join(repoRoot, 'docs/knowledge/contexts/refund/README.md'), 'utf8');
  assert.match(readme, /## 主要能力\n\n- refund-request: Refund Request - Handle refund request intake and handoff\./);
  assert.match(readme, /## 上下游关系\n\n入口：\n- POST \/refunds/);
  assert.match(readme, /## 相关文档\n\n- docs\/knowledge\/contexts\/refund\/evidence\/refund-request-routes\.md/);
  const evidence = readFileSync(join(repoRoot, 'docs/knowledge/contexts/refund/evidence/refund-request-routes.md'), 'utf8');
  assert.match(evidence, /generator: subagent-codegraph/);
  assert.match(evidence, /## 路由 \/ 接口\n\n- POST \/refunds/);
});

test('promote-candidate writes grouped deduplicated context README upstream relationships', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'course-link',
    name: 'Course Link',
    summary: 'Course link boundary candidate.',
    body: 'Course link generation appears in route, call-flow, and data evidence.',
  }).status, 0);
  const capabilities = [
    {
      capabilityId: 'course-link-generation',
      name: 'Course Link Generation',
      summary: 'Generate course link from route to cache.',
      responsibilities: 'Own course link generation flow.',
      nonResponsibilities: 'Course content authoring.',
      body: 'Course link generation starts from a route, reaches a service, and persists cache data.',
      entryPaths: ['CourseLinkController#createCourseLink'],
      dataObjects: ['CourseLinkCacheMapper'],
      externalDependencies: ['FeishuLinkClient#createLink'],
      evidence: [
        {
          evidenceKind: 'routes',
          name: 'Course link route',
          summary: 'Route entry for course link generation.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Route evidence identifies the external entry.',
          routes: '- CourseLinkController#createCourseLink',
          callRelations: '- CourseLinkController#createCourseLink -> CourseLinkService#createCourseLink',
        },
        {
          evidenceKind: 'call-flow',
          name: 'Course link call flow',
          summary: 'Service call flow for course link generation.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Call-flow evidence tracks service orchestration.',
          callRelations: '- CourseLinkController#createCourseLink -> CourseLinkService#createCourseLink\n- CourseLinkService#createCourseLink -> CourseLinkCacheMapper#selectAvailable',
        },
        {
          evidenceKind: 'data',
          name: 'Course link cache data',
          summary: 'Cache dependency for course link generation.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Data evidence records cache persistence dependency.',
          callRelations: '- CourseLinkService#createCourseLink -> CourseLinkCacheMapper#selectAvailable',
          dataMessages: '- course_link_cache.cache_key',
        },
        {
          evidenceKind: 'external',
          name: 'Course link external dependency',
          summary: 'External dependency used while generating a course link.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'External evidence records downstream dependency used by course link generation.',
          externalDependencies: '- FeishuLinkClient#createLink',
          callers: '- CourseLinkService#createCourseLink',
          downstreamInterfaces: '- FeishuLinkClient#createLink',
          dependencyType: 'downstream-service',
          triggerConditions: '- Course link generation requests a Feishu link.',
          failureHandling: '- Static test fixture records timeout handling as pending.',
          boundaryNotes: '- Feishu link creation remains a downstream dependency, not this capability main entry.',
          callRelations: '- CourseLinkService#createCourseLink -> FeishuLinkClient#createLink',
          limitations: '- Static trace stops at FeishuLinkClient.',
        },
      ],
    },
  ];

  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'course-link',
    contextId: 'course-link',
    changeId: '20260702-promote-candidate-course-link',
    name: 'Course Link',
    summary: 'Course link context promoted from evidence.',
    responsibilities: 'Own course link generation language.',
    nonResponsibilities: 'Course content authoring.',
    body: 'Course link context covers entry routes, service call flow, and cache dependency vocabulary.',
    capabilityPlan: capabilityPlan('course-link', capabilities),
    capabilities,
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.evidenceDepth['course-link-generation'], { routes: true, callFlow: true, data: true, external: true });
  assert.equal(output.qualityIssues.some((issue) => issue.code === 'missing-call-flow'), false);
  assert.equal(output.evidencePaths.includes('docs/knowledge/contexts/course-link/evidence/course-link-generation-external.md'), true);

  const readme = readFileSync(join(repoRoot, 'docs/knowledge/contexts/course-link/README.md'), 'utf8');
  assert.match(readme, /## 上下游关系\n\n入口：\n- CourseLinkController#createCourseLink\n\n主调用链：\n- CourseLinkController#createCourseLink -> CourseLinkService#createCourseLink\n- CourseLinkService#createCourseLink -> CourseLinkCacheMapper#selectAvailable\n\n数据依赖：\n- course_link_cache\.cache_key/);
  assert.equal((readme.match(/CourseLinkController#createCourseLink -> CourseLinkService#createCourseLink/g) ?? []).length, 1);
  assert.equal((readme.match(/CourseLinkService#createCourseLink -> CourseLinkCacheMapper#selectAvailable/g) ?? []).length, 1);
  const capability = readFileSync(join(repoRoot, 'docs/knowledge/contexts/course-link/capabilities/course-link-generation.md'), 'utf8');
  assert.match(capability, /## 典型流程\n\n- CourseLinkController#createCourseLink -> CourseLinkService#createCourseLink/);
  assert.doesNotMatch(capability, /Course link generation starts from a route/);
  const external = readFileSync(join(repoRoot, 'docs/knowledge/contexts/course-link/evidence/course-link-generation-external.md'), 'utf8');
  assert.match(external, /evidence_kind: external/);
  assert.match(external, /## 边界外依赖\n\n- FeishuLinkClient#createLink/);
  assert.match(external, /## 调用方\n\n- CourseLinkService#createCourseLink/);
  assert.match(external, /## 下游接口\n\n- FeishuLinkClient#createLink/);
  assert.match(external, /## 依赖类型\n\ndownstream-service/);
});

test('deep-promote-candidate rejects shallow routes-only evidence before writing', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund-deep',
    name: 'Refund Deep',
    summary: 'Refund deep boundary candidate.',
    body: 'Refund deep appears in route evidence.',
  }).status, 0);
  const capabilities = [
    {
      capabilityId: 'refund-request',
      name: 'Refund Request',
      summary: 'Handle refund request intake.',
      responsibilities: 'Own refund request business flow.',
      nonResponsibilities: 'Payment gateway settlement.',
      body: 'Refund request starts from customer intent.',
      entryPaths: ['RefundController#create'],
      evidence: [
        {
          evidenceKind: 'routes',
          name: 'Refund request routes',
          summary: 'HTTP routes that enter refund request handling.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Route evidence identifies refund request entry.',
          routes: '- RefundController#create',
        },
      ],
    },
  ];
  const result = runScript(repoRoot, 'deep-promote-candidate', {
    candidateId: 'refund-deep',
    contextId: 'refund-deep',
    changeId: '20260708-deep-promote-candidate-refund',
    name: 'Refund Deep',
    summary: 'Refund deep context.',
    responsibilities: 'Own refund language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund deep context covers refund terminology.',
    capabilities,
  });
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.promotionMode, 'blocked-deep-promote');
  assert.match(output.issues.map((issue) => issue.message).join('\n'), /requires call-flow, data, external evidence/);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund-deep.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/refund-deep/CONTEXT.md')), false);
});

test('deep-promote-candidate materializes plan and writes deep promotion with complete evidence', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'course-link-deep',
    name: 'Course Link Deep',
    summary: 'Course link deep boundary candidate.',
    body: 'Course link generation has route, call-flow, data, and external evidence.',
  }).status, 0);
  const capabilities = [
    {
      capabilityId: 'course-link-generation',
      name: 'Course Link Generation',
      summary: 'Generate course link from route to cache.',
      responsibilities: 'Own course link generation flow.',
      nonResponsibilities: 'Course content authoring.',
      body: 'Course link generation starts from a route, reaches a service, and persists cache data.',
      entryPaths: ['CourseLinkController#createCourseLink'],
      serviceRoots: ['CourseLinkService#createCourseLink'],
      dataObjects: ['CourseLinkCacheMapper'],
      externalDependencies: ['FeishuLinkClient#createLink'],
      noSplitReason: 'Unit test fixture covers a single focused capability.',
      evidence: [
        {
          evidenceKind: 'routes',
          name: 'Course link route',
          summary: 'Route entry for course link generation.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Route evidence identifies the external entry.',
          routes: '- CourseLinkController#createCourseLink',
        },
        {
          evidenceKind: 'call-flow',
          name: 'Course link call flow',
          summary: 'Service call flow for course link generation.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Call-flow evidence tracks service orchestration.',
          callRelations: '- CourseLinkController#createCourseLink -> CourseLinkService#createCourseLink\n- CourseLinkService#createCourseLink -> CourseLinkCacheMapper#selectAvailable',
        },
        {
          evidenceKind: 'data',
          name: 'Course link cache data',
          summary: 'Cache dependency for course link generation.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Data evidence records cache persistence dependency.',
          dataMessages: '- course_link_cache.cache_key',
        },
        {
          evidenceKind: 'external',
          name: 'Course link external dependency',
          summary: 'External dependency used while generating a course link.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'External evidence records downstream dependency used by course link generation.',
          externalDependencies: '- FeishuLinkClient#createLink',
          callers: '- CourseLinkService#createCourseLink',
          downstreamInterfaces: '- FeishuLinkClient#createLink',
          dependencyType: 'downstream-service',
          triggerConditions: '- Course link generation requests a Feishu link.',
          failureHandling: '- Static test fixture records timeout handling as pending.',
          boundaryNotes: '- Feishu link creation remains a downstream dependency, not this capability main entry.',
          callRelations: '- CourseLinkService#createCourseLink -> FeishuLinkClient#createLink',
          limitations: '- Static trace stops at FeishuLinkClient.',
        },
      ],
    },
  ];
  const result = runScript(repoRoot, 'deep-promote-candidate', {
    candidateId: 'course-link-deep',
    contextId: 'course-link-deep',
    changeId: '20260708-deep-promote-candidate-course-link',
    name: 'Course Link Deep',
    summary: 'Course link deep context promoted from evidence.',
    responsibilities: 'Own course link generation language.',
    nonResponsibilities: 'Course content authoring.',
    body: 'Course link deep context covers entry routes, service call flow, cache dependency, and downstream Feishu handoff.',
    capabilities,
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.deepPromote, true);
  assert.equal(output.shallowDraft, false);
  assert.equal(output.promotionMode, 'deep-promote');
  assert.deepEqual(output.evidenceDepth['course-link-generation'], { routes: true, callFlow: true, data: true, external: true });
  assert.equal(output.capabilityPlan.capabilityCandidates[0].capabilityId, 'course-link-generation');
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/course-link-deep/evidence/course-link-generation-call-flow.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/course-link-deep/evidence/course-link-generation-data.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/course-link-deep/evidence/course-link-generation-external.md')), true);
  const change = readFileSync(join(repoRoot, 'docs/knowledge/changes/20260708-deep-promote-candidate-course-link.md'), 'utf8');
  assert.match(change, /promotionMode: deep-promote/);
  assert.match(change, /"callFlow": true/);
  assert.match(change, /"external": true/);
});

test('promote-candidate validates structured guidance anchors before rendering', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'reward',
    name: 'Reward',
    summary: 'Reward boundary candidate.',
    body: 'Reward appears in route and service evidence.',
  }).status, 0);
  const capabilities = [
    {
      capabilityId: 'reward-receive',
      name: 'Reward Receive',
      summary: 'Receive a reward with scene checks.',
      responsibilities: 'Own reward receive checks.',
      nonResponsibilities: 'Coupon platform internals.',
      body: 'Reward receive body should not be used as typical flow when call-flow exists.',
      entryPaths: ['RewardController#receive'],
      structuredMisjudgments: [
        {
          misjudgment: 'Reward can directly call coupon grant.',
          correctJudgment: 'Reward must enter RewardService#receive first.',
          reason: 'The service owns scene and duplicate receive checks.',
          anchors: [{ type: 'symbol', value: 'RewardService#receive' }],
          verification: 'Cover duplicate receive.',
        },
        {
          misjudgment: 'Missing anchor should be rejected.',
          correctJudgment: 'This item is not rendered.',
          reason: 'Anchor is absent from evidence.',
          anchors: [{ type: 'symbol', value: 'CouponClient#grant' }],
        },
      ],
      structuredReuseGuidance: [
        {
          instruction: 'Reuse RewardService#receive for reward receive requests.',
          reason: 'It owns scene and duplicate checks.',
          anchors: [{ type: 'symbol', value: 'RewardService#receive' }],
          appliesWhen: 'Reward receive requirement.',
        },
      ],
      evidence: [
        {
          evidenceKind: 'call-flow',
          name: 'Reward receive call flow',
          summary: 'Call flow for reward receive.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Call-flow evidence records reward receive orchestration.',
          callRelations: '- RewardController#receive -> RewardService#receive',
        },
      ],
    },
  ];

  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'reward',
    contextId: 'reward',
    changeId: '20260708-promote-candidate-reward',
    name: 'Reward',
    summary: 'Reward context promoted from evidence.',
    responsibilities: 'Own reward receive language.',
    nonResponsibilities: 'Coupon platform internals.',
    body: 'Reward context covers reward receive checks and downstream grant handoff.',
    capabilityPlan: capabilityPlan('reward', capabilities),
    capabilities,
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.guidanceIssues.some((issue) => issue.code === 'guidance-anchor-not-found'), true);
  assert.equal(output.guidanceAccepted['reward-receive'].structuredMisjudgments, 1);
  assert.equal(output.guidanceAccepted['reward-receive'].structuredReuseGuidance, 1);

  const capability = readFileSync(join(repoRoot, 'docs/knowledge/contexts/reward/capabilities/reward-receive.md'), 'utf8');
  assert.match(capability, /guidance_reviewed_at: \d{4}-\d{2}-\d{2}/);
  assert.match(capability, /误判：Reward can directly call coupon grant\./);
  assert.doesNotMatch(capability, /Missing anchor should be rejected/);
  assert.match(capability, /Reuse RewardService#receive for reward receive requests\./);
});

test('promote-candidate does not stamp guidance review date for unstructured guidance', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'reward-text',
    name: 'Reward Text',
    summary: 'Reward text boundary candidate.',
    body: 'Reward text appears in candidate notes and route evidence.',
  }).status, 0);
  const capabilities = [
    {
      capabilityId: 'reward-text-receive',
      name: 'Reward Text Receive',
      summary: 'Receive a reward with text guidance.',
      responsibilities: 'Own reward receive checks.',
      nonResponsibilities: 'Coupon platform internals.',
      body: 'Reward receive body should not become a reviewed guidance stamp.',
      entryPaths: ['RewardController#receive'],
      reuseGuidance: '- Reuse RewardService#receive for reward receive requests.',
      commonMisjudgments: '- Reward can directly call coupon grant.',
      evidence: [
        {
          evidenceKind: 'call-flow',
          name: 'Reward text receive call flow',
          summary: 'Call flow for reward receive.',
          source: 'repository',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Call-flow evidence records reward receive orchestration.',
          callRelations: '- RewardController#receive -> RewardService#receive',
        },
      ],
    },
  ];

  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'reward-text',
    contextId: 'reward-text',
    changeId: '20260708-promote-candidate-reward-text',
    name: 'Reward Text',
    summary: 'Reward text context promoted from evidence.',
    responsibilities: 'Own reward receive language.',
    nonResponsibilities: 'Coupon platform internals.',
    body: 'Reward text context covers reward receive checks.',
    capabilityPlan: capabilityPlan('reward-text', capabilities),
    capabilities,
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.guidanceAccepted['reward-text-receive'].structuredMisjudgments, 0);
  assert.equal(output.guidanceAccepted['reward-text-receive'].structuredReuseGuidance, 0);

  const capability = readFileSync(join(repoRoot, 'docs/knowledge/contexts/reward-text/capabilities/reward-text-receive.md'), 'utf8');
  assert.match(capability, /guidance_reviewed_at:\s*\n/);
  assert.match(capability, /Reuse RewardService#receive for reward receive requests\./);
  assert.match(capability, /Reward can directly call coupon grant\./);
});

test('promote-candidate requires real capability and evidence payloads', () => {
  const repoRoot = tempRepo();
  runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Refund appears repeatedly in support requests and after-sales process reviews.',
  });
  const capabilities = [
    {
      capabilityId: 'refund-request',
      name: 'Refund Request',
      summary: 'Handle refund request intake and handoff.',
      responsibilities: 'Own refund request business flow.',
      nonResponsibilities: 'Payment gateway settlement.',
      body: 'Refund request starts from customer intent and ends with after-sales handoff.',
      entryPaths: ['RefundController#create'],
      evidence: [],
    },
  ];
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260630-promote-candidate-refund',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology, after-sales handoff, and status vocabulary.',
    capabilityPlan: capabilityPlan('refund', capabilities),
    capabilities,
  });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).issues[0].message, /evidence must include at least one evidence document/);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/refund/CONTEXT.md')), false);
});

test('promote-candidate requires a capability plan before writing documents', () => {
  const repoRoot = tempRepo();
  runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Refund appears repeatedly in support requests.',
  });
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260708-promote-candidate-refund-no-plan',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology.',
    capabilities: [
      {
        capabilityId: 'refund-request',
        name: 'Refund Request',
        summary: 'Handle refund request intake.',
        responsibilities: 'Own refund request business flow.',
        nonResponsibilities: 'Payment gateway settlement.',
        body: 'Refund request starts from customer intent.',
        evidence: [
          {
            evidenceKind: 'routes',
            name: 'Refund request routes',
            summary: 'HTTP routes that enter refund request handling.',
            source: 'repository',
            generator: 'unit-test',
            generation_evidence: 'Unit test evidence.',
            body: 'Route evidence identifies refund request entry.',
          },
        ],
      },
    ],
  });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).issues.map((issue) => issue.message).join('\n'), /capabilityPlan is required/);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/refund/CONTEXT.md')), false);
});

test('promote-candidate rejects unknown repo_commit when git HEAD is available', () => {
  const repoRoot = tempRepo();
  initGitHead(repoRoot);
  runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Refund appears repeatedly in support requests.',
  });
  const capabilities = [
    {
      capabilityId: 'refund-request',
      name: 'Refund Request',
      summary: 'Handle refund request intake.',
      responsibilities: 'Own refund request business flow.',
      nonResponsibilities: 'Payment gateway settlement.',
      body: 'Refund request starts from customer intent.',
      entryPaths: ['RefundController#create'],
      evidence: [
        {
          evidenceKind: 'routes',
          name: 'Refund request routes',
          summary: 'HTTP routes that enter refund request handling.',
          source: 'repository',
          repo_commit: 'unknown',
          generator: 'unit-test',
          generation_evidence: 'Unit test evidence.',
          body: 'Route evidence identifies refund request entry.',
        },
      ],
    },
  ];
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260708-promote-candidate-refund-unknown-commit',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology.',
    capabilityPlan: capabilityPlan('refund', capabilities),
    capabilities,
  });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).issues.map((issue) => issue.message).join('\n'), /repo_commit cannot be unknown/);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/refund/CONTEXT.md')), false);
});

test('promote-candidate does not remove candidate when target context exists', () => {
  const repoRoot = tempRepo();
  runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Refund appears repeatedly in support requests.',
  });
  runScript(repoRoot, 'create-context', {
    contextId: 'refund',
    name: 'Refund',
    summary: 'Existing refund context.',
    responsibilities: 'Own refund language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Existing refund context content should not be overwritten.',
  });
  const capabilities = [
    {
      capabilityId: 'refund-request',
      name: 'Refund Request',
      summary: 'Handle refund request intake and handoff.',
      responsibilities: 'Own refund request business flow.',
      nonResponsibilities: 'Payment gateway settlement.',
      body: 'Refund request starts from customer intent and ends with after-sales handoff.',
      entryPaths: ['RefundController#create'],
      evidence: [
        {
          evidenceKind: 'routes',
          name: 'Refund request routes',
          summary: 'HTTP routes that enter refund request handling.',
          source: 'repository',
          generator: 'subagent-codegraph',
          generation_evidence: 'CodeGraph inspected refund route and service entry points.',
          body: 'Refund request route evidence links the HTTP entry to the refund request service.',
          routes: '- POST /refunds',
        },
      ],
    },
  ];
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260630-promote-candidate-refund',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology, after-sales handoff, and status vocabulary.',
    allowShallowDraft: true,
    capabilityPlan: capabilityPlan('refund', capabilities),
    capabilities,
  });
  assert.equal(result.status, 1);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/changes/20260630-promote-candidate-refund.md')), false);
  assert.match(JSON.parse(result.stdout).issues[0].message, /Target document already exists/);
});

test('create-capability and create-evidence require existing parents', () => {
  const repoRoot = tempRepo();
  const missing = runScript(repoRoot, 'create-capability', {
    contextId: 'order',
    capabilityId: 'refund',
    name: 'Refund',
    summary: 'Handle refunds.',
    responsibilities: 'Refund request business flow.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund starts from a customer request and ends with after-sales status update.',
  });
  assert.equal(missing.status, 1);
  runScript(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  const capability = runScript(repoRoot, 'create-capability', {
    contextId: 'order',
    capabilityId: 'refund',
    name: 'Refund',
    summary: 'Handle refunds.',
    responsibilities: 'Refund request business flow.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund starts from a customer request and ends with after-sales status update.',
  });
  assert.equal(capability.status, 0);
  const evidence = runScript(repoRoot, 'create-evidence', {
    contextId: 'order',
    capabilityId: 'refund',
    evidenceKind: 'routes',
    name: 'Refund routes',
    summary: 'HTTP routes that enter the refund workflow.',
    source: 'repository',
    generator: 'manual',
    generation_evidence: 'Reviewed route files in current repository.',
    body: 'Route POST /refunds starts refund request handling.',
    generationMethod: 'Manual route inspection.',
    entryPaths: '- src/refund/controller.js',
    routes: '- POST /refunds',
    callRelations: '- RefundController -> RefundService',
    dataMessages: '- refund_requests table',
    frontendEntries: '- Refund detail page',
    limitations: '- Test fixture does not execute runtime HTTP calls.',
  });
  assert.equal(evidence.status, 0);
  const text = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/evidence/refund-routes.md'), 'utf8');
  assert.match(text, /name: Refund routes/);
  assert.match(text, /summary: HTTP routes that enter the refund workflow\./);
  assert.doesNotMatch(text, /evidence_kind.*must match/);
  assert.doesNotMatch(text, /## 生成方式/);
  assert.match(text, /generation_evidence: Reviewed route files in current repository\./);
  assert.match(text, /## 入口路径\n\n- src\/refund\/controller\.js/);
  assert.match(text, /## 路由 \/ 接口\n\n- POST \/refunds/);
  assert.match(text, /## 调用关系\n\n- RefundController -> RefundService/);
  assert.match(text, /## 数据 \/ 消息\n\n- refund_requests table/);
  assert.match(text, /## 前端入口\n\n- Refund detail page/);
  assert.match(text, /## 限制与疑点\n\n- Test fixture does not execute runtime HTTP calls\./);
});

test('create-evidence fills non-applicable sections with explicit fallback text', () => {
  const repoRoot = tempRepo();
  runScript(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  runScript(repoRoot, 'create-capability', {
    contextId: 'order',
    capabilityId: 'refund',
    name: 'Refund',
    summary: 'Handle refunds.',
    responsibilities: 'Refund request business flow.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund starts from a customer request and ends with after-sales status update.',
  });
  const evidence = runScript(repoRoot, 'create-evidence', {
    contextId: 'order',
    capabilityId: 'refund',
    evidenceKind: 'data',
    name: 'Refund data',
    summary: 'Data evidence for refund workflow.',
    source: 'repository',
    generator: 'manual',
    generation_evidence: 'Reviewed data model files.',
    body: 'Refund data evidence identifies refund request state fields.',
    dataMessages: '- refund_requests.status',
  });
  assert.equal(evidence.status, 0);
  const text = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/evidence/refund-data.md'), 'utf8');
  assert.doesNotMatch(text, /evidence_kind.*must match/);
  assert.doesNotMatch(text, /## 生成方式/);
  assert.match(text, /generation_evidence: Reviewed data model files\./);
  assert.match(text, /## 入口路径\n\n本轮未记录具体入口路径/);
  assert.match(text, /## 路由 \/ 接口\n\n本证据类型未覆盖路由或接口/);
  assert.match(text, /## 调用关系\n\n本证据类型未覆盖调用关系/);
  assert.match(text, /## 数据 \/ 消息\n\n- refund_requests.status/);
  assert.match(text, /## 前端入口\n\n本轮未发现或未覆盖前端入口/);
  assert.match(text, /## 限制与疑点\n\n暂无额外限制/);
});

test('create-evidence rejects flat call-flow and incomplete external evidence', () => {
  const repoRoot = tempRepo();
  runScript(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  runScript(repoRoot, 'create-capability', {
    contextId: 'order',
    capabilityId: 'refund',
    name: 'Refund',
    summary: 'Handle refunds.',
    responsibilities: 'Refund request business flow.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund starts from a customer request and ends with after-sales status update.',
  });

  const flatCallFlow = runScript(repoRoot, 'create-evidence', {
    contextId: 'order',
    capabilityId: 'refund',
    evidenceKind: 'call-flow',
    name: 'Refund call flow',
    summary: 'Call flow evidence for refund workflow.',
    source: 'repository',
    generator: 'manual',
    generation_evidence: 'Reviewed refund service files.',
    body: 'Refund call-flow evidence identifies refund service symbols.',
    callRelations: '- RefundController\n- RefundService',
  });
  assert.equal(flatCallFlow.status, 2);
  assert.match(JSON.parse(flatCallFlow.stdout).issues.map((issue) => issue.message).join('\n'), /directed Class#method -> Class#method chains/);

  const incompleteExternal = runScript(repoRoot, 'create-evidence', {
    contextId: 'order',
    capabilityId: 'refund',
    evidenceKind: 'external',
    name: 'Refund external dependency',
    summary: 'External dependency for refund workflow.',
    source: 'repository',
    generator: 'manual',
    generation_evidence: 'Reviewed refund service files.',
    body: 'Refund external evidence identifies the payment dependency.',
    externalDependencies: '- PaymentClient#refund',
    dependencyType: 'invalid-kind',
  });
  assert.equal(incompleteExternal.status, 2);
  const messages = JSON.parse(incompleteExternal.stdout).issues.map((issue) => issue.message).join('\n');
  assert.match(messages, /callers is required/);
  assert.match(messages, /dependencyType is not supported/);
});
