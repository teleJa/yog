import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookAdditionalContext, hookMissingKnowledgeNotice } from '../../skills/yog/lib/routing-guidance.mjs';

const initScript = join(process.cwd(), 'skills/yog/scripts/init.mjs');
const installHooksScript = join(process.cwd(), 'skills/yog/scripts/install-hooks.mjs');
const upgradeScript = join(process.cwd(), 'skills/yog/scripts/upgrade-guidance.mjs');
const hookRelPath = '.codex/hooks/yog-user-prompt-submit.mjs';

function tempRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), 'yog-hooks-'));
  mkdirSync(join(repoRoot, '.git'));
  return repoRoot;
}

function run(script, repoRoot, payload = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    input: JSON.stringify({ repoRoot, payload }),
    encoding: 'utf8',
  });
}

function runHook(repoRoot, input = '') {
  return spawnSync(process.execPath, [join(repoRoot, hookRelPath)], { cwd: repoRoot, input, encoding: 'utf8' });
}

function yogHandlers(document) {
  return (document.hooks?.UserPromptSubmit ?? [])
    .flatMap((group) => group.hooks ?? [])
    .filter((handler) => handler.command?.includes(hookRelPath));
}

test('install-hooks writes Codex project hook configuration and preserves unrelated hooks', () => {
  const repoRoot = tempRepo();
  run(initScript, repoRoot);
  mkdirSync(join(repoRoot, '.codex'), { recursive: true });
  writeFileSync(join(repoRoot, '.codex/hooks.json'), `${JSON.stringify({
    custom: { keep: true },
    hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'node keep.mjs' }] }] },
  }, null, 2)}\n`);

  const result = run(installHooksScript, repoRoot);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.platforms, ['codex']);
  assert.equal(output.reviewRequired, true);
  assert.match(output.reviewInstruction, /\/hooks/);
  assert.equal(existsSync(join(repoRoot, hookRelPath)), true);
  assert.equal(existsSync(join(repoRoot, '.codex/config.toml')), false);
  const hooks = JSON.parse(readFileSync(join(repoRoot, '.codex/hooks.json'), 'utf8'));
  assert.deepEqual(hooks.custom, { keep: true });
  assert.equal(hooks.hooks.Stop[0].hooks[0].command, 'node keep.mjs');
  assert.equal(yogHandlers(hooks).length, 1);
  assert.equal(yogHandlers(hooks)[0].type, 'command');
  assert.equal(yogHandlers(hooks)[0].timeout, 10);
  assert.match(yogHandlers(hooks)[0].command, /git rev-parse --show-toplevel/);
});

test('install-hooks is idempotent and only definition changes require review', () => {
  const repoRoot = tempRepo();
  run(initScript, repoRoot);
  const first = JSON.parse(run(installHooksScript, repoRoot).stdout);
  const firstConfig = readFileSync(join(repoRoot, '.codex/hooks.json'), 'utf8');
  const second = JSON.parse(run(installHooksScript, repoRoot).stdout);
  assert.equal(first.reviewRequired, true);
  assert.equal(second.reviewRequired, false);
  assert.deepEqual(second.changed, []);
  assert.deepEqual(second.unchanged.sort(), ['.codex/hooks.json', hookRelPath].sort());
  assert.equal(readFileSync(join(repoRoot, '.codex/hooks.json'), 'utf8'), firstConfig);
  assert.equal(yogHandlers(JSON.parse(firstConfig)).length, 1);
});

test('invalid hooks.json fails closed without copying or changing managed artifacts', () => {
  const repoRoot = tempRepo();
  run(initScript, repoRoot);
  mkdirSync(join(repoRoot, '.codex'), { recursive: true });
  writeFileSync(join(repoRoot, '.codex/hooks.json'), '{ invalid');
  const result = run(installHooksScript, repoRoot);
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.issues[0].severity, 'P1');
  assert.equal(output.reviewRequired, false);
  assert.equal(readFileSync(join(repoRoot, '.codex/hooks.json'), 'utf8'), '{ invalid');
  assert.equal(existsSync(join(repoRoot, hookRelPath)), false);
});

test('non-Codex platform request is rejected without compatibility behavior', () => {
  const repoRoot = tempRepo();
  run(initScript, repoRoot);
  const result = run(installHooksScript, repoRoot, { platforms: ['other'] });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout).platforms, []);
  assert.equal(existsSync(join(repoRoot, hookRelPath)), false);
});

test('copied hook emits bounded single-line routing guidance', () => {
  const repoRoot = tempRepo();
  run(initScript, repoRoot);
  run(installHooksScript, repoRoot);
  const result = runHook(repoRoot, JSON.stringify({ prompt: '修复退款接口' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes('\n'), false);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.equal(context, hookAdditionalContext('docs/knowledge'));
  assert.ok(context.length <= 900);
  assert.match(context, /Explicit Yog skill/);
  assert.match(context, /wiki-query/);
  assert.match(context, /knowledge-query/);
  assert.match(context, /Wiki first and Knowledge second/);
  assert.match(context, /never by user role/);
});

test('copied hook emits bounded missing-Knowledge notice without blocking Wiki', () => {
  const repoRoot = tempRepo();
  mkdirSync(join(repoRoot, '.yog'), { recursive: true });
  writeFileSync(join(repoRoot, '.yog/config.json'), JSON.stringify({ knowledgeRoot: 'docs/knowledge' }));
  run(installHooksScript, repoRoot);
  const result = runHook(repoRoot, 'not json');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.includes('\n'), false);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.equal(context, hookMissingKnowledgeNotice('docs/knowledge'));
  assert.ok(context.length <= 900);
  assert.match(context, /never blocks yog:wiki-query/);
});

test('copied hook honors custom knowledgeRoot and tolerates empty stdin', () => {
  const repoRoot = tempRepo();
  run(initScript, repoRoot, { language: 'zh-CN' });
  const configPath = join(repoRoot, '.yog/config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.knowledgeRoot = 'knowledge';
  writeFileSync(configPath, JSON.stringify(config));
  mkdirSync(join(repoRoot, 'knowledge'), { recursive: true });
  writeFileSync(join(repoRoot, 'knowledge/CONTEXT-MAP.md'), '# map\n');
  run(installHooksScript, repoRoot);
  const result = runHook(repoRoot, '');
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, hookAdditionalContext('knowledge'));
});

test('upgrade refreshes an installed hook but does not install a missing hook', () => {
  const withoutHook = tempRepo();
  run(initScript, withoutHook);
  const noHookUpgrade = JSON.parse(run(upgradeScript, withoutHook, { apply: true }).stdout);
  assert.equal(noHookUpgrade.hookUpgrade, null);
  assert.equal(existsSync(join(withoutHook, hookRelPath)), false);

  const withHook = tempRepo();
  run(initScript, withHook);
  run(installHooksScript, withHook);
  writeFileSync(join(withHook, hookRelPath), '// stale\n');
  const upgraded = JSON.parse(run(upgradeScript, withHook, { apply: true }).stdout);
  assert.equal(upgraded.hookUpgrade.scriptChanged, true);
  assert.equal(upgraded.hookUpgrade.reviewRequired, false);
  assert.match(readFileSync(join(withHook, hookRelPath), 'utf8'), /Explicit Yog skill invocation is authoritative/);
});
