# Yog 工作流上下文加载方案讨论记录

## 背景

Yog 生成的 `docs/knowledge` 文档后续需要接入 agent 工作流。当前探索的问题是：agent 在进入需求分析、方案设计、接口变更或业务规则判断前，如何稳定加载相关业务上下文文档。

参考 Trellis 的做法后，初步判断不要把所有知识库文档直接塞入上下文，而应把“路由”和“全文加载”拆开：

- hook 负责在合适时机提示 agent 应该加载哪些候选上下文；
- skill / agent prelude / workflow step 负责真正读取文档全文并进入设计。

## 目标

- 让 agent 在设计前优先读取与当前用户意图相关的 `docs/knowledge` 文档。
- 避免每轮对话全量注入业务知识库，控制上下文污染和 token 成本。
- 同时兼容 Codex 与 Claude Code，不把方案绑定到单一平台 hook 能力。
- 没有 hook 或 hook 不可用时，仍能通过 managed block 与 Yog skill 正常工作。

## 结论更新（2026-07-01 讨论后）

这一轮讨论修正了早期"初步结论"里的两个关键判断，现以本节为准，下方历史小节保留作为演进记录。

### 1. 这是读写闭环问题，不只是召回问题

早期笔记几乎只讨论消费侧（设计前怎么召回、怎么读）。真正让业务文档"活起来"的另一半是生产侧回写：agent 改完代码后，要回看本次改动是否让相关 evidence / capability 过期，决定更新或标 `stale`。只读不写，知识库会持续腐烂，此时召回越准，注入的陈旧信息危害越大。回写闭环已写入 managed block SOP（见下）。

### 2. 主路径是"agent 自选"，不是脚本召回

早期设想 hook 调用 `match-scope.mjs` 做词法召回、注入 matched paths。讨论后改为 **pure agent 自选**：

- 词法匹配（`match-scope.mjs`）解决的是字面命中；我们要的是语义相关（"退款没到账" → refund，哪怕 slug 是英文）。语义匹配确定性脚本做不到，只有带模型的 agent 能做对。
- hook 是"哑"环境，只能跑脚本、不能推理。因此 hook 不注入匹配结果，只注入**指令 + 路由表指针**："本轮若涉及业务/设计/接口/规则，先读 `CONTEXT-MAP.md`，语义选出相关 context 再读全文。"真正的匹配发生在 agent 上下文里。
- 这比"hook 注入 matches"更健壮：hook 不需要自己算准，分词准不准都不影响结果，选择权和语义判断全在 agent。

**承重产物随之从 tokenizer 变成 `CONTEXT-MAP.md`**：agent 匹配质量的上限由这张"选择菜单"的质量决定，尤其是每个 context 的 summary / responsibilities / non-responsibilities。

### 3. 中文分词降级为"规模大了才做的预筛"

`router.mjs` 的 `query.split(/\s+/)` 对中文切不开（无空格），整句变成一个 term，中文自然语言输入召回率约等于零；且中文 query 无法匹配英文 slug。在 pure agent 方向下，这不再是阻塞项：

- 当前十几个 context 规模，`CONTEXT-MAP.md` 全表几 k token，agent 直接读全表语义自选无压力，不需要脚本预筛。
- 当 context 逼近上百、路由表塞不进上下文时，才需要用确定性脚本做预筛缩小候选集。届时再修中文 tokenization（反向包含：拿 KB 侧策展词去 query 做子串测试）+ 字段加权 + 阈值 + top-N。
- 结论：分词不是废案，是"规模触发"的后续项，当前不做。

## 已落地（2026-07-01）

### Managed Block SOP 重写

`skills/yog/lib/managed-block.mjs` 的路由规则从软性的"读 index.json、匹配就读"改为显式 SOP：

