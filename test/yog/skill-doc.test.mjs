import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const selector = readFileSync('skills/yog/SKILL.md', 'utf8');
const knowledge = readFileSync('skills/knowledge/SKILL.md', 'utf8');
const knowledgeQuery = readFileSync('skills/knowledge-query/SKILL.md', 'utf8');
const wiki = readFileSync('skills/wiki/SKILL.md', 'utf8');
const wikiReview = readFileSync('skills/wiki-review/SKILL.md', 'utf8');
const wikiQuery = readFileSync('skills/wiki-query/SKILL.md', 'utf8');
const codexPlugin = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'));

function filesUnder(root) {
  const output = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) output.push(...filesUnder(path));
    else output.push(path);
  }
  return output;
}

test('plugin exposes exactly five task skills plus the Yog selector', () => {
  assert.deepEqual(
    readdirSync('skills').filter((entry) => existsSync(join('skills', entry, 'SKILL.md'))).sort(),
    ['knowledge', 'knowledge-query', 'wiki', 'wiki-query', 'wiki-review', 'yog'],
  );
  assert.equal(existsSync('.claude-plugin/plugin.json'), false);
  assert.equal(codexPlugin.skills, './skills/');
  assert.ok(codexPlugin.interface.defaultPrompt.length <= 3);
  const prompt = codexPlugin.interface.defaultPrompt.join('\n');
  for (const name of ['yog:knowledge', 'yog:wiki', 'yog:wiki-review', 'yog:knowledge-query', 'yog:wiki-query']) assert.match(prompt, new RegExp(name));
  assert.doesNotMatch(prompt, /yog:init|yog:discover-candidates|yog:sync-verify|yog:business-flow/);
});

test('general Yog skill is a read-only selector without fallback or maintenance implementation', () => {
  assert.match(selector, /name: yog/);
  for (const name of ['yog:knowledge', 'yog:wiki', 'yog:wiki-review', 'yog:knowledge-query', 'yog:wiki-query']) assert.match(selector, new RegExp(name));
  assert.match(selector, /ask at most one question/);
  assert.match(selector, /never reads a knowledge base/);
  assert.doesNotMatch(selector, /promotion|calibration|create-candidate|build-index|automatic fallback/i);
});

test('Knowledge skill owns eight stable actions and four natural-language workflows', () => {
  assert.match(knowledge, /name: knowledge/);
  for (const action of ['init', 'discover-candidates', 'business-flow', 'sync', 'verify', 'audit', 'install-hooks', 'upgrade']) {
    assert.match(knowledge, new RegExp(`\\| ${'`'}${action}${'`'} \\|`));
    assert.equal(existsSync(`skills/knowledge/references/workflows/${action}.md`), true);
  }
  for (const workflow of ['create-update', 'review', 'promote', 'calibrate']) {
    assert.match(knowledge, new RegExp(`references/workflows/${workflow}\\.md`));
    assert.equal(existsSync(`skills/knowledge/references/workflows/${workflow}.md`), true);
  }
  assert.match(knowledge, /does not authorize writes/);
  assert.match(knowledge, /explicit human confirmation/);
});

test('Knowledge Query documents fail-closed routing and CodeGraph authority', () => {
  assert.match(knowledgeQuery, /name: knowledge-query/);
  assert.match(knowledgeQuery, /read-only/);
  assert.match(knowledgeQuery, /not-initialized/);
  assert.match(knowledgeQuery, /not-managed/);
  assert.match(knowledgeQuery, /invalid-knowledge/);
  assert.match(knowledgeQuery, /verified/);
  assert.match(knowledgeQuery, /draft/);
  assert.match(knowledgeQuery, /Do not read or cite `stale`, `needs-review`/);
  assert.match(knowledgeQuery, /coverage_status: covered/);
  assert.match(knowledgeQuery, /revision/);
  assert.match(knowledgeQuery, /dirty paths/);
  assert.match(knowledgeQuery, /Seed queries/);
  assert.match(knowledgeQuery, /whole-repository source\/test scan/);
  assert.match(knowledgeQuery, /confirmed-conflict/);
  assert.match(knowledgeQuery, /possible-stale/);
  assert.match(knowledgeQuery, /insufficient-evidence/);
});

