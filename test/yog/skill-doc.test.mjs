import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = readFileSync('skills/yog/SKILL.md', 'utf8');

test('skill documents creation workflow before scripts', () => {
  assert.match(skill, /discover candidates/);
  assert.match(skill, /review candidates/);
  assert.match(skill, /promote candidates/);
  assert.match(skill, /create business-flow overviews/);
  assert.match(skill, /sync indexes/);
  assert.match(skill, /Ask for the business scope before creating/);
  assert.match(skill, /create-candidate/);
  assert.match(skill, /write-candidates/);
  assert.match(skill, /create-context/);
  assert.match(skill, /create-capability/);
  assert.match(skill, /create-evidence/);
  assert.match(skill, /business-flow entries/);
});

test('skill documents exit codes and candidate confirmation', () => {
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
  assert.match(skill, /more than 10 candidates/);
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
