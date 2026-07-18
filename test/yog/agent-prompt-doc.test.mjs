import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const userManual = readFileSync('docs/user-agent-prompts.zh-CN.md', 'utf8');
const onboardingPrompt = readFileSync('docs/yog-agent-onboarding-prompt.zh-CN.md', 'utf8');
const marketplace = JSON.parse(readFileSync('.agents/plugins/marketplace.json', 'utf8'));

test('user manual documents the five task entries and selector', () => {
  assert.match(userManual, /# Yog 用户手册/);
  for (const entry of ['yog:knowledge', 'yog:wiki', 'yog:wiki-review', 'yog:knowledge-query', 'yog:wiki-query', 'yog']) assert.match(userManual, new RegExp(entry));
  assert.match(userManual, /无法判断时固定先查 Wiki、再查 Knowledge/);
  assert.match(userManual, /普通 Query 不写文件/);
  assert.match(userManual, /CodeGraph 为主证据/);
  assert.match(userManual, /fingerprint/);
  assert.match(userManual, /\.codex\/hooks\.json/);
  assert.match(userManual, /\/hooks/);
  assert.doesNotMatch(userManual, /yog:init|yog:discover-candidates|yog:business-flow|yog:sync-verify/);
});

test('onboarding prompt guides Codex-only initialization, query routing, and audits', () => {
  assert.match(onboardingPrompt, /# Yog Codex Agent 引导提示词/);
  for (const entry of ['yog:knowledge', 'yog:wiki', 'yog:wiki-review', 'yog:knowledge-query', 'yog:wiki-query']) assert.match(onboardingPrompt, new RegExp(entry));
  assert.match(onboardingPrompt, /yog:knowledge init/);
  assert.match(onboardingPrompt, /yog:knowledge discover-candidates/);
  assert.match(onboardingPrompt, /\/hooks/);
  assert.match(onboardingPrompt, /partial \+ insufficient-evidence/);
  assert.match(onboardingPrompt, /Query 自身不写文件/);
});

test('GitHub marketplace manifest points at repository root plugin', () => {
  assert.equal(marketplace.name, 'yog');
  assert.equal(marketplace.plugins[0].name, 'yog');
  assert.equal(marketplace.plugins[0].source.source, 'local');
  assert.equal(marketplace.plugins[0].source.path, '.');
});
