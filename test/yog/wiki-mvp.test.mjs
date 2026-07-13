import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMvpWiki, generateMvpWiki } from '../../skills/yog/lib/wiki-mvp.mjs';
import { parseFrontmatter } from '../../skills/yog/lib/frontmatter.mjs';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function fixture(t) {
  const outputRoot = mkdtempSync(join(tmpdir(), 'yog-mvp-output-'));
  const recordRoot = mkdtempSync(join(tmpdir(), 'yog-mvp-record-'));
  const codeRoot = mkdtempSync(join(tmpdir(), 'yog-mvp-code-'));
  t.after(() => {
    rmSync(outputRoot, { recursive: true, force: true });
    rmSync(recordRoot, { recursive: true, force: true });
    rmSync(codeRoot, { recursive: true, force: true });
  });
  mkdirSync(join(recordRoot, 'artifacts'), { recursive: true });
  writeFileSync(join(recordRoot, 'SKILL.md'), '# 创建获客链接\n\n记录创建流程。\n');
  writeFileSync(join(recordRoot, 'artifacts/workflow.json'), '{\n  "name": "创建获客链接"\n}\n');
  mkdirSync(join(codeRoot, 'src'), { recursive: true });
  writeFileSync(join(codeRoot, 'src/acquire.ts'), "export const save = '/operation/mp/acquisition/link/saveOrUpdate';\n");
  git(codeRoot, 'init', '-q');
  git(codeRoot, 'config', 'user.name', 'Yog Test');
  git(codeRoot, 'config', 'user.email', 'yog@example.com');
  git(codeRoot, 'add', '.');
  git(codeRoot, 'commit', '-qm', 'fixture');

  const recordFact = (text, level = 'confirmed') => ({ text, level, evidenceIds: ['ev-record-workflow'] });
  const codeFact = (text) => ({ text, level: 'confirmed', evidenceIds: ['ev-code-save'] });
  const model = {
    schemaVersion: 1,
    runId: 'wiki-mvp-test-a',
    generatedAt: '2026-07-10T00:00:00.000Z',
    outputRoot,
    wikiRoot: 'docs/wiki',
    scopeDecision: { mode: 'record-related', confirmedByUser: true },
    sources: [
      { id: 'menu-input', type: 'menu', name: '用户菜单描述' },
      { id: 'record-create-link', type: 'record', name: '创建获客链接录制', root: recordRoot },
      { id: 'frontend-operations', type: 'code', name: '运营端前端', root: codeRoot },
      {
        id: 'requirements-example',
        type: 'requirement',
        provider: 'tapd',
        providerLabel: 'TAPD',
        name: '示例 TAPD 项目',
        scope: 'workspace:10000000',
        scopeConfirmedByUser: true,
        capturedAt: '2026-07-10T00:00:00.000Z',
        transport: 'mcp',
        queries: [
          { id: 'query-menu', tier: 'menu', terms: ['私域获客', '获客链接'], featureIds: ['acquisition-link'] },
          { id: 'query-capability', tier: 'capability', terms: ['员工分流', '欢迎语'], featureIds: ['acquisition-link'] },
        ],
        candidates: [{
          externalId: '1',
          title: '获客链接产品目标',
          itemRole: 'product-requirement',
          parentExternalId: null,
          relationshipVerified: true,
          rawStatus: 'closed',
          normalizedStatus: 'completed',
          relevance: 'direct',
          decision: 'adopted',
          reason: '直接描述当前菜单目标，且保存能力可由当前代码交叉验证。',
          featureIds: ['acquisition-link'],
          codeEvidenceIds: ['ev-code-save'],
          evidenceId: 'ev-requirement-purpose',
        }],
      },
    ],
    evidence: [
      { id: 'ev-menu', sourceId: 'menu-input', locator: 'user:current-conversation#menu', description: '用户提供私域获客到获客链接菜单。' },
      { id: 'ev-record-workflow', sourceId: 'record-create-link', path: 'artifacts/workflow.json', startLine: 1, endLine: 3, description: '录制 Workflow。' },
      { id: 'ev-code-save', sourceId: 'frontend-operations', path: 'src/acquire.ts', startLine: 1, endLine: 1, description: '保存接口定义。' },
      { id: 'ev-requirement-purpose', sourceId: 'requirements-example', externalId: '1', locator: 'https://example.test/tapd/workspaces/10000000/stories/1', description: 'TAPD：获客链接产品目标' },
    ],
    featureGroups: [{
      id: 'private-acquisition',
      name: '私域获客',
      menuEvidenceIds: ['ev-menu'],
      features: [{
        id: 'acquisition-link',
        name: '获客链接',
        menuEvidenceIds: ['ev-menu'],
        requirementEvidenceIds: ['ev-requirement-purpose'],
        route: '/acquire/private/link',
        purpose: [{ text: '配置企业微信获客链接。', level: 'confirmed', evidenceIds: ['ev-requirement-purpose', 'ev-code-save'] }],
        roles: [recordFact('私域运营人员。')],
        preconditions: [recordFact('已登录且具备配置权限。')],
        capabilities: [codeFact('支持创建、编辑、删除和推广获客链接。')],
        pageAreas: [recordFact('页面包含列表和新增表单。')],
        operations: [recordFact('可以打开新增获客助手表单。')],
        configuration: [codeFact('可以配置员工分流和欢迎语。')],
        businessRules: [codeFact('保存请求通过后端接口提交。')],
        systemBehavior: [codeFact('新增成功后刷新获客链接列表。')],
        limitations: [codeFact('分流方式保存后不可修改。')],
        implementation: [codeFact('前端调用 saveOrUpdate 接口。')],
        gapIds: ['gap-product-purpose'],
      }],
    }],
    scenarios: [{
      id: 'create-acquisition-link',
      groupId: 'private-acquisition',
      featureIds: ['acquisition-link'],
      name: '创建企业微信获客链接',
      recordEvidenceIds: ['ev-record-workflow'],
      goal: [recordFact('创建企业微信获客链接。')],
      roles: [recordFact('私域运营人员。')],
      preconditions: [recordFact('具备企业微信和员工配置权限。')],
      steps: [{ id: 'step-submit', action: '确认配置', result: codeFact('系统保存配置并刷新列表。') }],
      keyConfigurations: [codeFact('配置企业微信、员工分流和欢迎语。')],
      outcomes: [codeFact('生成可用于推广的企业微信获客链接。')],
      usageNotes: [codeFact('创建前先确认员工容量和欢迎语策略。')],
      gapIds: ['gap-record-quality'],
    }],
    gaps: [
      {
        id: 'gap-product-purpose',
        title: '产品定位需要确认',
        description: '当前未提供需求或产品设计依据。',
        audience: 'product-review',
        subjectRefs: ['feature:acquisition-link'],
      },
      {
        id: 'gap-record-quality',
        title: '录制未捕获最终响应',
        description: '该信息只用于内部采集诊断。',
        audience: 'internal',
        subjectRefs: ['scenario:create-acquisition-link'],
      },
    ],
  };
  return { outputRoot, recordRoot, codeRoot, model };
}

