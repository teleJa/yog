# Yog 产品需求文档

## 1. 产品定位

Yog 是一个面向 agent 的业务知识库工具，用于帮助大型仓库沉淀可检索、可验证、可持续维护的业务知识。

Yog 不以代码目录、服务模块或一次性需求任务作为主要组织边界，而是围绕业务上下文、业务能力、实现证据、候选边界和架构决策构建 `docs/knowledge`。Agent 在回答业务、架构、功能或实现问题前，应先通过知识库索引理解业务语言和边界，再用代码事实工具验证当前实现。

## 2. 用户问题

大型仓库中的业务知识通常分散在 PRD、代码、接口、测试、临时总结、聊天记录和历史决策中。Agent 直接搜索代码时容易出现以下问题：

- 把目录名、接口名、控制器名或表名误当成业务边界。
- 只能看到当前实现事实，无法理解稳定业务意图和历史取舍。
- 对同一业务能力的路由不稳定，每次都重新扫描代码和文档。
- 无法区分已确认知识、待确认候选、过期知识和历史记录。
- 业务变更后，知识库缺少低成本的过期提示和门禁检查。

Yog 要解决的是：让 agent 先按业务知识库路由，再按证据和代码事实验证，减少重复理解和错误归因。

## 3. 目标

- 使用 `docs/knowledge` 作为唯一业务知识库根目录。
- 以业务上下文和业务能力作为核心知识组织单位。
- 使用 `evidence/*.md` 分离实现事实与业务意图。
- 使用 Markdown frontmatter 作为索引源数据，生成 `INDEX.md` 和 `index.json`。
- 通过 managed `AGENTS.md` 和 `CLAUDE.md` block 同时支持 Codex 与 Claude Code，引导 agent 先读知识库。
- 在未初始化 CodeGraph 时，核心知识库脚本仍可运行。
- 将 CodeGraph 作为调用链和符号证据的默认工具，而不是 `init`、`sync`、`verify` 等核心脚本前置依赖。
- 自动 `discover-candidates` 是 agent workflow，必须具备 CodeGraph 后才能写入 `needs-review` candidate。
- 通过内部 `sync`、`verify`、`lint` 脚本提供本地质量门禁。
- 首版内部脚本不引入第三方运行时 npm 依赖。
- 首版重点是知识文档生成、索引读取和质量审核闭环。

## 4. 非目标

- 不从代码自动推断并确认业务上下文边界。
- 不从代码事实自动把业务能力提升为 `verified`。
- 首版不实现真实 CodeGraph evidence refresh。
- 首版不允许在缺少 CodeGraph 时自动发现并写入候选业务边界。
- 首版不实现 RAG、运行时日志证据、截图证据或外部契约同步。
- 首版不安装真实 git hook、PR/MR 门禁或定时审计流水线。
- 首版不实现语义聚类、自动合并候选或 LLM/embedding 驱动的候选去重。
- 不修改目标仓库业务代码。

## 5. 核心概念

### 5.1 Business Knowledge Base

基于 Markdown 的业务知识系统，记录业务语言、能力边界、设计意图、长期决策和可追溯实现证据。

### 5.2 Business Context

稳定的业务域或有明确语言边界的业务上下文。它可以跨多个代码目录，也可能与服务模块不是一一对应关系。

### 5.3 Business Capability

业务上下文中的具体业务能力，能够被描述、推理，并关联实现证据。

### 5.4 Implementation Evidence

支撑或约束业务能力的代码事实，例如路由、调用入口、表、消息、配置、状态字段和归档 PRD 结论。

### 5.5 Candidate

边界尚未确认的候选业务上下文或业务能力。Candidate 可用于积累线索，但不能被当作权威业务结论。

### 5.6 Architecture Decision

记录长期架构取舍的文档。只有难以逆转、没有上下文会令人困惑、且确实存在方案权衡的决策才需要 ADR。

## 6. 知识库结构

Yog 初始化目标项目后，应生成或维护以下结构：

```text
docs/knowledge/
  README.md
  AGENTS.md
  CONTEXT-MAP.md
  INDEX.md
  index.json
  changes/
    README.md
    <timestamp>-change.md
  audits/
    README.md
    YYYY-MM-DD.md
  contexts/
    README.md
    <context-id>/
      CONTEXT.md
      README.md
      capabilities/
        <capability-id>.md
      evidence/
        <capability-id>-routes.md
        <capability-id>-call-flow.md
        <capability-id>-data.md
        <capability-id>-prd.md
        <capability-id>-tests.md
        <capability-id>-ui.md
        <capability-id>-ops.md
  candidates/
    README.md
    <candidate-id>.md
  adr/
    README.md
    0001-*.md
  templates/
    context.md
    context-readme.md
    capability.md
    evidence.md
    candidate.md
    adr.md
    change.md
    audit.md
    prd-extraction-checklist.md
```

规则：

- `CONTEXT.md` 只记录业务语言和边界，不记录实现细节。
- `CONTEXT-MAP.md` 是人工确认后的业务上下文地图源文件，必须由模板初始化。
- 正式 context 必须同时满足 `CONTEXT-MAP.md` 有确认条目，且 `contexts/<context-id>/CONTEXT.md` 存在并包含真实业务语言内容；只有目录存在不算正式 context。
- `CONTEXT-MAP.md` 的 `## Contexts` 首版只解析顶层 context bullet，格式固定为 `- context-id: Context Name - one sentence summary`，并读取其下缩进的 `Path`、`Responsibilities`、`Non-responsibilities` 字段。
- `CONTEXT-MAP.md` context 条目的 `Path` 是相对 `docs/knowledge/` 的路径，必须等于 `contexts/<context-id>/CONTEXT.md`；生成全局 index 时再转换为目标仓库根相对路径 `docs/knowledge/contexts/<context-id>/CONTEXT.md`。
- `context-id` 必须符合 kebab-case：`[a-z][a-z0-9-]*`，不得包含大写、下划线、空格、斜杠或路径片段。
- `contexts/<context-id>/README.md` 是 context 概览源文件，不进入默认索引；正式 context 的 README 必须存在且至少包含标题和用途/概览说明，不能是空白文件或空壳模板。
- capability 文档记录业务能力、边界、流程、设计意图、约束和关联 evidence。
- evidence 文档记录实现事实，不承载业务设计结论。
- candidate 文档只表示待确认线索。
- change 和 audit 是维护报告，不进入默认 agent 路由索引。
- Markdown 源文档是权威真源，`INDEX.md` 和 `index.json` 是生成产物。
- `build-index` 不生成或覆盖 `CONTEXT-MAP.md`。
- 目标仓库 `docs/knowledge` 不复制 Yog 可执行工具脚本；确定性执行层只存在于插件 `skills/yog/scripts/`。
- `docs/knowledge/templates/*.md` 是目标仓库内的文档创建模板，创建脚本必须使用这些本地模板。
- context 创建依赖 `templates/context.md` 和 `templates/context-readme.md`。
- 从模板创建的 source Markdown 必须在进入索引前填入真实内容；capability、evidence、candidate 和 ADR 文档不得为空壳模板，不得保留 `{...}` 占位符。
- 目标仓库业务知识库 ADR 只放在 `docs/knowledge/adr/`；Yog 项目自身的 `docs/adr/` 不属于目标知识库索引范围。

## 7. 状态模型

知识文档状态用于表达置信度和路由优先级。

| 状态 | 适用对象 | 含义 |
|---|---|---|
| `verified` | capability、evidence | 已确认，可作为优先知识来源 |
| `draft` | capability、evidence | 草稿，可读取但不能当作最终结论 |
| `needs-review` | candidate、capability、evidence | 需要人工或归档 PRD 复核 |
| `stale` | capability、evidence、candidate | 可能过期，默认不作为权威候选 |
| `deprecated` | candidate、capability、evidence | 历史保留，默认不作为权威候选 |
| `accepted` | ADR | 已接受的架构决策 |

约束：

- `accepted` 只用于 ADR，不用于 capability、evidence 或 candidate。
- candidate 不能使用 `verified`。
- context 本身不使用 status；正式 context 由 `contexts/<context-id>/CONTEXT.md` 和 `CONTEXT-MAP.md` 表示。
- `contexts/<context-id>/CONTEXT.md` 不使用 frontmatter。
- 状态排序优先级固定为 `accepted` / `verified` -> `draft` -> `needs-review` -> `stale` -> `deprecated`。
- `accepted` 和 `verified` 在排序上同级，但适用对象不同：`accepted` 只用于 ADR / `adr-link`，`verified` 只用于 capability / evidence。
- capability 可创建为 `draft`，但不能自动提升为 `verified`。
- `verified` capability 必须包含非空 `confirmation_sources`，来源可以是归档 PRD 最终结论或人工确认。
- `verified` capability 必须有实现证据支撑；其 context index capability entry 的 `evidenceCount` 必须大于 0。
- `verified` evidence 必须包含 `source`、`repo_commit`、`generated_at`、`generator` 和 `generation_evidence`。

## 8. 插件运行面

Yog 的首版不提供用户需要记忆的公开 CLI，也不通过 MCP server 暴露工具。Yog 作为 Codex 插件分发，由 Yog skill 引导 agent 使用内部 Node ESM scripts 完成确定性操作。

### 8.1 `init` 脚本

项目接入执行器，由 Yog skill 在用户要求接入知识库时调用。

能力：

