import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const initScript = join(process.cwd(), 'skills/yog/scripts/init.mjs');
const upgradeGuidanceScript = join(process.cwd(), 'skills/yog/scripts/upgrade-guidance.mjs');
const deprecatedToolKey = String.fromCharCode(115, 101, 114, 101, 110, 97);
const unsupportedGuidanceFile = ['CL', 'AUDE.md'].join('');

function tempRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-init-'));
  mkdirSync(join(repoRoot, '.git'));
  return repoRoot;
}

function runInit(repoRoot, payload = {}) {
  return spawnSync(process.execPath, [initScript], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, payload }),
    encoding: 'utf8',
  });
}

function runUpgradeGuidance(repoRoot, payload = {}) {
  return spawnSync(process.execPath, [upgradeGuidanceScript], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, payload }),
    encoding: 'utf8',
  });
}

test('init creates docs/knowledge skeleton config and Codex managed block', () => {
  const repoRoot = tempRepo();
  const result = runInit(repoRoot);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.issues, []);
  assert.equal(output.nextSteps[0].action, 'install-hooks');
  assert.equal(output.nextSteps[0].status, 'optional-recommended');
  assert.match(output.nextSteps[0].message, /CONTEXT-MAP\.md/);
  assert.equal(output.nextSteps[1].action, 'discover-candidates');
  assert.equal(output.nextSteps[1].status, 'gated');
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/README.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/BUILD-PLAN.md')), false);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/business-flows/README.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/templates/business-flow.md')), true);
  assert.equal(existsSync(join(repoRoot, 'docs/knowledge/templates/evidence.md')), true);
  assert.equal(existsSync(join(repoRoot, '.yog/config.json')), true);
  const config = JSON.parse(readFileSync(join(repoRoot, '.yog/config.json'), 'utf8'));
  assert.equal(config.language, 'zh-CN');
  assert.deepEqual(config.discover, { maxMidLowCandidates: 10 });
  const agents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8');
  const blockPattern = /<!-- YOG MANAGED BLOCK START -->[\s\S]*<!-- YOG MANAGED BLOCK END -->/;
  assert.match(agents, blockPattern);
  assert.equal(existsSync(join(repoRoot, unsupportedGuidanceFile)), false);
  assert.match(agents, /ask Yog to run install-hooks/);
  assert.match(agents, /Run automatic discover-candidates only when CodeGraph is initialized/);
  assert.match(agents, /Explicit Yog skill invocation is authoritative/);
  assert.match(agents, /Wiki first and Knowledge second/);
  assert.match(agents, /never by user role/);
  assert.match(agents, /bounded CodeGraph seeds/);
  const knowledgeReadme = readFileSync(join(repoRoot, 'docs/knowledge/README.md'), 'utf8');
  const knowledgeAgents = readFileSync(join(repoRoot, 'docs/knowledge/AGENTS.md'), 'utf8');
  assert.match(knowledgeReadme, /Automatic candidate discovery/);
  assert.match(knowledgeReadme, /business-flows\/\*\.md/);
  assert.match(knowledgeReadme, /CodeGraph initialized/);
  assert.match(knowledgeReadme, /discover\.maxMidLowCandidates/);
  assert.match(knowledgeReadme, /candidates\/_gated\/gated-candidates\.md/);
  assert.match(knowledgeReadme, /Minimum migration package/);
  assert.doesNotMatch(knowledgeReadme, /docs\/knowledge\/BUILD-PLAN\.md/);
  assert.match(knowledgeAgents, /Yog plugin skill as the complete specification/);
  assert.match(knowledgeAgents, /business-flows\/\*\.md/);
  assert.match(knowledgeAgents, /ask Yog to run `install-hooks`/);
  assert.match(knowledgeAgents, /Automatic `discover-candidates` requires CodeGraph/);
  assert.match(knowledgeAgents, /Do not fall back to filename-only or `rg`-only discovery/);
  assert.doesNotMatch(knowledgeAgents, /Script success and blocking state/);
});

test('init can record selected tool configuration without requiring tools for init', () => {
  const repoRoot = tempRepo();
  const result = runInit(repoRoot, {
    codeFactProvider: { type: 'none', status: 'not-configured' },
  });
  assert.equal(result.status, 0);
  const config = JSON.parse(readFileSync(join(repoRoot, '.yog/config.json'), 'utf8'));
  assert.equal(deprecatedToolKey in config, false);
  assert.deepEqual(config.codeFactProvider, { type: 'none', status: 'not-configured' });
  assert.deepEqual(config.discover, { maxMidLowCandidates: 10 });
});

test('init rejects non-MVP languages without rewriting config', () => {
  const repoRoot = tempRepo();
  const result = runInit(repoRoot, { language: 'en-US' });
  assert.equal(result.status, 2);
  assert.equal(existsSync(join(repoRoot, '.yog/config.json')), false);
});

test('init defaults to Yog code fact tools when configuration is omitted', () => {
  const repoRoot = tempRepo();
  const result = runInit(repoRoot);
  assert.equal(result.status, 0);
  const config = JSON.parse(readFileSync(join(repoRoot, '.yog/config.json'), 'utf8'));
  assert.equal(deprecatedToolKey in config, false);
  assert.deepEqual(config.codeFactProvider, { type: 'codegraph', status: 'configured' });
  assert.deepEqual(config.discover, { maxMidLowCandidates: 10 });
});

