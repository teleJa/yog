import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();

function run(repoRoot, script, payload = {}) {
  return spawnSync(process.execPath, [join(root, `skills/yog/scripts/${script}.mjs`)], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, payload }),
    encoding: 'utf8',
  });
}

function repo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-gate-'));
  mkdirSync(join(repoRoot, '.git'));
  run(repoRoot, 'init');
  return repoRoot;
}

test('lint reports P1 for candidate using verified', () => {
  const repoRoot = repo();
  run(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Repeated refund signals exist in support work.',
  });
  const path = join(repoRoot, 'docs/knowledge/candidates/refund.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('status: needs-review', 'status: verified'));
  const result = run(repoRoot, 'lint');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).issues[0].severity, 'P1');
});

test('sync builds indexes then lint passes for valid knowledge base', () => {
  const repoRoot = repo();
  run(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  const result = run(repoRoot, 'sync');
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).issues.length, 0);
});

test('verify is read-only and fails when index is stale', () => {
  const repoRoot = repo();
  run(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  const before = readFileSync(join(repoRoot, 'docs/knowledge/index.json'), 'utf8');
  const result = run(repoRoot, 'verify');
  assert.equal(result.status, 1);
  const after = readFileSync(join(repoRoot, 'docs/knowledge/index.json'), 'utf8');
  assert.equal(after, before);
});

test('lint reports P2 for duplicate candidates without blocking', () => {
  const repoRoot = repo();
  run(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    keywords: ['refund'],
    body: 'Repeated refund signals exist in support work.',
  });
  run(repoRoot, 'create-candidate', {
    candidateId: 'return-refund',
    name: 'Return Refund',
    summary: 'Return refund boundary candidate.',
    keywords: ['refund'],
    confirmDuplicate: true,
    body: 'Return refund signal from support work.',
  });
  const result = run(repoRoot, 'lint');
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).issues[0].severity, 'P2');
});

test('lint reports P1 for invalid relationships in CONTEXT-MAP', () => {
  const repoRoot = repo();
  run(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  const mapPath = join(repoRoot, 'docs/knowledge/CONTEXT-MAP.md');
  writeFileSync(mapPath, `${readFileSync(mapPath, 'utf8')}\n- order -> order: self loop\n`);
  const result = run(repoRoot, 'lint');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).issues[0].message, 'CONTEXT-MAP relationship cannot be a self-loop.');
});

test('lint reports P1 for ADR duplicate related_contexts and evidence filename mismatch', () => {
  const repoRoot = repo();
  run(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  run(repoRoot, 'create-capability', {
    contextId: 'order',
    capabilityId: 'refund',
    name: 'Refund',
    summary: 'Handle refunds.',
    responsibilities: 'Refund request business flow.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund starts from a customer request and ends with after-sales status update.',
  });
  mkdirSync(join(repoRoot, 'docs/knowledge/adr'), { recursive: true });
  writeFileSync(join(repoRoot, 'docs/knowledge/adr/0001-refund-events.md'), `---
status: accepted
name: Refund events
summary: Record refund state transitions as events.
related_contexts: [order, order]
keywords: [refund]
---

# Refund events

Refund state changes are recorded as durable events.
`);
  mkdirSync(join(repoRoot, 'docs/knowledge/contexts/order/evidence'), { recursive: true });
  writeFileSync(join(repoRoot, 'docs/knowledge/contexts/order/evidence/refund-data.md'), `---
evidence_kind: routes
name: Refund routes
summary: HTTP routes that enter the refund workflow.
source: repository
repo_commit: ""
generated_at: ""
generator: manual
generation_evidence: Reviewed route files in current repository.
capability: refund
status: draft
---

# Refund routes

Route POST /refunds starts refund request handling.
`);
  const result = run(repoRoot, 'lint');
  assert.equal(result.status, 1);
  const messages = JSON.parse(result.stdout).issues.map((issue) => issue.message);
  assert.equal(messages.includes('ADR related_contexts contains duplicate context ids.'), true);
  assert.equal(messages.includes('Evidence file name kind does not match frontmatter evidence_kind.'), true);
});