test('Wiki lifecycle and query boundaries remain separate', () => {
  assert.match(wiki, /name: wiki/);
  for (const action of ['generate', 'update', 'sync', 'verify']) assert.match(wiki, new RegExp(`yog:wiki ${action}`));
  assert.match(wiki, /yog:wiki audit/);
  assert.match(wiki, /wiki-audit\.mjs/);
  assert.match(wiki, /must not call a generator/);
  assert.match(wiki, /_meta\/model\.json.*only canonical Wiki model/);
  assert.match(wiki, /only `evidenceIds` as proof links/);
  assert.match(wiki, /never receives a Wiki back-reference/);
  assert.match(wiki, /T16/);
  assert.match(wiki, /T21/);
  assert.match(wiki, /wiki\.sources\[\]/);
  assert.match(wiki, /metadata-only/);
  assert.match(wiki, /_meta\/catalog\/<system-id>\.json/);
  assert.match(wiki, /shared: true/);
  assert.match(wikiQuery, /name: wiki-query/);
  assert.match(wikiQuery, /read-only/);
  assert.match(wikiQuery, /managedBy: yog:wiki/);
  assert.match(wikiQuery, /yog-product-wiki-model/);
  assert.match(wikiQuery, /Never load or quote the complete canonical model/);
  assert.match(wikiQuery, /_meta\/catalog\/<system-id>\.json/);
  assert.match(wikiQuery, /Relationships/);
  assert.match(wikiQuery, /Coverage/);
  assert.match(wikiQuery, /confirmed/);
  assert.match(wikiQuery, /partial/);
  assert.match(wikiQuery, /Do not read, cite, or display `needs-review` Claims, Gap, Conflict/);
  assert.match(wikiQuery, /Never read `docs\/knowledge`, call CodeGraph, scan code/);
  assert.match(wikiQuery, /invalid-wiki/);
  assert.match(wikiQuery, /does not scan additional pages or suggest regeneration/);
  assert.match(wikiQuery, /wikiRunId \+ manifestHash/);
  assert.match(wikiQuery, /Never output a blocked Claim/);
});

test('Wiki Review skill is a thin one-ReviewItem PM workflow with deterministic handoff', () => {
  assert.match(wikiReview, /name: wiki-review/);
  assert.match(wikiReview, /Never read or summarize the complete `_meta\/model\.json`/);
  assert.match(wikiReview, /`_meta\/reviews\.json`/);
  assert.match(wikiReview, /one item per Decision/);
  assert.match(wikiReview, /confirm \| modify \| reject \| defer/);
  assert.match(wikiReview, /draft-wiki-decision\.mjs/);
  assert.match(wikiReview, /confirm-wiki-decision\.mjs/);
  assert.match(wikiReview, /confirmed-pending-apply/);
  assert.match(wikiReview, /Do not copy canonical schemas/);
  assert.doesNotMatch(wikiReview, /function\s+|JSON Patch operation|class\s+/);
});

test('current product surface contains no support artifacts for another agent platform', () => {
  const roots = ['README.md', 'README.zh-CN.md', 'docs/user-agent-prompts.zh-CN.md', 'docs/yog-agent-onboarding-prompt.zh-CN.md', '.codex-plugin/plugin.json'];
  const files = [...roots, ...filesUnder('skills'), ...filesUnder('templates')];
  const current = files.map((path) => readFileSync(path, 'utf8')).join('\n');
  assert.doesNotMatch(current, /Claude Code|CLAUDE\.md|\.claude\/|\.claude-plugin/);
});
