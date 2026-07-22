#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { buildWikiCollectionPlan, confirmWikiConfig } from '../lib/wiki-source-registry.mjs';

try {
  const input = await readStdinJson();
  const config = confirmWikiConfig(input.config, {
    outputRoot: input.outputRoot,
    inputFingerprint: input.inputFingerprint,
    decisions: input.decisions,
    confirmedAt: input.confirmedAt,
  });
  writeJson({
    schemaVersion: 1,
    result_status: 'ready',
    config,
    collectionPlan: buildWikiCollectionPlan(config, { outputRoot: input.outputRoot }),
  });
  process.exit(0);
} catch (error) {
  writeJson({
    schemaVersion: 1,
    result_status: error.code === 'wiki-source-scope-unconfirmed' ? 'confirmation-required' : 'invalid-config',
    issues: [{ severity: 'P1', code: error.code ?? 'wiki-confirmation-failed', message: error.message, path: error.path ?? '$' }],
  });
  process.exit(error.code === 'wiki-source-scope-unconfirmed' ? 3 : 2);
}
