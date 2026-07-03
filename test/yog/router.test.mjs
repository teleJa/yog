import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('match-scope returns context matches and does not read candidates by default', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-router-'));
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
  run(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund Candidate',
    summary: 'Unconfirmed refund candidate.',
    body: 'Refund candidate should not appear in default routing.',
  });
  run(repoRoot, 'sync');
  const result = run(repoRoot, 'match-scope', { query: 'order refund lifecycle' });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.query, 'order refund lifecycle');
  assert.equal(output.issues.length, 0);
  assert.equal(output.matches[0].type, 'context');
  assert.equal(output.matches.some((match) => match.type === 'candidate'), false);
});

test('match-scope prefers matching business-flow as operation overview', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-router-flow-'));
  mkdirSync(join(repoRoot, '.git'));
  run(repoRoot, 'init');
  run(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and refund operation overview.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  mkdirSync(join(repoRoot, 'docs/knowledge/business-flows'), { recursive: true });
  writeFileSync(join(repoRoot, 'docs/knowledge/business-flows/order-operation.md'), `---
flow_id: order-operation
name: Order Operation
summary: Order lifecycle and refund operation overview.
primary_contexts: [order]
related_contexts: []
keywords: [order, refund, operation]
status: draft
updated_at: ""
---

# Order Operation

## 业务范围

Order operation connects customer order lifecycle and refund handling.
`);
  run(repoRoot, 'sync');
  const result = run(repoRoot, 'match-scope', { query: 'order refund operation' });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.issues.length, 0);
  assert.equal(output.matches[0].type, 'business-flow');
  assert.equal(output.matches[0].path, 'docs/knowledge/business-flows/order-operation.md');
});

test('match-scope exits non-zero when generated indexes are missing', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-router-missing-'));
  mkdirSync(join(repoRoot, '.git'));
  run(repoRoot, 'init');
  rmSync(join(repoRoot, 'docs/knowledge/index.json'));
  const missingGlobal = run(repoRoot, 'match-scope', { query: 'order' });
  assert.equal(missingGlobal.status, 1);
  assert.equal(JSON.parse(missingGlobal.stdout).issues[0].path, 'docs/knowledge/index.json');

  run(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  });
  run(repoRoot, 'sync');
  rmSync(join(repoRoot, 'docs/knowledge/contexts/order/index.json'));
  const missingContext = run(repoRoot, 'match-scope', { query: 'order' });
  assert.equal(missingContext.status, 1);
  assert.equal(JSON.parse(missingContext.stdout).issues[0].path, 'docs/knowledge/contexts/order/index.json');
});

test('match-scope rejects half-broken context candidates', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-router-broken-'));
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
  run(repoRoot, 'sync');
  writeFileSync(join(repoRoot, 'docs/knowledge/contexts/order/README.md'), '# {Context Name}\n');
  const badReadme = run(repoRoot, 'match-scope', { query: 'order' });
  assert.equal(badReadme.status, 1);
  assert.equal(JSON.parse(badReadme.stdout).issues[0].path, 'docs/knowledge/contexts/order/README.md');

  writeFileSync(join(repoRoot, 'docs/knowledge/contexts/order/README.md'), '# Order\n\nOrder overview.\n');
  const indexPath = join(repoRoot, 'docs/knowledge/contexts/order/index.json');
  const contextIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
  contextIndex.context = 'wrong-context';
  writeFileSync(indexPath, `${JSON.stringify(contextIndex, null, 2)}\n`);
  const badIndex = run(repoRoot, 'match-scope', { query: 'order' });
  assert.equal(badIndex.status, 1);
  assert.equal(JSON.parse(badIndex.stdout).issues[0].message, 'Context index context does not match its path.');
});
