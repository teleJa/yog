# Yog

[English](./README.md)

Yog 是一个面向 AI 编码代理的业务知识库与产品 Wiki 插件。它把长期有效的项目知识沉淀到仓库内的 `docs/knowledge`，也可以在 `docs/wiki` 下生成聚焦、可追溯的中文产品手册。

Yog 的核心定位是 Codex agent-first：产品查询路由到 `docs/wiki`，研发查询路由到 `docs/knowledge`，授权的维护、索引、验证和 Audit 持久化由确定性 Node 脚本完成。

如果需要把启用流程直接交给 Codex agent，请使用：[Yog Agent 引导提示词](./docs/yog-agent-onboarding-prompt.zh-CN.md)。完整用户手册见：[Yog 用户手册](./docs/user-agent-prompts.zh-CN.md)。

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
- `yog:wiki generate/update/sync/verify`：创建并长期维护 `docs/wiki` 产品手册；verified Knowledge 可以作为当前实现的代码证据，引用方向始终是 Wiki 到 Knowledge。

## 当前插件形态

Yog 暴露五个任务 skill 和一个只读选择器：

```text
skills/yog/SKILL.md                 只读入口选择器
skills/knowledge/SKILL.md           生成和维护 docs/knowledge
skills/wiki/SKILL.md                生成、更新、同步、验证和审计 docs/wiki
skills/wiki-review/SKILL.md         逐条引导 PM 审核原子 ReviewItem
skills/knowledge-query/SKILL.md     只读研发查询
skills/wiki-query/SKILL.md          只读产品查询
```

这些 skill 会调用内部 Node ESM 脚本：

```text
skills/yog/scripts/
```

`yog:wiki generate/update/sync/verify` 构成产品 Wiki 长期维护入口；`yog:wiki audit` 只是验证或查询发现已受管 Wiki 结构、来源或引用损坏后的内部审计动作，不生成或修改 `docs/wiki`。

`yog:wiki-review` 只读取两级 Catalog、Review 索引、一个 Feature 审核分片和 Feature 正文，每次只处理一个原子产品问题，把 tagged Decision 保存到已确认的 `spec/filesystem` Source，再交回 `yog:wiki update` 正式应用。

`yog:knowledge` 统一承载 `init`、`discover-candidates`、`business-flow`、`sync`、`verify`、`audit`、`install-hooks`、`upgrade` 八个稳定子动作；创建、评审、提升和边界校准通过明确自然语言触发对应内部 workflow。

初始化生成的 `.yog/config.json` 包含 `"language": "zh-CN"`。当前产品 Wiki 合同支持 `zh-CN` 输出。

首版不提供公开 CLI、MCP server、HTTP server 或需要用户记忆的一组命令。脚本是 skill 和测试使用的确定性内部自动化入口。

仓库仅包含 Codex 插件 manifest：

```text
.codex-plugin/plugin.json
```

## 安装 Yog

Yog 的使用分两步：先把 Yog 安装成 agent 插件，再到每个目标仓库里初始化 `docs/knowledge` 知识库。

要求：

- Node.js 20 或更新版本。
- 支持插件的 Codex。

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

### 在目标仓库初始化 Yog

插件安装完成后，在目标仓库中让 agent 执行“初始化 Yog”：

```text
使用 yog:knowledge init 初始化当前仓库，knowledgeRoot 使用 docs/knowledge。
```

如需脚本级调试或 CI 自动化，也可以直接运行内部初始化脚本：

```bash
node /path/to/yog/skills/yog/scripts/init.mjs <<'JSON'
{"repoRoot":"/path/to/target-repo","knowledgeRoot":"docs/knowledge","payload":{}}
JSON
```

该步骤会创建 `docs/knowledge`，写入 `.yog/config.json`，并在根 `AGENTS.md` 中插入或更新 Yog managed guidance。它不会覆盖已有的 `docs/knowledge/**` 文件。

## 核心工作流

### 生成并维护产品 Wiki

让 agent 执行 `yog:wiki generate`。Yog 会先校验授权 Source 范围，再构建模式四产品知识模型并投影 T16—T21。

必需输入：

- 可识别 System、Domain、Module、Feature 的已确认 Catalog；
- Wiki 输出根目录的绝对路径；
- 用户授权的一个或多个 Code 根目录。

条件输入或增强输入：

- 有界 Requirement 范围，首发 Provider 为 TAPD；
- 对涉及持久化、指标或数据权限的 Feature，提供 PostgreSQL/MySQL Database metadata；
- 明确的 Spec、Record、Test 或 verified Knowledge 来源。

示例：

```text
使用 yog:wiki 生成已确认 Catalog 范围。
Catalog：交易系统 -> 订单域 -> 订单管理 -> 订单退款
输出根目录：/absolute/path/to/product
代码路径：/absolute/path/to/frontend、/absolute/path/to/backend
Requirement 范围：TAPD workspace 12345678
Database：/absolute/path/to/schema.json 中的 PostgreSQL metadata dump
```

