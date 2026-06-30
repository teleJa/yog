import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const initScript = join(process.cwd(), 'skills/yog/scripts/init.mjs');

function tempRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-init-'));
  mkdirSync(join(repoRoot, '.git'));
  return repoRoot;
}

function runInit(repoRoot, payload = {}) {
  return spawnSync(process.execPath, [initScript], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, payload }),
    encoding: 'utf8',
  });
}

test('init creates docs/knowledge skeleton config and managed blocks', () => {
  const repoRoot = tempRepo();
  const result = runInit(repoRoot, {
    serena: { enabled: true },
    codeFactProvider: { type: 'none', status: 'not-configured' },
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout).issues, []);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/README.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/templates/evidence.md')), true);
  assert.equal(existsSync(join(repoRoot, '.yog/config.json')), true);
  const agents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8');
  const claude = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
  const blockPattern = /<!-- YOG MANAGED BLOCK START -->[\s\S]*<!-- YOG MANAGED BLOCK END -->/;
  assert.match(agents, blockPattern);
  assert.match(claude, blockPattern);
  assert.equal(agents.match(blockPattern)[0], claude.match(blockPattern)[0]);
});

test('init replaces only the managed block and preserves existing file content', () => {
  const repoRoot = tempRepo();
  writeFileSync(join(repoRoot, 'AGENTS.md'), 'team agent rules\n');
  writeFileSync(join(repoRoot, 'CLAUDE.md'), 'team claude rules\n');
  const result = runInit(repoRoot);
  assert.equal(result.status, 0);
  assert.match(readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8'), /team agent rules/);
  assert.match(readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8'), /team claude rules/);
});

test('init is idempotent and does not overwrite existing template file', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  writeFileSync(join(repoRoot, 'docs/knowledge/templates/evidence.md'), 'team edited evidence template\n');
  const result = runInit(repoRoot);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.issues.some((issue) => issue.severity === 'P2'), true);
  assert.equal(readFileSync(join(repoRoot, 'docs/knowledge/templates/evidence.md'), 'utf8'), 'team edited evidence template\n');
});
