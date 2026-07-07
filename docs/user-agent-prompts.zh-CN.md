# Yog 用户手册

本文档面向 Yog 使用者，说明安装 Yog 后可以如何让 Codex / Claude Code agent 维护当前仓库的 `docs/knowledge` 业务知识库。

Yog 的正常入口是 agent skill。你只需要告诉 agent 要完成什么业务目标；agent 会按 Yog skill 读取指导、调用内部脚本、读写文件、同步索引并验证结果。内部 Node 脚本不是需要你记忆或手动执行的命令集。

## 使用原则

- 让 agent 先确认当前仓库路径，并把它作为 `repoRoot`。
- 默认 `knowledgeRoot` 使用 `docs/knowledge`。
- 让 agent 以 Yog skill 作为入口执行初始化、候选发现、候选提升、业务流创建、索引同步、验证、召回测试和 overlap 校准。
- 内部 Node 脚本是 Yog skill 的确定性执行层；只有脚本级调试、CI 自动化或你明确要求时，agent 才需要展示具体脚本命令。
- 涉及业务问题、方案设计、接口变更、业务规则判断或代码修改前，让 agent 优先读取 `docs/knowledge/index.json`、`INDEX.md`、`business-flows/`、`CONTEXT-MAP.md`，再选择相关 context 下钻。
- 所有写入后都要求 agent 运行 `sync` 或 `verify`，并报告验证结果。
- 不接受 agent 虚构已执行命令、退出码、子代理结果、召回率或验证结论。
- 不要把 `match-scope` 当成主召回入口；Yog 的主召回方式是 agent 自己阅读结构化索引、business-flow、context map 和相关文档。
- 业务边界、context 合并/拆分/改名、candidate promotion 和 overlap 裁决必须由你确认。

## 安装或更新 Yog 插件

当你要求安装、更新或确认 Yog 插件可用时，让 agent 执行以下任务：

1. 先确认你要使用的 agent surface：Codex、Claude Code，或两者都要。
2. 确认本机 Node.js 版本不低于 20。
3. 如果是 Codex：
   - 使用本地 marketplace wrapper 安装 Yog 插件。
   - 如果 Yog 已安装，进入 wrapper 中的 Yog 仓库执行更新。
   - 安装或更新后提示你重启 Codex，使新会话加载 `yog` skill。
   - 重启前后都要尽量验证 `codex plugin list` 中能看到 Yog。
4. 如果是 Claude Code：
   - 确认 Yog 仓库已克隆到本机。
   - 校验 Claude Code 插件 manifest。
   - 如果你使用 Claude Code marketplace，确认 marketplace 能把 Yog 仓库暴露为 `yog` 插件，再安装或更新。
   - 安装或更新后提示你重启 Claude Code，使新会话加载 `yog` skill。
5. 如果当前会话已经能看到 `yog` skill，直接报告可用；不要重复安装。
6. 如果当前会话看不到 `yog` skill，但插件列表显示已安装，说明需要开启新会话或重启 agent。
7. 不要把 Yog 内部 Node 脚本当作插件安装入口；插件安装完成后，后续初始化、discover、review、promote、business-flow、sync、verify 都通过 Yog skill 触发。
8. 完成后报告：
   - 安装或更新的是 Codex、Claude Code，还是两者。
   - Yog 插件来源路径。
   - 是否已验证插件列表。
   - 当前会话是否已加载 `yog` skill。
   - 是否需要你重启或开启新会话。

## 初始化当前仓库

当你要求初始化 Yog，或当前仓库尚未存在可用 Yog 知识库时，让 agent 执行以下任务：

1. 确认当前仓库路径，并把它作为 `repoRoot`。
2. 使用 Yog 初始化当前仓库，创建 `docs/knowledge`、`.yog/config.json`，并更新根 `AGENTS.md` / `CLAUDE.md` 的 Yog managed block。
3. 不覆盖已有 `docs/knowledge/**` 文件；如发现已有文件被跳过，把它作为 P2 提示报告。
4. 初始化后检查 `.yog/config.json`，确认 `knowledgeRoot`、`codeFactProvider` 字段合理。
5. 本轮不执行 `discover-candidates`，除非你明确要求。
6. 报告创建、更新或跳过的文件，以及下一步建议。

