#!/usr/bin/env node
import { readStdinJson, finishWithIssues } from '../lib/json-io.mjs';
import { buildIndexes } from '../lib/index.mjs';
import { lintKnowledgeBase } from '../lib/lint.mjs';

const input = await readStdinJson();
const buildResult = buildIndexes(input);
finishWithIssues([...buildResult.issues, ...lintKnowledgeBase(input)]);
