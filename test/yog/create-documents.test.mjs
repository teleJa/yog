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

function runScript(repoRoot, name, payload) {
  return spawnSync(process.execPath, [join(root, `skills/yog/scripts/${name}.mjs`)], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, payload }),
    encoding: 'utf8',
  });
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

test('promote-candidate creates context records change and removes candidate', () => {
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
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260630-promote-candidate-refund',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology, after-sales handoff, and status vocabulary.',
    capabilities: [
      {
        capabilityId: 'refund-request',
        name: 'Refund Request',
        summary: 'Handle refund request intake and handoff.',
        responsibilities: 'Own refund request business flow and status vocabulary.',
        nonResponsibilities: 'Payment gateway settlement internals.',
        body: 'Refund request starts from customer after-sales intent, records the request, and hands off to fulfillment review.',
        evidence: [
          {
            evidenceKind: 'routes',
            name: 'Refund request routes',
            summary: 'HTTP routes that enter refund request handling.',
            source: 'repository',
            generator: 'subagent-codegraph-serena',
            generation_evidence: 'CodeGraph and Serena inspected refund route and service entry points.',
            body: 'Refund request route evidence links the HTTP entry to the refund request service.',
            generationMethod: 'Parallel agent scan using Serena navigation and CodeGraph call evidence.',
            entryPaths: '- src/refund/controller.js',
            routes: '- POST /refunds',
            callRelations: '- RefundController -> RefundRequestService',
            dataMessages: '- refund_requests table',
            limitations: '- Unit test fixture uses representative paths.',
          },
        ],
      },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.candidatePath, 'docs/knowledge/candidates/refund.md');
  assert.equal(output.candidateRemoved, true);
  assert.equal(output.contextPath, 'docs/knowledge/contexts/refund/CONTEXT.md');
  assert.deepEqual(output.capabilityPaths, ['docs/knowledge/contexts/refund/capabilities/refund-request.md']);
  assert.deepEqual(output.evidencePaths, ['docs/knowledge/contexts/refund/evidence/refund-request-routes.md']);
  assert.equal(output.docsCount, 2);
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
  const capability = readFileSync(join(repoRoot, 'docs/knowledge/contexts/refund/capabilities/refund-request.md'), 'utf8');
  assert.match(capability, /Refund request starts from customer after-sales intent/);
  assert.match(capability, /evidence: \[docs\/knowledge\/contexts\/refund\/evidence\/refund-request-routes\.md\]/);
  assert.match(capability, /## 关键业务对象\n\n- refund_requests table/);
  assert.match(capability, /## 上下游关系\n\n- RefundController -> RefundRequestService/);
  assert.match(capability, /## 代码事实入口\n\n- src\/refund\/controller\.js/);
  assert.match(capability, /## 验证方式\n\n- routes: Parallel agent scan using Serena navigation and CodeGraph call evidence\./);
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
  assert.match(evidence, /generator: subagent-codegraph-serena/);
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

  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'course-link',
    contextId: 'course-link',
    changeId: '20260702-promote-candidate-course-link',
    name: 'Course Link',
    summary: 'Course link context promoted from evidence.',
    responsibilities: 'Own course link generation language.',
    nonResponsibilities: 'Course content authoring.',
    body: 'Course link context covers entry routes, service call flow, and cache dependency vocabulary.',
    capabilities: [
      {
        capabilityId: 'course-link-generation',
        name: 'Course Link Generation',
        summary: 'Generate course link from route to cache.',
        responsibilities: 'Own course link generation flow.',
        nonResponsibilities: 'Course content authoring.',
        body: 'Course link generation starts from a route, reaches a service, and persists cache data.',
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
        ],
      },
    ],
  });
  assert.equal(result.status, 0);

  const readme = readFileSync(join(repoRoot, 'docs/knowledge/contexts/course-link/README.md'), 'utf8');
  assert.match(readme, /## 上下游关系\n\n入口：\n- CourseLinkController#createCourseLink\n\n主调用链：\n- CourseLinkController#createCourseLink -> CourseLinkService#createCourseLink\n- CourseLinkService#createCourseLink -> CourseLinkCacheMapper#selectAvailable\n\n数据依赖：\n- course_link_cache\.cache_key/);
  assert.equal((readme.match(/CourseLinkController#createCourseLink -> CourseLinkService#createCourseLink/g) ?? []).length, 1);
  assert.equal((readme.match(/CourseLinkService#createCourseLink -> CourseLinkCacheMapper#selectAvailable/g) ?? []).length, 1);
});

test('promote-candidate requires real capability and evidence payloads', () => {
  const repoRoot = tempRepo();
  runScript(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Refund appears repeatedly in support requests and after-sales process reviews.',
  });
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260630-promote-candidate-refund',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology, after-sales handoff, and status vocabulary.',
    capabilities: [
      {
        capabilityId: 'refund-request',
        name: 'Refund Request',
        summary: 'Handle refund request intake and handoff.',
        responsibilities: 'Own refund request business flow.',
        nonResponsibilities: 'Payment gateway settlement.',
        body: 'Refund request starts from customer intent and ends with after-sales handoff.',
        evidence: [],
      },
    ],
  });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).issues[0].message, /evidence must include at least one evidence document/);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/refund.md')), true);
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
  const result = runScript(repoRoot, 'promote-candidate', {
    candidateId: 'refund',
    contextId: 'refund',
    changeId: '20260630-promote-candidate-refund',
    name: 'Refund',
    summary: 'Refund context promoted from repeated candidate signals.',
    responsibilities: 'Own refund business language.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund context covers refund request terminology, after-sales handoff, and status vocabulary.',
    capabilities: [
      {
        capabilityId: 'refund-request',
        name: 'Refund Request',
        summary: 'Handle refund request intake and handoff.',
        responsibilities: 'Own refund request business flow.',
        nonResponsibilities: 'Payment gateway settlement.',
        body: 'Refund request starts from customer intent and ends with after-sales handoff.',
        evidence: [
          {
            evidenceKind: 'routes',
            name: 'Refund request routes',
            summary: 'HTTP routes that enter refund request handling.',
            source: 'repository',
            generator: 'subagent-codegraph-serena',
            generation_evidence: 'CodeGraph and Serena inspected refund route and service entry points.',
            body: 'Refund request route evidence links the HTTP entry to the refund request service.',
          },
        ],
      },
    ],
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
  assert.match(text, /## 生成方式\n\nManual route inspection\./);
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
  assert.match(text, /## 生成方式\n\nReviewed data model files\./);
  assert.match(text, /## 入口路径\n\n本轮未记录具体入口路径/);
  assert.match(text, /## 路由 \/ 接口\n\n本证据类型未覆盖路由或接口/);
  assert.match(text, /## 调用关系\n\n本证据类型未覆盖调用关系/);
  assert.match(text, /## 数据 \/ 消息\n\n- refund_requests.status/);
  assert.match(text, /## 前端入口\n\n本轮未发现或未覆盖前端入口/);
  assert.match(text, /## 限制与疑点\n\n暂无额外限制/);
});
