#!/usr/bin/env node
import { readStdinJson, finishWithIssues } from '../lib/json-io.mjs';
import { checkIndexes } from '../lib/index.mjs';
import { lintKnowledgeBase } from '../lib/lint.mjs';

const input = await readStdinJson();
finishWithIssues([...checkIndexes(input).issues, ...lintKnowledgeBase(input)]);
