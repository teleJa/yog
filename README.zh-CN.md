# Yog

[English](./README.md)

Yog 是一个面向 AI 编码代理的业务知识库与产品 Wiki 插件。它把长期有效的项目知识沉淀到仓库内的 `docs/knowledge`，也可以在 `docs/wiki` 下生成聚焦、可追溯的中文产品手册。

Yog 的核心定位是 agent-first：用户仍然直接和 agent 对话；Yog skill 负责引导 agent 读取知识库、维护知识库；确定性的 Node 脚本负责写文件、建索引、lint 和 verify。

如果需要把启用流程直接交给 Codex / Claude Code agent，请使用：[Yog Agent 引导提示词](./docs/yog-agent-onboarding-prompt.zh-CN.md)。完整用户手册见：[Yog 用户手册](./docs/user-agent-prompts.zh-CN.md)。

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
- `contexts/<context-id>/CONTEXT.md`：正式业务上下文边界、何时使用、需求路由规则、域级常见误判和验证入口。
- `capabilities/`：该 context 承担的能力，并给 agent 提供开发落点指引：优先复用什么、不要复用什么、什么时候停下来确认、如何拆任务和验证。
- `evidence/`：把业务结论锚定到代码、路由、表、消息、测试或人工确认来源，并记录生成元数据和开发验证建议。
- `candidates/`：尚未确认、待 review 的业务上下文候选。
- `index.json` / `INDEX.md`：生成索引，用于路由、检查和 smoke 诊断。
- `yog:wiki generate`：把用户确认的菜单范围、可选业务来源和选定代码路径转换为 `docs/wiki` 下的产品功能页及 Record 用户场景页。

## 当前插件形态

Yog 暴露一组面向 agent 的 skill：

```text
skills/yog/SKILL.md                 通用入口和共享工作流规则
skills/init/SKILL.md                初始化目标仓库 docs/knowledge
skills/discover-candidates/SKILL.md 发现 needs-review 候选 context
skills/business-flow/SKILL.md       创建跨 context 的 business-flow 总览
skills/sync-verify/SKILL.md         sync、verify、build-index、check-index、lint
skills/wiki/SKILL.md                在 docs/wiki 下生成聚焦的产品 Wiki
```

这些 skill 会调用内部 Node ESM 脚本：

```text
skills/yog/scripts/
```

Repo Wiki 对用户只暴露 `yog:wiki generate`。它根据用户确认的菜单范围、可选 Record 业务流程、可选 Requirement 或 Spec，以及用户提供的代码路径，生成聚焦的中文产品 Wiki。一级菜单生成目录，二级菜单生成功能页；只有 Record 可以生成用户场景。CodeGraph 可以补充选定代码路径的关系，但不是生成前提。MVP 在发布前校验证据、内部链接、敏感内容和完整输出树，然后全量替换已由 `yog:wiki-mvp` 管理的 Wiki；未受管理的 `docs/wiki` 不会被接管或覆盖。

初始化生成的 `.yog/config.json` 包含 `"language": "zh-CN"`。产品 Wiki MVP 当前只支持 `zh-CN`。

首版不提供公开 CLI、MCP server、HTTP server 或需要用户记忆的一组命令。脚本是 skill 和测试使用的确定性内部自动化入口。

仓库同时包含 Codex 与 Claude Code 插件 manifest：

```text
.codex-plugin/plugin.json
.claude-plugin/plugin.json
```

两个 manifest 都指向同一个 `./skills/` 目录，保证两种 agent surface 使用同一份 Yog 指导。

## 安装 Yog

Yog 的使用分两步：先把 Yog 安装成 agent 插件，再到每个目标仓库里初始化 `docs/knowledge` 知识库。

要求：

- Node.js 20 或更新版本。
- 支持插件的 Codex 或 Claude Code。

### Codex

直接从 GitHub 插件市场安装 Yog：

```bash
codex plugin marketplace add https://github.com/teleJa/yog.git
codex plugin add yog@yog
```

安装后重启 Codex，让新的会话加载 `yog` skill。

更新已安装的 GitHub marketplace 版本：

```bash
codex plugin marketplace upgrade yog
codex plugin add yog@yog
```

验证插件是否可见：

```bash
codex plugin list | rg yog
```

### Claude Code

先克隆 GitHub 仓库：

```bash
git clone https://github.com/teleJa/yog.git /path/to/yog
```

校验插件 manifest：

```bash
claude plugin validate /path/to/yog
```

如果使用 Claude Code marketplace，需要添加一个能把克隆后的 Yog 仓库暴露为 `yog` 插件的 marketplace，然后安装 `yog@yog` 并重启 Claude Code。

### 在目标仓库初始化 Yog

插件安装完成后，在目标仓库中让 agent 执行“初始化 Yog”：

