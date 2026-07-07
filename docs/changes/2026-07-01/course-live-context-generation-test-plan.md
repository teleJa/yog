# Course Live Context Generation Test Plan

## 目标

基于真实仓库 `/Users/tele/xjjk/sharkcloud/services/course` 重新测试 Yog 生成链路，验证当前生成器在真实 CodeGraph 证据下能生成非空骨架的 context、README、capability 和 evidence，并用批判性视角检查文档质量。

## 测试范围

- 测试仓库：`/Users/tele/xjjk/sharkcloud/services/course`
- 测试主题：
  - discover 阶段：`services/course` 真实仓库内多个代码锚定业务上下文候选。
  - promotion 阶段：从 discover 结果中选择 3 个业务边界不同的候选升级；“飞书课程文档入口”只作为 2026-07-02 已完成 promotion 回归样例，不代表 discover 固定只测该主题。
- 生成对象：
  - candidate
  - context
  - README
  - capability
  - routes evidence
  - call-flow evidence
  - data evidence
  - change record
- 不覆盖：
  - 真实飞书开放平台调用
  - Java 自动化测试或 Dubbo 运行时联调
  - 修复旧 context 的历史空章节
  - 提交、推送或清理旧测试产物

## 测试阶段划分

本测试必须区分两个阶段，不能把“手工指定候选并升级”误写成“discover 已完整覆盖”：

1. `discover-candidates` 实测阶段：通过 3 个代码证据 lens subagent 并行扫描真实仓库，产出带 `code_symbols` 锚点的候选清单；再由 `reduce-candidates.mjs` 执行 JOIN、数量门禁、磁盘冲突预检和候选写入决策，验证自动发现能力、召回范围和候选质量。
2. `promote-candidate` 实测阶段：从 discover 结果中选择 3 个候选升级成 context/capability/evidence，验证正式知识文档生成质量和多 context 索引/路由能力。

当前 2026-07-02 已完成的是第 2 阶段中“飞书课程文档入口”的 promotion 链路验证；不能据此断言 discover 只发现了该候选。

## 前置条件

- `/Users/tele/xjjk/sharkcloud/services/course` CodeGraph 已初始化并可查询。
- CodeGraph 可用于精确定位符号、文件和调用链；若 CodeGraph 不可用，必须停止 discover 并记录初始化缺口。
- Yog 当前工作区脚本位于 `/Users/tele/ai-workspace/yog/skills/yog/scripts/`。
- `/Users/tele/xjjk/sharkcloud/services/course/docs/knowledge/templates/` 存在。
- 测试仓库 `/Users/tele/xjjk/sharkcloud/services/course` 允许写入 `docs/knowledge/`。

## 前置操作

Yog 插件当前尚未正式发布，测试仓库 `/Users/tele/xjjk/sharkcloud/services/course` 中可能残留旧版本生成的 `docs/knowledge`。每次执行本测试前，必须先删除旧知识库目录，再用当前工作区脚本重新初始化，避免旧 context、旧 evidence 或旧模板污染本轮 lint/verify 结果。

建议操作：

1. 确认测试仓库路径为 `/Users/tele/xjjk/sharkcloud/services/course`。
2. 删除旧的 `/Users/tele/xjjk/sharkcloud/services/course/docs/knowledge` 目录。
3. 重新执行当前 Yog 脚本的 `init.mjs`，生成最新 `docs/knowledge/templates/`、`.yog/config.json` 和 agent guidance。
4. 再继续执行 candidate discovery / reduce-candidates / create-candidate / promote-candidate / sync / verify。

参考命令：

```bash
cd /Users/tele/xjjk/sharkcloud/services/course
rm -rf docs/knowledge
node /Users/tele/ai-workspace/yog/skills/yog/scripts/init.mjs <<'JSON'
{"repoRoot":"/Users/tele/xjjk/sharkcloud/services/course","knowledgeRoot":"docs/knowledge","payload":{}}
JSON
```

