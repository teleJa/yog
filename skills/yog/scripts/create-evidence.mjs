#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { createEvidence } from '../lib/scaffold.mjs';

const result = createEvidence(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
