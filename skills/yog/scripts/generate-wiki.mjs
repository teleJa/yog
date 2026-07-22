#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { formatWikiError, generateProductWiki } from '../lib/wiki.mjs';
import { stageWikiGenerationInput } from '../lib/wiki-input-orchestrator.mjs';
import { composeWikiModelInput } from '../lib/wiki-model-composer.mjs';

try {
  const input = composeWikiModelInput(stageWikiGenerationInput(await readStdinJson()));
  writeJson({ schemaVersion: 1, ...generateProductWiki(input) });
  process.exit(0);
} catch (error) {
  writeJson(formatWikiError(error));
  process.exit(error.code === 'wiki-source-scope-unconfirmed' ? 3 : String(error.code ?? '').startsWith('wiki-semantic')
    || String(error.code ?? '').startsWith('wiki-gap')
    || String(error.code ?? '').startsWith('decision-')
    || String(error.code ?? '').startsWith('wiki-public')
    || String(error.code ?? '').includes('input')
    || String(error.code ?? '').includes('invalid')
    || String(error.code ?? '').includes('config') ? 2 : 1);
}
