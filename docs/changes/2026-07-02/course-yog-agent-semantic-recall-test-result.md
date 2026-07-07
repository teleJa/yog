# Course Yog Agent Semantic Recall Test Result

## 背景

本轮修正召回测试口径：Yog 的真实召回主路径不是 `match-scope.mjs`，而是 agent 根据 hook / managed block 提示读取 `docs/knowledge/index.json`、`INDEX.md`、business-flow、`CONTEXT-MAP.md`，再语义选择相关 context/capability/evidence。

`match-scope.mjs` 仅作为 deterministic smoke / diagnostic helper，用于检查索引可读、基础字段非空和最小字面匹配，不作为主召回质量证明。

## 测试环境

- 目标仓库：`/Users/tele/xjjk/sharkcloud/services/course`
- 知识库：`docs/knowledge`
- 当前知识库规模：
  - business-flow: 1
  - contexts: 14
  - capabilities: 14
  - evidence: 14

## 执行方式

启动 3 个只读子代理，要求：

- 不使用 `match-scope.mjs`
- 不先查源码
- 先读 `docs/knowledge/index.json`、`INDEX.md`、`CONTEXT-MAP.md`
- 必要时读取 `business-flows/course-live-operation.md`
- 必要时读取相关 context 的 `index.json`、`CONTEXT.md`、`README.md`、capability 和 evidence
- 输出每条 query 的 top1/top3、选择理由和实际读取过的 Yog 文件

## 测试结果

| 子代理 | 覆盖范围 | 查询数 | agent_recall_top1 | agent_recall_top3 | doc_read_hit |
|---|---:|---:|---:|---:|---:|
| A | 直播运营、互动奖励、播放规则 | 8 | 7/8 | 8/8 | 8/8 |
| B | 营期、课程、客户履约 | 10 | 10/10 | 10/10 | 10/10 |
| C | 客户端、飞书、企微、投流、代理推广 | 10 | 10/10 | 10/10 | 10/10 |

合计：

- agent_recall_top1: 27/28
- agent_recall_top3: 28/28
- doc_read_hit: 28/28

## 主要观察

1. 语义召回表现明显好于 `match-scope` 字面召回。
   子代理能通过 `index.json`、business-flow 和 context 摘要理解跨 context 问题，不依赖中文分词。

2. business-flow 对跨 context 问题有效。
   “直播间配置和互动奖励同时涉及哪些上下文”“获客归因问题是否应该先读 business-flow”“投流、企微、代理三个归因 context 如何区分”等问题，子代理会先选 `course-live-operation` 作为总览，再下钻具体 context。

3. context 边界仍有重叠。
   - `live-room-operations` 与 `live-engagement-rewards` 都涉及抽奖/奖励。
   - `client-link-feishu-cache` 与 `integration-client-configuration` 都涉及客户端配置/飞书账号。
   - `acquisition-plan-attribution` 与 `wework-acquisition-attribution` 都涉及获客/渠道/归因。

4. `CONTEXT-MAP.md` relationships 为空。
   跨 context 区分目前主要靠 business-flow 和 agent 语义判断；后续可以把高频关系沉淀到 Relationships。

5. 当前文档多为 `draft`。
   本轮证明“可召回、可路由”，不等于全部业务事实已人工确认。升级 `verified` 前仍需要逐行代码审阅、测试或人工确认。

## 结论

按真实 Yog 使用路径评估，本轮 course 知识库的 agent 语义召回通过。后续测试计划应以 agent semantic recall 为主指标，`match-scope` 只保留为 deterministic smoke 和问题诊断工具。