```text
使用 Yog 初始化当前仓库，knowledgeRoot 使用 docs/knowledge。
```

如需脚本级调试或 CI 自动化，也可以直接运行内部初始化脚本：

```bash
node /path/to/yog/skills/yog/scripts/init.mjs <<'JSON'
{"repoRoot":"/path/to/target-repo","knowledgeRoot":"docs/knowledge","payload":{}}
JSON
```

该步骤会创建 `docs/knowledge`，写入 `.yog/config.json`，并在根 `AGENTS.md` / `CLAUDE.md` 中插入或更新 Yog managed guidance。它不会覆盖已有的 `docs/knowledge/**` 文件。

## 核心工作流

### 生成产品 Wiki

让 agent 执行 `yog:wiki generate`。在读取来源或写入 Wiki 前，agent 会先收集并回显本次授权范围。

必需输入：

- 可以解析出一级菜单和二级功能的菜单描述；
- Wiki 输出根目录的绝对路径；
- 用户明确提供的一个或多个代码绝对路径。

可选输入：

- 由页面操作录制产出的 Record Skill 目录；
- Requirement 工作项 ID、链接或用户确认的有限项目范围；
- 明确的 Spec 文件或目录路径。

示例：

```text
使用 yog:wiki 生成本次菜单的全部范围。
菜单：客户端装修 -> 客户端页面、页面管理、弹窗广告、客户端设置
输出根目录：/absolute/path/to/product
代码路径：/absolute/path/to/frontend、/absolute/path/to/backend
Requirement 范围：TAPD workspace 12345678
本次没有 Record 和 Spec。
```

菜单是唯一可以创建功能名称的来源：一级菜单生成目录，二级菜单生成 Markdown 功能页。Requirement 和 Spec 只能补充已有菜单功能，不能扩大菜单范围；只有 Record 可以创建用户场景页。当 Record 只覆盖菜单的一部分，而用户尚未选择范围时，agent 必须停下来询问“只生成 Record 相关功能”还是“生成完整菜单范围”。

如果 `<outputRoot>/.yog/config.json` 存在，Yog 会读取其中可选的 Requirement Provider 路由配置：

```json
{
  "language": "zh-CN",
  "wiki": {
    "requirementProvider": {
      "provider": "tapd",
      "transport": "mcp",
      "serverRef": "tapd"
    }
  }
}
```

MVP 当前只生成中文，并通过已经配置好的 MCP server 读取 TAPD。配置只保存引用，不保存令牌。Requirement 或 Spec 缺失时，菜单加代码仍可继续生成，只降低证据覆盖度。

默认输出：

```text
docs/wiki/
  目录.md
  产品功能/
    <一级菜单>/
      <二级菜单>.md
  用户场景/
    <一级菜单>/
      <Record 场景名称>.md
  待确认问题.md              # 只有存在产品评审 Gap 时才生成
  _meta/
    catalog.json
    claims.json
    evidence.json
    manifest.json
```

MVP 不生成一级菜单索引页、验收页、三级功能页、业务流程页，也不生成独立的架构、模块、接口或数据模型目录。产品页只保留简洁技术关联，详细证据进入 `_meta`。

发布是全有或全无的：目标不存在时创建；目标已存在时，只有 Manifest 声明 `managedBy: yog:wiki-mvp` 才允许全量替换；未受管理的 `docs/wiki` 会阻断发布。MVP 不暴露 refresh、verify、resume，也不自动监控菜单变化。

### 初始化知识库

`init.mjs` 会在目标仓库创建 `docs/knowledge` 骨架，写入 `.yog/config.json`，并在根 `AGENTS.md` / `CLAUDE.md` 中插入或更新 Yog managed block。

`init` 不覆盖已有 `docs/knowledge/**` 文件。老仓库需要刷新指导文本时，应显式使用 `upgrade-guidance.mjs`。

### 安装 Prompt Hook

`install-hooks.mjs` 是可选步骤，和 `init` 分离。它会把 `UserPromptSubmit` hook 复制到目标仓库的 `.claude/hooks/` 与 `.codex/hooks/`，让后续每轮 prompt 都能提醒 agent：涉及业务需求、方案设计、接口变更或业务规则判断时，先读 `docs/knowledge/CONTEXT-MAP.md`，再选择相关 context 下钻全文。

Claude Code 的 `.claude/settings.json` 会自动合并更新。Codex 的 `config.toml` 不会被自动改写，脚本只返回手动开启提示，避免破坏用户已有配置。

### 自动发现候选

`discover-candidates` 是 agent workflow，不是单独的 Node 脚本。它有一个硬前置：

- 目标仓库已初始化 CodeGraph。

