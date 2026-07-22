#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { formatWikiError } from '../lib/wiki.mjs';
import { syncProductWiki } from '../lib/wiki-lifecycle.mjs';

try {
  const input = await readStdinJson();
  writeJson({ schemaVersion: 1, ...syncProductWiki(input) });
  process.exit(0);
} catch (error) {
  writeJson(formatWikiError(error));
  process.exit(1);
}