- 从插件内 `templates/knowledge` 拷贝完整 `docs/knowledge` 基础设施骨架。
- 写入或更新 `.yog/config.json`。
- 写入或更新 `AGENTS.md` 和 `CLAUDE.md` 的 Yog managed block。
- 根据用户确认结果写入 CodeGraph 或暂不配置代码事实 provider。
- provider 为 `none` 时，核心脚本仍可运行。

约束：

- 默认不覆盖已有用户文件。
- 已存在的模板文件不覆盖，只返回 warning 说明跳过。
- `INDEX.md` 和 `index.json` 是生成产物，可由 `build-index` 重新生成。
- `.yog/config.json` 已存在时合并已知字段，不删除未知字段。
- 重复执行必须幂等。
- `AGENTS.md` 和 `CLAUDE.md` 都是首版必写目标，且只能更新 Yog managed block。
- `init` 不创建空 context、capability、evidence 或 candidate。
- `init` 完成后应提示：自动 `discover-candidates` 需要 CodeGraph 针对目标仓库初始化并可用。
- `init` 不创建示例 ADR；只创建 `docs/knowledge/adr/` 目录。
- `init` 创建空目录时同步创建该目录的 `README.md`，用于说明目录用途并保证目录可提交。
- 目录 `README.md` 可由团队后续编辑，但只作为目录说明，不承载具体业务结论。
- 本机密钥、缓存、临时文件和机器相关信息不能写入可提交配置。
- `init` 永远不删除用户文件。

### 8.2 文档创建脚本

统一知识文档创建执行器，由 Yog skill 先和用户确认业务范围与边界，再调用对应脚本。

创建文档前，Yog skill 的第一步必须询问业务范围，而不是先询问创建哪种文档：

```text
你要沉淀哪块业务范围？请用一句话描述业务域、能力或需求来源。
```

Yog skill 随后检索 `docs/knowledge/index.json`、`INDEX.md` 和 `CONTEXT-MAP.md`。candidate 不进入默认索引；只有当用户明确要求创建候选、复核候选、补充候选或升级候选时，Yog skill 才直接读取 `docs/knowledge/candidates/*.md`：

- 命中已有 context：询问是否在该 context 下新增 capability，或补充已有 capability。
- 未命中：询问创建 candidate，还是显式创建正式 context。

内部脚本：

- `create-candidate`：创建 `needs-review` candidate；写入前可扫描现有 `candidates/*.md` 做确定性去重。
- `create-context`：显式创建正式 context，必须先确认 `context_id`、`name`、`summary`、`responsibilities`、`non_responsibilities`。
- `promote-candidate`：将已有 candidate 升级为正式 context，同时创建真实 capability 和 evidence，删除 candidate，并写入 change record。
- `create-capability`：在已有 context 下创建 `draft` capability。
- `create-evidence`：在已有 context 和 capability 下创建 `draft` evidence。
- `match-scope`：按用户输入的一句话，对已有 context、capability、evidence 或 ADR 做确定性候选排序；默认不扫描 candidate。

约束：

- capability 创建时 context 必须已存在。
- 创建脚本必须要求目标仓库所需 `docs/knowledge/templates/*.md` 存在；缺失时返回 P0/P1 并提示重新执行 `init`，不得回退插件内种子模板。
- `create-capability` 不能隐式创建正式 context。
- `create-candidate`、`create-context`、`create-capability`、`create-evidence` 必须收到已确认的 `candidateId`、`contextId`、`capabilityId` 或 evidence 文件参数后才能写入。
- `create-candidate` 写入前必须收到非空 `candidateId`、`name`、`summary` 和至少一段真实正文内容；正文内容必须能替换模板中的 `{...}` 占位，不得只保留空章节骨架。
- `create-capability` 写入前必须收到非空 `contextId`、`capabilityId`、`name`、`summary`、`responsibilities`、`nonResponsibilities` 和至少一段真实业务流程或边界说明；这些字段不得包含 `{...}`、`TODO`、`TBD`、`待补充` 或 `待确认`。
- `create-evidence` 写入前必须收到非空 `contextId`、`capabilityId`、`evidenceKind`、`name`、`summary` 和至少一段真实事实摘要；`evidenceKind` 必须是 `routes`、`call-flow`、`data`、`prd`、`tests`、`ui`、`ops` 之一。
- 创建脚本在写入前必须拒绝空索引字段、空壳正文和 `{...}` 占位符；调用方输入缺失或格式非法返回退出码 `2`，目标仓库状态阻断返回退出码 `1`，不得先写入再依赖后续 `lint` 兜底。
- `create-candidate` 的去重只允许在显式 candidate workflow 中执行；去重字段为文件名 slug、frontmatter `name`、`keywords` 和 `possible_contexts`，不得因此把 candidate 加入默认索引或默认 `match-scope` 结果。
- candidate 疑似重复判断必须保持确定性：slug 规范化相等、`name` 规范化相等、`keywords` 有交集或 `possible_contexts` 有交集；不得使用 LLM、embedding 或语义相似度。
- candidate 去重规范化只允许执行：trim、转小写、将空白和 `_` 转为 `-`、折叠连续 `-`、去掉首尾 `-`。不得做中文分词、拼音、同义词、翻译或模糊匹配。
- `create-candidate` 命中疑似重复 candidate 时不得自动覆盖、合并或追加内容；脚本必须不写文件，返回疑似重复列表，并由 Yog skill 询问用户是更新已有 candidate，还是使用新的 `candidateId` 创建独立候选。
- `create-candidate` 命中疑似重复 candidate 时 stdout 必须输出结构化 JSON，`code` 固定为 `candidate-duplicates-found`，`duplicates[]` 每项必须包含 `path`、`candidateId`、`name`、`status`、`matchedFields[]`。
- 用户确认创建独立候选后，`create-candidate` 可以在显式确认标记下继续写入；确认记录必须体现在脚本输入或 agent 对话记录中。
- ID 必须是小写 kebab-case，符合 `[a-z][a-z0-9-]*`，不含路径分隔符，不以 `.` 开头，且不能与已有目标路径冲突。
- ID 缺失或不合法时，创建脚本返回退出码 `2`，不得自动生成并写入。
- `create-context` 只创建正式业务上下文骨架，不把任何 capability 标记为 `verified`。
- `create-context` 必须基于已确认字段更新 `CONTEXT-MAP.md` 的模板化 context 条目。
- `create-context` 创建第一个正式 context 时，必须移除或替换 `CONTEXT-MAP.md` 中的模板占位项；Relationships 和 Open Questions 没有真实内容时保留标题但不保留占位列表项。
- `create-evidence` 只能在已有正式 context 和已有 capability 下创建 evidence，不得隐式创建 context 或 capability。
- `create-evidence` 文件名固定为 `<capability-id>-<evidence-kind>.md`，且 `evidenceKind` 必须同步写入 frontmatter `evidence_kind`。
- `create-evidence` 写入时必须填充 `source`、`generator` 和 `generation_evidence`；`repo_commit` 和 `generated_at` 缺失时只能创建 `draft`，不得创建 `verified` evidence。
- 首版不提供 `mark-verified` 脚本；`verified` 必须由用户明确确认后编辑 Markdown，并通过 `lint` / `sync` 校验。
- `promote-candidate` 写入前必须收到非空 `capabilities[]`，且每个 capability 至少包含一个真实 evidence；不得把 candidate 升级为空 context shell。
- `promote-candidate` 可由 Yog skill 在用户确认后编排 subagent 并行收集业务边界和 CodeGraph 代码证据，再一次性写入 context、capability、evidence 和 change record。
- 文档创建后由 Yog skill 调用 `build-index` 或 `sync`，但不自动把业务结论标记为已验证。
- `match-scope` 不做 LLM 语义推理，不自动创建 context，不扫描或升级 candidate，不自动判定 `verified`。candidate 去重属于 `create-candidate` / candidate review workflow，不属于默认 `match-scope`。

### 8.3 `build-index` 与 `check-index` 脚本

索引生成入口。

Yog 首版采用两级生成索引和三级读取链路：global index -> context index -> source Markdown。第三层是 Markdown 源文档，不是生成索引。

能力：

- 从 Markdown frontmatter 生成 `docs/knowledge/INDEX.md`。
- 从 Markdown frontmatter 生成全局 `docs/knowledge/index.json`。
- 从 Markdown frontmatter 生成 context 局部 `docs/knowledge/contexts/<context-id>/index.json`。
- `check-index` 只读重新生成索引并与已提交产物对比。

约束：

- `check-index` 不写文件。
- 全局索引和 context 局部索引顶层都保留 `generated_at`，作为生成产物审计元数据。
- 仅全局索引或 context 局部索引的 `generated_at` 不同不应导致 `check-index` 失败。
- `check-index` 比较 `INDEX.md` 时必须忽略 generated 时间行，避免时间变化导致误报。
- 全局索引是轻量路由索引，只收录 context 和 ADR。
- candidate 文档不进入默认路由索引，不写入全局 `index.json` 或 `INDEX.md`；candidate 仅由显式候选创建、复核、补充或升级流程直接读取。
- 全局索引不收录 evidence。
- context 局部索引只收录 `capability`、`evidence` 和 `adr-link`。
- ADR 索引来源只包含 `docs/knowledge/adr/*.md`，不得扫描目标仓库根 `docs/adr/`。
- `changes/*.md`、`audits/*.md`、目录说明 `README.md`、模板、根指导文件、context `CONTEXT.md` 和 context `README.md` 不进入默认路由索引。
- `init` 重跑不得覆盖已有目录 `README.md`。

全局 `index.json` 最小 schema：

