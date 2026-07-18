# Yog Codex Agent 引导提示词

请在当前 Git 仓库中使用已安装的 Yog 插件，并遵循以下规则：

1. 先确认 Codex 能发现 `yog`、`yog:knowledge`、`yog:wiki`、`yog:wiki-review`、`yog:knowledge-query`、`yog:wiki-query`。
2. 如果我要初始化编码 Agent 知识库，使用 `yog:knowledge init`。它只维护 `docs/knowledge`、`.yog/config.json` 和根 `AGENTS.md`。
3. 初始化后报告 verify 结果、CodeGraph 可用性，并询问我是否继续 `yog:knowledge discover-candidates`；未得到确认不要自动发现。
4. 安装 Prompt Hook 时使用 `yog:knowledge install-hooks`。它只维护 `.codex/hooks/` 与 `.codex/hooks.json`，不修改 `.codex/config.toml`；如定义变化，提醒我通过 `/hooks` 审查并信任。
5. 产品问题使用 `yog:wiki-query`，研发实现或影响问题使用 `yog:knowledge-query`。没有显式入口时可按问题视角自动选择；无法判断时固定先查 Wiki、再查 Knowledge，并标注两组来源。
6. 审核产品 Wiki 的逆向基线使用 `yog:wiki-review`：只读两级 Catalog、目标 System Review 索引、一个 Feature 审核分片和 Feature 正文，每次只处理一个 ReviewItem；不得读取完整 `_meta/model.json`。产品明确确认后才保存 tagged Markdown Decision 并交接 `yog:wiki update`。
7. 查询端到端业务流程时先读 `_meta/flows.json`，再读一个目标 System Flow 分片、`知识对象/业务流程/目录.md` 和一个 Flow 页面；分别表达 Current 全景、状态适用性和时序适用性，不把 Expected 或 unknown 画成当前事实。
7. 显式单一 Query 未命中时不自动切换知识面。低置信治理对象不进入 Query；我要查看 Candidate、`needs-review` 或 `stale` 时，改用 `yog:knowledge` 的只读评审 workflow。
8. Query 自身不写文件。Knowledge Drift 只有我明确要求记录时才写 Audit；`invalid-wiki` / `invalid-knowledge` 可自动交接独立 Audit，但不得自动生成、sync、修复或修改状态。
9. 当前实现事实以 CodeGraph 为主证据。覆盖不足时返回 `partial + insufficient-evidence`，不得用全仓源码扫描替代裁决。
10. 所有写入都必须报告实际变更，并运行适用的 `yog:knowledge sync`、`yog:knowledge verify` 或 Wiki 发布门禁；没有真实命令证据不得声称通过。

先报告当前可见的 Yog Skill；如果尚未初始化，再询问我是否执行 `yog:knowledge init`。
