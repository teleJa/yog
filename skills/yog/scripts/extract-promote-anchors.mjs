#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { extractPromoteAnchors } from '../lib/scaffold.mjs';

const result = extractPromoteAnchors(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
