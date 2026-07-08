import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookAdditionalContext, hookMissingKnowledgeNotice } from '../../skills/yog/lib/routing-guidance.mjs';

const initScript = join(process.cwd(), 'skills/yog/scripts/init.mjs');
const installHooksScript = join(process.cwd(), 'skills/yog/scripts/install-hooks.mjs');

function tempRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-hooks-'));
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

function runInstall(repoRoot, payload = {}) {
  return spawnSync(process.execPath, [installHooksScript], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, payload }),
    encoding: 'utf8',
  });
}

function runHookScript(repoRoot, scriptRelPath, input = '') {
  return spawnSync(process.execPath, [join(repoRoot, scriptRelPath)], {
    cwd: repoRoot,
    input,
    encoding: 'utf8',
  });
}

test('install-hooks generates Claude settings and copies scripts for both platforms', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  const result = runInstall(repoRoot);
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.platforms, ['claude', 'codex']);
  assert.equal(existsSync(join(repoRoot, '.claude/hooks/yog-user-prompt-submit.mjs')), true);
  assert.equal(existsSync(join(repoRoot, '.codex/hooks/yog-user-prompt-submit.mjs')), true);

  const settings = JSON.parse(readFileSync(join(repoRoot, '.claude/settings.json'), 'utf8'));
  const entries = settings.hooks.UserPromptSubmit;
  assert.equal(Array.isArray(entries), true);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hooks[0].type, 'command');
  assert.equal(entries[0].hooks[0].command, 'node .claude/hooks/yog-user-prompt-submit.mjs');
});

test('install-hooks does not write Codex config.toml but returns a manual hint', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  const output = JSON.parse(runInstall(repoRoot).stdout);
  assert.equal(existsSync(join(repoRoot, '.codex/config.toml')), false);
  assert.match(output.codexManualHint, /\[features\]\s*\nhooks = true/);
  assert.match(output.codexManualHint, /UserPromptSubmit = \[\{ command = "node \.codex\/hooks\/yog-user-prompt-submit\.mjs"/);
  assert.equal(output.issues.some((issue) => issue.severity === 'P2' && /enable it manually/.test(issue.message)), true);
});

test('install-hooks is idempotent and does not duplicate the Claude entry', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  runInstall(repoRoot);
  runInstall(repoRoot);
  const settings = JSON.parse(readFileSync(join(repoRoot, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
});

test('install-hooks preserves existing Claude settings content', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  mkdirSync(join(repoRoot, '.claude'), { recursive: true });
  writeFileSync(join(repoRoot, '.claude/settings.json'), JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [] }] } }, null, 2));
  runInstall(repoRoot);
  const settings = JSON.parse(readFileSync(join(repoRoot, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.equal(Array.isArray(settings.hooks.Stop), true);
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
});

test('install-hooks honors platforms payload to install a single platform', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  const output = JSON.parse(runInstall(repoRoot, { platforms: ['claude'] }).stdout);
  assert.deepEqual(output.platforms, ['claude']);
  assert.equal(existsSync(join(repoRoot, '.claude/hooks/yog-user-prompt-submit.mjs')), true);
  assert.equal(existsSync(join(repoRoot, '.codex/hooks/yog-user-prompt-submit.mjs')), false);
});

test('copied hook script emits single-line context when CONTEXT-MAP exists', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  runInstall(repoRoot, { platforms: ['claude'] });
  const result = runHookScript(repoRoot, '.claude/hooks/yog-user-prompt-submit.mjs', JSON.stringify({ prompt: '给退款加审批' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes('\n'), false); // single line: Claude drops multi-line output
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(payload.hookSpecificOutput.additionalContext, hookAdditionalContext('docs/knowledge'));
  assert.match(payload.hookSpecificOutput.additionalContext, /common misjudgments/);
  assert.match(payload.hookSpecificOutput.additionalContext, /non-reuse boundaries/);
  assert.match(payload.hookSpecificOutput.additionalContext, /stop-to-confirm checkpoints/);
});

test('copied hook script emits missing-knowledge notice when CONTEXT-MAP is absent', () => {
  const repoRoot = tempRepo();
  // No init: no docs/knowledge. Provide .yog/config.json only.
  mkdirSync(join(repoRoot, '.yog'), { recursive: true });
  writeFileSync(join(repoRoot, '.yog/config.json'), JSON.stringify({ knowledgeRoot: 'docs/knowledge' }));
  mkdirSync(join(repoRoot, '.claude/hooks'), { recursive: true });
  writeFileSync(
    join(repoRoot, '.claude/hooks/yog-user-prompt-submit.mjs'),
    readFileSync(join(process.cwd(), 'skills/yog/hooks/user-prompt-submit.mjs'), 'utf8'),
  );
  const result = runHookScript(repoRoot, '.claude/hooks/yog-user-prompt-submit.mjs', 'not json at all');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes('\n'), false);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.hookSpecificOutput.additionalContext, hookMissingKnowledgeNotice('docs/knowledge'));
});

test('copied hook script never blocks and tolerates empty stdin', () => {
  const repoRoot = tempRepo();
  runInit(repoRoot);
  runInstall(repoRoot, { platforms: ['claude'] });
  const result = runHookScript(repoRoot, '.claude/hooks/yog-user-prompt-submit.mjs', '');
  assert.equal(result.status, 0);
  assert.notEqual(result.stdout.trim(), '');
});

test('copied hook script honors a custom knowledgeRoot from config', () => {
  const repoRoot = tempRepo();
  spawnSync(process.execPath, [initScript], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, knowledgeRoot: 'knowledge' }),
    encoding: 'utf8',
  });
  runInstall(repoRoot, { platforms: ['claude'] });
  const result = runHookScript(repoRoot, '.claude/hooks/yog-user-prompt-submit.mjs', '{}');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.hookSpecificOutput.additionalContext, hookAdditionalContext('knowledge'));
});
