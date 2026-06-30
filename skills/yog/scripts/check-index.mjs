#!/usr/bin/env node
import { readStdinJson, finishWithIssues } from '../lib/json-io.mjs';
import { checkIndexes } from '../lib/index.mjs';

finishWithIssues(checkIndexes(await readStdinJson()).issues);