```json
{
  "schemaVersion": 1,
  "kind": "global",
  "generated_at": "2026-06-22T00:00:00.000Z",
  "entries": [
    {
      "type": "context",
      "context": "order",
      "name": "Order",
      "summary": "Order lifecycle and after-sales handling.",
      "path": "docs/knowledge/contexts/order/CONTEXT.md",
      "readmePath": "docs/knowledge/contexts/order/README.md",
      "indexPath": "docs/knowledge/contexts/order/index.json",
      "docsCount": 12,
      "keywords": ["order", "refund"]
    },
    {
      "type": "adr",
      "name": "Use event log for refund state transitions",
      "summary": "Record refund state transitions in an event log.",
      "status": "accepted",
      "path": "docs/knowledge/adr/0001-refund-event-log.md",
      "keywords": ["refund", "event-log"]
    }
  ]
}
```

context 局部 `index.json` 最小 schema：

```json
{
  "schemaVersion": 1,
  "kind": "context",
  "context": "order",
  "generated_at": "2026-06-22T00:00:00.000Z",
  "entries": [
    {
      "type": "capability",
      "context": "order",
      "capability": "refund",
      "name": "Refund",
      "summary": "Handle customer refund requests.",
      "status": "draft",
      "evidenceCount": 1,
      "path": "docs/knowledge/contexts/order/capabilities/refund.md",
      "keywords": ["refund", "payment"]
    },
    {
      "type": "evidence",
      "context": "order",
      "capability": "refund",
      "name": "Refund routes",
      "summary": "Implementation entry points for refund requests.",
      "status": "verified",
      "evidenceKind": "routes",
      "path": "docs/knowledge/contexts/order/evidence/refund-routes.md",
      "keywords": ["route", "refund"]
    },
    {
      "type": "adr-link",
      "context": "order",
      "name": "Use event log for refund state transitions",
      "summary": "ADR linked to the order context by explicit related_contexts.",
      "status": "accepted",
      "path": "docs/knowledge/adr/0001-refund-event-log.md"
    }
  ]
}
```

Schema 约束：

- `schemaVersion` 必填。
- `kind` 必填，全局索引为 `global`，context 局部索引为 `context`。
- context 局部索引顶层字段固定为 `schemaVersion`、`kind`、`context`、`generated_at` 和 `entries`；不得增加顶层 `stats`、`capabilityCount` 或 `evidenceCountTotal`。
- context 局部索引顶层 `context` 必须等于其文件路径 `docs/knowledge/contexts/<context-id>/index.json` 中的 `<context-id>`，且所有 entries 的 `context` 必须与顶层 `context` 一致。
- `entries[].path`、`entries[].type`、`entries[].name` 必填。
- context 局部索引中 `capability` 和 `evidence` entry 的 `path` 必须落在同一 `docs/knowledge/contexts/<context-id>/` 目录下；不得指向其他 context 目录。
- context 局部索引中 `adr-link` entry 的 `path` 必须指向全局 `docs/knowledge/adr/*.md`。
- 所有索引中的 `path`、`readmePath` 和 `indexPath` 必须使用目标仓库根相对路径，例如 `docs/knowledge/adr/0001-refund-event-log.md`。
- context entry 不使用 `status`。
- ADR、capability、evidence、adr-link entry 必须包含 `status`；candidate 文档可使用 `status`，但不生成 index entry。
- `context`、`domain`、`capability`、`summary`、`keywords`、`updated_at` 可选。
- 全局索引 `type` 只能是 `context`、`adr`。
- context 局部索引 `type` 只能是 `capability`、`evidence`、`adr-link`。
- context 局部索引必须使用平铺 `entries[]`；不得按 `capabilities[].evidence[]` 或其他嵌套结构分组。
- 全局 context entry 必须包含 `path`、`readmePath`、`indexPath` 和 `docsCount`。
- 全局 context entry 的 `path`、`readmePath` 和 `indexPath` 必须固定到同一 context 目录：`docs/knowledge/contexts/<context-id>/CONTEXT.md`、`docs/knowledge/contexts/<context-id>/README.md`、`docs/knowledge/contexts/<context-id>/index.json`。
- 全局 context entry 的 `path` 必须指向存在、可读取且包含真实业务语言内容的 `docs/knowledge/contexts/<context-id>/CONTEXT.md`；缺失、目标不存在、文件为空或仍是空壳模板时 `build-index`、`check-index` 和 `lint` 必须返回非 0。
- 全局 context entry 的 `readmePath` 必须指向存在、可读取且包含真实概览内容的 `docs/knowledge/contexts/<context-id>/README.md`；README 至少包含标题和用途/概览说明，缺失、目标不存在、文件为空或仍是空壳模板时 `build-index`、`check-index` 和 `lint` 必须返回非 0。
- 全局 context entry 的 `indexPath` 必须指向存在的 `docs/knowledge/contexts/<context-id>/index.json`；缺失或目标不存在时 `build-index`、`check-index` 和 `lint` 必须返回非 0。
- `docsCount` 等于对应 context 局部索引中可计数本地知识 entry 数量；`adr-link` 不计入 `docsCount`。
- `docsCount = capabilityCount + evidenceCountTotal`，其中 `capabilityCount` 为 context index 中 `type: "capability"` entry 数量，`evidenceCountTotal` 为 `type: "evidence"` entry 数量。
- 全局 context entry 只保留 `docsCount`，不得额外存储 `capabilityCount` 或 `evidenceCountTotal`；细分数量从 context index 计算。
- 全局 context entry 的 `name` 和 `summary` 来源于 `CONTEXT-MAP.md` 中人工确认的 context 条目。
- 全局 context entry 的 `path` 来源于 `CONTEXT-MAP.md` context 条目的 `Path`；`CONTEXT-MAP.md` 中的 `Path` 相对 `docs/knowledge/`，生成全局 index 时必须加上 `docs/knowledge/` 前缀，最终等于目标仓库根相对路径 `docs/knowledge/contexts/<context-id>/CONTEXT.md`。
- 全局 context entry 的 `keywords` 是派生字段，主要从对应 context index 中所有 capability entry 的 `keywords`、`capability`、`name` 去重聚合；没有 capability 时可退化为 context id 和 context name。
- capability、evidence 和 ADR source Markdown 必须包含真实内容，不得是空文件、空壳模板或保留 `{...}` 占位符；否则不得进入对应 index。candidate source Markdown 也必须包含真实内容，不得是空文件、空壳模板或保留 `{...}` 占位符，但 candidate 始终不进入 global index、context index 或 `INDEX.md`。
- context 局部 capability entry 的 `capability` 必须符合 `[a-z][a-z0-9-]*`，并与源文件名 `contexts/<context-id>/capabilities/<capability-id>.md` 一致。
- context 局部 capability entry 必须包含 `evidenceCount`，等于同一 context index 中绑定该 capability 的 evidence entries 数量。
- `evidenceCount` 是轻量聚合字段，只统计 `type: "evidence"` entries；`adr-link` 不参与统计。
- `evidenceCount: 0` 合法，用于尚无实现证据的 `draft`、`needs-review`、`stale` 或 `deprecated` capability；`verified` capability 的 `evidenceCount` 必须大于 0。
- context 局部 capability entry 的 `keywords` 来源于 capability frontmatter 的显式 `keywords`，不从正文分词；`name` 和 `capability` id 可参与匹配，但不混入该 entry 的 `keywords` 字段。
- evidence entry 必须包含 `capability`，并且该 capability 必须存在于同一 context 局部索引。
- evidence entry 的 `capability` 必须符合 `[a-z][a-z0-9-]*`，并绑定到同一 context index 中已存在的 capability entry。
- evidence 不单独建模 evidence id；文件名作为稳定标识，必须符合 `<capability-id>-<evidence-kind>.md`，其中 `evidence-kind` 符合 `[a-z][a-z0-9-]*`。
- evidence 文件名前缀 `<capability-id>` 必须等于 evidence frontmatter 的 `capability`。
- evidence-kind 表示证据切面，不表示生成方式；生成方式写入 `source`、`generator` 和 `generation_evidence`。
- evidence-kind 首版枚举为 `routes`、`call-flow`、`data`、`prd`、`tests`、`ui`、`ops`。
- evidence frontmatter 的 `evidence_kind` 必须等于文件名中的 `<evidence-kind>`。
- context index evidence entry 必须包含 `evidenceKind`，由 frontmatter `evidence_kind` 生成，并等于文件名中的 `<evidence-kind>`。
- context index evidence entry 只保留路由和筛选字段：`type`、`context`、`capability`、`evidenceKind`、`name`、`summary`、`status`、`path`、`keywords`。
- context index evidence entry 不复制 `source`、`repo_commit`、`generated_at`、`generator` 或 `generation_evidence`；需要生成详情时读取 source Markdown。
- evidence entry 的 `keywords` 来源于 evidence frontmatter 的显式 `keywords`；缺失时为空数组，不继承 capability keywords，不从正文分词。
- `adr-link` 只由 ADR frontmatter 中显式声明的 `related_contexts` 生成，不从正文、标题或关键词自动推断。
- ADR frontmatter 的 `related_contexts` 必须填写 context id 列表，例如 `[order]`；不得填写 context 路径。
- ADR frontmatter 的 `related_contexts` 可以为空；空列表表示该 ADR 只进入全局 ADR index，不在任何 context index 中生成 `adr-link`。
- Yog skill 或脚本写入 `related_contexts` 时必须先对 context id 去重。
- ADR frontmatter 的 `related_contexts` 不应包含重复 context id；`lint` 发现重复项时按 P1 报告，`build-index` 生成 `adr-link` 时必须去重以保证生成产物稳定。
- `build-index` / `lint` 必须通过 `CONTEXT-MAP.md` 和 `contexts/<context-id>/` 校验 `related_contexts` 中的 context id 是否存在。
- `related_contexts` 中的 context id 必须指向正式 context；只有目录存在但缺少 `CONTEXT-MAP.md` 确认条目时不算存在。
- `related_contexts` 引用不存在的 context id 时，`build-index` 必须失败，不得跳过或生成部分反向链接。
- `adr-link.status` 必须镜像全局 ADR entry 的 `status`。
- `adr-link` 是 context index 中的反向链接，不复制全局 ADR entry 的 `keywords`；ADR 关键词检索只走全局 ADR entry。
- 全局 ADR entry 和 context `adr-link` 以 `path` 作为机器对齐键；`name` 只作为展示和诊断字段。
- 全局 ADR entry 的 `keywords` 来源于 ADR frontmatter 的显式 `keywords`，不从正文分词。
- candidate frontmatter 可包含 `keywords` 和 `possible_contexts` 供人工复核，但这些字段不进入默认路由索引。
- 在显式 candidate 创建、复核、补充或升级流程中，Yog skill 可以读取 `candidates/*.md`，并基于文件名 slug、`name`、`keywords`、`possible_contexts` 做确定性去重，避免重复候选；该扫描结果不得写入 global index、context index 或 `INDEX.md`。
- candidate 去重输出必须列出命中字段和候选路径；首版不得输出 LLM 语义判断或 embedding 相似度分数。
- candidate 去重中的规范化为低风险字符级标准化：trim、转小写、将空白和 `_` 转为 `-`、折叠连续 `-`、去掉首尾 `-`；不得引入中文分词、拼音、同义词、翻译或模糊匹配。
- `status` 必须符合文档类型约束。
- entries 必须稳定排序。
- `statusRank` 固定为 `accepted` / `verified` -> `draft` -> `needs-review` -> `stale` -> `deprecated`。
- 全局索引 entries 必须先按 `context`、`adr` 分桶排序；context 桶内按 `path` 稳定排序，ADR 桶内按 `statusRank` 和 `path` 稳定排序。context entry 不使用 `statusRank`。
- context 局部索引 entries 必须先按 `capability`、`evidence`、`adr-link` 分桶排序，再在桶内按 `statusRank` 和 `path` 稳定排序。
- 全局索引和 context 局部索引顶层保留 `generated_at`，但 `generated_at` 不参与 `check-index` 差异判断。
- 初始化模板中的 `index.json` 必须是空全局索引：`schemaVersion: 1`、`kind: "global"`、`entries: []`。

