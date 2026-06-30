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
  });
  assert.equal(evidence.status, 0);
  const text = readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/evidence/refund-routes.md'), 'utf8');
  assert.match(text, /name: Refund routes/);
  assert.match(text, /summary: HTTP routes that enter the refund workflow\./);
});
