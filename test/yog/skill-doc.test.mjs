import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = readFileSync('skills/yog/SKILL.md', 'utf8');

test('skill documents creation workflow before scripts', () => {
  assert.match(skill, /Ask for the business scope before creating/);
  assert.match(skill, /create-candidate/);
  assert.match(skill, /create-context/);
  assert.match(skill, /create-capability/);
  assert.match(skill, /create-evidence/);
});

test('skill documents exit codes and candidate confirmation', () => {
  assert.match(skill, /Exit code `3` means user confirmation is required and no write occurred/);
  assert.match(skill, /candidate-duplicates-found/);
  assert.match(skill, /matchedFields/);
});

test('skill documents init and discover-candidates gates', () => {
  assert.match(skill, /`init\.mjs` is the init step/);
  assert.match(skill, /run `install-hooks\.mjs` to enable the optional per-prompt reminder/);
  assert.match(skill, /do not leave it discoverable only through the scripts list/);
  assert.match(skill, /`discover-candidates` is an agent workflow/);
  assert.match(skill, /Serena is available/);
  assert.match(skill, /CodeGraph is initialized/);
  assert.match(skill, /more than 10 candidates/);
  assert.match(skill, /Do not fall back to filename-only or `rg`-only discovery/);
  assert.match(skill, /needs-review/);
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
  assert.match(skill, /one subagent uses Serena/);
  assert.match(skill, /one subagent uses CodeGraph/);
  assert.match(skill, /payload with `capabilities\[\]`/);
  assert.match(skill, /Each capability must include at least one `evidence\[\]` item/);
  assert.match(skill, /docsCount/);
  assert.match(skill, /If `docsCount` is 0, treat the promotion as failed/);
});

test('skill does not expose user-visible commands or MCP server instructions', () => {
  assert.doesNotMatch(skill, /mcpServers/);
  assert.doesNotMatch(skill, /commands\//);
});
