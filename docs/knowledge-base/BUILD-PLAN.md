# 大型代码仓库业务知识库建设计划

本计划沉淀“如何在大型代码仓库中渐进建立业务知识库”的执行方案。该方案定位是通用型，可迁移到多服务、多应用代码库。

## 目标

建立一套基于 Markdown 的业务知识库，让 agent 和工程师先通过业务上下文理解需求，再用代码工具验证当前实现事实。

知识库要解决的问题：

- 业务术语、业务边界、设计意图不再散落在聊天记录、PRD 和代码猜测里。
- CodeGraph、仓库扫描、测试等工具负责证明“代码现在怎么跑”。
- 业务知识库负责说明“业务能力是什么、边界在哪里、为什么这样组织”。
- 后续 Codex、Claude Code 或其他 agent 可通过统一结构和索引进行检索与路由。

## 范围

本计划覆盖：

- `docs/knowledge/**` 的目录结构。
- 业务上下文、业务能力、证据、ADR、候选区的文档分工。
- frontmatter、状态机和索引机制。
- 从真实需求、归档 PRD、排障和重复问题中渐进沉淀知识。
- agent 维护知识库时的查询、写入、验证和人工确认边界。

本计划不覆盖：

- 一次性全仓业务建模。
- 自动生成完整业务边界。
- 替代 CodeGraph 或其他代码调用图工具。
- 修改业务代码。
- 知识库 plugin 的具体实现设计。

## 核心决策

1. 知识库按业务能力边界组织，不按代码目录或服务模块组织。
2. 一个业务上下文可以跨多个代码目录，一个服务也可以贡献多个业务上下文。
3. `CONTEXT.md` 只写已确认的业务术语，不写 controller、表、接口、MQ、调用链等实现细节。
4. 代码事实进入 `evidence/*.md`，由 CodeGraph、仓库扫描、归档 PRD、测试记录等生成或半自动刷新。
5. 业务能力文档采用固定结构，并用 frontmatter 提供 agent 索引字段。
6. `status` 是文档置信度信号，agent 检索时优先 `verified`。
7. 知识库必须渐进建设，不创建空上下文，不做一次性全量抽取。
8. 业务边界、术语、设计意图、上下文拆分合并必须人工确认。
9. `INDEX.md` 和 `index.json` 是生成型索引，可以随知识库提交，但 Markdown 源文档仍是事实源。
10. 归档 PRD 可触发或补充知识库，但只抽取长期有效的最终业务结论。
11. init 只创建知识库骨架，不自动创建业务 context、capability、evidence 或 candidate。
12. 自动 `discover-candidates` 必须同时具备 Serena 和 CodeGraph；缺任一工具时停止自动候选发现，不退化为只按文件名或 `rg` 猜业务边界。

## 目录结构

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

## 文档类型

### `CONTEXT-MAP.md`

全局业务上下文地图，只列已确认的业务上下文及其关系。候选上下文不能进入正式列表。

正式 context 必须同时满足 `CONTEXT-MAP.md` 有确认条目，且 `contexts/<context-id>/CONTEXT.md` 存在并包含真实业务语言内容。只有目录存在不算正式 context；`lint` 必须标记这种半初始化或残留状态。

`## Contexts` 首版只解析顶层 context bullet，格式为 `- context-id: Context Name - one sentence summary`，并读取其下缩进的 `Path`、`Responsibilities`、`Non-responsibilities` 字段。`context-id` 必须符合 `[a-z][a-z0-9-]*`；`Path` 相对 `docs/knowledge/`，必须等于 `contexts/<context-id>/CONTEXT.md`，所有解析字段都必须非空。

`CONTEXT-MAP.md` 有确认条目但缺少对应 `contexts/<context-id>/CONTEXT.md`，或该 `CONTEXT.md` 为空或仍是空壳模板时，`build-index` 必须失败，避免生成指向无效文件的全局 context entry。

`CONTEXT-MAP.md` relationships 只能指向正式 context，不能指向 candidate、半初始化目录或不存在 id。`build-index` 不使用 relationships 生成索引，但 `lint` 必须按 P1 标记这种结构问题。

