#!/usr/bin/env node
import { readStdinJson, writeJson } from '../lib/json-io.mjs';
import { createContext } from '../lib/scaffold.mjs';

const result = createContext(await readStdinJson());
writeJson(result.output);
process.exit(result.code);
