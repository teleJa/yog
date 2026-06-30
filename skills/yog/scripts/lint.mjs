#!/usr/bin/env node
import { readStdinJson, finishWithIssues } from '../lib/json-io.mjs';
import { lintKnowledgeBase } from '../lib/lint.mjs';

finishWithIssues(lintKnowledgeBase(await readStdinJson()));