## 安装 Prompt Hook

当你要求安装 prompt hook，或要求增强后续 prompt 自动提醒时，让 agent 执行以下任务：

1. 使用 Yog 为当前仓库安装或更新 Claude / Codex 的 `UserPromptSubmit` hook 文件。
2. 不覆盖你已有的无关配置。
3. Claude Code settings 可以自动合并。
4. Codex 全局 `config.toml` 不自动覆盖；如果需要手动启用，只报告具体配置提示。
5. 完成后报告写入或更新的文件。

## 刷新 Yog 指导文本

当 Yog 插件升级后，需要把目标仓库里的 Yog guidance 更新到当前模板时，执行以下任务：

1. 使用 Yog `upgrade-guidance` 刷新当前仓库的 Yog 指导文本。
2. 先 dry-run 报告差异。
3. 如果差异只涉及 Yog guidance 模板，再 apply 更新。
4. 不修改业务知识文档、context、capability、evidence、business-flow。
5. 完成后运行 `verify` 并报告结果。

## 自动发现候选 Context

当你要求发现候选 context 时，让 agent 执行以下任务：

1. 先确认 `docs/knowledge` 已初始化。
2. 先确认 CodeGraph 已初始化并能查询当前仓库。
3. 如果 CodeGraph 不可用，停止并提示先初始化 CodeGraph；不要退化成只用文件名、目录名或 `rg` 猜业务边界。
5. 使用 3 个只读 subagent：
   - `controller-route-agent`：扫描 controller、Feign/Dubbo service、HTTP route、client entry。
   - `service-flow-agent`：扫描 service 调用链、核心业务服务、跨服务依赖。
   - `data-contract-agent`：扫描 mapper、entity、DTO、XML、表结构契约、缓存、状态机、消息。
6. 每个 subagent 设置 10-15 分钟 timeout。
7. subagent 只能输出候选建议，不能写 `docs/knowledge`。
8. 每个候选必须包含 `candidateId`、`name`、`summary`、`business_boundary`、`responsibilities_hint`、`non_responsibilities_hint`、`evidence_paths`、`code_symbols`、`keywords`、`possible_contexts`、`confidence`、`confidence_reason`、`skip_reason`。
9. `code_symbols` 必须是 `Class#method`、`Class`、`MapperClass#statementId`、`InterfaceClass#method` 这类 canonical form。
10. docs、PRD、OpenSpec、README 只能用于 promote/enrich 阶段交叉核实，不能作为 discover 真相源。
11. 将 3 个 subagent 输出交给 `reduce-candidates.mjs`。
12. reduce gate 为 ok 后，再用 `write-candidates.mjs` 写入 `docs/knowledge/candidates`。
13. 如果发现疑似重复，不要自动合并，列出 duplicate decision 等你确认。
14. 完成后运行 `sync` 和 `verify`。
15. 报告原始候选数、JOIN 后候选数、写入候选数、写入路径、rejected / lowConfidence / possibleDuplicates / diskDuplicates、候选是否进入 `index.json` / `INDEX.md`、超时或缺失的 subagent 覆盖。

## Review 候选

当你要求 review 当前候选时，让 agent 执行以下任务：

1. 读取 `docs/knowledge/candidates` 下的候选。
2. 按业务边界、代码证据、可能重复、是否适合提升为 context 进行评审。
3. 不修改文件。
4. 输出建议表，包含 `candidateId`、建议动作、依据、需要你裁决的问题。
5. 建议动作只使用 `promote`、`merge`、`split`、`rename`、`reject`、`needs-more-evidence`。

## 提升候选为正式 Context

当你已经确认某个 candidate 要提升为正式 context 时，让 agent 执行以下任务：

1. 读取 `docs/knowledge/candidates/<candidate-id>.md`。
2. 用 CodeGraph / 源码核实候选里的 `code_symbols` 和 `evidence_paths`。
3. 生成正式 context、README、至少 1 个 capability、至少 1 个 evidence、change record。
4. capability 必须有真实业务能力说明，不写空模板。
5. evidence 必须包含真实代码符号、路径、调用链、数据对象、路由、消息或测试证据。
6. `candidateRemoved` 必须为 `true`。
7. 完成后运行 `sync` 和 `verify`。
8. 报告 `contextPath`、`capabilityPaths`、`evidencePaths`、`changePath`、`docsCount`、`candidateRemoved`。

