#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { stageWikiGenerationInput } from '../lib/wiki-input-orchestrator.mjs';

try {
  writeJson(stageWikiGenerationInput(await readStdinJson()));
  process.exit(0);
} catch (error) {
  writeJson({
    schemaVersion: 1,
    ok: false,
    issues: [{ severity: 'P1', code: error.code ?? 'wiki-input-staging-failed', message: error.message, path: error.path ?? '$' }],
  });
  process.exit(error.code === 'wiki-source-scope-unconfirmed' ? 3 : 2);
}