缺少 CodeGraph 时，Yog 会停止自动发现，不退化为只按文件名、目录名或 `rg` 猜业务边界。满足前置后，workflow 使用多个代码证据 lens 并行扫描，再由 `reduce-candidates.mjs` 执行 JOIN、数量门禁和磁盘重复预检，最后通过 `write-candidates.mjs` 写入待 review 候选。

### 候选升级

候选升级会把一个已 review 的 candidate 转成正式 context，并创建至少一个真实 capability 和一个真实 evidence。只生成空 context 壳不算完成。

正式知识文档的目标不是只归档结论，而是指导 agent 开发：

- Context 文档承载业务边界、何时使用、需求路由规则、能力矩阵、域级常见误判，以及 prescriptive guidance 的人工复核时间。
- Capability 文档承载能力级职责和 agent 开发指引：复用路径、禁止复用边界、停下确认点、任务拆分、验证方式和能力级常见误判。
- Evidence 文档承载代码事实锚点：入口路径、路由、调用关系、数据/消息、前端入口、生成证据和开发验证建议。

常见误判、开发指引这类红线内容只由人判断是否仍有效，机器不根据代码 diff 自动裁判。`guidance_reviewed_at` 记录上次人工复核日期。lint 会在非 verified 文档缺复核日期或复核周期到期时输出 P2 `[review-due]` 提醒；verified capability 的开发指引缺复核日期会成为 P1 门禁。

### 同步与验证

Yog 的索引是确定性生成物：

- `sync.mjs`：重建索引并执行 lint。
- `verify.mjs`：只检查索引和 lint，不写文件。
- `check-index.mjs`：比较索引是否需要更新，不写文件。
- `lint.mjs`：检查结构、必填章节、路径、状态、路由安全性、证据元数据和指导内容复核提醒。

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

测试会创建临时仓库，覆盖初始化、文档创建、候选 reduce、hook 安装、索引生成、lint、verify、sync、路由、产品 Wiki MVP、脚本契约和非目标约束。

## 为什么用 index.json 而不是 RAG

一个常见挑战：为什么检索走生成的 `index.json`，而不是把所有文档嵌入向量库、用 RAG 召回？三个理由，由直接到本质：

1. **量级根本没到 RAG 的门槛。** RAG 是为"规模大到无法穷举的语料"设计的——几万篇文档、几百万个片段。而基于单个仓库代码产生的业务知识完全是另一个数量级：通常就几十个 context，全局 `index.json` 是一份 agent 一次就能读进上下文的路由表。当整份索引一次读得完、agent 能直接判断相关性时，RAG 是在解决一个根本不存在的问题。不要给没有的问题上方案。

2. **RAG 会拍平 Yog 建立的结构。** Yog 的文档不是"待检索的无结构语料"，而是已经建模成的有向结构：`CONTEXT-MAP.md` 是路由图，business-flow 串联 context，evidence 精确锚定到代码。切成 chunk 做向量，等于丢掉 Yog 花力气维持的边界和关联，再用相似度去近似地拼回来。它还破坏两条核心原则：**确定性**（向量召回是概率性的——换 embedding 模型或 chunk 策略，结果就变，这和"文件即事实、可 diff、可校验、可 lint"直接冲突）和**业务语言与代码证据的分离**（无差别切碎会把业务定义和实现细节混进同一个向量空间）。

3. **检索主体本就有语义能力。** Yog 的检索靠的是 agent 自己的语义理解——它读 `CONTEXT-MAP.md` / `index.json` / summary，判断该进哪个 context。RAG 是为"没有语义能力的检索系统"设计的中间层；一个 LLM agent 不需要外挂一个来替它做它本就擅长的事。Yog 只需给 agent 一份干净的路由图，而不是一个模糊召回器。读一份完整、结构化、带出处的 context，胜过从去了上下文的碎片里拼理解。

一句话：Yog 的问题从来不是"文档太多搜不到"，而是"业务知识没结构、会漂移"。RAG 解决前者，Yog 解决后者。`keywords` 字段是给 agent 的语义锚点，不是给机器算相似度的输入。如果知识库真的膨胀到成百上千个 context，可以在结构之上加一层可选的语义粗筛作为加速器——但永远是结构之上的加层、不是替代，最终的精确定位和读取始终走结构化路径。

## 非目标

当前版本不提供：

- 需要用户记忆的公开 CLI；
- MCP server；
- Web 服务或常驻 daemon；
- 缺少 CodeGraph 时的自动业务发现；
- 产品 Wiki 的 refresh、resume、菜单自动监控或 Reader/Evidence Judge 工作流；
- MVP 阶段 `zh-CN` 以外的产品 Wiki 输出语言；
- npm 包发布形态。

## License

MIT。见 [LICENSE](./LICENSE)。