注意：该删除操作只适用于本测试阶段；正式发布后不应要求用户每次删除 `docs/knowledge`，而应通过升级/迁移/repair 机制处理旧产物。

## 测试数据

以下 ID 是 2026-07-02 “飞书课程文档入口” promotion 回归样例。完整 discover 复测不得固定只使用该候选；每个写入 candidate 应使用 `reduce-candidates.mjs` 输出的唯一 ID，避免覆盖历史产物：

- `candidateId`: `feishu-course-document-entry-course-live-20260701`
- `contextId`: `feishu-course-document-entry-course-live-20260701`
- `capabilityId`: `feishu-course-document-link-generation-live`

核心 CodeGraph 查询：

```text
CourseLinkFeignController createCourseLink
ProjectWxWorkRelationWxProgramServiceImpl createFeiShuCourseLink
createFeiShuDocumentUrl
buildFeiShuLinkCacheKey
chooseFeiShuFolderToken
saveFeiShuLinkCache
FeiShuLinkCacheMapper
FeiShuLinkFolderMapper
FeiShuAccountManagementService
createDocumentBlock
updatePermissionPublic
```

## 执行步骤

1. 确认 CodeGraph 状态。
   - 期望：能返回 indexed files/nodes/edges。

2. 使用 CodeGraph 探索真实调用链。
   - 期望：能确认 `CourseLinkFeignController#createCourseLink -> ProjectWxWorkRelationWxProgramService#createFeiShuCourseLink -> ProjectWxWorkRelationWxProgramServiceImpl#createFeiShuCourseLink -> createFeiShuDocumentUrl`。

3. 执行 `upgrade-guidance.mjs`。
   - 期望：测试仓库 guidance 为当前模板；如无变化则 `unchanged`。

