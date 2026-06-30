#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { buildIndexes } from '../lib/index.mjs';

const result = buildIndexes(await readStdinJson());
writeJson({ issues: result.issues });
process.exit(result.issues.some((issue) => issue.severity === 'P0' || issue.severity === 'P1') ? 1 : 0);