`INDEX.md` 约束：

- `INDEX.md` 是 `index.json.entries` 的人类可读镜像，不承载额外路由语义。
- `INDEX.md` 中展示的 Path 必须与 `index.json.entries[].path` 保持一致，使用目标仓库根相对路径。
- 全局 `docs/knowledge/INDEX.md` 只镜像全局轻量索引，不展开 context 局部索引内容。
- `INDEX.md` 由 `build-index` 生成，开头必须标注 generated / do not edit by hand。
- 初始化模板中的 `INDEX.md` 必须是空索引镜像，不包含示例业务知识、示例 ADR 或不存在的路径。
- `INDEX.md` 表格字段保持最小：Name、Type、Status、Summary、Path。
- 首版不生成 context-level `contexts/<context-id>/INDEX.md`。
- 长期说明必须写入 `README.md`、`CONTEXT-MAP.md`、capability 或 ADR，不得只写在 `INDEX.md`。

### 8.4 `sync` 脚本

本地刷新入口。

能力：

- 执行 `build-index`。
- 执行 `lint`。
- 适合文档变更后的收尾。

约束：

- 只写生成产物。
- 不改写业务知识源文档。
- 只执行索引生成与知识库检查。

### 8.5 `verify` 脚本

只读门禁入口。

能力：

- 执行 `check-index`。
- 执行 `lint`。
- 适合提交前本地门禁。

约束：

- 全程只读。
- P0/P1 问题或索引过期时返回非 0。
- P2 建议不阻断。

### 8.6 `lint` 脚本

知识库质量检查入口。

检查项：

- `docs/knowledge` 是否存在。
- `index.json` 是否可解析。
- frontmatter 是否可解析。
- frontmatter 是否只使用 Yog 支持的简单 YAML 子集。
- status 是否符合文档类型。
- candidate 是否错误使用 `verified`。
- candidate 之间是否存在基于文件名 slug、`name`、`keywords`、`possible_contexts` 的确定性疑似重复；规范化规则固定为 trim、转小写、将空白和 `_` 转为 `-`、折叠连续 `-`、去掉首尾 `-`；发现时按 P2 维护提醒，不阻断，issue `details.duplicates[]` 复用 `create-candidate` 的 duplicate item 结构。
- `verified` capability 是否包含非空 `confirmation_sources`。
- `verified` evidence 是否包含生成确认字段。
- `accepted` 是否只用于 ADR。
- change/audit 报告是否误入默认索引。
- `stale` / `deprecated` 是否被错误提升为默认权威候选。
- `CONTEXT-MAP.md` 是否存在。
- `CONTEXT-MAP.md` 的 `## Contexts` 条目是否符合 `- context-id: Context Name - one sentence summary` 格式。
- `context-id` 是否符合 `[a-z][a-z0-9-]*`。
- `CONTEXT-MAP.md` 的 context 条目是否包含非空 `Path`、`Responsibilities`、`Non-responsibilities` 字段。
- `CONTEXT-MAP.md` context 条目的 `Path` 是否等于相对 `docs/knowledge/` 的路径 `contexts/<context-id>/CONTEXT.md`。
- context 目录是否都有对应 `CONTEXT-MAP.md` 条目。
- `CONTEXT-MAP.md` 是否存在重复 context id 或指向不存在 context。
- 是否存在只有 `contexts/<context-id>/` 目录但缺少 `CONTEXT-MAP.md` 条目的半初始化或残留 context；发现时按 P1 标记。
- 是否存在 `CONTEXT-MAP.md` 条目但缺少 `contexts/<context-id>/CONTEXT.md` 的 context；发现时按 P1 标记。
- context `CONTEXT.md` 是否误用 frontmatter 或 `status`。
- context `README.md` 是否存在，以及是否误用 frontmatter 或 `status`。
- 已有正式 context 时，`CONTEXT-MAP.md` 是否仍保留模板占位符。
- relationships 是否只指向正式 context；指向 candidate、半初始化目录或不存在 id 时按 P1 标记。
- relationships 是否只使用单向边 bullet 格式 `- source -> target: summary`；双向关系必须写成两条单向边。
- relationships 的 `summary` 是否非空；空 summary 按 P1 标记。
- relationships 是否存在自环；`source` 和 `target` 相同时按 P1 标记。
- relationships 是否存在重复边；同一 `source -> target` 出现多次按 P1 标记。
- relationships 结构解析是否只覆盖 `## Relationships` 章节下的 bullet 行，格式为 `- source -> target: summary`；其他说明文字不参与结构校验。

问题分级：

- P0：知识库结构不可用。
- P1：agent 路由可能产生错误权威结论。
- P2：质量建议或维护提醒。

`lint` 只检查知识库结构、索引一致性和文档质量门禁，不判断业务边界是否应拆分、合并或重命名。

### 8.7 脚本输入输出协议

Yog scripts 默认以结构化 JSON 和 agent 通信。Yog skill 负责把脚本结果解释给用户。

规则：

- 写操作和匹配操作优先从 stdin 读取 JSON。
- 检查类操作可以无参数运行，并默认使用当前仓库和 `.yog/config.json`。
- stdout 只输出 JSON，不输出人类说明文本。
- stderr 只用于运行错误或调试信息，不承载业务结果。
- 脚本是否成功由退出码表达，不定义通用 `ok` 字段。
- `lint` 输出使用 `issues[]` 表达检查结果；issue 至少包含 `severity`、`message`，需要机器解析的数据放入 `details`。文件级问题或能定位到具体文件的全局结构问题必须包含 `path`。
- `lint` stdout 必须始终包含 `issues` 数组；没有发现问题时输出 `"issues": []`，不得用空 stdout、`null` 或通用 `ok` 字段表达无问题。
- `match-scope` stdout 必须始终包含 `query`、`matches` 和 `issues`。没有匹配到知识不是错误，返回退出码 `0`，输出 `"matches": []` 和 `"issues": []`。索引损坏、context index 缺失或路径不可读属于目标仓库状态阻断，返回退出码 `1` 并通过 `issues[]` 说明；输入 JSON 或字段非法返回退出码 `2`。

通用 stdin JSON：

```json
{
  "repoRoot": "/path/to/repo",
  "knowledgeRoot": "docs/knowledge",
  "payload": {}
}
```

脚本输入约束：

- `init`、`create-candidate`、`create-context`、`create-capability`、`match-scope` 使用 stdin JSON。
- `create-evidence` 使用 stdin JSON。
- `build-index`、`check-index`、`lint`、`verify`、`sync` 可无参数运行。
- 自然语言、中文、多行摘要、数组和 provider 配置不得通过 shell flags 传递。

退出码是 agent 编排用的流程信号，首版只定义以下 4 个：

