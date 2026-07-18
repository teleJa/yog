import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    input: options.input ?? '',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
}

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function candidate(index) {
  return {
    candidateId: `wide-entry-${index}`,
    name: `Wide Entry ${index}`,
    summary: 'Wide entry candidate with enough text to exercise structured stdout.',
    business_boundary: 'Wide entry business boundary.',
    responsibilities_hint: 'Wide entry responsibility.',
    non_responsibilities_hint: 'Other boundaries.',
    code_symbols: ['WideController#entry'],
    evidence_paths: [`src/Wide${index}.java`],
    keywords: [`wide-${index}`],
    possible_contexts: ['wide-entry'],
    confidence: 'medium',
    confidence_reason: 'Regression fixture.',
  };
}

test('plugin exposes Yog skill entry directories', () => {
  assert.equal(existsSync(join(root, 'skills/yog/SKILL.md')), true);
  assert.equal(existsSync(join(root, 'skills/knowledge/SKILL.md')), true);
  assert.equal(existsSync(join(root, 'skills/knowledge-query/SKILL.md')), true);
  assert.equal(existsSync(join(root, 'skills/wiki-query/SKILL.md')), true);
  assert.equal(existsSync(join(root, 'skills/wiki-review/SKILL.md')), true);
  assert.deepEqual(
    readdirSync(join(root, 'skills')).filter((entry) => existsSync(join(root, 'skills', entry, 'SKILL.md'))).sort(),
    ['knowledge', 'knowledge-query', 'wiki', 'wiki-query', 'wiki-review', 'yog'],
  );
});

test('init script accepts stdin JSON and returns JSON on input errors', () => {
  const result = runNode(['skills/yog/scripts/init.mjs'], { input: '{' });
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    issues: [
      {
        severity: 'P1',
        message: 'stdin is not valid JSON.',
        details: { reason: 'parse-error' },
      },
    ],
  });
  assert.equal(result.stderr, '');
});

test('lint script without docs/knowledge returns structured P0', () => {
  const result = runNode(['skills/yog/scripts/lint.mjs']);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    issues: [
      {
        severity: 'P0',
        message: 'docs/knowledge does not exist.',
        path: 'docs/knowledge',
      },
    ],
  });
});

test('lint script without custom knowledgeRoot returns configured structured P0', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-contract-custom-root-'));
  mkdirSync(join(repoRoot, '.git'));
  const result = runNode(['skills/yog/scripts/lint.mjs'], {
    input: JSON.stringify({ repoRoot, knowledgeRoot: 'knowledge' }),
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    issues: [
      {
        severity: 'P0',
        message: 'knowledge does not exist.',
        path: 'knowledge',
      },
    ],
  });
});

test('install-hooks script returns structured error for non-Codex platforms', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-contract-hooks-'));
  mkdirSync(join(repoRoot, '.git'));
  const result = runNode(['skills/yog/scripts/install-hooks.mjs'], {
    input: JSON.stringify({ repoRoot, payload: { platforms: ['nope'] } }),
  });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.platforms, []);
  assert.equal(output.issues[0].severity, 'P1');
  assert.equal(result.stderr, '');
});

test('upgrade-guidance script accepts empty stdin as structured input', () => {
  const result = runNode(['skills/yog/scripts/upgrade-guidance.mjs']);
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    issues: [
      {
        severity: 'P0',
        message: 'docs/knowledge does not exist.',
        path: 'docs/knowledge',
      },
    ],
    applied: false,
    changed: [],
    unchanged: [],
    hookUpgrade: null,
  });
});

test('audit scripts exist as internal deterministic write actions', () => {
  assert.equal(existsSync(join(root, 'skills/yog/scripts/knowledge-audit.mjs')), true);
  assert.equal(existsSync(join(root, 'skills/yog/scripts/wiki-audit.mjs')), true);
});

test('reduce-candidates exit 3 still emits complete parseable JSON', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-contract-reduce-json-'));
  mkdirSync(join(repoRoot, '.git'));
  runNode(['skills/yog/scripts/init.mjs'], { input: JSON.stringify({ repoRoot }) });
  const result = runNode(['skills/yog/scripts/reduce-candidates.mjs'], {
    input: JSON.stringify({
      repoRoot,
      payload: {
        batches: [
          {
            agent: 'service-flow-agent',
            candidates: [candidate(1), candidate(2)],
          },
        ],
      },
    }),
  });
  assert.equal(result.status, 3);
  const output = JSON.parse(result.stdout);
  assert.equal(output.gate, 'batch-duplicates-require-resolution');
  assert.equal(output.stats.batchDuplicates, 1);
  assert.equal(result.stderr, '');
});

test('wiki init workflow is not exposed', () => {
  assert.equal(existsSync(join(root, 'skills/yog/scripts/init-wiki.mjs')), false);
});

test('wiki lifecycle exposes prepare confirmation generate update sync and verify scripts', () => {
  for (const script of [
    'prepare-wiki.mjs',
    'confirm-wiki-sources.mjs',
    'stage-wiki-input.mjs',
    'generate-wiki.mjs',
    'update-wiki.mjs',
    'sync-wiki.mjs',
    'verify-wiki.mjs',
    'draft-wiki-decision.mjs',
    'confirm-wiki-decision.mjs',
  ]) {
    assert.equal(existsSync(join(root, 'skills/yog/scripts', script)), true, script);
  }
  for (const legacy of [
    `${['generate', 'wiki', 'mvp'].join('-')}.mjs`,
    'check-wiki.mjs',
    'plan-wiki-refresh.mjs',
    'apply-wiki-refresh.mjs',
    'build-wiki-evidence-batches.mjs',
  ]) {
    assert.equal(existsSync(join(root, 'skills/yog/scripts', legacy)), false, legacy);
  }
});
