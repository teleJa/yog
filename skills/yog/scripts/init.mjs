#!/usr/bin/env node
import { readStdinJson, finishOk } from '../lib/json-io.mjs';
import { initKnowledgeBase } from '../lib/scaffold.mjs';

const input = await readStdinJson();
finishOk(initKnowledgeBase(input));
