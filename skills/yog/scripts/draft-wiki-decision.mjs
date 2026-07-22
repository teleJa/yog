#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { writeDraftDecision } from '../lib/wiki-decision-store.mjs';

try {
  writeJson({ ok: true, ...writeDraftDecision(await readStdinJson()) });
  process.exit(0);
} catch (error) {
  writeJson({ schemaVersion: 1, ok: false, issues: [{ severity: 'P1', code: error.code ?? 'decision-draft-failed', message: error.message, path: error.path ?? '$' }] });
  process.exit(error.code === 'decision-source-not-configured' ? 3 : 2);
}

