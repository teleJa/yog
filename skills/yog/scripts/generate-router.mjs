#!/usr/bin/env node
// Optional multi-repo router extension — NOT part of the core single-repo protocol.
// Reads router-input JSON on stdin, writes a router index.json on stdout.
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { generateRouter } from '../lib/router-gen.mjs';

const result = generateRouter(await readStdinJson());
writeJson(result);
process.exit(result.issues.some((item) => item.severity === 'P0' || item.severity === 'P1') ? 1 : 0);
