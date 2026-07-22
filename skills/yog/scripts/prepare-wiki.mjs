#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { buildWikiCollectionPlan, prepareWikiConfig } from '../lib/wiki-source-registry.mjs';

try {
  const input = await readStdinJson();
  const config = prepareWikiConfig(input.config ?? input, { outputRoot: input.outputRoot });
  writeJson({
    schemaVersion: 1,
    result_status: 'confirmation-required',
    config,
    collectionPlan: buildWikiCollectionPlan(config, { outputRoot: input.outputRoot }),
  });
  process.exit(3);
} catch (error) {
  writeJson({
    schemaVersion: 1,
    result_status: 'invalid-config',
    issues: [{ severity: 'P1', code: error.code ?? 'wiki-prepare-failed', message: error.message, path: error.path ?? '$' }],
  });
  process.exit(2);
}