- `0`：已完成，没有阻断。操作成功；写入型脚本已经完成写入或幂等 no-op；`lint` / `verify` 只有 P2 建议时也返回 `0`。
- `1`：已执行，但被目标仓库状态或门禁阻断。包括 `lint` 发现 P0/P1、`check-index` 发现生成产物过期、`build-index` 发现知识库结构不合法，以及创建脚本发现目标路径冲突、目标模板缺失、context 不存在、source Markdown 是空壳模板等仓库状态问题。此类结果通常通过 `issues[]` 返回问题。
- `2`：调用方输入错误。包括 stdin 不是合法 JSON、必填输入缺失、ID 格式非法、枚举值非法等。此类问题表示 Yog skill 或 agent 调脚本方式错误，不应要求用户修改知识库内容。
- `3`：需要用户确认，且脚本未写入。不是失败，不是 P0/P1，也不是参数错误；表示脚本发现可继续的分支，但继续前必须由 Yog skill 询问用户。首版典型场景是 `create-candidate` 命中疑似重复候选。

返回退出码 `3` 时，脚本必须保持未写入状态，stdout 必须是合法 JSON，并包含足够信息供 Yog skill 发起确认。用户确认后，Yog skill 可再次调用脚本并传入显式确认标记；第二次成功写入时返回 `0`。首版不增加其他退出码。

`lint` 通用 issue 结构必须固定：

- `severity` 必填，只能是 `P0`、`P1`、`P2`。
- `message` 必填，面向人类阅读。
- `path` 条件必填，指向触发问题的目标仓库根相对路径；文档级问题必须包含 `path`，全局结构问题如果能定位到文件也必须包含 `path`，例如 `docs/knowledge/CONTEXT-MAP.md`。只有仓库级问题，例如 `docs/knowledge` 不存在，才允许省略 `path`。
- `details` 可选，承载结构化诊断数据；必须是 JSON-serializable 对象，不得包含大段正文内容或复制源文档内容。Yog skill 不得解析 `message` 获取机器字段。`lint` issue 不要求 `code`。
- `line` 不进入通用 issue 字段；能稳定定位行号时可写入 `details.line`，首版不强制输出行号。
- `issues[]` 必须稳定排序：先按 `severity` 排序，顺序为 `P0`、`P1`、`P2`；同级再按 `path`、`message` 升序排序。缺少 `path` 的仓库级 issue 排在同级最前。

`lint` stdout JSON 最小结构：

无问题时：

```json
{
  "issues": []
}
```

有问题时：

```json
{
  "issues": [
    {
      "severity": "P1",
      "message": "Context directory has no confirmed CONTEXT-MAP.md entry.",
      "path": "docs/knowledge/contexts/order/CONTEXT.md",
      "details": {
        "context": "order",
        "line": 12
      }
    }
  ]
}
```

`create-candidate` 命中疑似重复候选时的 stdout JSON：

```json
{
  "code": "candidate-duplicates-found",
  "duplicates": [
    {
      "path": "docs/knowledge/candidates/refund.md",
      "candidateId": "refund",
      "name": "Refund",
      "status": "needs-review",
      "matchedFields": ["slug", "keywords"]
    }
  ]
}
```

`duplicates[].matchedFields[]` 只能使用 `slug`、`name`、`keywords`、`possible_contexts`。脚本不得在该结构中输出自然语言相似度解释、LLM 判断或 embedding 分数。

`lint` 报告 candidate 疑似重复时复用同样的 duplicate item 结构，但放在 P2 issue 的 `details.duplicates[]` 中。只有 P2 candidate duplicate issues 时，`lint` 仍返回退出码 `0`：

```json
{
  "issues": [
    {
      "severity": "P2",
      "message": "Likely duplicate candidate documents found.",
      "details": {
        "duplicates": [
          {
            "path": "docs/knowledge/candidates/refund.md",
            "candidateId": "refund",
            "name": "Refund",
            "status": "needs-review",
            "matchedFields": ["slug", "keywords"]
          }
        ]
      }
    }
  ]
}
```

`lint` 的 `details.duplicates[]` 不触发退出码 `3`；退出码 `3` 只用于写入型脚本在写入前需要用户确认的场景。

`match-scope` stdout JSON 最小结构：

```json
{
  "query": "退款流程",
  "matches": [],
  "issues": []
}
```

`match-scope` 的空 `matches[]` 表示当前知识库没有确定性命中，不代表知识库结构错误。Yog skill 可继续询问用户是创建 candidate、显式创建正式 context，还是补充已有 context。`match-scope` 只有在索引文件损坏、context index 缺失、路径不可读或读取链路不一致时才通过 `issues[]` 返回结构问题并使用退出码 `1`。

## 9. 配置

项目级配置写入 `.yog/config.json`，该文件只保存非敏感、可提交的共享配置。

建议结构：

```json
{
  "schemaVersion": 1,
  "knowledgeRoot": "docs/knowledge",
  "codeFactProvider": {
    "type": "codegraph",
    "status": "configured"
  }
}
```

规则：

- `.yog/config.json` 可提交。
- `.yog/local.json`、`.yog/*.local.json`、`.yog/cache/`、`.yog/tmp/` 必须被忽略。
- 配置只保存团队共享偏好，不保存本机路径、token、cache 或临时目录。
- `codeFactProvider.type` 可为 `none`、`codegraph`、`repo-scan`。
- `codeFactProvider.status` 可为 `not-configured`、`configured`、`unavailable`。
- provider 选择不写入 managed prompt block。
- managed prompt block 只保存 agent 行为引导。
- `AGENTS.md` 和 `CLAUDE.md` 的 Yog managed block 生成完全相同内容，确保 Codex 与 Claude Code 读取到一致行为规则。
- Yog managed block 不写具体脚本路径、脚本命令或 stdin JSON 协议；这些实现细节只写在 Yog skill 中。
- 缺少 provider 不影响初始化、创建、索引、同步、验证和检查脚本。
- provider 声明不可用时，`lint` 只返回 P2 warning，不阻断核心脚本。

## 9.1 Frontmatter 语法子集

首版不依赖完整 YAML 解析器。Yog frontmatter 只支持以下简单 YAML 子集：

- 顶层 `key: value`。
- 字符串、布尔值、空数组 `[]`。
- 单行数组 `[a, b, c]`。
- 缩进列表。

不支持：

- 嵌套对象。
- YAML 锚点、别名、tag。
- 多行 block scalar。
- 复杂类型隐式转换。

`lint` 遇到无法解析或超出子集的 frontmatter 时必须报告问题；可能影响 agent 路由权威性的情况按 P1 处理。

## 9.2 仓库根目录定位

Yog scripts 必须先定位目标仓库根目录，再读写 `docs/knowledge`。

定位规则：

1. stdin JSON 提供 `repoRoot` 时优先使用。
2. 否则从 `process.cwd()` 向上查找 `.yog/config.json` 或 `.git`。
3. 两者都找不到时，脚本无法确定目标仓库，返回退出码 `2`，stdout 输出合法 JSON 并说明需要通过 stdin 传入 `repoRoot` 或在目标仓库内运行。
4. `knowledgeRoot` 优先从 `.yog/config.json` 读取，没有配置时默认 `docs/knowledge`。
5. 所有写路径 resolve 后必须仍在 `repoRoot` 内。
6. 插件安装目录只读使用，不能作为目标仓库默认值。

## 10. Agent 路由行为

Yog 不要求用户手动执行路由工具。用户以自然语言和 agent 对话，agent 由 managed block 与 Yog skill 引导执行以下流程：

1. 读取 `docs/knowledge/index.json`。
2. 如需要人工可读导航，再读取 `docs/knowledge/INDEX.md` 和 `docs/knowledge/CONTEXT-MAP.md`。
3. 根据全局轻量索引匹配 context 或 ADR。
4. 命中 context 时，先读取对应 `contexts/<context-id>/index.json`。
5. 全局 context entry 的 `indexPath` 缺失或指向不存在的 context index 时，该 context 不可用于 `match-scope`，不得降级为只返回 context。
6. 全局 context entry 的 `readmePath` 缺失、指向不存在的 context README、README 为空或仍是空壳模板时，该 context 不可用于 `match-scope`，不得降级为只返回 context。
7. 全局 context entry 的 `path` 缺失、指向不存在的 `CONTEXT.md`、`CONTEXT.md` 为空或仍是空壳模板时，该 context 不可用于 `match-scope`，不得降级为只返回 context。
8. context index 顶层 `context` 与路径中的 context id 不一致，或 entries 的 `context` 与顶层 `context` 不一致时，该 context 不可用于 `match-scope`。
9. context index 中 capability/evidence entry 的 `path` 指向其他 context 目录时，该 context 不可用于 `match-scope`；`adr-link` 只能指向全局 ADR。
10. 从 context index 定位 source Markdown，再读取 capability、evidence 或相关 ADR。
11. 命中全局 ADR 时，可以直接读取对应 source Markdown，不强制经过 context index。
12. 优先读取 `verified` capability 和 `accepted` ADR。
13. 需要实现事实时读取 linked evidence。
14. 只命中 `needs-review` 时，必须说明业务边界尚未确认。
15. 做当前代码事实判断前，使用 CodeGraph、仓库扫描或测试验证。调用链和符号证据优先使用 CodeGraph。
16. 如代码事实与知识库冲突，以当前代码事实处理当前任务，并建议将相关知识文档标记为 `stale` 或 `needs-review`。

读取分支：

- `global adr -> ADR Markdown`
- `global context -> context index -> source Markdown`

Managed block 只表达上述跨 agent 行为规则，不表达插件内部 scripts 的调用方式。

