import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('reduce-candidates gates only mid-low candidates when threshold is exceeded', () => {
  const repoRoot = tempRepo();
  const highCandidates = Array.from({ length: 3 }, (_, index) => candidate({
    candidateId: `high-candidate-${index}`,
    name: `High Candidate ${index}`,
    code_symbols: [`HighClass${index}#method`, `HighMapper${index}#save`, `HighService${index}#sync`],
    evidence_paths: [`src/HighClass${index}.java`, `src/HighMapper${index}.java`, `src/HighService${index}.java`],
  }));
  const midLowCandidates = Array.from({ length: 11 }, (_, index) => candidate({
    candidateId: `midlow-candidate-${index}`,
    name: `MidLow Candidate ${index}`,
    code_symbols: [`MidLowClass${index}#method`],
    evidence_paths: [`src/MidLowClass${index}.java`],
  }));
  const result = runScript(repoRoot, 'reduce-candidates', {
    maxCandidates: 10,
    batches: [{ agent: 'controller-route-agent', candidates: [...highCandidates, ...midLowCandidates] }],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.gate, 'mid-low-scope-required');
  assert.equal(output.stats.clusters, 14);
  assert.equal(output.stats.high, 3);
  assert.equal(output.stats.midLow, 11);
  assert.equal(output.stats.threshold, 10);
  assert.equal(output.stats.thresholdSource, 'payload');
  assert.deepEqual(output.writable.map((item) => item.candidateId).sort(), ['high-candidate-0', 'high-candidate-1', 'high-candidate-2']);
  assert.deepEqual(output.lowConfidence, []);
  assert.equal(output.gatedCandidates.length, 11);
  assert.equal(output.gatedCandidates[0].score >= 0, true);
});

test('reduce-candidates respects mid-low threshold boundaries and config fallback', () => {
  const repoRoot = tempRepo();
  const configPath = join(repoRoot, '.yog/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.discover.maxMidLowCandidates = 2;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const thresholdCandidates = Array.from({ length: 2 }, (_, index) => candidate({
    candidateId: `threshold-candidate-${index}`,
    name: `Threshold Candidate ${index}`,
    code_symbols: [`ThresholdClass${index}#method`],
    evidence_paths: [`src/ThresholdClass${index}.java`],
  }));
  const equal = runScript(repoRoot, 'reduce-candidates', {
    batches: [{ agent: 'controller-route-agent', candidates: thresholdCandidates }],
  });
  assert.equal(equal.status, 0);
  const equalOutput = JSON.parse(equal.stdout);
  assert.equal(equalOutput.gate, 'ok');
  assert.equal(equalOutput.stats.threshold, 2);
  assert.equal(equalOutput.stats.thresholdSource, 'config');

  const exceeded = runScript(repoRoot, 'reduce-candidates', {
    batches: [{ agent: 'controller-route-agent', candidates: [...thresholdCandidates, candidate({ candidateId: 'threshold-candidate-2', name: 'Threshold Candidate 2', code_symbols: ['ThresholdClass2#method'], evidence_paths: ['src/ThresholdClass2.java'] })] }],
  });
  assert.equal(exceeded.status, 0);
  assert.equal(JSON.parse(exceeded.stdout).gate, 'mid-low-scope-required');

  config.discover.maxMidLowCandidates = 'bad';
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const invalidConfig = runScript(repoRoot, 'reduce-candidates', {
    batches: [{ agent: 'controller-route-agent', candidates: thresholdCandidates }],
  });
  assert.equal(invalidConfig.status, 0);
  const invalidOutput = JSON.parse(invalidConfig.stdout);
  assert.equal(invalidOutput.stats.threshold, 10);
  assert.equal(invalidOutput.stats.thresholdSource, 'default');
  assert.equal(invalidOutput.issues.some((issue) => issue.severity === 'P2' && /Invalid discover/.test(issue.message)), true);

  const invalidPayload = runScript(repoRoot, 'reduce-candidates', {
    maxCandidates: 0,
    batches: [{ agent: 'controller-route-agent', candidates: thresholdCandidates }],
  });
  assert.equal(invalidPayload.status, 2);
  assert.match(JSON.parse(invalidPayload.stdout).issues[0].message, /maxCandidates/);
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

test('write-candidates writes high candidates and gated report for mid-low gate', () => {
  const repoRoot = tempRepo();
  const highCandidate = candidate({
    candidateId: 'course-high',
    name: 'Course High',
    code_symbols: ['CourseHighController#create', 'CourseHighService#create', 'CourseHighMapper#save'],
    evidence_paths: ['src/CourseHighController.java', 'src/CourseHighService.java', 'src/CourseHighMapper.java'],
  });
  const midLowCandidates = Array.from({ length: 11 }, (_, index) => candidate({
    candidateId: `overflow-${index}`,
    name: `Overflow ${index}`,
    code_symbols: [`Overflow${index}#method`],
    evidence_paths: [`src/Overflow${index}.java`],
  }));
  const reduce = runScript(repoRoot, 'reduce-candidates', {
    maxCandidates: 10,
    batches: [{ agent: 'controller-route-agent', candidates: [highCandidate, ...midLowCandidates] }],
  });
  assert.equal(reduce.status, 0);
  const reduceOutput = JSON.parse(reduce.stdout);
  assert.equal(reduceOutput.gate, 'mid-low-scope-required');
  assert.deepEqual(reduceOutput.writable.map((item) => item.candidateId), ['course-high']);
  const written = runScript(repoRoot, 'write-candidates', { reduceOutput });
  assert.equal(written.status, 0);
  const output = JSON.parse(written.stdout);
  assert.equal(output.written, 1);
  assert.equal(output.gatedReportPath, 'docs/knowledge/candidates/_gated/gated-candidates.md');
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/course-high.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/overflow-0.md')), false);
  const reportPath = join(repoRoot, output.gatedReportPath);
  const report = readFileSync(reportPath, 'utf8');
  assert.match(report, /# 被门禁挡下的中低信度候选/);
  assert.match(report, /本次被挡: 11 个/);
  assert.match(report, /已自动写入的 high 候选: 1 个/);
  assert.match(report, /overflow-0/);

  const overwriteRepo = tempRepo();
  const overwriteReportPath = join(overwriteRepo, output.gatedReportPath);
  mkdirSync(join(overwriteRepo, 'docs/knowledge/candidates/_gated'), { recursive: true });
  writeFileSync(overwriteReportPath, 'old gated report\n');
  const overwrittenReduce = runScript(overwriteRepo, 'reduce-candidates', {
    maxCandidates: 1,
    batches: [{ agent: 'controller-route-agent', candidates: [
      candidate({ candidateId: 'later-high', name: 'Later High', code_symbols: ['LaterController#create', 'LaterService#create', 'LaterMapper#save'], evidence_paths: ['src/LaterController.java', 'src/LaterService.java', 'src/LaterMapper.java'] }),
      candidate({ candidateId: 'later-overflow-a', name: 'Later Overflow A', code_symbols: ['LaterA#method'], evidence_paths: ['src/LaterA.java'] }),
      candidate({ candidateId: 'later-overflow-b', name: 'Later Overflow B', code_symbols: ['LaterB#method'], evidence_paths: ['src/LaterB.java'] }),
    ] }],
  });
  assert.equal(overwrittenReduce.status, 0);
  const overwritten = runScript(overwriteRepo, 'write-candidates', { reduceOutput: JSON.parse(overwrittenReduce.stdout) });
  assert.equal(overwritten.status, 0);
  const overwrittenReport = readFileSync(overwriteReportPath, 'utf8');
  assert.match(overwrittenReport, /later-overflow-a/);
  assert.doesNotMatch(overwrittenReport, /old gated report/);
});

test('write-candidates does not bypass duplicate gates for high candidates under mid-low gate', () => {
  const repoRoot = tempRepo();
  assert.equal(runScript(repoRoot, 'create-candidate', {
    candidateId: 'course-high-existing',
    name: 'Course High Existing',
    summary: 'Existing high candidate.',
    keywords: ['course-high'],
    possible_contexts: ['course-live'],
    code_symbols: ['CourseHighController#create'],
    body: '- existing candidate.',
    evidence: '- symbol: CourseHighController#create',
  }).status, 0);
  const reduce = runScript(repoRoot, 'reduce-candidates', {
    maxCandidates: 1,
    batches: [{ agent: 'controller-route-agent', candidates: [
      candidate({
        candidateId: 'course-high-new',
        name: 'Course High New',
        keywords: ['course-high'],
        code_symbols: ['CourseHighController#create', 'CourseHighService#create', 'CourseHighMapper#save'],
        evidence_paths: ['src/CourseHighController.java', 'src/CourseHighService.java', 'src/CourseHighMapper.java'],
      }),
      candidate({ candidateId: 'overflow-a', name: 'Overflow A', code_symbols: ['OverflowA#method'], evidence_paths: ['src/OverflowA.java'] }),
      candidate({ candidateId: 'overflow-b', name: 'Overflow B', code_symbols: ['OverflowB#method'], evidence_paths: ['src/OverflowB.java'] }),
    ] }],
  });
  assert.equal(reduce.status, 3);
  const reduceOutput = JSON.parse(reduce.stdout);
  assert.equal(reduceOutput.gate, 'mid-low-scope-required');
  assert.equal(reduceOutput.stats.diskDuplicates, 1);
  const blocked = runScript(repoRoot, 'write-candidates', { reduceOutput });
  assert.equal(blocked.status, 3);
  const output = JSON.parse(blocked.stdout);
  assert.equal(output.written, 0);
  assert.equal(output.blocked, 1);
  assert.equal(output.gatedReportPath, 'docs/knowledge/candidates/_gated/gated-candidates.md');
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/course-high-new.md')), false);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/candidates/_gated/gated-candidates.md')), true);
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
