import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { generateRouter } from '../../skills/yog/lib/router-gen.mjs';

const routerScript = join(process.cwd(), 'skills/yog/scripts/generate-router.mjs');

function runScript(input) {
  return spawnSync(process.execPath, [routerScript], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  });
}

test('normal input: mixed yogInitialized, index emitted, exit 0', () => {
  const result = runScript({
    schemaVersion: 1,
    repositories: [
      { repo: 'callcenter', path: 'services/callcenter', remote: 'git@x:o/cc.git', knowledgeRoot: 'docs/knowledge', yogInitialized: true },
      { repo: 'oms', path: 'services/oms', yogInitialized: false },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.kind, 'router');
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.entries.length, 2);
  assert.deepEqual(output.issues, []);
  const cc = output.entries.find((e) => e.repo === 'callcenter');
  assert.equal(cc.type, 'repository');
  assert.equal(cc.knowledgeRoot, 'docs/knowledge');
  assert.equal(cc.yogInitialized, true);
});

test('yogInitialized:false repo still appears in entries', () => {
  const { entries } = generateRouter({ repositories: [{ repo: 'oms', path: 'services/oms', yogInitialized: false }] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].yogInitialized, false);
});

test('empty knowledgeRoot and remote are omitted, not emitted as ""', () => {
  const { entries } = generateRouter({ repositories: [{ repo: 'oms', path: 'services/oms', yogInitialized: false }] });
  assert.equal('remote' in entries[0], false);
  assert.equal('knowledgeRoot' in entries[0], false);
  assert.equal('path' in entries[0], true);
});

test('missing both path and remote -> P1, exit 1', () => {
  const result = runScript({ repositories: [{ repo: 'bad', yogInitialized: true }] });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.issues.some((i) => i.severity === 'P1' && /at least one of/.test(i.message)), true);
});

test('invalid repo id -> P1', () => {
  const { issues } = generateRouter({ repositories: [{ repo: 'Bad_Name', path: 'x', yogInitialized: false }] });
  assert.equal(issues.some((i) => i.severity === 'P1' && /\[a-z\]/.test(i.message)), true);
});

test('missing repo -> P1', () => {
  const { issues } = generateRouter({ repositories: [{ path: 'x', yogInitialized: false }] });
  assert.equal(issues.some((i) => i.severity === 'P1' && /missing "repo"/.test(i.message)), true);
});

test('duplicate repo -> second skipped with P1', () => {
  const { entries, issues } = generateRouter({
    repositories: [
      { repo: 'dup', path: 'a', yogInitialized: true },
      { repo: 'dup', path: 'b', yogInitialized: false },
    ],
  });
  assert.equal(entries.length, 1);
  assert.equal(issues.some((i) => /Duplicate/.test(i.message)), true);
});

test('missing repositories array -> P1, exit 1', () => {
  const result = runScript({ schemaVersion: 1 });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.entries.length, 0);
  assert.equal(output.issues.some((i) => /repositories/.test(i.message)), true);
});

test('empty repositories -> valid empty index, exit 0', () => {
  const result = runScript({ repositories: [] });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.kind, 'router');
  assert.deepEqual(output.entries, []);
  assert.deepEqual(output.issues, []);
});

test('entries sorted by repo id (stable output)', () => {
  const { entries } = generateRouter({
    repositories: [
      { repo: 'zebra', path: 'z', yogInitialized: false },
      { repo: 'alpha', path: 'a', yogInitialized: true },
    ],
  });
  assert.deepEqual(entries.map((e) => e.repo), ['alpha', 'zebra']);
});

test('empty stdin treated as missing repositories -> exit 1', () => {
  const result = runScript('');
  assert.equal(result.status, 1);
});

test('pure transformation: never reads repository internals (nonexistent paths are fine)', () => {
  const result = runScript({ repositories: [{ repo: 'ghost', path: '/nonexistent/repo/x', yogInitialized: true }] });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.entries[0].repo, 'ghost');
});

test('structurally invalid entries are EXCLUDED from entries (only P1, no pollution)', () => {
  // missing repo, invalid id, and no-locator must NOT appear in entries — only in issues.
  const { entries, issues } = generateRouter({
    repositories: [
      { path: 'services/a', yogInitialized: true },          // missing repo
      { repo: 'Bad_Name', path: 'x', yogInitialized: false }, // invalid id
      { repo: 'nolocator', yogInitialized: true },            // no path/remote
      { repo: 'good', path: 'services/good', yogInitialized: false }, // the only valid one
    ],
  });
  assert.deepEqual(entries.map((e) => e.repo), ['good']);
  assert.equal(entries.every((e) => e.repo && e.repo.length > 0), true);
  assert.equal(issues.length >= 3, true);
});

test('multiple missing-repo entries do not collide as duplicate empty ids', () => {
  const { entries } = generateRouter({
    repositories: [{ path: 'a' }, { path: 'b' }, { path: 'c' }],
  });
  assert.deepEqual(entries, []); // all excluded, none pushed as repo:""
});