relationships 首版只解析 `## Relationships` 章节下的 bullet 行，格式为 `- source -> target: summary`。`summary` 必须非空，用于说明关系语义。如果是双向关系，必须写成两条单向边；不允许自环或重复边，context 内部关系应写入该 context 的 `README.md` 或 capability，多个语义应合并到同一条 `summary`；说明文字不参与结构校验，其他 bullet 格式按 P1 处理。

### `contexts/<context-id>/CONTEXT.md`

业务术语表。只写已确认术语和避免使用的同义词，不写实现细节。

### `contexts/<context-id>/README.md`

业务上下文概览，说明该上下文为什么存在、包含哪些能力、和其他上下文如何协作。

### `capabilities/*.md`

业务能力文档，承载稳定业务知识：

capability id 与 context id 使用同一规则：`[a-z][a-z0-9-]*`。capability 文件名、capability frontmatter、context index entry 和 evidence frontmatter 中的 `capability` 绑定必须一致。

- 一句话定位
- 负责什么
- 不负责什么
- 关键业务对象
- 典型流程
- 上下游关系
- 设计意图 / 架构取舍
- 代码事实入口
- 验证方式
- 未确认问题

### `evidence/*.md`

实现证据文档，承载代码事实：

evidence 不单独建模 evidence id，文件名就是稳定标识。文件名必须符合 `<capability-id>-<evidence-kind>.md`，其中 `evidence-kind` 符合 `[a-z][a-z0-9-]*`；文件名前缀 `<capability-id>` 必须等于 evidence frontmatter 的 `capability`。

`evidence-kind` 表示证据切面，不表示生成方式。首版只允许 `routes`、`call-flow`、`data`、`prd`、`tests`、`ui`、`ops`。CodeGraph、`rg`、AST 扫描、人工整理等生成方式写入 `source`、`generator` 和 `generation_evidence`；frontmatter `evidence_kind` 必须等于文件名中的 `evidence-kind`。

context index 的 evidence entry 必须包含 `evidenceKind`，由 Markdown frontmatter `evidence_kind` 生成，并等于文件名中的 `evidence-kind`。

context index 的 evidence entry 只保留路由和筛选字段：`type`、`context`、`capability`、`evidenceKind`、`name`、`summary`、`status`、`path`、`keywords`。`source`、`repo_commit`、`generated_at`、`generator`、`generation_evidence` 等生成详情只保留在 source Markdown。

context index 的 capability entry 必须包含 `evidenceCount`，统计同一 context index 中绑定该 capability 的 `type: "evidence"` entries 数量；`adr-link` 不参与统计。`evidenceCount: 0` 对非 verified capability 合法；`verified` capability 必须 `evidenceCount > 0`。

全局 context entry 的 `docsCount = capabilityCount + evidenceCountTotal`。`capabilityCount` 统计 context index 中 `type: "capability"` entries，`evidenceCountTotal` 统计 `type: "evidence"` entries；`adr-link`、`CONTEXT.md`、context `README.md`、目录 README、模板和生成索引文件不计入。全局 context entry 只保留 `docsCount`，不额外存储 `capabilityCount` 或 `evidenceCountTotal`。

- 生成方式
- 事实摘要
- 入口路径
- 路由 / 接口
- 调用关系
- 数据 / 消息
- 前端入口
- 限制与疑点

### `candidates/*.md`

候选区用于暂存边界未确认但反复出现的业务词或能力。候选文档不能作为正式业务边界、术语或架构结论。

### `adr/*.md`

只记录难回退、代码看不出来、且存在真实取舍的长期决策。普通设计说明默认写在能力文档。

### `changes/*.md`

变更影响报告，只记录某次代码或文档变化可能影响哪些能力、证据或 ADR。它不是权威业务知识，不进入默认 agent 路由索引。

### `audits/*.md`

知识库健康巡检报告，用于记录 stale 文档、过期 evidence、长期未处理 candidate 等维护问题。它不是权威业务知识，不进入默认 agent 路由索引。

## Frontmatter 与状态

能力文档最小 frontmatter：

```yaml
---
domain: ""
capability: ""
name: ""
summary: ""
owners: []
related_contexts: []
keywords: []
evidence: []
confirmation_sources: []
status: draft
updated_at: ""
---
```

状态含义：

