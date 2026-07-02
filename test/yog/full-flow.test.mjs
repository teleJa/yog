import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
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

function runWithInput(repoRoot, script, input) {
  return spawnSync(process.execPath, [join(root, `skills/yog/scripts/${script}.mjs`)], {
    cwd: repoRoot,
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

test('full Yog first-version flow initializes creates syncs verifies and routes', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-full-'));
  mkdirSync(join(repoRoot, '.git'));
  assert.equal(run(repoRoot, 'init').status, 0);
  assert.equal(run(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  }).status, 0);
  assert.equal(run(repoRoot, 'create-capability', {
    contextId: 'order',
    capabilityId: 'refund',
    name: 'Refund',
    summary: 'Handle refunds.',
    responsibilities: 'Refund request business flow.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund starts from a customer request and ends with after-sales status update.',
  }).status, 0);
  assert.equal(run(repoRoot, 'create-evidence', {
    contextId: 'order',
    capabilityId: 'refund',
    evidenceKind: 'routes',
    name: 'Refund routes',
    summary: 'HTTP routes that enter the refund workflow.',
    source: 'repository',
    generator: 'manual',
    generation_evidence: 'Reviewed route files in current repository.',
    body: 'Route POST /refunds starts refund request handling.',
    generationMethod: 'Manual route inspection.',
    entryPaths: '- src/refund/controller.js',
    routes: '- POST /refunds',
    limitations: '- Test fixture does not execute runtime HTTP calls.',
  }).status, 0);
  assert.equal(run(repoRoot, 'sync').status, 0);
  assert.equal(run(repoRoot, 'verify').status, 0);
  const match = JSON.parse(run(repoRoot, 'match-scope', { query: 'refund route order' }).stdout);
  assert.equal(match.matches.some((entry) => entry.type === 'evidence' && entry.path.endsWith('/refund-routes.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/contexts/order/index.json')), true);
  assert.match(readFileSync(join(repoRoot, 'docs/knowledge/INDEX.md'), 'utf8'), /Order/);
});

test('full Yog flow honors custom knowledgeRoot in files indexes lint and routing', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-custom-root-'));
  const knowledgeRoot = 'knowledge';
  mkdirSync(join(repoRoot, '.git'));
  assert.equal(runWithInput(repoRoot, 'init', { repoRoot, knowledgeRoot }).status, 0);
  assert.equal(existsSync(join(repoRoot, 'knowledge/README.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/README.md')), false);
  assert.match(readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8'), /first read knowledge\/CONTEXT-MAP\.md/);

  assert.equal(run(repoRoot, 'create-context', {
    contextId: 'order',
    name: 'Order',
    summary: 'Order lifecycle and after-sales handling.',
    responsibilities: 'Own order lifecycle language.',
    nonResponsibilities: 'Payment settlement internals.',
    body: 'Order context covers order creation, cancellation, refund handoff, and after-sales vocabulary.',
  }).status, 0);
  assert.equal(run(repoRoot, 'create-capability', {
    contextId: 'order',
    capabilityId: 'refund',
    name: 'Refund',
    summary: 'Handle refunds.',
    responsibilities: 'Refund request business flow.',
    nonResponsibilities: 'Payment gateway settlement.',
    body: 'Refund starts from a customer request and ends with after-sales status update.',
  }).status, 0);
  assert.equal(run(repoRoot, 'create-evidence', {
    contextId: 'order',
    capabilityId: 'refund',
    evidenceKind: 'routes',
    name: 'Refund routes',
    summary: 'HTTP routes that enter the refund workflow.',
    source: 'repository',
    generator: 'manual',
    generation_evidence: 'Reviewed route files in current repository.',
    body: 'Route POST /refunds starts refund request handling.',
    generationMethod: 'Manual route inspection.',
    entryPaths: '- src/refund/controller.js',
    routes: '- POST /refunds',
    limitations: '- Test fixture does not execute runtime HTTP calls.',
  }).status, 0);
  assert.equal(run(repoRoot, 'sync').status, 0);

  const global = JSON.parse(readFileSync(join(repoRoot, 'knowledge/index.json'), 'utf8'));
  assert.equal(global.entries[0].path, 'knowledge/contexts/order/CONTEXT.md');
  assert.equal(global.entries[0].readmePath, 'knowledge/contexts/order/README.md');
  assert.equal(global.entries[0].indexPath, 'knowledge/contexts/order/index.json');
  const contextIndex = JSON.parse(readFileSync(join(repoRoot, 'knowledge/contexts/order/index.json'), 'utf8'));
  assert.equal(contextIndex.entries.some((entry) => entry.path === 'knowledge/contexts/order/evidence/refund-routes.md'), true);

  assert.equal(run(repoRoot, 'verify').status, 0);
  const lint = JSON.parse(run(repoRoot, 'lint').stdout);
  assert.deepEqual(lint.issues, []);
  const match = JSON.parse(run(repoRoot, 'match-scope', { query: 'refund route order' }).stdout);
  assert.equal(match.issues.length, 0);
  assert.equal(match.matches.some((entry) => entry.path === 'knowledge/contexts/order/evidence/refund-routes.md'), true);

  const duplicate = run(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Repeated customer refund signals from support requests.',
  });
  assert.equal(duplicate.status, 0);
  const duplicateAgain = JSON.parse(run(repoRoot, 'create-candidate', {
    candidateId: 'refund',
    name: 'Refund',
    summary: 'Refund boundary candidate.',
    body: 'Another refund signal.',
  }).stdout);
  assert.equal(duplicateAgain.duplicates[0].path, 'knowledge/candidates/refund.md');
});