`match-scope` 只用于稳定化候选排序。它先读取全局 `index.json`，按全局索引排序规则返回 context / ADR 候选：context 仅按 `path`、`context`、`keywords`、`name` 和 `summary` 排序，不使用 `status`；ADR 可按 `statusRank`、`path`、`keywords`、`name` 和 `summary` 排序。命中 context 后再读取 context index 匹配 capability / evidence。`match-scope` 默认不读取 `candidates/*.md`，也不返回 candidate 候选。全局 context entry 的 `path`、`readmePath` 或 `indexPath` 缺失，任一字段指向不存在的 context 文件，`CONTEXT.md` 或 README 为空或仍是空壳模板，context index 顶层 `context` 与路径不一致、entries 的 `context` 与顶层 `context` 不一致，或 capability/evidence entry 的 `path` 指向其他 context 目录时，`match-scope` 必须将该 context 视为不可用候选，不得降级返回半坏 context。业务语义判断和边界确认仍由 agent 与用户完成。

指导文件职责：

- 根 `AGENTS.md` 和 `CLAUDE.md` 的 Yog managed block 是短入口提示，只写路由和权威性原则。
- `docs/knowledge/AGENTS.md` 是知识库维护细则，写目录内文档边界、确认规则和禁止事项。
- Yog skill 是插件执行说明，写脚本调用、stdin JSON、输出解析和场景流程。

## 11. Candidate 升级为 Context

Yog 可以在用户确认后把 candidate 升级为正式 context。升级不能只创建空 context shell，必须同时创建至少一个真实 capability 和至少一个真实 evidence。

可触发升级建议的信号：

- 用户明确要求复核或升级某个已有 candidate。
- 用户明确要求创建 candidate，且现有 `candidates/*.md` 中可能已有相同或高度重叠的候选。
- 同一 candidate 被多次补充，出现稳定业务语言。
- candidate 下已有至少一个明确 capability 候选。
- candidate 有归档 PRD、人工说明或 evidence 支撑。
- 用户明确表达这是业务域、上下文或能力边界。

升级必须阻塞确认以下字段：

- `context_id`
- `name`
- `summary`
- `responsibilities`
- `non_responsibilities`
- 至少一个 capability 的 `capabilityId`、`name`、`summary`、`responsibilities`、`nonResponsibilities`、真实 `body`
- 每个 capability 至少一个 evidence 的 `evidenceKind`、`name`、`summary`、`source`、`generator`、`generation_evidence`、真实 `body`

大型仓库中，Yog skill 可 spawn subagent 并行加速：

- 业务边界 agent：复核 PRD、OpenSpec、candidate notes、业务术语和非职责。
- CodeGraph agent：定位符号、入口文件和代码归属边界，并核验 routes、services、mappers、call paths 和代码事实。

升级动作：

- 创建 `contexts/<context-id>/CONTEXT.md`。
- 创建 `contexts/<context-id>/README.md`。
- 创建 `contexts/<context-id>/capabilities/<capability-id>.md`。
- 创建 `contexts/<context-id>/evidence/<capability-id>-<evidence-kind>.md`。
- 更新 `CONTEXT-MAP.md`。
- 删除已升级的 candidate。
- 写入 `docs/knowledge/changes/<change-id>.md` 记录 candidate、context、capability 和 evidence 路径。
- 重建 `INDEX.md` 和 `index.json`。

若用户只确认继续补充，则保持 candidate 为 `needs-review`。

首版实现边界：

- 提供 `promote-candidate` 脚本。
- `promote-candidate` 缺少 capability 或 evidence 时必须失败，不写入 context，也不删除 candidate。
- `promote-candidate` 输出必须包含 `contextPath`、`capabilityPaths`、`evidencePaths`、`changePath`、`docsCount` 和 `candidateRemoved`。
- `docsCount: 0` 视为升级失败。
- candidate 创建、复核、补充或升级时，可以扫描 `candidates/*.md` 做去重；去重只影响候选处理建议，不改变默认 `match-scope` 行为。
- 命中疑似重复 candidate 时，不自动合并候选；Yog skill 必须展示重复候选的 `path`、`name`、`status` 和命中字段，让用户选择更新已有 candidate 或创建独立候选。
- 修改后必须运行 `sync` 和 `verify`。

## 12. Evidence 切面

首版只定义 schema 和模板，不实现真实抽取。

`evidence-kind` 表示证据切面，不表示生成方式。CodeGraph、`rg`、AST 扫描、人工整理等生成方式写入 `source`、`generator` 和 `generation_evidence`，不得作为 `evidence-kind`。

支持的 evidence-kind：

- `routes`：HTTP、前端、CLI、RPC 或类似入口面。
- `call-flow`：从入口到核心实现的调用链、模块协作或关键执行路径。
- `data`：表、实体、消息、配置、状态字段。
- `prd`：归档需求的最终结论和长期约束。
- `tests`：测试用例、验证记录和质量门禁证据。
- `ui`：前端入口、页面、交互和可视状态证据。
- `ops`：部署、配置、任务、运行时和运维相关证据。

延后支持：

- RAG 摘要。
- 运行时日志。
- UI 截图。
- 外部契约同步。
- 完整业务流程图。

## 13. 维护机制

Yog 的维护边界是：自动化可以发现影响、生成报告、刷新代码事实 evidence、建议标记 `stale` 或 `needs-review`，但不能自动改写业务边界、术语、设计意图或 capability 置信度。

### 13.1 变更影响报告

首版定义 `change.md` 模板和影响匹配规则，但不安装真实 git hook。

报告路径：

```text
docs/knowledge/changes/<timestamp>-change.md
```

报告应包含：

- 改动路径、符号、接口、表、消息或配置。
- 可能受影响的 capability、evidence 和 ADR。
- 是否建议刷新 evidence。
- 是否建议人工确认 `stale` 或 `needs-review`。

报告不能：

- 进入默认 agent 路由索引。
- 自动修改 capability 正文。
- 自动修改 capability 或 evidence frontmatter。

### 13.2 审计报告

首版定义 `audit.md` 模板，但不接入定时流水线。

报告路径：

```text
docs/knowledge/audits/YYYY-MM-DD.md
```

审计适合发现：

- stale 文档。
- evidence 过期。
- index 过期。
- candidate 长期未处理。
- context 边界可能需要拆分或合并。

### 13.3 归档 PRD 触发

归档 PRD、OpenSpec 或 requirement archive 是提升 capability 置信度的重要来源。

规则：

- 只抽取最终稳定业务结论。
- 不复制任务拆分、日报、一次性测试日志或完整 PRD 正文。
- 重要方案取舍满足 ADR 条件时才新建 ADR。
- capability 提升为 `verified` 前必须有 `confirmation_sources`。

## 14. 实现边界

首版交付知识库协议、Yog skill 和内部 Node ESM scripts，不做公开 CLI、MCP server 或真实代码事实采集。
首版重点是生成、读取和审核闭环：生成知识库骨架与源文档，读取两级索引并定位 source Markdown，审核索引一致性、文档质量和低置信度候选风险。语义聚类、自动合并候选、LLM/embedding 去重和真实 evidence refresh 均不进入首版。

必须实现：

- 核心 schema 与模板。
- 零第三方运行时 npm 依赖的脚本执行层。
- 最小 `package.json`，只提供项目元信息和测试脚本，不声明运行时 dependencies。
- Node.js 版本要求为 `>=20`。
- 单一 Yog skill。
- `init` 脚本。
- `create-candidate` 脚本。
- `create-context` 脚本。
- `promote-candidate` 脚本。
- `create-capability` 脚本。
- `create-evidence` 脚本。
- `match-scope` 脚本。
- `build-index` 与 `check-index` 脚本。
- managed block 写入和幂等替换。
- `.yog/config.json`。
- `sync` 脚本。
- `verify` 脚本。
- `lint` 脚本。
- change/audit 模板与影响匹配规则。

可以只提供占位行为：

- evidence refresh。
- PRD 自动抽取。
- provider adapter。

## 15. 推荐模块布局

```text
skills/yog/
  SKILL.md
  scripts/
    init.mjs
    create-candidate.mjs
    create-context.mjs
    create-capability.mjs
    create-evidence.mjs
    build-index.mjs
    check-index.mjs
    lint.mjs
    verify.mjs
    sync.mjs
    match-scope.mjs
  lib/
    config.mjs
    frontmatter.mjs
    knowledge-root.mjs
    scaffold.mjs
    index.mjs
    lint.mjs
    managed-block.mjs
    router.mjs
    evidence.mjs
    prd.mjs
```

模块职责：

- `SKILL.md`：首版唯一 Yog skill，负责 agent 工作流、用户确认边界和脚本调用规则。
- `scripts/`：Codex skill 可调用的确定性执行入口。
- `config.mjs`：项目配置读写。
- `frontmatter.mjs`：文档类型、状态值、frontmatter 解析和校验。
- `scaffold.mjs`：从插件模板拷贝骨架，以及 candidate、context、capability、evidence 创建。
- `index.mjs`：索引生成和只读检查。
- `router.mjs`：基于 entries 的匹配和排序。
- `lint.mjs`：lint、verify、问题分级。
- `managed-block.mjs`：`AGENTS.md` 和 `CLAUDE.md` managed block 幂等更新。
- `evidence.mjs`：evidence provider 接口与占位实现。
- `prd.mjs`：归档 PRD 抽取 checklist 和占位实现。

## 16. 验收标准

### 16.1 初始化

