import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();

function tempRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-reduce-'));
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

function candidate(overrides) {
  return {
    candidateId: 'course-link-entry',
    name: 'Course Link Entry',
    summary: 'Course link business signal.',
    business_boundary: 'Course link entry boundary.',
    responsibilities_hint: 'Course link creation.',
    non_responsibilities_hint: 'Feishu platform internals.',
    code_symbols: ['CourseLinkController#createCourseLink'],
    evidence_paths: ['src/CourseLinkController.java'],
    keywords: ['course', 'link'],
    possible_contexts: ['course-live'],
    confidence: 'medium',
    confidence_reason: 'Code entry exists.',
    skip_reason: '',
    ...overrides,
  };
}

test('reduce-candidates joins only by canonical code symbols', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'reduce-candidates', {
    batches: [
      { agent: 'controller-route-agent', candidates: [candidate({ candidateId: 'course-link-a', code_symbols: ['com.foo.CourseLinkController#createCourseLink(java.lang.String)'] })] },
      { agent: 'service-flow-agent', candidates: [candidate({ candidateId: 'course-link-b', code_symbols: ['CourseLinkController.createCourseLink'] })] },
      { agent: 'data-contract-agent', candidates: [candidate({ candidateId: 'course-link-c', name: 'Course Link Entry', code_symbols: ['CourseLinkMapper#save'], evidence_paths: ['src/CourseLinkMapper.java'] })] },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.gate, 'ok');
  assert.equal(output.stats.raw, 3);
  assert.equal(output.stats.clusters, 2);
  assert.equal(output.stats.possibleDuplicates, 1);
  const all = [...output.writable, ...output.lowConfidence];
  assert.equal(all.some((item) => item.code_symbols.includes('CourseLinkController#createCourseLink')), true);
  assert.equal(all.some((item) => item.candidateId === 'course-link-c'), true);
});

test('reduce-candidates bridge joins controller service and data lenses', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'reduce-candidates', {
    batches: [
      { agent: 'controller-route-agent', candidates: [candidate({ candidateId: 'course-link-entry', code_symbols: ['CourseLinkController#createCourseLink'] })] },
      { agent: 'service-flow-agent', candidates: [candidate({ candidateId: 'course-link-flow', code_symbols: ['CourseLinkController#createCourseLink', 'CourseLinkService#createLink', 'CourseLinkMapper#save'], evidence_paths: ['src/CourseLinkService.java'] })] },
      { agent: 'data-contract-agent', candidates: [candidate({ candidateId: 'course-link-data', code_symbols: ['CourseLinkMapper#save'], evidence_paths: ['src/CourseLinkMapper.java'] })] },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stats.clusters, 1);
  assert.equal(output.writable.length, 1);
  assert.deepEqual(output.writable[0].hitAgents, ['controller-route-agent', 'data-contract-agent', 'service-flow-agent']);
  assert.equal(output.writable[0].confidence, 'high');
});

test('reduce-candidates joins by identity symbols and keeps supporting symbols out of JOIN', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'reduce-candidates', {
    batches: [
      {
        agent: 'controller-route-agent',
        candidates: [candidate({
          candidateId: 'course-entry',
          identity_symbols: ['CourseController#create'],
          supporting_symbols: ['SharedService#helper'],
          code_symbols: ['CourseController#create', 'SharedService#helper'],
        })],
      },
      {
        agent: 'service-flow-agent',
        candidates: [candidate({
          candidateId: 'shared-helper-flow',
          identity_symbols: ['OtherController#create'],
          supporting_symbols: ['SharedService#helper'],
          code_symbols: ['OtherController#create', 'SharedService#helper'],
          evidence_paths: ['src/OtherController.java'],
        })],
      },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stats.clusters, 2);
  const all = [...output.writable, ...output.lowConfidence];
  assert.equal(all.find((item) => item.candidateId === 'course-entry').supporting_symbols.includes('SharedService#helper'), true);
  assert.equal(all.find((item) => item.candidateId === 'shared-helper-flow').identity_symbols.includes('OtherController#create'), true);
});

test('reduce-candidates joins same-agent same-slug identity candidates', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'reduce-candidates', {
    batches: [
      {
        agent: 'service-flow-agent',
        candidates: [
          candidate({ candidateId: 'wide-entry', code_symbols: ['WideController#entry'] }),
          candidate({ candidateId: 'wide-entry', code_symbols: ['WideController#entry'], evidence_paths: ['src/B.java'] }),
        ],
      },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stats.clusters, 1);
  assert.equal(output.stats.joinConflicts, 0);
  assert.equal(output.writable[0].candidateId, 'wide-entry');
});