test('init replaces only the AGENTS managed block and preserves existing file content', () => {
  const repoRoot = tempRepo();
  writeFileSync(join(repoRoot, 'AGENTS.md'), 'team agent rules\n');
  const result = runInit(repoRoot);
  assert.equal(result.status, 0);
  assert.match(readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8'), /team agent rules/);
});

test('init is idempotent and does not overwrite existing template file', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  writeFileSync(join(repoRoot, 'docs/knowledge/templates/evidence.md'), 'team edited evidence template\n');
  const result = runInit(repoRoot);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.issues.some((issue) => issue.severity === 'P2'), true);
  assert.equal(readFileSync(join(repoRoot, 'docs/knowledge/templates/evidence.md'), 'utf8'), 'team edited evidence template\n');
});

test('init preserves existing discover config and fills defaults', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  const configPath = join(repoRoot, '.yog/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.discover = { maxMidLowCandidates: 25, customFutureFlag: true };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const result = runInit(repoRoot);
  assert.equal(result.status, 0);
  const updated = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(updated.discover.maxMidLowCandidates, 25);
  assert.equal(updated.discover.customFutureFlag, true);
});

test('upgrade-guidance reports and applies README and AGENTS template updates', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  writeFileSync(join(repoRoot, 'docs/knowledge/AGENTS.md'), '# Old Agent Guidance\n');
  writeFileSync(join(repoRoot, 'docs/knowledge/README.md'), '# Old Knowledge README\n');

  const dryRun = runUpgradeGuidance(repoRoot);
  assert.equal(dryRun.status, 0);
  const dryRunOutput = JSON.parse(dryRun.stdout);
  assert.equal(dryRunOutput.applied, false);
  assert.deepEqual(dryRunOutput.changed.sort(), ['docs/knowledge/AGENTS.md', 'docs/knowledge/README.md']);
  assert.deepEqual(dryRunOutput.unchanged.sort(), ['AGENTS.md']);
  assert.equal(dryRunOutput.issues.every((issue) => issue.severity === 'P2'), true);
  assert.equal(readFileSync(join(repoRoot, 'docs/knowledge/AGENTS.md'), 'utf8'), '# Old Agent Guidance\n');
  assert.equal(readFileSync(join(repoRoot, 'docs/knowledge/README.md'), 'utf8'), '# Old Knowledge README\n');

  const apply = runUpgradeGuidance(repoRoot, { apply: true });
  assert.equal(apply.status, 0);
  const applyOutput = JSON.parse(apply.stdout);
  assert.equal(applyOutput.applied, true);
  assert.deepEqual(applyOutput.changed.sort(), ['docs/knowledge/AGENTS.md', 'docs/knowledge/README.md']);
  assert.match(readFileSync(join(repoRoot, 'docs/knowledge/AGENTS.md'), 'utf8'), /Yog plugin skill as the complete specification/);
  assert.match(readFileSync(join(repoRoot, 'docs/knowledge/README.md'), 'utf8'), /Automatic candidate discovery/);

  const clean = runUpgradeGuidance(repoRoot);
  assert.equal(clean.status, 0);
  const cleanOutput = JSON.parse(clean.stdout);
  assert.deepEqual(cleanOutput.issues, []);
  assert.deepEqual(cleanOutput.changed, []);
  assert.deepEqual(cleanOutput.unchanged.sort(), ['AGENTS.md', 'docs/knowledge/AGENTS.md', 'docs/knowledge/README.md']);
});

test('upgrade-guidance refreshes a stale root managed block and preserves surrounding content', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  const staleBlock = [
    '# Team Root Guidance',
    '',
    '<!-- YOG MANAGED BLOCK START -->',
    'Yog knowledge routing rules:',
    '- Before answering business, architecture, feature, or implementation questions, read docs/knowledge/index.json when it exists.',
    '<!-- YOG MANAGED BLOCK END -->',
    '',
    '# Team footer notes',
    '',
  ].join('\n');
  writeFileSync(join(repoRoot, 'AGENTS.md'), staleBlock);

  const dryRun = JSON.parse(runUpgradeGuidance(repoRoot).stdout);
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.changed.includes('AGENTS.md'), true);
  assert.match(readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8'), /read docs\/knowledge\/index\.json/);

  const apply = JSON.parse(runUpgradeGuidance(repoRoot, { apply: true }).stdout);
  assert.equal(apply.applied, true);
  assert.equal(apply.changed.includes('AGENTS.md'), true);
  const upgraded = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8');
  assert.match(upgraded, /Explicit Yog skill invocation is authoritative/);
  assert.match(upgraded, /yog:wiki-query reads docs\/wiki/);
  assert.match(upgraded, /Wiki first and Knowledge second/);
  assert.match(upgraded, /bounded CodeGraph seeds/);
  assert.match(upgraded, /ask Yog to run install-hooks/);
  assert.match(upgraded, /After a change lands, re-check the evidence documents/);
  assert.doesNotMatch(upgraded, /Before answering business, architecture, feature, or implementation questions/);
  assert.match(upgraded, /# Team Root Guidance/);
  assert.match(upgraded, /# Team footer notes/);
});