4. 使用 subagent 执行 `discover-candidates` 实测。
   - 目标：验证 agent workflow 能否在真实 `services/course` 仓库中自动发现多个候选业务上下文，而不是只验证手工指定的飞书课程链接候选。
   - 编排方式：
     - 主线程负责任务拆分、`reduce-candidates.mjs` 调用、疑似重复确认、写入决策和最终判定。
     - 启动 3 个独立 subagent，分别作为代码证据 lens 扫描同一个仓库，允许并行执行。
     - subagent 只负责只读扫描和候选建议；不能写入 `docs/knowledge/`。
     - 写入 `docs/knowledge/candidates/*.md` 前，必须先把所有 subagent 输出交给 `reduce-candidates.mjs` 做确定性 JOIN、数量门禁和磁盘冲突预检。
   - 子代理超时规则：
     - 每个 subagent prompt 必须写明只读范围、输出格式和期望完成时间。
     - 等待 subagent 返回时必须设置显式 timeout；discover lens 推荐单个等待窗口 10-15 分钟。
     - 若 subagent 超时，记录 `timed_out: true`、agent 角色、等待时长、已返回的部分输出和缺失覆盖；不得把超时结果计为成功扫描，也不得伪造该 lens 的候选。
     - 不得把“关闭旧 subagent”放到关键路径；如果并发名额不足，优先复用已有 idle/completed subagent、降低 fan-out 或由主线程本地完成剩余只读检查。
     - 禁止批量并行关闭多个旧 subagent 作为 discover 前置门禁；关闭操作只能作为非阻塞清理。
   - 建议 subagent 分工：
     - `controller-route-agent`: 扫描 controller、feign、Dubbo service、HTTP route、client entry，提取外部入口型候选。
     - `service-flow-agent`: 使用 CodeGraph 扫描 service 调用链、核心业务服务、跨服务依赖，提取流程型候选。
     - `data-contract-agent`: 扫描 mapper/entity/DTO/XML/表结构契约/缓存/状态机/消息，提取数据粒度和契约型候选。
   - discover 真相源边界：
     - discover 阶段只接受能静态追溯到执行路径的候选，每个候选必须有可归一的 `code_symbols`。
     - `docs/`、OpenSpec、PRD、README、需求设计等文档不作为 discover 候选发现输入；它们只能在 promote / enrich 阶段用于业务边界交叉核实。
     - route、MQ topic、缓存 key、表名、配置 key 可以作为证据正文或 `evidence_paths` 辅助说明，但不能替代 `code_symbols` 参与强 JOIN。
   - 每个 subagent 必须输出结构化候选建议：
     - `candidateId`
     - `name`
     - `summary`
     - `business_boundary`
     - `responsibilities_hint`
     - `non_responsibilities_hint`
     - `evidence_paths`
     - `code_symbols`: 必填，至少 1 项，使用 `Class#method`、`Class`、`MapperClass#statementId`、`InterfaceClass#method` 等 canonical form
     - `keywords`
     - `possible_contexts`
     - `confidence`: `high | medium | low`
     - `confidence_reason`
     - `skip_reason`: 若不建议落 candidate，说明原因
   - 主线程汇总和写入规则：
     - 主线程把 3 个 subagent 的 JSON 输出作为 `reduce-candidates.mjs` 输入，记录脚本退出码和完整 JSON 结果。
     - 自动 JOIN 只认 `code_symbols` 归一后的 `canonicalSymbols` 交集；`candidateId`、`name`、`keywords`、`possible_contexts` 只能进入 `possibleDuplicates` 提示，不能单独触发自动合并。
     - `service-flow-agent` 必须上报入口符号、直接调用的 1-2 层核心服务符号和数据层锚点符号，用于桥接 controller lens 与 data lens。
     - JOIN 后总簇数 `> 10` 时触发 `gate: narrow-scope-required`，停止写入 candidate，要求收窄扫描范围；low 候选也计入该总数。
     - `writable[]` 与 `lowConfidence[]` 都允许写入 candidate；low 只表示 review 优先级较低，不是丢弃门禁。
     - `rejected[]` 不写入；必须记录拒绝原因，尤其是缺少可归一 `code_symbols`、缺少 `name/summary/evidence_paths` 或 `candidateId` 非法。
     - 命中 `diskDuplicate: { matched: true, candidateIds: [...] }` 时，默认不创建新文件；单一冲突优先通过 `updateExisting: true` 更新磁盘已有 candidate，多冲突或疑似非同一对象必须人工确认。
     - 写盘统一调用 `create-candidate.mjs`；不得绕过 `reduce-candidates.mjs` 直接逐个创建候选。
   - discover 实测必须记录：
     - subagent 数量和分工。
     - 每个 subagent 扫描范围。
     - `reduce-candidates.mjs` 的 `raw / afterFormat / clusters / writable / lowConfidence / possibleDuplicates / rejected / diskDuplicates` 统计。
     - 每个写入候选的路径、命中 agent、canonical `code_symbols`、证据来源和归一 confidence。
     - 每个 low 候选是否写入，以及后续 review 处理建议。
     - 未写入候选的 `skip_reason` 或 `rejected[]` 原因。
     - 是否触发 `>10` JOIN 后总簇数收窄门禁。
     - 是否命中磁盘重复，以及最终是更新已有 candidate、人工确认后创建独立 candidate，还是暂缓写入。
     - 候选是否进入 `index.json` / `INDEX.md`；期望是不进入。
     - 每个 subagent 的 timeout 设置、是否超时、是否复用已有 subagent，以及是否存在因超时导致的覆盖缺口。
   - discover 质量抽查：
     - 随机抽查至少 3 个已写入候选，确认 frontmatter 持久化 `code_symbols`，body 中包含真实代码符号、路径或执行结构证据。
     - 人工列出至少 3 个从仓库目录/模块名直观看到的候选基准样本，检查 discover 是否命中。
     - 输出粗略 `recall_sample_hit_rate` 和 `precision_sample_pass_rate`。
   - 期望：
     - discover 不应只产出一个飞书课程链接候选，除非 subagent 明确证明扫描范围被限制到该主题。
     - discover 结果中 candidate 只停留在 `docs/knowledge/candidates/`，不进入正式 context index。
     - discover 结果中的候选均能追溯到真实代码锚点；仅由文档主张支撑、没有 canonical `code_symbols` 的候选必须进入 `rejected[]`。