test('reduce-candidates reports same-agent same-identity different-slug conflicts', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'reduce-candidates', {
    batches: [
      {
        agent: 'service-flow-agent',
        candidates: [
          candidate({ candidateId: 'wide-entry-a', code_symbols: ['WideController#entry'] }),
          candidate({ candidateId: 'wide-entry-b', code_symbols: ['WideController#entry'], evidence_paths: ['src/B.java'] }),
        ],
      },
    ],
  });
  assert.equal(result.status, 3);
  const output = JSON.parse(result.stdout);
  assert.equal(output.gate, 'batch-duplicates-require-resolution');
  assert.equal(output.stats.clusters, 2);
  assert.equal(output.stats.joinConflicts, 1);
  assert.equal(output.stats.batchDuplicates, 1);
  assert.equal(output.batchDuplicates[0].reason, 'same-identity-symbol');
});

test('reduce-candidates rejects missing symbols and keeps low confidence candidates', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'reduce-candidates', {
    batches: [
      { agent: 'controller-route-agent', candidates: [candidate({ candidateId: 'bad-candidate', code_symbols: [], evidence_paths: ['src/A.java'] })] },
      { agent: 'data-contract-agent', candidates: [candidate({ candidateId: 'thin-data', name: 'Thin Data', code_symbols: ['ThinMapper#find'], evidence_paths: ['src/ThinMapper.java'], keywords: [], possible_contexts: [] })] },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stats.rejected, 1);
  assert.equal(output.rejected[0].candidateId, 'bad-candidate');
  assert.equal(output.lowConfidence.length, 1);
  assert.equal(output.lowConfidence[0].candidateId, 'thin-data');
});

test('reduce-candidates gates when post-join clusters exceed maxCandidates', () => {
  const repoRoot = tempRepo();
  const candidates = Array.from({ length: 11 }, (_, index) => candidate({
    candidateId: `candidate-${index}`,
    name: `Candidate ${index}`,
    code_symbols: [`Class${index}#method`],
    evidence_paths: [`src/Class${index}.java`],
  }));
  const result = runScript(repoRoot, 'reduce-candidates', {
    maxCandidates: 10,
    batches: [{ agent: 'controller-route-agent', candidates }],
  });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.gate, 'narrow-scope-required');
  assert.equal(output.stats.clusters, 11);
  assert.deepEqual(output.writable, []);
  assert.deepEqual(output.lowConfidence, []);
});

test('reduce-candidates reports disk duplicates by candidate ids and code symbols', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'course-link-existing',
    name: 'Course Link Existing',
    summary: 'Course link boundary candidate.',
    keywords: ['course'],
    possible_contexts: ['course-live'],
    code_symbols: ['CourseLinkController#createCourseLink'],
    body: '- existing candidate.',
    evidence: '- symbol: CourseLinkController#createCourseLink',
  }).status, 0);
  const result = runScript(repoRoot, 'reduce-candidates', {
    batches: [
      { agent: 'controller-route-agent', candidates: [candidate({ candidateId: 'course-link-existing', code_symbols: ['CourseLinkController#createCourseLink'] })] },
    ],
  });
  assert.equal(result.status, 3);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stats.diskDuplicates, 1);
  const all = [...output.writable, ...output.lowConfidence];
  assert.deepEqual(all[0].diskDuplicate, { matched: true, candidateIds: ['course-link-existing'] });
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/course-link-existing.md')), true);
});

test('reduce-candidates rejects invalid batch structure with exit code 2', () => {
  const repoRoot = tempRepo();
  const result = runScript(repoRoot, 'reduce-candidates', { batches: [{ agent: 'broken' }] });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).issues[0].message, /candidates array/);
});

