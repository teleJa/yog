#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { reduceCandidates } from '../lib/scaffold.mjs';

const result = reduceCandidates(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
