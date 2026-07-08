import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const userManual = readFileSync('docs/user-agent-prompts.zh-CN.md', 'utf8');
const onboardingPrompt = readFileSync('docs/yog-agent-onboarding-prompt.zh-CN.md', 'utf8');
const marketplace = JSON.parse(readFileSync('.agents/plugins/marketplace.json', 'utf8'));

test('user manual documents plugin installation and update workflow', () => {
  assert.match(userManual, /# Yog 用户手册/);
  assert.match(userManual, /## 安装或更新 Yog 插件/);
  assert.match(userManual, /Codex/);
  assert.match(userManual, /Claude Code/);
  assert.match(userManual, /Node\.js 版本不低于 20/);
  assert.match(userManual, /codex plugin list/);
  assert.match(userManual, /当前会话是否已加载 `yog` skill/);
  assert.match(userManual, /不要把 Yog 内部 Node 脚本当作插件安装入口/);
  assert.match(userManual, /已暴露的 Yog skill/);
  assert.match(userManual, /`yog:init`/);
  assert.match(userManual, /`yog:discover-candidates`/);
  assert.match(userManual, /`yog:business-flow`/);
  assert.match(userManual, /`yog:sync-verify`/);
  assert.match(userManual, /不要在用户手册里手动复刻 `yog:discover-candidates` 的内部脚本顺序/);
  assert.doesNotMatch(userManual, /本地 marketplace wrapper/);
  assert.doesNotMatch(userManual, /确认 Yog 仓库已克隆/);
  assert.doesNotMatch(userManual, /将 3 个 subagent 输出交给 `reduce-candidates\.mjs`/);
  assert.doesNotMatch(userManual, /再用 `write-candidates\.mjs` 写入/);
});

test('onboarding prompt guides install init and discover confirmation only', () => {
  assert.match(onboardingPrompt, /# Yog Agent 引导提示词/);
  assert.match(onboardingPrompt, /GitHub 插件市场/);
  assert.match(onboardingPrompt, /https:\/\/github\.com\/teleJa\/yog\.git/);
  assert.match(onboardingPrompt, /codex plugin marketplace add https:\/\/github\.com\/teleJa\/yog\.git/);
  assert.match(onboardingPrompt, /codex plugin marketplace upgrade yog/);
  assert.match(onboardingPrompt, /codex plugin add yog@yog/);
  assert.match(onboardingPrompt, /plugins\[0\]\.source\.path/);
  assert.match(onboardingPrompt, /指向仓库根 `\.`/);
  assert.doesNotMatch(onboardingPrompt, /继续确认我要使用的 agent surface/);
  assert.doesNotMatch(onboardingPrompt, /本地 marketplace wrapper/);
  assert.doesNotMatch(onboardingPrompt, /\bclone\b/);
  assert.doesNotMatch(onboardingPrompt, /\bremote\b/);
  assert.match(onboardingPrompt, /1\. 完成 Yog 插件的安装或更新/);
  assert.match(onboardingPrompt, /2\. 完成当前仓库的 Yog 初始化/);
  assert.match(onboardingPrompt, /3\. 初始化完成后，交互式询问我是否执行 `discover-candidates`/);
  assert.match(onboardingPrompt, /请只围绕以下 3 个任务推进/);
  assert.match(onboardingPrompt, /不要扩展到候选提升、business-flow 创建、召回测试或 overlap 校准/);
  assert.match(onboardingPrompt, /直接调用已暴露的 Yog skill/);
  assert.match(onboardingPrompt, /`yog:init`/);
  assert.match(onboardingPrompt, /`yog:discover-candidates`/);
  assert.match(onboardingPrompt, /`yog:business-flow`/);
  assert.match(onboardingPrompt, /`yog:sync-verify`/);
  assert.match(onboardingPrompt, /停下来询问我是否现在调用 `yog:discover-candidates`/);
  assert.match(onboardingPrompt, /不要在本引导文档里手动复刻 `yog:discover-candidates` 的内部脚本顺序/);
  assert.match(onboardingPrompt, /后续可直接调用的 Yog 入口/);
  assert.doesNotMatch(onboardingPrompt, /主 agent 收集结果后走 `reduce-candidates\.mjs`/);
});

test('GitHub marketplace manifest points at repository root plugin', () => {
  assert.equal(marketplace.name, 'yog');
  assert.equal(marketplace.plugins[0].name, 'yog');
  assert.equal(marketplace.plugins[0].source.source, 'local');
  assert.equal(marketplace.plugins[0].source.path, '.');
});