test('write-candidates blocks weak duplicate writes until batch decision is provided', () => {
  const repoRoot = tempRepo();
  const reduce = runScript(repoRoot, 'reduce-candidates', {
    batches: [{
      agent: 'controller-route-agent',
      candidates: [
        candidate({ candidateId: 'period-customer', name: 'Period Customer', keywords: ['customer'], code_symbols: ['PeriodController#bind'] }),
        candidate({ candidateId: 'traffic-attribution', name: 'Traffic Attribution', keywords: ['customer'], code_symbols: ['TrafficController#match'], evidence_paths: ['src/TrafficController.java'] }),
      ],
    }],
  });
  assert.equal(reduce.status, 0);
  const reduceOutput = JSON.parse(reduce.stdout);
  assert.equal(reduceOutput.stats.possibleDuplicates, 1);

  const blocked = runScript(repoRoot, 'write-candidates', { reduceOutput });
  assert.equal(blocked.status, 3);
  const blockedOutput = JSON.parse(blocked.stdout);
  assert.equal(blockedOutput.written, 0);
  assert.equal(blockedOutput.blocked, 1);
  assert.equal(blockedOutput.blockedDuplicates[0].candidateId, 'traffic-attribution');
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/period-customer.md')), false);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/traffic-attribution.md')), false);

  const confirmedRepo = tempRepo();
  const confirmedReduce = JSON.parse(runScript(confirmedRepo, 'reduce-candidates', {
    batches: [{
      agent: 'controller-route-agent',
      candidates: [
        candidate({ candidateId: 'period-customer', name: 'Period Customer', keywords: ['customer'], code_symbols: ['PeriodController#bind'] }),
        candidate({ candidateId: 'traffic-attribution', name: 'Traffic Attribution', keywords: ['customer'], code_symbols: ['TrafficController#match'], evidence_paths: ['src/TrafficController.java'] }),
      ],
    }],
  }).stdout);
  const confirmed = runScript(confirmedRepo, 'write-candidates', {
    reduceOutput: confirmedReduce,
    duplicateDecisions: {
      acceptDistinct: ['traffic-attribution'],
      reasons: { 'traffic-attribution': 'same keyword but distinct identity symbols and boundary' },
    },
  });
  assert.equal(confirmed.status, 0);
  const confirmedOutput = JSON.parse(confirmed.stdout);
  assert.equal(confirmedOutput.written, 2);
  assert.equal(confirmedOutput.confirmedDuplicates[0].candidateId, 'traffic-attribution');
  assert.equal(existsSync(join(confirmedRepo, 'docs/knowledge/candidates/period-customer.md')), true);
  assert.equal(existsSync(join(confirmedRepo, 'docs/knowledge/candidates/traffic-attribution.md')), true);
});

test('write-candidates blocks same identity batch duplicates before writing any files', () => {
  const repoRoot = tempRepo();
  const reduce = runScript(repoRoot, 'reduce-candidates', {
    batches: [{
      agent: 'service-flow-agent',
      candidates: [
        candidate({ candidateId: 'wide-entry-a', code_symbols: ['WideController#entry'] }),
        candidate({ candidateId: 'wide-entry-b', code_symbols: ['WideController#entry'], evidence_paths: ['src/B.java'] }),
      ],
    }],
  });
  assert.equal(reduce.status, 3);
  const reduceOutput = JSON.parse(reduce.stdout);
  assert.equal(reduceOutput.gate, 'batch-duplicates-require-resolution');

  const blocked = runScript(repoRoot, 'write-candidates', { reduceOutput });
  assert.equal(blocked.status, 3);
  const blockedOutput = JSON.parse(blocked.stdout);
  assert.equal(blockedOutput.written, 0);
  assert.equal(blockedOutput.blocked, 1);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/wide-entry-a.md')), false);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/wide-entry-b.md')), false);
});

test('write-candidates accepts both sides of confirmed weak duplicate pairs', () => {
  const repoRoot = tempRepo();
  const reduce = runScript(repoRoot, 'reduce-candidates', {
    batches: [{
      agent: 'controller-route-agent',
      candidates: [
        candidate({
          candidateId: 'course-content-subject',
          name: 'Course Content Subject',
          keywords: ['course'],
          code_symbols: ['CourseSubjectService#list'],
          identity_symbols: ['CourseSubjectService#list'],
        }),
        candidate({
          candidateId: 'course-subject-content-delivery',
          name: 'Course Subject Content Delivery',
          keywords: ['subject'],
          code_symbols: ['CourseSubjectService#list', 'CourseDeliveryService#send'],
          identity_symbols: ['CourseDeliveryService#send'],
          supporting_symbols: ['CourseSubjectService#list'],
          evidence_paths: ['src/CourseDeliveryService.java'],
        }),
      ],
    }],
  });
  assert.equal(reduce.status, 0);
  const reduceOutput = JSON.parse(reduce.stdout);
  assert.equal(reduceOutput.stats.possibleDuplicates, 1);

  const confirmed = runScript(repoRoot, 'write-candidates', {
    reduceOutput,
    duplicateDecisions: {
      acceptDistinct: ['course-subject-content-delivery'],
      reasons: { 'course-subject-content-delivery': 'shares supporting symbol but has distinct identity symbol' },
    },
  });
  assert.equal(confirmed.status, 0);
  const confirmedOutput = JSON.parse(confirmed.stdout);
  assert.equal(confirmedOutput.written, 2);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/course-content-subject.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/course-subject-content-delivery.md')), true);
});