- `verified`：文档类型对应的置信度已确认；evidence 需要记录 `source`、`repo_commit`、`generated_at`、`generator` 和 `generation_evidence`，capability 还需要在 `confirmation_sources` 中记录归档 PRD 最终结论或人工确认业务边界的来源，并且 context index 中 `evidenceCount > 0`。
- `draft`：基于局部工作或部分证据整理的初稿。
- `needs-review`：边界、术语或证据需要人工确认。
- `stale`：已发现和当前代码或新知识冲突；可保留在索引中用于审计和历史追溯，但不能作为权威路由依据。
- `deprecated`：保留历史背景；可保留在索引中用于审计和历史追溯，但不能作为权威路由依据。
- `accepted`：ADR 状态，排序等同 `verified`；capability、evidence、candidate 不使用该状态。

规则：

状态排序优先级固定为 `accepted` / `verified` -> `draft` -> `needs-review` -> `stale` -> `deprecated`。`accepted` 只用于 ADR / `adr-link`，`verified` 只用于 capability / evidence。

- `evidence/*.md` 在记录 `source`、`repo_commit`、`generated_at`、`generator` 和 `generation_evidence` 后，可由 agent 标为 `verified`。
- `capabilities/*.md` 不能仅凭代码事实标为 `verified`，还需要在 `confirmation_sources` 中记录归档 PRD 最终结论或人工确认业务边界的来源。
- `candidates/*.md` 不能使用 `verified`。
- 非 ADR 文档不能使用 `accepted`。
- `CONTEXT.md` 不放状态，只有术语确认后才写入。

## 建设触发

只在真实工作中渐进补充知识库：

- 新需求进入某个业务域。
- 归档 PRD 或完成变更产生可沉淀结论。
- 多次问到同一业务链路。
- 跨模块 bug 暴露边界问题。
- agent 或新人经常误判业务归属。
- 代码事实和既有知识库发生冲突。

不要因为“看起来应该完整”而创建空上下文或空能力。

## 初始化与候选发现

init 只负责创建 `docs/knowledge` 骨架、`.yog/config.json` 和根 managed guidance。它不依赖 Serena 或 CodeGraph，也不写入业务 context、capability、evidence 或 candidate。

init 之后如果要自动发现候选，进入 `discover-candidates` agent workflow。该流程的硬前置是：

- Serena 对当前仓库可用，agent 可以用它做符号导航和代码结构读取。
- CodeGraph 已为当前仓库初始化，且可以回答代码结构、调用关系或符号查询。

缺少任一条件时，停止自动发现，并提示先安装或初始化缺失工具。不要把 `rg`、目录名、Controller/Service 文件名扫描当成自动候选发现的替代方案。

满足前置条件后，agent 可以结合现有业务文档、OpenSpec、Serena 和 CodeGraph 证据自动写入 `needs-review` candidate。candidate 不进入生成索引；正式 context 仍必须经过人工确认或显式升级。

自动发现如果产生超过 10 个候选，先停止写入并要求用户缩小业务范围。疑似重复 candidate 不得覆盖或合并，必须跳过并输出重复项。

每个自动发现 candidate 必须记录发现来源、具体证据引用和 `low` / `medium` 置信度说明。

## 最小建设流程

1. 路由
   查 `docs/knowledge/index.json`、`docs/knowledge/INDEX.md` 和 `docs/knowledge/CONTEXT-MAP.md`，判断是否已有 context 或 capability。只有在明确创建、复核、补充或升级候选时才直接读取 `candidates/*.md`。

2. 归类
   已有 capability 则更新；已有 context 但无 capability 则新增 capability；边界不清则新增或更新 candidate；存在长期硬取舍才写 ADR。

3. 取证
   使用 Serena、CodeGraph、归档 PRD、OpenSpec、测试记录或仓库扫描生成 / 刷新 evidence。自动 candidate discovery 必须同时具备 Serena 和 CodeGraph；`rg` 只能作为人工辅助证据，不能单独驱动自动候选写入。

4. 写入
   `CONTEXT.md` 写确认术语；capability 写长期业务知识；evidence 写代码事实；ADR 写长期取舍。

5. 重建索引
   通过 Yog skill 刷新生成索引；目标仓库不保存 Yog 可执行脚本。

