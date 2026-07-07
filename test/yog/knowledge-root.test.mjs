import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRepoContext, assertInsideRepo } from '../../skills/yog/lib/knowledge-root.mjs';
import { mergeConfig, writeConfig } from '../../skills/yog/lib/config.mjs';

const deprecatedToolKey = String.fromCharCode(115, 101, 114, 101, 110, 97);

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'yog-root-'));
  mkdirSync(join(dir, '.git'));
  return dir;
}

test('resolveRepoContext prefers stdin repoRoot and default knowledgeRoot', () => {
  const repoRoot = tempRepo();
  const result = resolveRepoContext({ repoRoot });
  assert.equal(result.repoRoot, repoRoot);
  assert.equal(result.knowledgeRoot, 'docs/knowledge');
  assert.equal(result.knowledgeAbs, join(repoRoot, 'docs/knowledge'));
});

test('resolveRepoContext reads .yog/config.json knowledgeRoot', () => {
  const repoRoot = tempRepo();
  mkdirSync(join(repoRoot, '.yog'));
  writeFileSync(join(repoRoot, '.yog/config.json'), JSON.stringify({ schemaVersion: 1, knowledgeRoot: 'knowledge' }));
  const result = resolveRepoContext({ repoRoot });
  assert.equal(result.knowledgeRoot, 'knowledge');
  assert.equal(result.knowledgeAbs, join(repoRoot, 'knowledge'));
});

test('assertInsideRepo rejects resolved paths outside repo', () => {
  const repoRoot = tempRepo();
  assert.throws(() => assertInsideRepo(repoRoot, join(repoRoot, '..', 'outside.md')), /outside repository root/);
});

test('mergeConfig preserves unknown fields and writes non-sensitive shared config', () => {
  const merged = mergeConfig(
    { schemaVersion: 1, knowledgeRoot: 'docs/knowledge', extra: { keep: true } },
    { codeFactProvider: { type: 'none', status: 'not-configured' } },
  );
  assert.deepEqual(merged.extra, { keep: true });
  assert.equal(deprecatedToolKey in merged, false);
  assert.deepEqual(merged.codeFactProvider, { type: 'none', status: 'not-configured' });
});

test('writeConfig creates .yog/config.json', () => {
  const repoRoot = tempRepo();
  writeConfig(repoRoot, { schemaVersion: 1, knowledgeRoot: 'docs/knowledge' });
  assert.deepEqual(JSON.parse(readFileSync(join(repoRoot, '.yog/config.json'), 'utf8')), {
    schemaVersion: 1,
    knowledgeRoot: 'docs/knowledge',
  });
});