5. 从 discover 结果中选择 3 个候选并分别执行 `promote-candidate.mjs`。
   - 期望：3 个被选择的 candidate 均来源于第 4 步 discover 结果；如果临时手工指定候选，必须在测试记录中标注“非 discover 产物，仅用于 promotion 链路测试”。
   - 选择策略：
     - 优先选择 `writable[]` 中 high/medium 且业务边界不同的候选，避免 3 个 context 都落在同一条链路。
     - 若需要选择 `lowConfidence[]` 候选，必须记录选择理由和人工 review 结论。
     - 至少覆盖 2 种候选类型，例如入口型、流程型、数据契约型。
     - 若 discover 结果不足 3 个可升级候选，必须记录原因并判定 discover 覆盖不足。
   - 如命中旧候选重复，默认按人工确认结果更新已有候选；只有确认不是同一业务对象或确需独立复测时，才允许使用显式 `confirmDuplicate: true` 创建独立候选。
   - promotion 期望：
     - 每个被升级 candidate 均 `candidateRemoved=true`
     - 每个被升级 candidate 均生成 context/README/capability/evidence/change
     - 每个被升级 context 的 `docsCount >= 4`
     - `docs/knowledge/index.json` / `INDEX.md` 至少收录 3 个正式 context

6. 执行 `sync.mjs`、`verify.mjs`，并可选执行 `match-scope.mjs` deterministic smoke。
   - 期望：
     - `sync/verify` 通过，生成索引与源文档一致
     - 如执行 `match-scope`，只用于检查索引可读、基础字段非空和最小字面匹配；不得把它作为主召回质量证明
     - 全局 `sync/verify` 如失败，需要区分是新产物问题还是旧产物遗留问题

7. 检查新生成文档质量。
   - 3 个新 context 的 `CONTEXT.md` 均必须填充：
     - 业务定位
     - 负责什么
     - 不负责什么
     - 核心业务语言
     - 避免混用
     - 相关上下文
     - 未确认问题
   - 3 个新 context 的 `README.md` 均必须填充：
     - 一句话定位
     - 业务边界
     - 主要能力
     - 上下游关系
     - 相关文档
     - 未确认问题
   - 3 个新 context 的 capability 均必须填充：
     - 关键业务对象
     - 典型流程
     - 上下游关系
     - 设计意图 / 架构取舍
     - 代码事实入口
     - 验证方式
     - 未确认问题
   - evidence 不应出现模板说明残留，不应出现空标题；不适用章节应明确写明“不覆盖/未发现/需补充”。