## 从归档 PRD 抽取

抽取进入知识库的内容：

- 最终业务术语
- 最终业务边界
- 最终业务流程
- 上下游关系
- 长期有效约束
- 需要刷新或链接的实现证据
- 仍然有效的未确认问题

不进入知识库的内容：

- 中间任务拆分
- 开发日报
- 一次性测试日志
- 已废弃方案细节
- 完整 PRD 正文
- 交付状态流水

如果归档 PRD 中存在重要争议或方案取舍，只有满足 ADR 条件时才单独沉淀为 ADR。

## Agent 使用流程

agent 接到业务相关任务时：

1. 从请求中抽取业务词、英文标识符、路径、接口、表名、消息名。
2. 优先检索 `index.json`，按 `status` 排序，优先读取 `verified` 文档。
3. 读取命中的 `CONTEXT.md`、capability 文档和相关 ADR。
4. 再用 CodeGraph、仓库扫描和测试验证当前代码事实。
5. 如果代码事实和知识库冲突，以当前代码事实处理任务，并建议将相关知识库文档标记为 `stale` 或 `needs-review`；真正修改 frontmatter 必须经过用户确认或显式 apply 命令。

agent 不能自动改写：

- 业务边界
- 术语定义
- 设计意图
- 上下文拆分 / 合并
- 能力文档的 `verified` 状态
- 文档置信度 frontmatter

## 索引机制

Yog skill 调用插件内脚本，从 Markdown frontmatter 和标题生成：

- `docs/knowledge/INDEX.md`
- `docs/knowledge/index.json`
- `docs/knowledge/contexts/<context-id>/index.json`

Yog 首版采用两级生成索引和三级读取链路：global index -> context index -> source Markdown。第三层是 Markdown 源文档，不是生成索引。

全局 context entry 的 `path`、`readmePath` 和 `indexPath` 必须固定到同一 context 目录，分别为 `docs/knowledge/contexts/<context-id>/CONTEXT.md`、`docs/knowledge/contexts/<context-id>/README.md` 和 `docs/knowledge/contexts/<context-id>/index.json`。三者都是读取链路必需字段，必须分别指向存在的 context `CONTEXT.md`、context README 和 context index。`CONTEXT.md` 和 README 不能是空文件或空壳模板，README 至少包含标题和用途/概览说明。缺失、目标不存在、文件为空或仍是空壳模板时，`match-scope` 不得降级返回该 context，`build-index`、`check-index` 和 `lint` 必须失败。

空壳模板判定：文件去除空白、Markdown 标题、空章节标题、骨架说明和占位符后没有真实业务内容，或仍包含 `{...}` 形式的模板占位符时，按 P1 处理并返回非 0。

capability、evidence 和 ADR source Markdown 同样不得为空文件或空壳模板，不得保留 `{...}` 占位符。发现时按 P1 处理，不得进入 global index 或 context index，`build-index`、`check-index` 和 `lint` 必须失败。candidate source Markdown 也不得为空文件或空壳模板，不得保留 `{...}` 占位符；candidate 只服务显式创建、复核、补充或升级流程，始终不进入 global index、context index 或 `INDEX.md`。

`{...}` 形式的模板占位符一律按 P1 处理。`TODO`、`TBD`、`待补充`、`待确认` 只允许出现在 `未确认问题` / `Open Questions` 章节；不得出现在 `name`、`summary`、`keywords`、`status`、`context`、`capability`、`evidence_kind`、`related_contexts`、`possible_contexts`、`confirmation_sources` 等索引字段或核心正文中，发现时按 P1 处理。

`TODO`、`TBD`、`待补充`、`待确认` 出现在 `未确认问题` / `Open Questions` 章节时不阻断 `draft`、`needs-review`、`stale` 或 `deprecated` 文档进入索引；但 `verified` 文档和 `accepted` ADR 不得保留这类未确认占位文本，发现时按 P1 处理。

`CONTEXT-MAP.md` 中的 `Path` 为相对 `docs/knowledge/` 的人工维护路径；生成全局 index 时必须加上 `docs/knowledge/` 前缀，输出目标仓库根相对路径。

