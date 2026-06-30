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

test('skill does not expose user-visible commands or MCP server instructions', () => {
  assert.doesNotMatch(skill, /mcpServers/);
  assert.doesNotMatch(skill, /commands\//);
});