8. 使用子代理验证文档引用效果。
   - 目标：验证普通 agent 在面对真实业务问题时，是否会通过 Yog guidance 读取 `index.json`、`INDEX.md`、business-flow、`CONTEXT-MAP.md` 后语义选择相关 context，并在回答中真实引用 context/capability/evidence，而不是直接只读源码后绕过知识库。
   - 子代理建议不少于 3 个，任务彼此独立，分别覆盖：
     - 入口定位类问题：例如“课程发送飞书链接的入口在哪里？”
     - 调用链解释类问题：例如“从 Dubbo 入口到飞书 docx 创建经过哪些方法？”
     - 数据粒度类问题：例如“飞书课程文档链接缓存 key 如何区分个人/群链接？”
   - 子代理超时规则：
     - 每个召回子代理 prompt 必须明确：先读 `index.json`、`INDEX.md`、business-flow、`CONTEXT-MAP.md`，不得先查源码，不得用 `match-scope` 作为主召回证据。
     - 等待子代理返回时必须设置显式 timeout；语义召回推荐单个等待窗口 5-10 分钟。
     - 若子代理超时，记录 `timed_out: true`、问题组、等待时长和缺失问题；该组不得计入通过率分子。
     - 若并发名额不足，优先复用已有 idle/completed subagent 并用新任务 interrupt；不要批量关闭旧 subagent 来释放名额。
   - 每个子代理必须记录：
     - 输入问题。
     - 是否先读取根 `AGENTS.md` / `CLAUDE.md` 中的 Yog managed block。
     - 是否读取 `docs/knowledge/index.json`、`INDEX.md`、business-flow 或 `CONTEXT-MAP.md`。
     - agent 语义选择的 top1/top3 business-flow/context/capability/evidence 路径，以及选择理由。
     - 命中的 context/capability/evidence 路径。
     - 回答中实际引用的 Yog 文档路径与代码证据路径。
     - 是否额外读取源码或 CodeGraph，以及读取原因。
   - 观测方式：
     - 优先检查子代理执行记录、命令输出、引用路径和最终回答。
     - 不能只看最终答案是否正确；必须确认答案中至少引用 1 个 Yog context/capability/evidence 路径。
     - 若子代理直接从源码回答但未读取 Yog 文档，应计为“答案正确但 Yog 未命中”。
   - 命中率口径：
     - `agent_recall_top1`: 子代理语义选择的第 1 个 business-flow/context 是否为预期目标。
     - `agent_recall_top3`: 子代理语义选择的前 3 个 business-flow/context 是否包含预期目标。
     - `routing_hit`: 子代理通过 `index.json`、business-flow、`CONTEXT-MAP.md` 或 context index 定位到目标 context/capability/evidence；`match-scope` 命中只能作为辅助 smoke，不计入主 routing_hit。
     - `doc_read_hit`: 子代理实际读取了命中的 Yog Markdown 文档。
     - `answer_citation_hit`: 子代理最终回答中引用了 Yog 文档路径或明确说明依据来自该 context/evidence。
     - `code_cross_check_hit`: 子代理在引用 Yog 文档后，再用 CodeGraph/源码做交叉验证。
     - `timed_out`: 子代理是否超时；超时组不得被当作通过结果。
   - 建议通过阈值：
     - `agent_recall_top1 >= 70%`
     - `agent_recall_top3 >= 85%`
     - `routing_hit >= 80%`
     - `doc_read_hit >= 80%`
     - `answer_citation_hit >= 80%`
     - `code_cross_check_hit >= 50%`
   - 失败判定：
     - 多数子代理绕过 Yog 文档直接查源码，说明 guidance 或路由入口不够强。
     - 子代理能命中 context 但不读取 capability/evidence，说明 context 到证据的引导不足。
     - 子代理读取了文档但答案仍缺少关键业务边界，说明文档内容质量不足。

9. 生成 overlap calibration report，并等待用户裁决。
   - 目标：发现疑似 context 边界重叠，但不由 Yog 自动裁决边界。
   - 触发信号：
     - `name`、`summary`、responsibilities、non-responsibilities、keywords 或 business-flow 阅读顺序中出现共享业务词。
     - `reduce-candidates.mjs` / `write-candidates.mjs` 的 `possibleDuplicates[]`、`confirmedDuplicates[]` 或 duplicate decisions。
     - 子代理语义召回中，同一 query 的 top3 合理命中多个 context。
     - business-flow 中相同 context 高频相邻出现。
     - `CONTEXT-MAP.md` Relationships 为空或缺边，导致 agent 无法区分重叠、上下游或同一业务的不同阶段。
   - 报告内容：
     - 疑似重叠 context ids。
     - 触发信号和证据路径。
     - 代表性用户 query。
     - 受影响的 business-flow 段落。
     - 可选裁决动作：保持拆分并补 relationship、合并 context、改名/改职责、标记 `needs-review` 暂缓、继续补代码/业务证据。
   - 约束：
     - overlap 不是错误，只是校准候选。
     - Yog 只能报告证据和选项；只有用户能裁决 merge/split/rename/relationship/no-op。
     - 用户裁决前，不得自动改 context 边界、合并文档或重写 responsibilities/non-responsibilities。
     - 子代理引用了文档但没有代码证据交叉验证，说明“可信回答”闭环不足。