全局索引是轻量路由索引，只包含 context 和 ADR，不包含 candidate、capability 或 evidence。

context 局部索引包含该 context 下的 capability、evidence 和 `adr-link`。context 局部索引使用平铺 `entries[]`，不按 capability 嵌套 evidence。context 局部索引顶层字段固定为 `schemaVersion`、`kind`、`context`、`generated_at` 和 `entries`，不得增加顶层 `stats`、`capabilityCount` 或 `evidenceCountTotal`。context 局部索引先按 `capability`、`evidence`、`adr-link` 分桶排序，再在桶内按固定状态优先级和稳定路径排序。

context 局部索引顶层 `context` 必须等于文件路径中的 context id，且所有 entries 的 `context` 必须等于顶层 `context`。不一致时，`match-scope` 不得使用该 context，`build-index`、`check-index` 和 `lint` 必须失败。

context 局部索引中 `capability` 和 `evidence` entry 的 `path` 必须位于同一 context 目录；指向其他 context 目录时按 P1 处理，`match-scope` 不得使用该 context，`build-index`、`check-index` 和 `lint` 必须失败。`adr-link` entry 的 `path` 必须指向全局 `docs/knowledge/adr/*.md`。

全局索引和 context 局部索引顶层都保留 `generated_at`，作为生成产物审计元数据；索引新鲜度检查必须忽略 `generated_at` 差异。

`adr-link` 只由 ADR frontmatter 中显式声明的 `related_contexts` 生成，不从标题、正文或关键词推断。

ADR frontmatter 的 `related_contexts` 填写 `CONTEXT-MAP.md` 中的 context id 列表，例如 `[order]`，不得填写 context 路径。`build-index` / `lint` 通过 `CONTEXT-MAP.md` 和 `contexts/<context-id>/` 校验这些 id 是否存在。

`related_contexts: []` 合法；此时 ADR 仍进入全局 ADR index，但不在任何 context index 中生成 `adr-link`。

写入 `related_contexts` 时必须对 context id 去重。已有文档出现重复 context id 时，`lint` 按 P1 报告；`build-index` 生成 context `adr-link` 前仍需去重，避免生成重复反向链接。

`related_contexts` 引用不存在的 context id 时，`build-index` 和 `lint` 必须失败并明确输出缺失 id，不得跳过或生成部分反向链接。

`related_contexts` 只能引用正式 context。只有 `contexts/<context-id>/` 目录但没有 `CONTEXT-MAP.md` 确认条目的 context 不算存在，`lint` 必须按 P1 标记。

`related_contexts` 指向 `CONTEXT-MAP.md` 中存在但缺少 `CONTEXT.md` 的 context 时，仍按不存在的正式 context 处理。

`adr-link` 只是 context index 中的 ADR 反向链接，不复制全局 ADR entry 的 `keywords`。ADR 关键词检索只走全局 ADR entry。

全局 ADR entry 和 context `adr-link` 使用 `path` 作为机器对齐键；`name` 只作为展示和诊断字段。

所有索引路径字段，包括 `path`、`readmePath` 和 `indexPath`，都使用目标仓库根相对路径，不使用 context index 文件所在目录相对路径。

全局 `INDEX.md` 只镜像全局轻量索引，首版不生成 context-level `INDEX.md`。

全局索引来源：

- `contexts/**/capabilities/*.md`
- `adr/*.md`

`candidates/*.md` 不进入 global index、context index 或 `INDEX.md`，只在显式 candidate 创建、复核、补充或升级流程中直接读取。显式 candidate workflow 只允许按规范化文件名 slug 相等、规范化 `name` 相等、`keywords` 有交集、`possible_contexts` 有交集做确定性去重，去重结果不得写回任何生成索引。规范化只允许执行 trim、转小写、将空白和 `_` 转为 `-`、折叠连续 `-`、去掉首尾 `-`；不得做中文分词、拼音、同义词、翻译或模糊匹配。首版不得使用 LLM、embedding 或语义相似度做 candidate 去重。创建 candidate 时命中疑似重复候选，不得自动覆盖、合并或追加内容；脚本应不写文件并返回疑似重复列表，由 Yog skill 询问用户更新已有 candidate 还是创建独立候选。

