# Yog

[English](./README.md)

Yog 是一个面向 AI 编码代理的业务知识库插件。它把长期有效的项目知识沉淀到仓库内的 `docs/knowledge`，按业务上下文、能力、证据、业务流、候选项和 ADR 组织，帮助 Codex / Claude Code 在需求分析、方案设计和代码修改前先读对业务边界。

Yog 的核心定位是 agent-first：用户仍然直接和 agent 对话；Yog skill 负责引导 agent 读取知识库、维护知识库；确定性的 Node 脚本负责写文件、建索引、lint 和 verify。

## Yog 解决什么问题

大仓库里最容易丢的不是代码结构，而是业务上下文：

- 某段逻辑属于哪个业务边界；
- 一个能力负责什么、不负责什么；
- 哪些路由、服务、表、消息或测试能证明某个业务事实；
- 需求文档、PRD、README 和真实代码之间是否已经漂移；
- agent 每次都从零扫代码，容易重复消耗上下文并做出边界误判。

Yog 提供一套仓库内知识协议：

- `CONTEXT-MAP.md`：给 agent 看的业务路由表。
- `business-flows/`：跨 context 的端到端业务流程。
- `contexts/<context-id>/CONTEXT.md`：正式业务上下文边界。
- `capabilities/`：该 context 承担的能力。
- `evidence/`：把业务结论锚定到代码、路由、表、消息、测试或人工确认来源。
- `candidates/`：尚未确认、待 review 的业务上下文候选。
- `index.json` / `INDEX.md`：生成索引，用于路由、检查和 smoke 诊断。

## 当前插件形态

Yog 当前只暴露一个面向 agent 的 skill：

```text
skills/yog/SKILL.md
```

skill 会调用内部 Node ESM 脚本：

```text
skills/yog/scripts/
```

首版不提供公开 CLI、MCP server、HTTP server 或需要用户记忆的一组命令。脚本是 skill 和测试使用的确定性内部自动化入口。

仓库同时包含 Codex 与 Claude Code 插件 manifest：

```text
.codex-plugin/plugin.json
.claude-plugin/plugin.json
```

两个 manifest 都指向同一个 `./skills/` 目录，保证两种 agent surface 使用同一份 Yog 指导。

## 核心工作流

### 初始化知识库

`init.mjs` 会在目标仓库创建 `docs/knowledge` 骨架，写入 `.yog/config.json`，并在根 `AGENTS.md` / `CLAUDE.md` 中插入或更新 Yog managed block。

`init` 不覆盖已有 `docs/knowledge/**` 文件。老仓库需要刷新指导文本时，应显式使用 `upgrade-guidance.mjs`。

### 安装 Prompt Hook

`install-hooks.mjs` 是可选步骤，和 `init` 分离。它会把 `UserPromptSubmit` hook 复制到目标仓库的 `.claude/hooks/` 与 `.codex/hooks/`，让后续每轮 prompt 都能提醒 agent：涉及业务需求、方案设计、接口变更或业务规则判断时，先读 `docs/knowledge/CONTEXT-MAP.md`，再选择相关 context 下钻全文。

Claude Code 的 `.claude/settings.json` 会自动合并更新。Codex 的 `config.toml` 不会被自动改写，脚本只返回手动开启提示，避免破坏用户已有配置。

### 自动发现候选

`discover-candidates` 是 agent workflow，不是单独的 Node 脚本。它有两个硬前置：

- 当前 agent 会话可用 Serena。
- 目标仓库已初始化 CodeGraph。

缺任一工具时，Yog 会停止自动发现，不退化为只按文件名、目录名或 `rg` 猜业务边界。满足前置后，workflow 使用多个代码证据 lens 并行扫描，再由 `reduce-candidates.mjs` 执行 JOIN、数量门禁和磁盘重复预检，最后通过 `write-candidates.mjs` 写入待 review 候选。

### 候选升级

候选升级会把一个已 review 的 candidate 转成正式 context，并创建至少一个真实 capability 和一个真实 evidence。只生成空 context 壳不算完成。

### 同步与验证

Yog 的索引是确定性生成物：

- `sync.mjs`：重建索引并执行 lint。
- `verify.mjs`：只检查索引和 lint，不写文件。
- `check-index.mjs`：比较索引是否需要更新，不写文件。
- `lint.mjs`：检查结构、必填章节、路径、状态和路由安全性。

## 脚本协议

内部写入和匹配脚本从 stdin 读取 JSON：

```json
{
  "repoRoot": "/path/to/repo",
  "knowledgeRoot": "docs/knowledge",
  "payload": {}
}
```

脚本向 stdout 输出 JSON。普通业务问题写入 stdout，不写 stderr。

退出码：

- `0`：完成，或只有 P2 提示。
- `1`：目标仓库状态或质量门禁阻塞。
- `2`：调用方输入错误。
- `3`：需要用户确认，且未发生写入。

示例：

```bash
node skills/yog/scripts/verify.mjs <<'JSON'
{"repoRoot":"/path/to/repo","knowledgeRoot":"docs/knowledge","payload":{}}
JSON
```

## 仓库结构

```text
skills/yog/
  SKILL.md                 面向 agent 的工作流契约
  hooks/                   会复制到目标仓库的 prompt hook 模板
  lib/                     共享实现
  scripts/                 内部确定性脚本入口
templates/knowledge/       docs/knowledge 骨架与文档模板
test/yog/                  Node 测试套件
docs/changes/              设计记录、测试计划和变更记录
docs/adr/                  架构决策记录
docs/knowledge-base/       构建计划和协议细节
```

## 本地开发

要求：

- Node.js 20 或更新版本。

运行测试：

```bash
npm test
```

测试会创建临时仓库，覆盖初始化、文档创建、候选 reduce、hook 安装、索引生成、lint、verify、sync、路由、脚本契约和非目标约束。

## 非目标

当前版本不提供：

- 需要用户记忆的公开 CLI；
- MCP server；
- Web 服务或常驻 daemon；
- 缺少 Serena / CodeGraph 时的自动业务发现；
- npm 包发布形态。

## License

MIT。见 [LICENSE](./LICENSE)。
