#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { createCandidate } from '../lib/scaffold.mjs';

const result = createCandidate(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
