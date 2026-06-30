#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { matchScope } from '../lib/router.mjs';

const result = matchScope(await readStdinJson());
writeJson(result);
process.exit(result.issues.some((issue) => issue.severity === 'P0' || issue.severity === 'P1') ? 1 : 0);
