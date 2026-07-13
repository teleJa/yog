#!/usr/bin/env node
import { readStdinJson, finishOk, writeJson } from '../lib/json-io.mjs';
import { initKnowledgeBase } from '../lib/scaffold.mjs';

const input = await readStdinJson();
try {
  finishOk(initKnowledgeBase(input));
} catch (error) {
  writeJson({ issues: [{ severity: 'P1', code: error.code ?? 'init-input-invalid', message: error.message, path: '.yog/config.json' }] });
  process.exit(error.code === 'yog-language-invalid' ? 2 : 1);
}
