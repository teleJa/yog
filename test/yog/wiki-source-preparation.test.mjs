import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WIKI_CONFIG } from '../../skills/yog/lib/config.mjs';

const prepareScript = fileURLToPath(new URL('../../skills/yog/scripts/prepare-wiki.mjs', import.meta.url));
const confirmScript = fileURLToPath(new URL('../../skills/yog/scripts/confirm-wiki-sources.mjs', import.meta.url));
const generateScript = fileURLToPath(new URL('../../skills/yog/scripts/generate-wiki.mjs', import.meta.url));

function run(script, input) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

function config() {
  const value = {
    schemaVersion: 1,
    language: 'zh-CN',
    wiki: structuredClone(DEFAULT_WIKI_CONFIG),
  };
  value.wiki.sources.find((source) => source.kind === 'catalog').scope.rootNodeIds = ['system-example'];
  return value;
}

test('prepare and confirm scripts expose a two-stage Source authorization workflow', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-prepare-`);
  const prepare = run(prepareScript, { outputRoot, config: config() });
  assert.equal(prepare.status, 3);
  const prepared = JSON.parse(prepare.stdout);
  assert.equal(prepared.result_status, 'confirmation-required');
  assert.equal(prepared.collectionPlan.status, 'confirmation-required');

  const decisions = prepared.config.wiki.sources.filter((source) => source.enabled).map((source) => ({
    sourceId: source.id,
    decision: source.required ? 'confirm' : 'disable',
    scopeFingerprint: source.confirmation.scopeFingerprint,
  }));
  const confirm = run(confirmScript, {
    outputRoot,
    config: prepared.config,
    inputFingerprint: prepared.collectionPlan.inputFingerprint,
    confirmedAt: '2026-07-15T08:00:00.000Z',
    decisions,
  });
  assert.equal(confirm.status, 0);
  const confirmed = JSON.parse(confirm.stdout);
  assert.equal(confirmed.result_status, 'ready');
  assert.equal(confirmed.collectionPlan.status, 'ready');
});

test('generate refuses an unconfirmed complete-model request before publication', () => {
  const outputRoot = mkdtempSync(`${tmpdir()}/yog-wiki-prepare-`);
  const prepare = run(prepareScript, { outputRoot, config: config() });
  const prepared = JSON.parse(prepare.stdout);
  const result = run(generateScript, {
    config: prepared.config,
    outputRoot,
    sourceResults: [],
    artifacts: [],
  });
  assert.equal(result.status, 3);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.issues[0].code, 'wiki-source-scope-unconfirmed');
});

test('prepare reports malformed JSON and missing outputRoot as caller input errors', () => {
  const malformed = spawnSync(process.execPath, [prepareScript], { input: '{', encoding: 'utf8' });
  assert.equal(malformed.status, 2);
  assert.equal(JSON.parse(malformed.stdout).issues[0].details.reason, 'parse-error');
  const missingRoot = run(prepareScript, { config: config() });
  assert.equal(missingRoot.status, 2);
  assert.equal(JSON.parse(missingRoot.stdout).result_status, 'invalid-config');
});
