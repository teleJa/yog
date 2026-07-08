#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { deepPromoteCandidate } from '../lib/scaffold.mjs';

const result = deepPromoteCandidate(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
