#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { createCapability } from '../lib/scaffold.mjs';

const result = createCapability(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
