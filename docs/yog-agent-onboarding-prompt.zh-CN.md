# Yog Agent 引导提示词

你现在要引导我完成当前仓库的 Yog 启用流程。请只围绕以下 3 个任务推进，不要扩展到候选提升、business-flow 创建、召回测试或 overlap 校准，除非我后续明确要求。

## 目标

1. 完成 Yog 插件的安装或更新。
2. 完成当前仓库的 Yog 初始化。
3. 初始化完成后，交互式询问我是否执行 `discover-candidates`。

## 执行规则

- Yog 默认从 GitHub 插件市场安装或更新；插件来源是 `https://github.com/teleJa/yog.git`。
- Yog 的正常入口是 agent skill。插件安装完成并加载后，不要自行复述或重建 Yog 内部流程，优先直接调用已暴露的 Yog skill：
  - 初始化当前仓库：`yog:init`
  - 发现候选 context：`yog:discover-candidates`
  - 创建或更新 business-flow：`yog:business-flow`
  - 同步 / 验证 / build-index / check-index / lint：`yog:sync-verify`
  - review / promote / overlap / recall 等尚未拆分独立入口的任务：使用通用 `yog` skill
- 不要把 Yog 内部 Node 脚本当成用户需要手动执行的安装入口。
- 不要要求我记忆内部脚本命令。
- 不要虚构已执行命令、退出码、插件列表、初始化结果或验证结论。
- 如果需要我重启 Codex / Claude Code 或开启新会话才能加载 `yog` skill，请明确说明，并在本轮停止到可验证状态。

## 1. 安装或更新 Yog 插件

请先判断当前会话是否已经加载 `yog` skill。

- 如果已经加载，报告 Yog skill 已可用，不要重复安装。
- 如果未加载且当前是 Codex 会话，直接执行 Codex 安装或更新命令，不要先询问我要使用哪个 agent surface。
- 只有当前 agent surface 无法判断，或我明确要求同时配置 Claude Code 时，才询问我要安装 Codex、Claude Code，还是两者。
- 检查 Node.js 版本是否不低于 20。

Codex 场景：

- 直接执行 GitHub 插件市场安装或更新命令：
  - `codex plugin marketplace add https://github.com/teleJa/yog.git`
  - `codex plugin marketplace upgrade yog`
  - `codex plugin add yog@yog`
- 安装或更新后，用 `codex plugin list` 验证 Yog 是否在插件列表中。
- 如果插件列表可见但当前会话仍未加载 `yog` skill，告诉我需要重启 Codex 或开启新会话。
- 如果 `codex plugin add yog@yog` 失败，并报告 marketplace manifest 指向 `plugins/yog` 或类似不存在的路径，立即停止，不要继续初始化。明确告诉我：GitHub marketplace 当前快照仍是旧 manifest，Yog 仓库需要先发布或推送 `.agents/plugins/marketplace.json` 修复，使 `plugins[0].source.path` 指向仓库根 `.`，然后重新执行 `codex plugin marketplace upgrade yog` 和 `codex plugin add yog@yog`。

Claude Code 场景：

- 从 GitHub 插件市场安装或更新 Yog 插件，插件来源为 `https://github.com/teleJa/yog.git`。
- 安装或更新后，验证 Claude Code 的插件列表或当前会话能力中能看到 `yog` skill。
- 如果安装后当前会话仍未加载 `yog` skill，告诉我需要重启 Claude Code 或开启新会话。

完成后报告：

- 安装或更新的是 Codex、Claude Code，还是两者。
- Yog 插件来源。
- 是否验证了插件列表或当前会话能力。
- 当前会话是否已加载 `yog` skill。
- 是否需要我重启或开启新会话。

## 2. 调用 `yog:init` 初始化当前仓库

当 `yog` skill 已可用后，请直接调用 `yog:init` 初始化当前仓库。

要求：

- 先确认当前仓库路径，并把它作为 `repoRoot`。
- `knowledgeRoot` 使用 `docs/knowledge`。
- 按 `yog:init` skill 执行初始化、校验和报告；不要在本文档中重新实现内部脚本调用流程。
- 不覆盖已有 `docs/knowledge/**` 文件；如 `yog:init` 报告已有文件被跳过，作为 P2 提示报告。
- 初始化后按 `yog:init` 的输出检查 `.yog/config.json`，确认 `knowledgeRoot`、`codeFactProvider` 字段合理。
- 初始化后按 `yog:init` 要求运行验证；如果当前刚初始化导致索引为空或只有 P2 提示，请如实报告。

完成后报告：

- 创建、更新或跳过的文件。
- `.yog/config.json` 的关键字段。
- `verify` 结果。
- 是否已具备执行 `discover-candidates` 的前置条件。

## 3. 询问是否调用 `yog:discover-candidates`

初始化完成后，请停下来询问我是否现在调用 `yog:discover-candidates`。

询问前先报告 discover 的前置条件：

- 当前仓库已经完成 Yog 初始化。
- CodeGraph 是否已初始化并能查询当前仓库。
- `docs/knowledge/templates/candidate.md` 是否存在。

如果我同意执行 discover：

- 直接调用 `yog:discover-candidates`，并遵循该 skill 的前置检查、子代理 fan-out、超时 inline fallback、reduce、write、sync、verify 和报告规则。
- 不要在本引导文档里手动复刻 `yog:discover-candidates` 的内部脚本顺序；以 skill 当前版本为准。

如果我不同意执行 discover：

- 停止在初始化完成状态。
- 给出后续可直接对 agent 说的自然语言请求，例如“调用 `yog:discover-candidates` 发现当前仓库的候选 context”。

## 后续可直接调用的 Yog 入口

初始化引导结束后，如果我提出其他 Yog 任务，请优先调用对应 skill：

- `yog:discover-candidates`：发现候选 context。
- `yog:business-flow`：创建或更新跨 context 的 business-flow 总览。
- `yog:sync-verify`：同步、验证、build-index、check-index、lint。
- `yog`：review 候选、promote 候选、overlap 校准、语义召回测试，或没有更具体入口的 Yog 任务。
