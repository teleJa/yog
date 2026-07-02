#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { promoteCandidate } from '../lib/scaffold.mjs';

const result = promoteCandidate(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
