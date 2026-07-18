# Yog 用户手册（Codex）

Yog 在 Codex 中提供两个独立知识面：面向产品、运营和测试的 `docs/wiki`，以及面向编码 Agent 的 `docs/knowledge`。路由依据是本次问题需要的知识视角，不是用户角色。

## 六个可见入口

| 入口 | 用途 | 是否写入 |
| --- | --- | --- |
| `yog:knowledge` | 生成或维护编码 Agent 知识 | 明确授权后可以 |
| `yog:wiki` | 生成并长期维护产品 Wiki | 通过发布门禁后可以 |
| `yog:wiki-review` | 逐条审核 Wiki 的原子产品行为并保存 tagged Decision | 明确确认后可以 |
| `yog:knowledge-query` | 查询研发业务、实现上下文和影响范围 | Query 自身只读 |
| `yog:wiki-query` | 查询产品功能、规则、状态和用户场景 | Query 自身只读 |
| `yog` | 不确定入口时帮助选择 | 始终只读 |

显式引用优先。没有显式引用时，Agent 可以按问题视角自动选择 Query；无法判断时固定先查 Wiki、再查 Knowledge，并分别标注来源。显式单一 Query 未命中时不会静默切换。

## Knowledge 维护

`yog:knowledge` 支持八个稳定子动作：

- `init`：初始化 `docs/knowledge`、`.yog/config.json` 和根 `AGENTS.md` Managed Block。
- `discover-candidates`：基于 CodeGraph 发现 `needs-review` Candidate。
- `business-flow`：维护跨 Context 的端到端业务流。
- `sync`：重建索引并 lint。
- `verify`：只读检查索引和 lint。
- `audit`：记录 Knowledge Drift、完整性 finding 或显式复查 resolution。
- `install-hooks`：安装或刷新项目级 Codex Prompt Hook。
- `upgrade`：刷新受管指导、Managed Block 和已安装 Hook。

创建/更新、候选评审、候选提升和边界校准通过 `yog:knowledge` 加明确自然语言触发。正式业务边界、术语、状态、split/merge 和 promotion 仍需人工确认。

示例：

```text
使用 yog:knowledge init 初始化当前仓库。
使用 yog:knowledge discover-candidates 发现支付范围的候选 Context。
使用 yog:knowledge 评审 needs-review 清单，只读展示，不修改状态。
使用 yog:knowledge sync，然后 verify。
```

## Product Wiki

使用 `yog:wiki generate` 首次生成产品 Wiki；后续用 `update` 从授权来源更新受影响页面、用 `sync` 从 `_meta/model.json` 重建机器投影、用只读 `verify` 校验页面、来源快照和引用。菜单范围、输出根和代码路径是必需输入；Record、Requirement、Spec 和 verified Knowledge 是可选来源。Knowledge 只作为当前实现代码证据，引用方向固定为 Wiki 到 Knowledge。`yog:wiki audit` 是内部动作，仅记录 verify 或 `wiki-query` 发现的当前 run 完整性、来源或引用问题，不生成或修改 `docs/wiki`。

业务流程查询按最小上下文读取：`_meta/flows.json` → 一个 System Flow 分片 → 业务流程目录 → 一个 Flow 页面。Flow 页面从同一 canonical graph 生成 Current 泳道全景、适用的 Current 状态图和按路径分组的时序图；不得读取完整 model 来回答普通产品问题。

使用 `yog:wiki-review` 审核某个 Feature 的一条原子产品行为。它只读两级 Catalog、Review 索引、一个 Feature 审核分片和 Feature 正文；产品可以确认、修改、拒绝或延期，明确确认后把 tagged Decision 保存到 `docs/wiki-inputs/decisions`，再交给 `yog:wiki update`。不要让产品经理回答工程或数据证据缺口。

## 查询

产品问题显式使用：

```text
使用 yog:wiki-query 说明退款功能适用角色、入口、规则和状态。
```

研发问题显式使用：

```text
使用 yog:knowledge-query 说明退款审批的业务边界、调用链和修改影响。
```

两个视角同时需要时可同时引用两个 Query。输出分为“产品 Wiki 视角 / 研发 Knowledge 视角 / 差异与冲突”，不把两个真源合并成单一事实。

Wiki Query 只引用 `confirmed` 和 `partial`；Knowledge Query 只引用 `verified`、确认 Context、`accepted` ADR 和明确标注的 `draft`。`stale`、`needs-review`、Candidate、Gap 和 Conflict 默认不进入回答。

当前实现核实以 CodeGraph 为主证据。CodeGraph 未覆盖当前 HEAD 或相关 dirty paths、revision 未知、仓库 identity 不匹配或缺少 Knowledge seed 时，返回 `partial + insufficient-evidence`，不回退全仓源码扫描裁决。

## Audit

普通 Query 不写文件。只有两个例外：

1. 用户明确要求记录 Knowledge Drift；
2. 已确认由 Yog 管理的 Wiki/Knowledge 结构损坏，Query 返回 `invalid-*` 后由 orchestrator 自动交接对应 Audit。

Audit 按日写入 `docs/knowledge/audits/YYYY-MM-DD.md` 或 `docs/wiki-audits/YYYY-MM-DD.md`，同日按 fingerprint 幂等更新，不修改源知识正文或状态。历史 Audit 不回写；只有显式复查才在当天记录 resolution。

## Codex Hook

`yog:knowledge install-hooks` 维护 `.codex/hooks/yog-user-prompt-submit.mjs` 和 `.codex/hooks.json` 中唯一 Yog `UserPromptSubmit` handler。它保留其他 Hook，不修改 `.codex/config.toml`。新建或定义变化后，在 Codex 中使用 `/hooks` 审查并信任。

Hook 只是非阻断提醒：显式 Yog Skill 始终优先；明确编码、调试、重构、接口实现和代码影响分析才默认加载 Knowledge 作为实现上下文。
