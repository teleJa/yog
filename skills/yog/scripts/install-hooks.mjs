#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { installHooks } from '../lib/scaffold.mjs';

const output = installHooks(await readStdinJson());
writeJson(output);
process.exit(output.issues.some((issue) => issue.severity === 'P0' || issue.severity === 'P1') ? 1 : 0);