## 创建 Business Flow 总览

当多个 context 已经能组成一个端到端业务时，执行以下任务：

1. 读取 `docs/knowledge/index.json`、`INDEX.md`、`CONTEXT-MAP.md` 和相关 context。
2. 创建 `docs/knowledge/business-flows/<flow-id>.md`。
3. 内容包括业务范围、总览流程、状态流转、系统协作、前端入口、参与 context、关键能力、推荐阅读顺序、证据入口、待确认项。
4. business-flow 只做总览和阅读顺序，不复制 evidence 细节。
5. 如果发现 context 边界重叠，只记录到待确认项，不自动合并。
6. 完成后运行 `sync` 和 `verify`。

## 同步索引

当 source Markdown 被修改后，执行以下任务：

1. 使用 Yog `sync` 当前仓库知识库。
2. 运行 `build-index` 和 `lint`。
3. 报告 issues。

## 验证知识库

当你要求只读检查或需要确认当前知识库状态时，让 agent 执行以下任务：

1. 使用 Yog `verify` 当前仓库知识库。
2. 只读检查，不写文件。
3. 报告 `check-index` 和 `lint` 结果。
4. 如果失败，说明是索引过期、结构问题、缺文件还是内容质量问题。

## 语义召回测试

当你要求验证 Yog 文档是否能支撑 agent 路由时，让 agent 执行以下任务：

1. 启动不少于 3 个只读子代理，任务彼此独立。
2. 每个子代理设置 5-10 分钟 timeout。
3. 每个子代理必须先读取 `docs/knowledge/index.json`、`INDEX.md`、`business-flow`、`CONTEXT-MAP.md`。
4. 不使用 `match-scope` 作为主召回证据。
5. 不先查源码；只有在引用 Yog 文档后，才允许用 CodeGraph / 源码交叉验证。
6. 每题记录输入问题、top1 business-flow/context/capability/evidence 路径、top3 business-flow/context/capability/evidence 路径、`top1_hit`、`top3_hit`、`routing_hit`、`doc_read_hit`、`answer_citation_hit`、`code_cross_check_hit`、选择理由、发现的弱点或重叠。
7. 输出汇总：`agent_recall_top1`、`agent_recall_top3`、`doc_read_hit`。

## Overlap 校准

当生成多个 context 后，执行以下任务：

1. 读取 `docs/knowledge/index.json`、`INDEX.md`、`CONTEXT-MAP.md`、business-flow 和相关 context。
2. 结合 candidate `possibleDuplicates`、`confirmedDuplicates`、子代理召回结果、business-flow 阅读顺序和 shared terms。
3. 找出疑似重叠 context。
4. 对每组重叠报告 context ids、触发信号、示例问题、受影响 business-flow、可选裁决动作。
5. 可选裁决动作只使用：保持拆分并补 relationship、merge、split、rename、needs-review、补证据。
6. 不自动修改 context 边界。
7. 不自动合并、拆分或改名。
8. 等你裁决后再执行修改。

## 按你的裁决修正边界

当你已经决定 overlap 怎么处理后，让 agent 执行以下任务：

1. 只修改与裁决相关的 `CONTEXT-MAP.md`、`CONTEXT.md`、`README.md`、capability 或 business-flow。
2. 不扩大到无关 context。
3. 修改后运行 `sync` 和 `verify`。
4. 报告修改文件、修改原因和验证结果。

## 默认执行顺序

当你给出“从零建立 Yog 知识库”这类完整目标时，让 agent 按以下顺序推进：

1. 初始化当前仓库。
2. 根据你的要求决定是否安装 prompt hook。
3. 自动发现候选 context。
4. Review 候选并等待你裁决。
5. 按你的裁决提升候选为正式 context。
6. 创建 business-flow 总览。
7. 执行 `sync`。
8. 执行 `verify`。
9. 执行语义召回测试。
10. 执行 overlap 校准。
11. 等待你裁决边界。
12. 按裁决修正边界。
13. 再次执行 `sync` 和 `verify`。
