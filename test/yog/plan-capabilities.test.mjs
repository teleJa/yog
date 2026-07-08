import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();

function runScript(name, payload) {
  return spawnSync(process.execPath, [join(root, `skills/yog/scripts/${name}.mjs`)], {
    cwd: root,
    input: JSON.stringify({ payload }),
    encoding: 'utf8',
  });
}

test('extract-promote-anchors gathers entry service data and external anchors', () => {
  const result = runScript('extract-promote-anchors', {
    contextId: 'course-live',
    lenses: [
      {
        agent: 'controller-route-agent',
        anchors: [{ entryPaths: ['LiveController#saveConfig'], routes: ['POST /live/config'], operations: ['保存配置'] }],
      },
      {
        agent: 'service-flow-agent',
        anchors: [{ entryPath: 'LiveController#saveConfig', serviceRoots: ['LiveConfigServiceImpl#saveConfig'], externalDependencies: ['TencentLiveService#getUserSig'] }],
      },
      {
        agent: 'data-contract-agent',
        anchors: [{ entryPath: 'LiveController#saveConfig', dataObjects: ['LiveConfigMapper'] }],
      },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.contextId, 'course-live');
  assert.equal(output.anchors.length, 1);
  assert.deepEqual(output.anchors[0].entryPath, ['LiveController#saveConfig']);
  assert.deepEqual(output.anchors[0].serviceRoots, ['LiveConfigServiceImpl#saveConfig']);
  assert.deepEqual(output.anchors[0].dataObjects, ['LiveConfigMapper']);
  assert.deepEqual(output.anchors[0].externalDependencies, ['TencentLiveService#getUserSig']);
  assert.deepEqual(output.anchors[0].sourceLens.sort(), ['controller-route-agent', 'data-contract-agent', 'service-flow-agent']);
});

test('plan-capabilities blocks empty capabilities and unexplained unassigned anchors', () => {
  const empty = runScript('plan-capabilities', { contextId: 'course-live', capabilityCandidates: [] });
  assert.equal(empty.status, 1);
  assert.match(JSON.parse(empty.stdout).issues[0].message, /capabilityCandidates/);

  const unassigned = runScript('plan-capabilities', {
    contextId: 'course-live',
    anchors: [{ entryPath: ['LiveController#saveConfig'], operations: ['保存配置'] }],
    unassignedAnchors: [{ operations: ['回放地址'] }],
  });
  assert.equal(unassigned.status, 1);
  assert.match(JSON.parse(unassigned.stdout).issues.at(-1).message, /unassignedAnchors/);
});

test('plan-capabilities emits quality issues without blocking draft plans', () => {
  const result = runScript('plan-capabilities', {
    contextId: 'course-live',
    anchors: [{ entryPath: ['LiveController#saveConfig'], externalDependencies: ['TencentLiveService#getUserSig'], operations: ['保存配置'] }],
    traceLimitations: [
      {
        anchor: 'LiveController#saveConfig',
        anchorType: 'entryPath',
        reason: 'dynamic-dispatch',
        impact: 'service root cannot be statically resolved',
        manualDecision: 'pending',
      },
    ],
  });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.capabilityCandidates.length, 1);
  assert.equal(output.qualityIssues.some((issue) => issue.code === 'possible-under-split'), true);
  assert.equal(output.qualityIssues.some((issue) => issue.code === 'missing-service-root'), true);
  assert.equal(output.qualityIssues.some((issue) => issue.code === 'trace-pending'), true);
  assert.equal(output.qualityIssues.some((issue) => issue.code === 'missing-data-and-external'), false);
  assert.equal(output.statusDecisions[0].status, 'needs-review');
});
