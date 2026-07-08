#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { planCapabilities } from '../lib/scaffold.mjs';

const result = planCapabilities(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