- 临时项目由 Yog skill 调用 `init` 脚本后得到完整 `docs/knowledge` 骨架。
- `init` 直接使用插件内 `templates/knowledge` 作为骨架来源。
- `init` 不创建空业务知识项。
- `init` 不创建示例 ADR，避免污染索引。
- `init` 后初始 `index.json.entries` 必须为空。
- `init` 为 `changes/`、`audits/`、`contexts/`、`candidates/`、`adr/` 创建目录说明 `README.md`。
- 目录 `README.md` 已存在时，`init` 跳过并返回 warning，不覆盖团队编辑内容。
- 重复执行 `init` 脚本幂等。
- `init` 脚本默认不覆盖已有用户文件。
- `init` 遇到已有模板文件时跳过并返回 warning。
- 未初始化 CodeGraph 时，`init` 脚本仍可成功。
- `.yog/config.json` 只包含非敏感配置。
- `AGENTS.md` 和 `CLAUDE.md` managed block 指向 `docs/knowledge` 工作流。
- `AGENTS.md` 和 `CLAUDE.md` 中的 Yog managed block 内容完全一致。

### 16.2 文档创建

- `create-candidate` 创建 `status: needs-review` 文档。
- `create-candidate` 输入缺少非空 `name`、`summary` 或真实正文内容时必须失败，不得写入空壳 candidate。
- `create-candidate` 写入前允许在显式 candidate workflow 中扫描 `candidates/*.md` 做确定性去重。
- `create-candidate` 命中疑似重复候选时返回退出码 `3`，不写文件，并输出重复候选列表供 Yog skill 继续确认。
- Yog skill 创建文档前首先询问业务范围。
- 创建脚本缺少已确认 ID 时必须失败，不得静默生成长期路径。
- `create-capability` 输入缺少非空 `name`、`summary`、`responsibilities`、`nonResponsibilities` 或真实业务流程/边界说明时必须失败，不得写入空壳 capability。
- `create-capability` 收到不符合 `[a-z][a-z0-9-]*` 的 `capabilityId` 时必须失败。
- `create-evidence` 必须使用 `<capability-id>-<evidence-kind>.md` 文件名；`capabilityId` 与 `evidenceKind` 不合法时必须失败。
- `create-evidence` 的 `evidenceKind` 必须是 `routes`、`call-flow`、`data`、`prd`、`tests`、`ui`、`ops` 之一。
- `create-evidence` 输入缺少非空 `name`、`summary`、真实事实摘要、`source`、`generator` 或 `generation_evidence` 时必须失败，不得写入空壳 evidence。
- `create-evidence` 在 context 或 capability 不存在时必须失败。
- `create-context` 要求确认业务边界字段。
- `create-capability` 只能在已有 context 下创建 `status: draft` 文档。
- context 不存在时，`create-capability` 失败。
- capability 创建不会隐式创建正式 context。

### 16.3 索引

