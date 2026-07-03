#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { writeCandidates } from '../lib/scaffold.mjs';

const result = writeCandidates(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