test('MVP build renders product-first Chinese pages without leaking source roots', (t) => {
  const data = fixture(t);
  const build = buildMvpWiki(data.model);
  const paths = build.files.map((file) => file.path);
  assert.deepEqual(paths.filter((path) => path.endsWith('.md')).sort(), [
    '产品功能/私域获客/获客链接.md',
    '待确认问题.md',
    '用户场景/私域获客/创建企业微信获客链接.md',
    '目录.md',
  ].sort());
  const serialized = build.files.filter((file) => file.path.endsWith('.md')).map((file) => file.content).join('\n');
  assert.doesNotMatch(serialized, new RegExp(data.recordRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, new RegExp(data.codeRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(serialized, /## 功能清单/);
  assert.match(serialized, /## 配置说明/);
  assert.match(serialized, /## 需求来源/);
  assert.match(serialized, /\[TAPD 1（已结束）：获客链接产品目标\]\(https:\/\/example\.test\/tapd\/workspaces\/10000000\/stories\/1\)/);
  assert.match(serialized, /新增成功后刷新获客链接列表/);
  assert.doesNotMatch(serialized, /来源证据|实际观察|最终响应|_\[(?:已确认|部分证据|待确认)\]_/);
  assert.doesNotMatch(serialized, /> 文档状态：产品评审草稿/);
  assert.doesNotMatch(serialized, /产品功能\/产品功能\.md|业务流程\//);
  const featurePage = build.files.find((file) => file.path === '产品功能/私域获客/获客链接.md');
  const scenarioPage = build.files.find((file) => file.path === '用户场景/私域获客/创建企业微信获客链接.md');
  assert.deepEqual(parseFrontmatter(featurePage.content).data, {
    schemaVersion: '1',
    status: 'product-review-draft',
    generatedBy: 'yog:wiki-mvp',
    pageId: 'feature-acquisition-link',
    pageType: 'feature',
    title: '获客链接',
    featureGroupId: 'private-acquisition',
    featureGroup: '私域获客',
    featureId: 'acquisition-link',
    menuPath: ['私域获客', '获客链接'],
    route: '/acquire/private/link',
    relatedScenarioIds: ['scenario-create-acquisition-link'],
    requirementEvidenceIds: ['ev-requirement-purpose'],
  });
  assert.deepEqual(parseFrontmatter(scenarioPage.content).data.relatedFeatureIds, ['acquisition-link']);
  assert.equal(build.manifest.sources.some((source) => 'root' in source), false);
  assert.equal(build.manifest.reviewStatus, 'product-review-draft');
  assert.equal(build.manifest.gaps.length, 2);
  assert.equal(build.manifest.gaps.some((gap) => gap.audience === 'internal'), true);
  assert.equal(build.manifest.pages.every((page) => page.status === 'product-review-draft'), true);
  const catalogFeature = build.manifest.pages.find((page) => page.id === 'feature-acquisition-link');
  assert.deepEqual(catalogFeature.requirementEvidenceIds, ['ev-requirement-purpose']);
  const requirementSource = build.manifest.sources.find((source) => source.id === 'requirements-example');
  assert.equal(requirementSource.type, 'requirement');
  assert.equal(requirementSource.provider, 'tapd');
  assert.equal(requirementSource.providerLabel, 'TAPD');
  assert.equal(requirementSource.scope, 'workspace:10000000');
  assert.deepEqual(requirementSource.queries.map((query) => query.tier), ['menu', 'capability']);
  assert.equal(requirementSource.candidates[0].normalizedStatus, 'completed');
  assert.equal(requirementSource.candidates[0].decision, 'adopted');
  const requirementEvidence = JSON.parse(build.files.find((file) => file.path === '_meta/evidence.json').content)
    .evidence.find((evidence) => evidence.id === 'ev-requirement-purpose');
  assert.equal(requirementEvidence.requirement.externalId, '1');
  assert.equal(requirementEvidence.requirement.normalizedStatus, 'completed');
});

test('MVP generator creates and fully replaces only its own managed Wiki', (t) => {
  const data = fixture(t);
  const created = generateMvpWiki(data.model);
  assert.equal(created.operation, 'create');
  assert.equal(existsSync(join(data.outputRoot, 'docs/wiki/产品功能/私域获客/获客链接.md')), true);
  const manifest = JSON.parse(readFileSync(join(data.outputRoot, 'docs/wiki/_meta/manifest.json'), 'utf8'));
  assert.equal(manifest.managedBy, 'yog:wiki-mvp');

  const replaced = generateMvpWiki({ ...data.model, runId: 'wiki-mvp-test-b' });
  assert.equal(replaced.operation, 'replace');
  assert.equal(existsSync(join(data.outputRoot, replaced.backupPath, '_meta/manifest.json')), true);
});

test('MVP generator refuses to overwrite an unmanaged Wiki root', (t) => {
  const data = fixture(t);
  mkdirSync(join(data.outputRoot, 'docs/wiki'), { recursive: true });
  writeFileSync(join(data.outputRoot, 'docs/wiki/README.md'), '# Human Wiki\n');
  assert.throws(() => generateMvpWiki(data.model), { code: 'wiki-mvp-root-unmanaged' });
  assert.equal(readFileSync(join(data.outputRoot, 'docs/wiki/README.md'), 'utf8'), '# Human Wiki\n');
});

test('MVP authority and metadata gates reject invented scenarios and machine-local values', (t) => {
  const data = fixture(t);
  const withoutRecordAuthority = structuredClone(data.model);
  withoutRecordAuthority.scenarios[0].recordEvidenceIds = ['ev-code-save'];
  assert.throws(() => buildMvpWiki(withoutRecordAuthority), { code: 'wiki-mvp-authority-evidence-invalid' });

  const invalidRequirementAuthority = structuredClone(data.model);
  invalidRequirementAuthority.featureGroups[0].features[0].requirementEvidenceIds = ['ev-code-save'];
  assert.throws(() => buildMvpWiki(invalidRequirementAuthority), { code: 'wiki-mvp-authority-evidence-invalid' });

  const leakingMetadata = structuredClone(data.model);
  leakingMetadata.sources[0].name = '/Users/example/private/menu.json';
  assert.throws(() => buildMvpWiki(leakingMetadata), { code: 'wiki-mvp-sensitive-output' });
});

test('MVP requirement retrieval gate enforces scope status hierarchy relevance and code cross-validation', (t) => {
  const data = fixture(t);
  const requirementSource = (model) => model.sources.find((source) => source.type === 'requirement');

  const unconfirmedScope = structuredClone(data.model);
  requirementSource(unconfirmedScope).scopeConfirmedByUser = false;
  assert.throws(() => buildMvpWiki(unconfirmedScope), { code: 'wiki-mvp-requirement-scope-unconfirmed' });

  const inProgress = structuredClone(data.model);
  requirementSource(inProgress).candidates[0].normalizedStatus = 'in-progress';
  assert.throws(() => buildMvpWiki(inProgress), { code: 'wiki-mvp-requirement-status-not-adoptable' });

  const guessedHierarchy = structuredClone(data.model);
  requirementSource(guessedHierarchy).candidates[0].relationshipVerified = false;
  assert.throws(() => buildMvpWiki(guessedHierarchy), { code: 'wiki-mvp-requirement-hierarchy-unverified' });

  const weakMatch = structuredClone(data.model);
  requirementSource(weakMatch).candidates[0].relevance = 'weak';
  assert.throws(() => buildMvpWiki(weakMatch), { code: 'wiki-mvp-requirement-relevance-not-adoptable' });

  const noCodeEvidence = structuredClone(data.model);
  requirementSource(noCodeEvidence).candidates[0].codeEvidenceIds = [];
  assert.throws(() => buildMvpWiki(noCodeEvidence), { code: 'wiki-mvp-requirement-code-evidence-required' });

  const noJoinedClaim = structuredClone(data.model);
  noJoinedClaim.featureGroups[0].features[0].purpose[0].evidenceIds = ['ev-requirement-purpose'];
  assert.throws(() => buildMvpWiki(noJoinedClaim), { code: 'wiki-mvp-requirement-claim-cross-validation-required' });
});

test('MVP requirement conflicts require a product-review gap and cannot become feature evidence', (t) => {
  const data = fixture(t);
  const conflict = structuredClone(data.model);
  const source = conflict.sources.find((item) => item.type === 'requirement');
  source.candidates[0].decision = 'conflict';
  conflict.featureGroups[0].features[0].requirementEvidenceIds = [];
  conflict.featureGroups[0].features[0].purpose = [conflict.featureGroups[0].features[0].systemBehavior[0]];
  assert.doesNotThrow(() => buildMvpWiki(conflict));

  const withoutGap = structuredClone(conflict);
  withoutGap.gaps = withoutGap.gaps.filter((gap) => !gap.subjectRefs.includes('feature:acquisition-link'));
  withoutGap.featureGroups[0].features[0].gapIds = [];
  assert.throws(() => buildMvpWiki(withoutGap), { code: 'wiki-mvp-requirement-conflict-gap-required' });
});

test('MVP supports menu and code without Record and requires an explicit user scope decision', (t) => {
  const data = fixture(t);
  const menuCodeOnly = structuredClone(data.model);
  menuCodeOnly.scopeDecision = { mode: 'menu-scope', confirmedByUser: true };
  menuCodeOnly.sources = menuCodeOnly.sources.filter((source) => source.type !== 'record');
  menuCodeOnly.evidence = menuCodeOnly.evidence.filter((evidence) => evidence.sourceId !== 'record-create-link');
  menuCodeOnly.featureGroups[0].features[0].roles = [];
  menuCodeOnly.featureGroups[0].features[0].preconditions = [];
  menuCodeOnly.featureGroups[0].features[0].pageAreas = [menuCodeOnly.featureGroups[0].features[0].capabilities[0]];
  menuCodeOnly.featureGroups[0].features[0].operations = [menuCodeOnly.featureGroups[0].features[0].capabilities[0]];
  menuCodeOnly.scenarios = [];
  menuCodeOnly.gaps = menuCodeOnly.gaps.filter((gap) => gap.audience === 'product-review');
  const build = buildMvpWiki(menuCodeOnly);
  assert.equal(build.manifest.scope.scenarioIds.length, 0);
  assert.equal(build.files.some((file) => file.path.startsWith('用户场景/')), false);
  const featurePage = build.files.find((file) => file.path === '产品功能/私域获客/获客链接.md');
  assert.doesNotMatch(featurePage.content, /典型业务流程|Record 用户场景/);

  const unconfirmed = structuredClone(data.model);
  unconfirmed.scopeDecision.confirmedByUser = false;
  assert.throws(() => buildMvpWiki(unconfirmed), { code: 'wiki-mvp-scope-unconfirmed' });
});

test('MVP supports menu and code when no Requirement Provider source is supplied', (t) => {
  const data = fixture(t);
  const withoutRequirements = structuredClone(data.model);
  withoutRequirements.scopeDecision = { mode: 'menu-scope', confirmedByUser: true };
  withoutRequirements.sources = withoutRequirements.sources.filter((source) => source.type !== 'requirement');
  withoutRequirements.evidence = withoutRequirements.evidence.filter((evidence) => evidence.sourceId !== 'requirements-example');
  const feature = withoutRequirements.featureGroups[0].features[0];
  feature.requirementEvidenceIds = [];
  feature.purpose = [feature.systemBehavior[0]];
  assert.doesNotThrow(() => buildMvpWiki(withoutRequirements));
});