## 验收标准

- 新生成 context/capability/evidence 均来自 `/Users/tele/xjjk/sharkcloud/services/course` 真实 CodeGraph 和源码证据，而不是 fixture。
- discover 阶段必须通过 3 个代码证据 lens subagent 实测，并通过 `reduce-candidates.mjs` 汇总；记录候选总量、JOIN 结果、写入结果、low 候选、磁盘冲突和跳过/拒绝原因；不能用单个手工候选替代 discover 结论。
- discover 写入的 candidate 不得进入 `index.json` / `INDEX.md`，必须只作为 review/promotion 输入。
- discover 写入或更新的 candidate 必须持久化 canonical `code_symbols`；无可归一 `code_symbols` 的候选不得写入。
- 自动 JOIN 只能由 `code_symbols` 交集触发；`candidateId/name/keywords/possible_contexts` 相似只能记录为 `possibleDuplicates`。
- `lowConfidence[]` 候选仍应写入 candidate 暂存区并进入 review，不得因 low 档位静默丢弃。
- JOIN 后总簇数超过 10 时必须触发收窄门禁，不得分批绕过。
- 若 discover 只发现 1 个候选，必须说明扫描范围、subagent 证据和未发现其它候选的原因；否则判定 discover 覆盖不足。
- 从 discover 结果中选择 3 个候选升级成正式 context，且 3 个被升级 candidate 均从 `docs/knowledge/candidates` 删除。
- 新生成的 3 个 context、README、capability 不存在关键章节空白。
- 新生成的 3 组 evidence 不存在模板残留和空标题。
- `sync/verify` 能证明新生成的 context/capability/evidence 已进入索引且索引一致；`match-scope` 只作为可选 deterministic smoke，不作为主召回验收条件。
- 子代理测试中，至少 3 个独立业务问题完成观测，且 `routing_hit`、`doc_read_hit`、`answer_citation_hit` 均达到 80% 以上。
- 子代理测试必须报告 `agent_recall_top1` / `agent_recall_top3`；召回结论以 agent 读取 `index.json`、business-flow、`CONTEXT-MAP.md` 后的语义选择为准。
- 生成 overlap calibration report；若报告存在疑似重叠，必须等待用户裁决后才能修改 context 边界。
- 子代理最终回答必须能看出 Yog 文档被真实使用；仅回答正确但没有 Yog 文档引用，不算完整通过。
- 全局 lint 失败时，必须明确列出是否由旧产物导致，不能把旧产物问题误判为新生成器失败。
- 测试结果需要记录：
  - 生成路径
  - 执行命令结果
  - discover subagent 分工、原始候选数、JOIN 后总簇数、写入候选数、low 候选数、`possibleDuplicates`、`rejected`、磁盘冲突和跳过候选数
  - discover 抽样召回率和精度评估
  - 3 个新 context 的生成路径和质量评价
  - 子代理问题、命中文档、引用路径和命中率统计
  - 旧产物遗留问题
  - 后续修复建议

## 已知风险

- `/Users/tele/xjjk/sharkcloud/services/course` 已存在旧 Yog 产物，可能导致全局 `sync/verify` 失败。
- 旧 `feishu-course-document-entry` 和 `feishu-course-document-entry-retest-20260701` 仍有空章节，需要单独回填或删除。
- evidence 模板和空章节策略若未升级，可能生成模板说明残留或空标题。
- `service-flow-agent` 如果没有上报入口、核心服务和数据层锚点符号，controller lens 与 data lens 可能无法通过 symbol JOIN 连通，导致同一业务对象碎片化；该情况应放行为多个候选并在 review 中收敛，不能用 name/keyword 强行合并。
- 文档不再作为 discover 真相源，候选命名可能偏技术；业务术语和边界应在 promote / enrich 阶段通过文档和人工知识补齐。
- CodeGraph 是静态证据，不能替代真实飞书开放平台联调。