1. 进入需求分析 / 方案设计 / 接口变更 / 业务规则判断前，先读 `{knowledgeRoot}/CONTEXT-MAP.md`（人读菜单，不是机器索引）。
2. 自行按 summary / responsibilities / non-responsibilities 语义选出相关 context，再读全文 CONTEXT.md 及相关 capability / evidence。
3. 无命中时落到 `INDEX.md` 再探索代码。
4. 用 CodeGraph / 仓库扫描 / 测试复核代码事实；调用链和符号证据优先使用 CodeGraph。代码事实与知识冲突时以代码为准并建议标记陈旧知识。
5. **回写闭环**：改动落地后回看依赖的 evidence，若已失真则更新或标 `stale`。
6. discover-candidates 门禁规则保留（需 CodeGraph）。

### 老仓库升级路径打通

`upgradeGuidance`（`scaffold.mjs`）扩展为：除刷新 `docs/knowledge/AGENTS.md` / `README.md` 外，还用 `upsertManagedBlock` 刷新根 `AGENTS.md` / `CLAUDE.md` 里的 managed block（只替换 block，保留其余内容），复用 dry-run（`apply:false` 报 P2）/ apply 语义。这样已跑过旧版 `init` 的老仓库能通过 `upgrade-guidance --apply` 一次性拿到新 SOP 和回写闭环。测试 60/60 通过。

## Hook 设计（下一步，未实现）

hook 是增强路径，不是唯一依赖——managed block SOP 已能独立工作，hook 只是把"先读 CONTEXT-MAP"这个动作提前喂到 agent 眼前。

pure agent 方向下 hook 只注入指令 + 路由表指针，不注入匹配结果：

```xml
<yog-context>
本轮若涉及业务需求、方案设计、接口变更或业务规则判断：
先读 docs/knowledge/CONTEXT-MAP.md，按 responsibilities / non-responsibilities
语义选出相关 context，再读其 CONTEXT.md 及相关 capability / evidence 全文后再动手。
</yog-context>
```

要点：

- 每轮运行、无命中静默；不靠触发词卡入口（触发词是脆弱启发式，"给退款加审批"这类不含触发词但需要召回）。
- 由 `init` 模板统一生成 Codex 与 Claude Code 的 `UserPromptSubmit` 配置，语义一致，避免手维护漂移。
- 没有 hook 或 hook 不可用时，managed block SOP 是最低可用基线。

## 与 Trellis 的差异

Trellis 的 spec 更偏工程约束，通常可以通过任务 JSONL 精确列出本次 implement / check 需要的 spec。

Yog 的文档是业务知识库，匹配粒度更依赖用户意图和业务语义。因此更适合：

- 设计前由 agent 基于当前 prompt 语义自选相关 context；
- 读取全文的判断权留给 agent；
- 只把相关 context / capability / evidence / ADR 加入当前工作上下文。

## 已决策的问题

- **hook 输出模式**：不注入脚本匹配结果，只注入指令 + 路由表指针，agent 自选。
- **运行时机**：每轮运行、无命中静默，不用触发词。成本控制点在输出（阈值/静默），不在要不要运行。
- **Codex vs CC 配置**：由 `init` 模板统一生成，语义一致。
- **任务级 manifest（仿 Trellis implement.jsonl）**：当前不引入。Yog "一个需求读哪些 context"是模糊演进的语义问题，固化清单会变成需人工维护且易过期的负担，属过度工程。
- **多命中处理**：分层——命中多时注入 `CONTEXT-MAP.md` 指针让 agent 裁剪，命中少给 top-N；读全文决策权留给 agent。
- **`CONTEXT-MAP.md` 加 `Typical asks` 字段**：暂不加（会连带改 `parseContexts` 位置敏感解析 + 测试），先只让 SOP 指向现有 responsibilities / non-responsibilities。
- **`upgrade-guidance` 的 `CLAUDE.md` 守卫**：不加守卫。仓库若无 `CLAUDE.md`，直接创建一个含 managed block 的文件（与 `init` 行为一致），无需"只刷新已存在的"逻辑。

## 待继续讨论

- hook 的具体实现：`init` 模板如何生成 Codex 与 CC 的 `UserPromptSubmit` 配置。
- context 规模逼近上百时，中文 tokenization 预筛（反向包含 + 加权 + 阈值 + top-N）的触发时机与实现。