Catalog 是唯一可以创建或重命名产品层级的来源。Code 证明 Current 行为，Requirement/Spec 支持 Expected 意图，Database 证明 deployed structure，Record/Test 只证明其实际覆盖的 Observed 范围。Catalog + Code 是硬门禁；Requirement 缺失会降低背景、范围和验收覆盖；Database 通过 `dataSourceAssessment` 对每个 Feature 构成条件门禁。

如果 `<outputRoot>/.yog/config.json` 存在，`wiki.sources[]` 是唯一 Source 配置合同：

```json
{
  "language": "zh-CN",
  "wiki": {
    "root": "docs/wiki",
    "sources": [
      { "id": "product-catalog", "kind": "catalog", "provider": "menu-json", "enabled": true, "required": true },
      { "id": "current-code", "kind": "code", "provider": "git-worktree", "enabled": true, "required": true },
      { "id": "primary-requirements", "kind": "requirement", "provider": "tapd", "enabled": true, "required": false },
      { "id": "primary-database", "kind": "database", "provider": "postgres", "enabled": false, "required": false, "capturePolicy": "metadata-only" }
    ]
  }
}
```

远端与 Database scope 必须由用户明确确认。配置只保存路由和 credential reference，不保存密钥。Live Database introspection 默认关闭，只允许对 PostgreSQL 系统目录或 MySQL `information_schema` 执行 allowlist metadata `SELECT`；严禁读取业务行和样例值。

默认输出：

```text
docs/wiki/
  AGENTS.md
  目录.md
  产品目录/
    <系统>/
      系统总览.md
      <业务域>/<模块>/<功能>.md
  知识对象/
    用户场景/
    业务流程/
      目录.md
    状态模型/
    页面与操作/
    业务规则/
    数据字典/
    指标口径/
    接口集成/
    角色权限/
  质量治理/
    目录覆盖与质量报告.md
    待确认问题.md
    版本与变更/
  _meta/
    model.json
    catalog.json
    catalog/
      <system-id>.json
    flows.json
    flows/
      <system-id>.json
    claims.json
    evidence.json
    relationships.json
    coverage.json
    state-machines.json
    manifest.json
```

`AGENTS.md` 规定 Agent 的最小上下文读取顺序：先读一级 `catalog.json`，再读一个 System 分片和目标 Markdown，只在需要追溯时定向过滤 Relationships、Claims、Evidence；流程问题读取 `flows.json`、一个 System Flow 分片、流程目录和一个 Flow 页面；禁止全文加载完整 canonical `model.json`。`_meta/catalog.json` 与 `_meta/flows.json` 都是轻量一级 System 索引，二级分片只保留指针摘要，不复制完整对象。

T16 是系统总览，T17 按内容投影当前实现、已审核基线、影响地图和下一批最多 5 个原子 ReviewItem，T18—T20 是可复用的规则、数据、接口、角色与权限对象，T21 是多维质量报告。每个 Flow 可投影 Current 泳道全景、适用的 Current 状态图和按明确路径分组的时序图。`_meta/model.json` 是唯一 canonical model，Markdown 和其他 metadata 都是确定性投影。

`generate` 首次创建 `managedBy: yog:wiki` snapshot；`generate/update` 的公开输入只包含已确认 Source、标准化 Artifact 和 Yog 语义分析生成的 `semanticDraft`，完整 next model 由 Yog 内部 composer 构建。`update` 通过 Relationships 传播共享对象变更，并保持无关页面字节不变；`sync` 重建机器投影且不改变任何 Markdown 字节；`verify` 只读校验 ownership、model/page/projection hash、来源新鲜度、层级、对象、关系和 T16—T21 一致性。

发布使用仓库级单写锁、`prepared/backed-up/committed` 事务 journal、staging 全量校验和 run-local backup。旧合同或非受管 Wiki 会被拒绝，Yog 不迁移也不接管。Claim 只保存 `evidenceIds`，`wiki-query` 只读取未阻断的 `confirmed` 或 `partial` 产品事实。

### 初始化知识库

`yog:knowledge init` 会在目标仓库创建 `docs/knowledge` 骨架，写入 `.yog/config.json`，并在根 `AGENTS.md` 中插入或更新 Yog managed block。

`init` 不覆盖已有 `docs/knowledge/**` 文件。老仓库需要刷新指导文本时，应显式使用 `upgrade-guidance.mjs`。

### 安装 Prompt Hook

`yog:knowledge install-hooks` 是可选步骤，和 `init` 分离。它会把 `UserPromptSubmit` hook 复制到 `.codex/hooks/`，并在 `.codex/hooks.json` 中幂等 upsert 唯一 Yog handler，同时保留其他 Hook。它不修改 `.codex/config.toml`；新建或定义变化后需要用户通过 `/hooks` 审查和信任。

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

测试会创建临时仓库，覆盖初始化、文档创建、候选 reduce、hook 安装、索引生成、lint、verify、sync、路由、模式四产品 Wiki、脚本契约和非目标约束。

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
- 产品 Wiki 的自动菜单监控或 Reader/Evidence Judge 工作流；
- 当前合同中 `zh-CN` 以外的产品 Wiki 输出语言；
- npm 包发布形态。

## License

MIT。见 [LICENSE](./LICENSE)。