## 通过/失败判定

- 通过：discover 阶段完成 3 代码 lens fan-out、`reduce-candidates.mjs` 汇总和 candidate 写入/更新门禁，且 3 个从 discover 结果中升级的 context 均满足验收标准；即使全局 lint 因旧产物失败，也可判定新生成链路通过，但需记录旧产物阻塞项。
- 失败：3 个新生成 context 中任意一个 context、README、capability 出现关键章节空白，或新 evidence 出现模板残留/空标题，或子代理未能通过 Yog guidance 读取索引/业务流/context 文档并完成语义路由。

## 2026-07-02 实测记录

### 执行摘要

- 已按前置操作删除 `/Users/tele/xjjk/sharkcloud/services/course/docs/knowledge`，并用当前 Yog 工作区脚本重新执行 `init.mjs`。
- CodeGraph 状态：`978 files / 17845 nodes / 30788 edges`。
- 本轮真实生成 ID：
  - `candidateId`: `feishu-course-document-entry-course-live-20260702`
  - `contextId`: `feishu-course-document-entry-course-live-20260702`
  - `capabilityId`: `feishu-course-document-link-generation-live`
- `promote-candidate.mjs` 返回 `candidateRemoved=true`，候选升级后已从 `docs/knowledge/candidates` 删除。

### 生成产物

- `docs/knowledge/contexts/feishu-course-document-entry-course-live-20260702/CONTEXT.md`
- `docs/knowledge/contexts/feishu-course-document-entry-course-live-20260702/README.md`
- `docs/knowledge/contexts/feishu-course-document-entry-course-live-20260702/capabilities/feishu-course-document-link-generation-live.md`
- `docs/knowledge/contexts/feishu-course-document-entry-course-live-20260702/evidence/feishu-course-document-link-generation-live-routes.md`
- `docs/knowledge/contexts/feishu-course-document-entry-course-live-20260702/evidence/feishu-course-document-link-generation-live-call-flow.md`
- `docs/knowledge/contexts/feishu-course-document-entry-course-live-20260702/evidence/feishu-course-document-link-generation-live-data.md`
- `docs/knowledge/changes/20260702-003748-promote-candidate-feishu-course-document-entry-course-live-20260702.md`

### 验证结果

- `node /Users/tele/ai-workspace/yog/skills/yog/scripts/sync.mjs`: 通过，`issues=[]`。
- `node /Users/tele/ai-workspace/yog/skills/yog/scripts/verify.mjs`: 串行重跑通过，`issues=[]`。
- `node /Users/tele/ai-workspace/yog/skills/yog/scripts/match-scope.mjs`: 作为 deterministic smoke 通过，命中 1 个 capability 和 3 个 evidence；该结果只证明基础索引字段可被字面命中，不证明 agent 语义召回质量。
- `/Users/tele/ai-workspace/yog` 中 `npm test`: 通过，`60/60`。

注意：最初将 `sync`、`verify`、`match-scope` 并行执行时，`verify` 曾报 `Generated indexes are stale`，`match-scope` 曾返回空匹配。串行重跑后均通过，因此该现象归类为测试执行顺序问题：`verify` 和 `match-scope` 不应与会写索引的 `sync` 并行。

### 本轮发现并修复的问题

- `hasTemplatePlaceholder` 过宽，正文中合法示例 `https://{tenantDomain}/docx/{documentId}` 会被误判为模板残留，导致 evidence 被 lint 判定为 `source is an empty shell`。
  - 修复：`skills/yog/lib/markdown.mjs` 改为只识别整行模板占位，例如 `# {Name}`、`- {question}`、`1. {补充审核规则}`。
  - 测试：`test/yog/frontmatter.test.mjs` 增加 URL 示例不误判、TODO/TBD/待补充空壳识别、未确认问题章节允许占位的覆盖。