`create-candidate` 命中疑似重复候选时，stdout JSON 的 `code` 固定为 `candidate-duplicates-found`，`duplicates[]` 每项必须包含 `path`、`candidateId`、`name`、`status`、`matchedFields[]`。`matchedFields[]` 只能包含 `slug`、`name`、`keywords`、`possible_contexts`，不得输出自然语言相似度解释、LLM 判断或 embedding 分数。

`lint` 可以按同样字段发现 candidate 之间的疑似重复，但只报告 P2 维护提醒，不阻断；真正阻断写入的是 `create-candidate` 命中疑似重复时的用户确认流程。`lint` 的 P2 issue 必须把重复候选放入 `details.duplicates[]`，每项复用 `create-candidate` 的 duplicate item 结构；只有 P2 candidate duplicate issues 时 `lint` 返回退出码 `0`。

`lint` 通用 issue 结构固定为 `severity`、`message`、条件必填 `path`、可选 `details`。`severity` 只能是 `P0`、`P1`、`P2`；文档级问题必须包含目标仓库根相对 `path`，能定位到文件的全局结构问题也必须包含 `path`，例如 `docs/knowledge/CONTEXT-MAP.md`；只有 `docs/knowledge` 不存在这类仓库级问题才允许省略 `path`。`message` 只供人读；Yog skill 必须用 `severity` 判断门禁，用 `details` 读取机器字段，不得解析 `message`。`details` 必须是 JSON-serializable 对象，不得包含大段正文内容或复制源文档内容。`line` 不作为顶层 issue 字段；能稳定定位行号时可放入 `details.line`，首版不强制。`issues[]` 必须按 `P0`、`P1`、`P2` 排序，同级按 `path`、`message` 升序排序；同级缺少 `path` 的仓库级 issue 排在最前。`lint` issue 不要求 `code`。`lint` stdout 必须始终包含 `issues` 数组；无问题时输出 `"issues": []`，不得用空 stdout、`null` 或通用 `ok` 字段表示。

脚本成功或阻断状态由退出码表达，不要求 JSON 中存在通用 `ok` 字段。退出码 `0` 表示已完成或只有 P2；`1` 表示目标仓库状态或门禁阻断；`2` 表示调用方输入错误；`3` 只表示需要用户确认且脚本未写入。首版不增加其他退出码。所有内部脚本 stdout 必须是合法 JSON；人类可读说明放入 `message` 等结构化字段，或由 Yog skill 渲染。stderr 只用于非结构化崩溃或调试输出，正常业务问题和门禁结果不得写入 stderr。

`match-scope` stdout 必须始终包含 `query`、`matches` 和 `issues`。没有确定性命中不是错误，返回退出码 `0`，输出 `"matches": []` 和 `"issues": []`。索引损坏、context index 缺失、路径不可读或读取链路不一致属于目标仓库状态阻断，必须通过 `issues[]` 说明并返回退出码 `1`；输入 JSON 或字段非法返回退出码 `2`。

context 局部索引来源：

- `contexts/<context-id>/capabilities/*.md`
- `contexts/<context-id>/evidence/*.md`

索引是检索入口，不是源文档。修改源文档后必须重跑索引，并提交生成产物。

## 迁移步骤

迁移到其他大型仓库时，复制最小包：

- `docs/knowledge/README.md`
- `docs/knowledge/AGENTS.md`
- `docs/knowledge/CONTEXT-MAP.md`
- `docs/knowledge/templates/*.md`
- `docs/knowledge/adr/README.md`

迁移后通过 Yog skill 刷新生成索引。

再根据目标仓库的第一个真实需求、归档 PRD 或排障场景，渐进创建第一个业务上下文和能力文档。

## 验证方式

每次修改知识库结构、模板或规则后，至少通过 Yog skill 执行 `lint` 和 `sync`。

验收标准：

- Yog skill 的 `lint` 和 `sync` 结果通过。
- `index.json` 可被 JSON parser 正常读取。
- `INDEX.md` 可读，且声明为生成产物。
- 新增或修改的知识库源文档符合 Yog skill 和 `docs/knowledge/AGENTS.md` 的目录级规则。
- 没有把未确认候选写入 `CONTEXT-MAP.md` 正式上下文。
