#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { formatWikiError } from '../lib/wiki.mjs';
import { verifyProductWiki } from '../lib/wiki-lifecycle.mjs';

try {
  const input = await readStdinJson();
  const result = verifyProductWiki(input);
  writeJson(result);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  writeJson(formatWikiError(error));
  process.exit(1);
}