- `CONTEXT-MAP.md` 中模板关系行 `- {source-context} -> {target-context}: ...` 不应依赖通用 `hasTemplatePlaceholder` 跳过。
  - 修复：`skills/yog/lib/lint.mjs` 在 relationship parser 内局部跳过含 `{...}` 的模板关系示例。

### 文档质量评价

- `CONTEXT.md` 已填充业务定位、负责什么、不负责什么、核心业务语言、避免混用、相关上下文和未确认问题，没有空白章节。
- `README.md` 已填充一句话定位、业务边界、主要能力、上下游关系、相关文档和未确认问题。
- capability 已填充关键业务对象、典型流程、上下游关系、设计意图、代码事实入口、验证方式和未确认问题。
- 三份 evidence 均有事实摘要、入口路径、对应证据类型章节和限制与疑点；非适用章节不再留空标题，而是写明“不覆盖/见其他 evidence”。
- 质量不足：`README.md` 的上下游关系会把 routes、call-flow、data evidence 的调用关系简单拼接，出现重复入口链路；这不阻断本轮验收，但后续可以考虑在生成器中去重或按 evidenceKind 分组。

### 待补充子代理验证

2026-07-02 已完成生成链路和本地脚本验证，但尚未执行“子代理是否真实引用 Yog context/capability/evidence”的命中率测试。下一轮真实测试必须在生成后启动不少于 3 个独立子代理，并按本计划第 8 步记录 `routing_hit`、`doc_read_hit`、`answer_citation_hit`、`code_cross_check_hit`。

### 待补充 discover 实测

2026-07-02 的候选不是完整 `discover-candidates` 阶段产物，而是围绕“飞书课程文档入口”手工收窄后创建并升级的复测候选。下一轮真实测试必须先通过第 4 步 subagent 编排执行 discover：

- 启动 3 个代码证据 lens subagent，分别扫描 controller/route、service-flow、data-contract；不再设置 docs-scan-agent。
- 每个候选必须带 canonical `code_symbols`；仅由 docs/OpenSpec/PRD 主张支撑的候选不得写入。
- 通过 `reduce-candidates.mjs` 汇总原始候选、JOIN 后总簇数、`writable[]`、`lowConfidence[]`、`possibleDuplicates[]`、`rejected[]` 和磁盘冲突。
- 自动 JOIN 只认 `code_symbols` 交集；name/keyword/possible_context 相似只能作为疑似重复提示。
- low 候选仍应写入 candidate 暂存区并进入 review；JOIN 后总簇数超过 10 时必须停止写入并收窄范围。
- 只有当 discover 产物经过 `reduce-candidates.mjs` JOIN 和数量门禁后，才选择其中 3 个候选进入 promotion；如果可升级候选不足 3 个，必须记录原因并判定 discover 覆盖不足。
- 如果仍只产出飞书课程文档入口一个候选，必须提供每个 subagent 的扫描证据和未发现其它候选的原因。

### 结论

本轮基于真实 course 仓库和真实 CodeGraph 证据的 promotion 生成链路通过。生成器当前能在清理旧 `docs/knowledge` 后，针对一个已知真实候选生成非空 context、README、capability 和 evidence，并通过 `sync/verify`；`match-scope` 仅作为 deterministic smoke 观察。严格按最新测试计划看，端到端验收还缺少 discover subagent 实测、子代理按 `index.json` / business-flow / `CONTEXT-MAP.md` 进行语义路由后的真实引用与命中率观测；剩余主要改进项是 README 上下游关系的重复信息压缩、子代理使用 Yog 文档的引导验证、discover 召回/精度验证，以及未来正式发布时用 upgrade/repair 替代测试阶段的删除重建。
