import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const skill = readFileSync('skills/yog/SKILL.md', 'utf8');
const initSkill = readFileSync('skills/init/SKILL.md', 'utf8');
const discoverSkill = readFileSync('skills/discover-candidates/SKILL.md', 'utf8');
const businessFlowSkill = readFileSync('skills/business-flow/SKILL.md', 'utf8');
const syncVerifySkill = readFileSync('skills/sync-verify/SKILL.md', 'utf8');
const wikiSkill = readFileSync('skills/wiki/SKILL.md', 'utf8');
const codexPlugin = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'));
const claudePlugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));

test('skill documents creation workflow before scripts', () => {
  assert.match(skill, /yog:init/);
  assert.match(skill, /yog:discover-candidates/);
  assert.match(skill, /yog:sync-verify/);
  assert.match(skill, /discover candidates/);
  assert.match(skill, /review candidates/);
  assert.match(skill, /promote candidates/);
  assert.match(skill, /business-flow overviews/);
  assert.match(skill, /sync or verify requests/);
  assert.match(skill, /Ask for the business scope before creating/);
  assert.match(skill, /create-candidate/);
  assert.match(skill, /write-candidates/);
  assert.match(skill, /create-context/);
  assert.match(skill, /create-capability/);
  assert.match(skill, /create-evidence/);
  assert.match(skill, /business-flow entries/);
});