- 全局索引 entries 只包含 context、ADR。
- candidate 文档不进入默认路由索引，不进入全局 `INDEX.md` 或 `index.json`。
- context 局部索引 entries 只包含 capability、evidence、adr-link。
- context 局部索引 entries 必须平铺，不按 capability 嵌套 evidence。
- context 局部索引顶层字段固定为 `schemaVersion`、`kind`、`context`、`generated_at` 和 `entries`；不得包含顶层 `stats`、`capabilityCount` 或 `evidenceCountTotal`。
- change、audit、template、README、AGENTS、context `CONTEXT.md` 和 context `README.md` 不进入默认 `entries[]`。
- `context` 字段可从路径或 frontmatter 派生。
- 所有索引路径字段使用目标仓库根相对路径，不使用 context index 文件所在目录相对路径。
- 全局 entries 先按 `context`、`adr` 分桶排序；context 桶内按 `path` 稳定排序，ADR 桶内按 `statusRank` 和 `path` 稳定排序。
- context 局部索引 entries 先按 `capability`、`evidence`、`adr-link` 分桶，再按 `statusRank` 和稳定路径排序。
- 全局 context entry 的 `docsCount` 必须等于对应 context 局部索引中可计数 entry 数量。
- 全局 context entry 的 `path`、`readmePath` 和 `indexPath` 必须固定到同一 context 目录，分别为 `docs/knowledge/contexts/<context-id>/CONTEXT.md`、`docs/knowledge/contexts/<context-id>/README.md` 和 `docs/knowledge/contexts/<context-id>/index.json`；不一致时按 P1 处理，`match-scope` 不得返回该 context，`build-index`、`check-index` 和 `lint` 必须返回非 0。
- `build-index` 生成全局 context entry 时，必须把 `CONTEXT-MAP.md` 中相对 `docs/knowledge/` 的 `Path` 转为目标仓库根相对路径；不得把 `contexts/<context-id>/CONTEXT.md` 原样写入全局 index。
- 全局 context entry 的 `path` 必须存在且指向可读取、包含真实业务语言内容的 context `CONTEXT.md`；缺失、目标不存在、文件为空或仍是空壳模板时，`match-scope` 不得返回该 context，`build-index`、`check-index` 和 `lint` 必须返回非 0。
- 全局 context entry 的 `readmePath` 必须存在且指向可读取、包含真实概览内容的 context README；README 至少包含标题和用途/概览说明，缺失、目标不存在、文件为空或仍是空壳模板时，`match-scope` 不得返回该 context，`build-index`、`check-index` 和 `lint` 必须返回非 0。
- capability、evidence 和 ADR source Markdown 如果为空、仍是空壳模板或仍包含 `{...}` 占位符，按 P1 处理，不得进入 global index 或 context index，`build-index`、`check-index` 和 `lint` 必须返回非 0。candidate source Markdown 如果为空、仍是空壳模板或仍包含 `{...}` 占位符，按 P1 处理，并且仍不得进入 global index、context index 或 `INDEX.md`。
- 空壳模板判定：文件去除空白、frontmatter、Markdown 标题、空章节标题、模板占位符和说明性骨架后没有真实内容，或仍包含 `{...}` 形式的模板占位符时，按 P1 处理并返回非 0。
- `{...}` 形式的模板占位符一律按 P1 处理；常见占位文本 `TODO`、`TBD`、`待补充`、`待确认` 只允许出现在 `未确认问题` / `Open Questions` 章节。
- `TODO`、`TBD`、`待补充`、`待确认` 不得出现在索引字段或核心正文中；索引字段包括 `name`、`summary`、`keywords`、`status`、`context`、`capability`、`evidence_kind`、`related_contexts`、`possible_contexts` 和 `confirmation_sources`，发现时按 P1 处理并返回非 0。
- `TODO`、`TBD`、`待补充`、`待确认` 出现在 `未确认问题` / `Open Questions` 章节时不阻断 `draft`、`needs-review`、`stale` 或 `deprecated` 文档进入索引；但 `verified` 文档和 `accepted` ADR 不得保留这类未确认占位文本，发现时按 P1 处理并返回非 0。
- 全局 context entry 的 `indexPath` 必须存在且指向可读取的 context 局部索引；缺失或目标不存在时，`match-scope` 不得返回该 context，`build-index`、`check-index` 和 `lint` 必须返回非 0。
- context 局部索引顶层 `context` 必须等于其文件路径中的 context id，且所有 entries 的 `context` 必须等于顶层 `context`；不一致时，`match-scope` 不得返回该 context，`build-index`、`check-index` 和 `lint` 必须返回非 0。
- context 局部索引中 `capability` 和 `evidence` entry 的 `path` 必须位于同一 context 目录；指向其他 context 目录时按 P1 处理，`match-scope` 不得返回该 context，`build-index`、`check-index` 和 `lint` 必须返回非 0。
- context 局部索引中 `adr-link` entry 的 `path` 必须指向全局 `docs/knowledge/adr/*.md`，不得指向 context 内部文件或其他目录。
- 全局 context entry 的 `docsCount` 必须等于 `capabilityCount + evidenceCountTotal`；`adr-link`、`CONTEXT.md`、context `README.md`、目录 README、模板和生成索引文件不计入。
- 全局 context entry 不得包含 `capabilityCount` 或 `evidenceCountTotal`。
- 全局 context entry 的 `keywords` 必须与对应 context index 中 capability entry 的关键词派生结果一致。
- `adr-link` 必须来自 ADR frontmatter 的显式 `related_contexts`，且不计入 `docsCount`。
- ADR frontmatter 的 `related_contexts` 必须是 context id 列表，不能是 context 路径。
- ADR frontmatter 的 `related_contexts: []` 合法；此时全局 ADR entry 仍生成，但不生成 context `adr-link`。
- ADR frontmatter 的 `related_contexts` 不得包含重复 context id；创建或更新时必须去重。
- `build-index` 从重复 `related_contexts` 生成 context `adr-link` 前必须去重，避免同一 ADR 在同一 context index 中出现重复 `adr-link`。
- `build-index` 发现 `CONTEXT-MAP.md` 中的 context 条目缺少对应 `contexts/<context-id>/CONTEXT.md`，或该 `CONTEXT.md` 为空或仍是空壳模板时必须返回非 0，避免生成指向无效文件的全局 context entry。
- `build-index` 发现 `CONTEXT-MAP.md` context 条目格式无效，或缺少非空 `name`、`summary`、`Path` 时必须返回非 0。
- `build-index` 发现 `related_contexts` 引用不存在的 context id 时必须返回非 0，并明确输出缺失的 context id。
- `build-index` 不使用 `CONTEXT-MAP.md` relationships 生成索引；relationships 的结构问题由 `lint` 负责发现。
- `CONTEXT-MAP.md` relationships 首版只支持单向边 bullet 格式 `- source -> target: summary`；双向关系必须写成两条单向边。
- `CONTEXT-MAP.md` relationships 的 `summary` 必须非空，用于说明关系语义。
- `CONTEXT-MAP.md` relationships 不允许自环；`source` 和 `target` 不能相同。context 内部关系应写入该 context 的 `README.md` 或 capability。
- `CONTEXT-MAP.md` relationships 不允许重复边；同一 `source -> target` 只能出现一次。多个语义应合并到同一条 `summary`。
- `CONTEXT-MAP.md` relationships 的结构解析范围只包含 `## Relationships` 章节下的 bullet 行，格式为 `- source -> target: summary`；章节说明文字和其他正文不参与结构校验。
- `adr-link.path` 必须能在全局 ADR entry 中找到同路径 entry。
- 同一 ADR 的全局 entry 与所有 `adr-link` 必须使用相同 `path`。
- `lint` 必须校验 ADR `related_contexts` 中的非空 context id 指向正式 context。
- `lint` 必须校验 `CONTEXT-MAP.md` 的 `## Contexts` 只使用 `- context-id: Context Name - one sentence summary` 顶层 bullet 格式。
- `lint` 必须校验所有 context id 符合 `[a-z][a-z0-9-]*`；不允许大写、下划线、空格、斜杠或路径片段。
- `lint` 必须校验所有 capability id 符合 `[a-z][a-z0-9-]*`；不允许大写、下划线、空格、斜杠或路径片段。
- `lint` 必须校验 capability frontmatter 的 `capability` 与文件名 `<capability-id>.md` 一致。
- `lint` 必须校验 context index capability entry 的 `evidenceCount` 等于同一 context index 中绑定该 capability 的 evidence entry 数量。
- `lint` 必须校验 context index 顶层不包含 `stats`、`capabilityCount` 或 `evidenceCountTotal`。
- `lint` 必须校验全局 context entry 的 `path`、`readmePath` 和 `indexPath` 固定到同一 context 目录。
- `lint` 必须校验全局 context entry 的 `path` 存在且指向可读取、包含真实业务语言内容且不是空壳模板的 context `CONTEXT.md`。
- `lint` 必须校验全局 context entry 的 `readmePath` 存在且指向可读取、包含标题和用途/概览说明且不是空壳模板的 context README。
- `lint` 必须校验全局 context entry 的 `indexPath` 存在且指向可读取的 context 局部索引。
- `lint` 必须校验 capability、evidence、candidate 和 ADR source Markdown 不是空文件、空壳模板，且不包含 `{...}` 模板占位符。
- `lint` 必须校验 `TODO`、`TBD`、`待补充`、`待确认` 不出现在索引字段或核心正文中；仅允许它们出现在 `未确认问题` / `Open Questions` 章节。
- `lint` 必须校验 `verified` 文档和 `accepted` ADR 的 `未确认问题` / `Open Questions` 章节不包含 `TODO`、`TBD`、`待补充` 或 `待确认`。
- `lint` 必须校验 context index 顶层 `context` 与路径中的 context id 一致，并校验所有 entries 的 `context` 与顶层 `context` 一致。
- `lint` 必须校验 context index 中 `capability` 和 `evidence` entry 的 `path` 位于同一 context 目录，并校验 `adr-link` entry 的 `path` 指向全局 `docs/knowledge/adr/*.md`。
- `lint` 必须校验 `status: verified` 的 capability entry `evidenceCount > 0`，且源 capability Markdown 包含非空 `confirmation_sources`。
- `lint` 必须校验 evidence frontmatter 的 `capability` 符合 `[a-z][a-z0-9-]*`，且指向同一 context 中已存在 capability。
- `lint` 必须校验 evidence 文件名符合 `<capability-id>-<evidence-kind>.md`，且 `evidence-kind` 符合 `[a-z][a-z0-9-]*`。
- `lint` 必须校验 evidence 文件名前缀 `<capability-id>` 等于 evidence frontmatter 的 `capability`。
- `lint` 必须校验 evidence-kind 属于 `routes`、`call-flow`、`data`、`prd`、`tests`、`ui`、`ops` 枚举。
- `lint` 必须校验 evidence frontmatter 的 `evidence_kind` 等于文件名中的 `<evidence-kind>`。
- `lint` 必须校验 context index evidence entry 的 `evidenceKind` 等于源 Markdown frontmatter `evidence_kind`。
- `lint` 必须校验 context index evidence entry 不包含 `source`、`repo_commit`、`generated_at`、`generator` 或 `generation_evidence`。
- `lint` 必须校验 `CONTEXT-MAP.md` context 条目的 `name`、`summary`、`Path`、`Responsibilities`、`Non-responsibilities` 非空。
- `lint` 必须校验 `CONTEXT-MAP.md` context 条目的 `Path` 等于相对 `docs/knowledge/` 的路径 `contexts/<context-id>/CONTEXT.md`，并校验生成后的全局 context entry `path` 等于目标仓库根相对路径 `docs/knowledge/contexts/<context-id>/CONTEXT.md`。
- `lint` 发现 context 目录存在但 `CONTEXT-MAP.md` 缺少对应确认条目时，必须按 P1 标记。
- `lint` 发现 `CONTEXT-MAP.md` 条目缺少对应 `contexts/<context-id>/CONTEXT.md`，或该 `CONTEXT.md` 为空或仍是空壳模板时，必须按 P1 标记并返回非 0。
- `lint` 必须校验 `CONTEXT-MAP.md` relationships 只指向正式 context；指向 candidate、半初始化目录或不存在 id 时按 P1 处理并返回非 0。
- `lint` 必须校验 `CONTEXT-MAP.md` relationships bullet 行符合 `- source -> target: summary` 格式；不支持的格式按 P1 处理并返回非 0。
- `lint` 必须校验 `CONTEXT-MAP.md` relationships 的 `summary` 非空；空 summary 按 P1 处理并返回非 0。
- `lint` 必须校验 `CONTEXT-MAP.md` relationships 不存在自环；`source` 和 `target` 相同时按 P1 处理并返回非 0。
- `lint` 必须校验 `CONTEXT-MAP.md` relationships 不存在重复边；同一 `source -> target` 出现多次按 P1 处理并返回非 0。
- `lint` 发现 `related_contexts` 引用不存在的 context id 时按 P1 处理并返回非 0。
- `lint` 必须校验 ADR `related_contexts` 不包含重复 context id；发现重复项按 P1 处理。
- `lint` 必须校验 `adr-link.status` 与全局 ADR entry 的 `status` 一致。
- `lint` 必须校验 `adr-link` 不包含 `keywords`。
- 全局 `INDEX.md` 标注为生成产物，且只展示全局轻量索引。
- 首版不生成 context-level `INDEX.md`。
- 生成产物过期时，`check-index` 失败。
- 仅全局索引或 context 局部索引的 `generated_at` 不同时，`check-index` 不失败。

### 16.4 门禁

- `verify` 脚本全程只读。
- `sync` 脚本只写生成产物，不改写业务知识源文档。
- `lint` 脚本能发现 candidate 错误使用 `verified`。
- `lint` 脚本能发现 candidate 之间的疑似重复，并按 P2 warning 报告。
- `lint` 脚本能发现不支持或无法解析的 frontmatter。
- `lint` 脚本能发现 `verified` capability 缺少 `confirmation_sources`。
- `lint` 脚本能发现 `verified` evidence 缺少生成确认字段。
- `lint` 脚本发现 P0/P1 时返回非 0。
- `lint` 脚本只有 P2 建议时返回 0。
- `lint` 脚本输出的 `issues[]` 必须按 `P0 -> P1 -> P2`、同级按 `path` 和 `message` 稳定排序。
- provider 未配置只产生 P2 warning，不阻断核心脚本。
- 所有脚本 stdout 输出合法 JSON。
- 脚本参数错误返回退出码 `2`；需要用户确认且未写入时返回退出码 `3`；首版不增加其他退出码。
- scripts 在子目录运行时仍能定位目标仓库根目录。
- scripts 禁止写出目标仓库根目录。

### 16.5 插件与文档

- 首版插件不声明 MCP server，也不要求用户使用公开 CLI。
- 首版只提供一个 Yog skill，不拆分初始化、维护、验证等多个 skill，也不声明用户可见 `commands` 或 `agents` 入口。
- 新项目初始化只创建 `docs/knowledge` 业务知识库结构和必要配置。
- README、技能说明、模板和 managed block 均指向 `docs/knowledge`。

## 17. 风险

- 自动创建 context 会把代码猜测固化成业务边界。
- managed block 不够明确时，agent 可能跳过知识库直接搜代码。
- provider 配置如果成为 `init` 硬依赖，会阻碍团队先从纯业务文档开始；但自动 `discover-candidates` 必须把 CodeGraph 作为硬前置，避免弱扫描污染候选区。
- `verified` 如果太容易赋值，会把未经确认的代码事实变成业务事实。
- 公开命令面过多会增加用户心智负担，削弱 agent-first 的使用体验。
- hook、CI 或定时审计如果自动改写业务结论，会把实现变化误提升为业务设计。

## 18. 后续问题

- 第二阶段是否补充其他代码事实 adapter；自动 `discover-candidates` 首版以 CodeGraph 作为硬前置。
- `prd` evidence 首先只支持本地归档 Markdown，还是同时支持 OpenSpec 结构。
- warning-only knowledge impact hook 是否进入第二阶段首批能力。
- PR/MR 门禁何时从 warning 升级为阻断。
