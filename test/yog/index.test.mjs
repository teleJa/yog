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

function repoWithKnowledge() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-index-'));
  mkdirSync(join(repoRoot, '.git'));
  run(repoRoot, 'init');
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
  run(repoRoot, 'create-evidence', {
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
  return repoRoot;
}

test('build-index writes global and context indexes with expected entries', () => {
  const repoRoot = repoWithKnowledge();
  const result = run(repoRoot, 'build-index');
  assert.equal(result.status, 0);
  const global = JSON.parse(readFileSync(join(repoRoot, 'docs/knowledge/index.json'), 'utf8'));
  assert.equal(global.kind, 'global');
  assert.deepEqual(global.entries.map((entry) => entry.type), ['context']);
  assert.equal(global.entries[0].path, 'docs/knowledge/contexts/order/CONTEXT.md');
  assert.equal(global.entries[0].docsCount, 2);
  const context = JSON.parse(readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/index.json'), 'utf8'));
  assert.deepEqual(context.entries.map((entry) => entry.type), ['capability', 'evidence']);
  assert.equal(context.entries[0].evidenceCount, 1);
});

test('build-index creates global ADR entries and context adr-link entries', () => {
  const repoRoot = repoWithKnowledge();
  mkdirSync(join(repoRoot, 'docs/knowledge/adr'), { recursive: true });
  writeFileSync(join(repoRoot, 'docs/knowledge/adr/0001-refund-events.md'), `---
status: accepted
name: Refund events
summary: Record refund state transitions as events.
related_contexts: [order]
keywords: [refund, event-log]
updated_at: ""
---

# Refund events

Refund state changes are recorded as durable events.
`);
  assert.equal(run(repoRoot, 'build-index').status, 0);
  const global = JSON.parse(readFileSync(join(repoRoot, 'docs/knowledge/index.json'), 'utf8'));
  assert.deepEqual(global.entries.map((entry) => entry.type), ['context', 'adr']);
  const context = JSON.parse(readFileSync(join(repoRoot, 'docs/knowledge/contexts/order/index.json'), 'utf8'));
  assert.deepEqual(context.entries.map((entry) => entry.type), ['capability', 'evidence', 'adr-link']);
});

test('check-index ignores generated timestamps and fails on stale content', () => {
  const repoRoot = repoWithKnowledge();
  assert.equal(run(repoRoot, 'build-index').status, 0);
  assert.equal(run(repoRoot, 'check-index').status, 0);
});

test('build-index fails when CONTEXT-MAP points at a missing context source', () => {
  const repoRoot = repoWithKnowledge();
  const contextPath = join(repoRoot, 'docs/knowledge/contexts/order/CONTEXT.md');
  writeFileSync(contextPath, '# {Context Name}\n\n## 业务定位\n');
  const result = run(repoRoot, 'build-index');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).issues[0].path, 'docs/knowledge/contexts/order/CONTEXT.md');
});

test('build-index fails when ADR related_contexts references a missing context', () => {
  const repoRoot = repoWithKnowledge();
  mkdirSync(join(repoRoot, 'docs/knowledge/adr'), { recursive: true });
  writeFileSync(join(repoRoot, 'docs/knowledge/adr/0001-refund-events.md'), `---
status: accepted
name: Refund events
summary: Record refund state transitions as events.
related_contexts: [missing-context]
keywords: [refund, event-log]
updated_at: ""
---

# Refund events

Refund state changes are recorded as durable events.
`);
  const result = run(repoRoot, 'build-index');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).issues[0].message, 'ADR related_contexts references an unknown context.');
});
