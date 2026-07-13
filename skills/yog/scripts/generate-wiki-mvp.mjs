#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { formatMvpError, generateMvpWiki } from '../lib/wiki-mvp.mjs';

try {
  const input = await readStdinJson();
  writeJson({ schemaVersion: 1, ...generateMvpWiki(input) });
  process.exit(0);
} catch (error) {
  writeJson(formatMvpError(error));
  process.exit(String(error.code ?? '').includes('input') || String(error.code ?? '').includes('invalid') ? 2 : 1);
}
