import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    input: options.input ?? '',
    encoding: 'utf8',
  });
}

test('plugin exposes exactly one Yog skill directory', () => {
  assert.equal(existsSync(join(root, 'skills/yog/SKILL.md')), true);
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