test('wiki skill documents the product-oriented MVP workflow contract', () => {
  assert.match(wikiSkill, /name: wiki/);
  assert.match(wikiSkill, /yog:wiki generate/);
  assert.doesNotMatch(wikiSkill, /yog:wiki init|init-wiki\.mjs/);
  assert.match(wikiSkill, /menu description/i);
  assert.match(wikiSkill, /Record Skill/);
  assert.match(wikiSkill, /Wiki output root/);
  assert.match(wikiSkill, /user-provided code paths/);
  assert.match(wikiSkill, /Record, Requirement, and Spec sources are optional/);
  assert.match(wikiSkill, /stop and ask whether to generate only Record-related features or the full supplied menu scope/);
  assert.match(wikiSkill, /inspect its complete product surface/);
  assert.match(wikiSkill, /product-review drafts/);
  assert.match(wikiSkill, /generate-wiki-mvp\.mjs/);
  assert.match(wikiSkill, /产品功能\//);
  assert.match(wikiSkill, /用户场景\//);
  assert.match(wikiSkill, /CodeGraph or an equivalent symbol graph may enrich/);
  assert.match(wikiSkill, /Do not generate pages for unrelated repositories/);
  assert.match(wikiSkill, /managedBy: yog:wiki-mvp/);
  assert.match(wikiSkill, /Requirement Retrieval Gate/);
  assert.match(wikiSkill, /Never search every project visible to the account/);
  assert.match(wikiSkill, /Never infer hierarchy from an ID format/);
  assert.match(wikiSkill, /Only completed product requirements may become current `requirementEvidenceIds`/);
  assert.match(wikiSkill, /type: requirement/);
  assert.match(wikiSkill, /code Evidence IDs/);
  assert.doesNotMatch(wikiSkill, /Reader Agent|Evidence Judge|apply-wiki-refresh\.mjs/);
});

test('both plugin manifests discover the shared wiki skill directory', () => {
  assert.equal(codexPlugin.skills, './skills/');
  assert.equal(claudePlugin.skills, './skills/');
  assert.match(codexPlugin.interface.defaultPrompt.join('\n'), /yog:wiki/);
  assert.match(codexPlugin.interface.defaultPrompt.join('\n'), /focused product Wiki/);
  assert.doesNotMatch(codexPlugin.interface.defaultPrompt.join('\n'), /engineering Repo Wiki|architecture, modules, dependencies/);
  assert.equal(existsSync('skills/wiki/SKILL.md'), true);
});

test('skill documents exit codes and candidate confirmation', () => {
  assert.match(skill, /mid-low-scope-required/);
  assert.match(skill, /Exit code `3` means user confirmation is required and no write occurred/);
  assert.match(skill, /candidate-duplicates-found/);
  assert.match(skill, /matchedFields/);
});

test('skill documents init and discover-candidates gates', () => {
  assert.match(skill, /`init\.mjs` is the init step/);
  assert.match(skill, /templates\/business-flow\.md/);
  assert.match(skill, /run `install-hooks\.mjs` to enable the optional per-prompt reminder/);
  assert.match(skill, /do not leave it discoverable only through the scripts list/);
  assert.match(skill, /`discover-candidates` is an agent workflow/);
  assert.match(skill, /CodeGraph is initialized/);
  assert.match(skill, /discover\.maxMidLowCandidates/);
  assert.match(skill, /medium\+low confidence candidates/);
  assert.match(skill, /gatedCandidates/);
  assert.match(skill, /gatedReportPath/);
  assert.match(skill, /Do not fall back to filename-only or `rg`-only discovery/);
  assert.match(skill, /needs-review/);
  assert.match(skill, /identity_symbols/);
  assert.match(skill, /supporting_symbols/);
  assert.match(skill, /joinConflicts/);
  assert.match(skill, /If the user only asks for init/);
  assert.match(skill, /`install-hooks\.mjs` was not executed/);
  assert.match(skill, /`discover-candidates` was not executed/);
  assert.match(skill, /docs\/knowledge\/templates\/candidate\.md/);
  assert.match(skill, /candidate_count/);
  assert.match(skill, /Candidates should not enter `index\.json` or `INDEX\.md`/);
  assert.match(skill, /candidate_count: 0/);
  assert.match(skill, /only medium\/low candidates exceeded the threshold/);
});

test('skill documents candidate promotion requires real capability and evidence', () => {
  assert.match(skill, /Promoting a candidate to a formal context must not create an empty context shell/);
  assert.match(skill, /spawn focused subagents in parallel/);
  assert.match(skill, /one subagent uses CodeGraph/);
  assert.match(skill, /payload with `capabilities\[\]`/);
  assert.match(skill, /Each capability must include at least one `evidence\[\]` item/);
  assert.match(skill, /docsCount/);
  assert.match(skill, /If `docsCount` is 0, treat the promotion as failed/);
});

test('skill documents subagent timeout discipline', () => {
  assert.match(skill, /Subagent Timeout Discipline/);
  assert.match(skill, /explicit timeout discipline before fan-out begins/);
  assert.match(skill, /10-15 minutes for code discovery lenses/);
  assert.match(skill, /5-10 minutes for semantic recall probes/);
  assert.match(skill, /Do not block the critical path on closing old or completed subagents/);
  assert.match(skill, /Never bulk-close many subagents in parallel/);
  assert.match(skill, /timed_out: true/);
  assert.match(skill, /one bounded inline fallback/);
  assert.match(skill, /Do not spawn a replacement subagent/);
  assert.match(skill, /<agent>-inline-fallback/);
});

test('skill documents post-generation overlap calibration', () => {
  assert.match(skill, /Post-generation Calibration/);
  assert.match(skill, /agent semantic recall check/);
  assert.match(skill, /Overlap is not an error by itself/);
  assert.match(skill, /Only the user can decide/);
  assert.match(skill, /keep separate and add explicit `CONTEXT-MAP\.md` relationship/);
  assert.match(skill, /Apply changes to `CONTEXT-MAP\.md`/);
});

test('skill does not expose user-visible commands or MCP server instructions', () => {
  assert.doesNotMatch(skill, /mcpServers/);
  assert.doesNotMatch(skill, /commands\//);
});

test('init skill documents repository initialization boundary', () => {
  assert.match(initSkill, /name: init/);
  assert.match(initSkill, /does not install or update the Yog plugin/);
  assert.match(initSkill, /Call the Yog internal `init\.mjs` script/);
  assert.match(initSkill, /Run `verify\.mjs` after init/);
  assert.match(initSkill, /discover\.maxMidLowCandidates/);
  assert.match(initSkill, /ask the user whether to run `discover-candidates`/);
  assert.match(initSkill, /Do not run `discover-candidates` during init unless the user confirms/);
});

test('discover-candidates skill documents fanout and write gates', () => {
  assert.match(discoverSkill, /name: discover-candidates/);
  assert.match(discoverSkill, /CodeGraph is initialized/);
  assert.match(discoverSkill, /controller-route-agent/);
  assert.match(discoverSkill, /service-flow-agent/);
  assert.match(discoverSkill, /data-contract-agent/);
  assert.match(discoverSkill, /one bounded inline fallback/);
  assert.match(discoverSkill, /Do not spawn a replacement subagent/);
  assert.match(discoverSkill, /controller-route-agent` fallback scans only controllers/);
  assert.match(discoverSkill, /<agent>-inline-fallback/);
  assert.match(discoverSkill, /fallback_for/);
  assert.match(discoverSkill, /reduce-candidates\.mjs/);
  assert.match(discoverSkill, /write-candidates\.mjs/);
  assert.match(discoverSkill, /mid-low-scope-required/);
  assert.match(discoverSkill, /thresholdSource/);
  assert.match(discoverSkill, /gatedReportPath/);
  assert.match(discoverSkill, /Do not promote candidates/);
});

test('sync-verify skill documents index and lint boundary', () => {
  assert.match(syncVerifySkill, /name: sync-verify/);
  assert.match(syncVerifySkill, /sync/);
  assert.match(syncVerifySkill, /verify/);
  assert.match(syncVerifySkill, /build-index/);
  assert.match(syncVerifySkill, /check-index/);
  assert.match(syncVerifySkill, /lint/);
  assert.match(syncVerifySkill, /Do not discover candidates/);
});

test('business-flow skill documents overview creation boundary', () => {
  assert.match(businessFlowSkill, /name: business-flow/);
  assert.match(businessFlowSkill, /business-flows\/\*\.md/);
  assert.match(businessFlowSkill, /index\.json/);
  assert.match(businessFlowSkill, /INDEX\.md/);
  assert.match(businessFlowSkill, /CONTEXT-MAP\.md/);
  assert.match(businessFlowSkill, /contexts, capabilities, evidence, ADRs/);
  assert.match(businessFlowSkill, /Do not discover candidates/);
  assert.match(businessFlowSkill, /promote candidates/);
  assert.match(businessFlowSkill, /change context boundaries/);
  assert.match(businessFlowSkill, /sync\.mjs/);
  assert.match(businessFlowSkill, /verify\.mjs/);
});
