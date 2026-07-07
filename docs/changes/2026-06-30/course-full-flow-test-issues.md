# Course 仓库完整链路实测问题记录

## 背景

2026-06-30 在 `/Users/tele/xjjk/sharkcloud/services/course` 使用当前 Yog 工作区版本测试完整知识库生命周期：

1. `init`
2. `discover-candidates` agent workflow
3. candidate -> context
4. context -> capability
5. capability -> evidence
6. `sync` / `verify`
7. `match-scope`

目标仓库追踪记录：

- `/Users/tele/xjjk/sharkcloud/services/course/.goal/yog-retest-course-20260630/execute_record.md`
- `/Users/tele/xjjk/sharkcloud/services/course/.goal/yog-full-flow-course-20260630/execute_record.md`

最终测试可以通过，但过程中暴露出以下产品和脚本问题。

## 问题 1：init 后 discover-candidates 已有规则，但测试口径曾漏测真实候选输出（已修复）

### 现象

当前产品规则已经修复为：`init.mjs` 只创建知识库骨架、`.yog/config.json` 和根 `AGENTS.md` / `CLAUDE.md` managed block；init 后由 Yog skill 在 CodeGraph 可用时继续执行 `discover-candidates` agent workflow，并通过 `create-candidate.mjs` 写入 `needs-review` candidate。

本次实测中真正的问题不是产品规则缺失，而是首次测试只验证了 init、sync/verify 和提示文案，没有把“真实候选文件已生成”作为验收门禁，导致交付结论不完整。

### 复现证据

在 course 仓库执行：

```bash
find docs/knowledge/candidates -maxdepth 1 -type f -print | sort
```

初始结果只有：

```text
docs/knowledge/candidates/README.md
```

补测后已生成：

```text
docs/knowledge/candidates/feishu-course-document-entry.md
```

### 判断

当前设计里 `discover-candidates` 是 agent workflow，不是 Node 脚本，这一点是有意设计。已修复的规则要求 init 后继续 discovery；测试和最终报告必须区分：

- init 完成；
- discover-candidates 已执行；
- candidate 文件已真实写入；
- candidate 未进入默认 routing index。

### 影响

如果测试只检查 init，用户会误以为 Yog 没有扫描代码或没有生成业务候选；或者 agent 会错误声称完整链路已通过。

### 建议

- 保留当前 Yog skill 规则：init 后在 CodeGraph 满足时继续 `discover-candidates`。
- 把测试验收标准补清楚：必须检查 `docs/knowledge/candidates/*.md` 是否真实生成。
- 最终报告必须列出 candidate 路径、状态、置信度和是否进入 index。
- 如果只完成 init，最终回复必须明确“尚未执行 discover-candidates / 尚未生成 candidate”。

### 修复记录

已修复到 Yog skill 规范：

- 用户只要求 init 时，执行 `init.mjs` 后停止，并报告 `discover-candidates` 未执行。
- 用户要求测试 init 是否能生成业务文档、发现候选或扫描业务边界时，init alone 不算完成，必须继续执行 `discover-candidates` agent workflow。
- discovery 前必须确认 `docs/knowledge/templates/candidate.md` 存在；缺失时要求重跑 `init.mjs`。
- discovery 后必须运行 `sync.mjs` 与 `verify.mjs`。
- 最终报告必须包含：
  - `candidate_count`
  - candidate paths
  - candidate status values
  - confidence notes
  - candidate 是否进入 generated indexes
- 如果没有生成 candidate，必须报告 `candidate_count: 0` 和原因。

新增测试断言这些门禁文案存在。

## 问题 2：已有知识库不会升级内部模板文档（已修复）

### 现象

对已经执行过 init 的仓库再次执行 `init.mjs` 时，`docs/knowledge/**` 既有文件会被跳过，只返回 P2 `Existing file skipped during init.`。根 `AGENTS.md` / `CLAUDE.md` managed block 会更新，但 `docs/knowledge/README.md`、`AGENTS.md` 等既有模板说明仍保留旧内容。

### 复现证据

在 course 仓库复跑 init 后，输出包含大量：

```json
{
  "severity": "P2",
  "message": "Existing file skipped during init.",
  "path": "docs/knowledge/README.md"
}
```

`AGENTS.md` 与 `CLAUDE.md` 已包含：

```text
Run automatic discover-candidates only when CodeGraph is initialized for this repository
```

但 `docs/knowledge/README.md` 仍未出现新版 `Automatic candidate discovery` 说明。

### 判断

`init` 的 no-overwrite 策略避免破坏用户文档，是正确的；但缺少显式模板迁移/刷新机制。

本次已先收窄新初始化仓库的模板暴露面：

- `BUILD-PLAN.md` 改为 Yog 仓库内部文档：`docs/knowledge-base/BUILD-PLAN.md`，不再复制到目标仓库 `docs/knowledge`。
- `docs/knowledge/AGENTS.md` 缩短为目录级提醒，完整规范由 Yog plugin skill 承载。

### 影响

老仓库的根规则与知识库内部说明仍可能不一致，agent 读不同入口时会得到不同操作规范。

### 建议

- 保持 `init` no-overwrite。
- 增加显式 `upgrade-guidance` workflow，默认只报告差异，传 `apply: true` 时直接覆盖内部说明。
- `verify` 或 `lint` 可以报告 P2：root managed block 与 `docs/knowledge/AGENTS.md` 的 init/discovery 规则不一致。

### 修复记录

已修复。新增 `upgrade-guidance.mjs`：

- 默认 dry-run：比较目标仓库 `docs/knowledge/AGENTS.md` 和 `docs/knowledge/README.md` 是否与当前 Yog 模板一致。
- dry-run 发现不一致时返回 P2 issue，不写文件。
- 传入 `payload.apply: true` 时，直接用当前模板覆盖目标仓库 `docs/knowledge/AGENTS.md` 和 `docs/knowledge/README.md`。
- 不覆盖业务知识源文档、context、capability、evidence、candidate 或 ADR。
- `init.mjs` 继续保持 no-overwrite。

新增测试：

- `upgrade-guidance reports and applies README and AGENTS template updates`

## 问题 3：candidate -> context 没有一键 promote 流程（已修复）

### 现象

当前没有 `promote-candidate.mjs`。将 candidate 升级为 context 需要 agent 手动串联：

1. 读取 candidate。
2. 调用 `create-context.mjs`。
3. 手动更新 candidate frontmatter：
   - `status: deprecated`
   - `promoted_to: "contexts/<context-id>/CONTEXT.md"`
4. 执行 `sync` / `verify`。

### 复现证据

本次把 `docs/knowledge/candidates/feishu-course-document-entry.md` 升级为：

```text
docs/knowledge/contexts/feishu-course-document-entry/CONTEXT.md
```

候选 promoted 状态是通过手动更新 frontmatter 完成，而不是脚本自动完成。

### 影响

不同 agent 可能遗漏 candidate 状态更新，导致已提升的候选继续以 `needs-review` 形式存在。

### 建议

增加 `promote-candidate.mjs` 或在 Yog skill 中定义标准 promote workflow。至少应保证：

- 创建正式 context。
- 删除已提升的 candidate，避免继续参与候选复核。
- 写入 `docs/knowledge/changes/*.md`，记录来源 candidate、目标 context 和变更路径。
- 不覆盖已有 context。
- 写入结构化 JSON 输出，包含 context path 与 candidate path。

### 修复记录

已修复。新增 `promote-candidate.mjs`：

- 校验 candidate 存在。
- 校验目标 context 不存在。
- 创建正式 context 与 README。
- 删除原 candidate。
- 写入 `docs/knowledge/changes/<change-id>.md` 记录提升过程。
- 返回结构化输出：
  - `candidatePath`
  - `candidateRemoved`
  - `contextPath`
  - `contextReadmePath`
  - `changePath`

按当前决策，升级后的候选不再保留为 `deprecated` 文件；历史信息沉淀到 change report。

新增测试：

- `promote-candidate creates context records change and removes candidate`
- `promote-candidate does not remove candidate when target context exists`

## 问题 4：candidate promotion 只创建空 capability/evidence 目录（已修复）

### 现象

`create-context.mjs` 创建正式 context 后，`capabilities/` 和 `evidence/` 是空目录。用户容易以为“升级成 context”后应该自动带出 capability/evidence。

### 复现证据

`createContext()` 实现只执行：

```js
mkdirSync(join(contextDir, 'capabilities'), { recursive: true });
mkdirSync(join(contextDir, 'evidence'), { recursive: true });
```

不会创建 capability/evidence 文件。

### 判断

用户已确认：candidate 升级为 context 时不应只创建空骨架，而应自动创建真实 capability 和 evidence。对于大型仓库，Yog workflow 可以 spawn subagent 并行收集业务边界和 CodeGraph 调用/路由证据，再把完整 payload 交给脚本落盘。

### 影响

完整链路测试容易误判为通过，实际 context-local index 仍为空。

### 建议

- `promote-candidate.mjs` 要求 `capabilities[]`，且每个 capability 至少包含一个 evidence。
- Yog skill 在 promotion 前并行收集真实业务边界和代码证据。
- promotion 输出 `capabilityPaths`、`evidencePaths`、`docsCount`。
- promotion 后执行 `sync` / `verify`；`docsCount: 0` 视为失败。

### 修复记录

已修复。`promote-candidate.mjs` 现在会：

- 拒绝缺少 `capabilities[]` 或缺少 evidence 的 promote 请求。
- 创建正式 context 与 README。
- 自动创建真实 capability 文档。
- 自动创建真实 evidence 文档。
- 删除已提升 candidate。
- 写入 change report，记录 candidate、context、capability、evidence 路径。
- 返回结构化输出：
  - `candidatePath`
  - `candidateRemoved`
  - `contextPath`
  - `contextReadmePath`
  - `capabilityPaths`
  - `evidencePaths`
  - `changePath`
  - `docsCount`

Yog skill 已补充 promotion workflow：大型仓库可 spawn subagent 并行收集业务边界和 CodeGraph 代码事实；证据不足时不得创建空 context shell。

## 问题 5：evidence 只填充事实摘要，结构化章节为空（已修复）

### 现象

`create-evidence.mjs` 只把 `payload.body` 注入到 `## 事实摘要` 下，模板中的以下章节保持空白：

- `## 生成方式`
- `## 入口路径`
- `## 路由 / 接口`
- `## 调用关系`
- `## 数据 / 消息`
- `## 前端入口`
- `## 限制与疑点`

### 复现证据

生成的 `docs/knowledge/contexts/feishu-course-document-entry/evidence/feishu-course-link-generation-routes.md` 中：

```markdown
## 入口路径

## 路由 / 接口

## 调用关系
```

相关实现只有：

```js
markdown = injectAfterHeading(markdown, '事实摘要', payload.body);
```

### 影响

`sync` / `verify` 可以通过，但 evidence 质量偏低，不利于 agent 快速定位入口、路由和调用关系。

### 建议

- 扩展 `create-evidence.mjs` 输入字段，例如：
  - `generationMethod`
  - `entryPaths`
  - `routes`
  - `callRelations`
  - `dataMessages`
  - `frontendEntries`
  - `limitations`
- 将字段分别注入对应章节。
- `lint` 对 evidence 空章节至少报告 P2；对 `routes` / `call-flow` / `data` 这类强结构证据，可将关键章节空白报告为 P1。

### 修复记录

已修复生成器部分。`create-evidence.mjs` 现在保留 `body -> 事实摘要` 的向后兼容行为，并新增可选结构化字段：

- `generationMethod` -> `生成方式`
- `entryPaths` -> `入口路径`
- `routes` -> `路由 / 接口`
- `callRelations` -> `调用关系`
- `dataMessages` -> `数据 / 消息`
- `frontendEntries` -> `前端入口`
- `limitations` -> `限制与疑点`

新增回归测试覆盖这些字段会分别落到对应章节。

验证：

- `node --test test/yog/create-documents.test.mjs` 通过。
- `npm test` 通过，50 个测试全部 pass。

后续已补充：lint 对 evidence 空章节的 P1/P2 质量检查，详见问题 8。

## 问题 6：`call-flow` evidence kind 与文件名校验冲突（已修复）

### 现象

`call-flow` 是允许的 `evidenceKind`，但生成文件名 `feishu-course-link-generation-call-flow.md` 后，`sync` / `verify` 报 P1：

```text
Evidence file name capability does not match frontmatter capability.
Evidence file name kind does not match frontmatter evidence_kind.
```

### 根因

当前 lint 文件名解析按最后一个 `-` 拆分 capability 和 evidence kind。对于 `call-flow` 这种自身带 `-` 的 kind，会被错误拆成：

- capability: `feishu-course-link-generation-call`
- kind: `flow`

实际应为：

- capability: `feishu-course-link-generation`
- kind: `call-flow`

### 影响

`call-flow` 虽然在常量中被允许，但无法通过 `verify`，导致调用链 evidence 不能正常使用。

### 建议

- 解析 evidence 文件名时，应优先匹配允许的 evidence kind 后缀。
- 例如按 `EVIDENCE_KINDS` 从长到短匹配：
  - `call-flow`
  - `routes`
  - `tests`
  - ...
- 增加回归测试：`<capability-id>-call-flow.md` 必须通过 lint。

### 修复记录

已修复。`lint` 现在按 `EVIDENCE_KINDS` 后缀从长到短匹配 evidence kind，再反推出 capability id，避免把 `call-flow` 错拆成 `flow`。

新增回归测试：

- `lint accepts evidence kinds that contain hyphens`

验证：

- `node --test test/yog/lint-verify-sync.test.mjs` 通过。
- `npm test` 通过，50 个测试全部 pass。

## 问题 7：real-body 检测对编号列表正文过严（已修复）

### 现象

第一次调用 `create-capability.mjs` 时，`payload.body` 是真实编号流程，但脚本返回：

```json
{
  "severity": "P1",
  "message": "body must contain real content.",
  "details": {
    "field": "body"
  }
}
```

改为段落式正文后通过。

### 影响

真实业务流程经常天然是步骤列表。过严检测会迫使 agent 把结构化流程改写成段落，降低可读性。

### 建议

- 调整 `hasRealBodyContent`，允许包含足够文本量的有序/无序列表。
- 保持对空模板和 `{...}` placeholder 的阻断。
- 增加测试覆盖：编号列表正文应通过 real-body 检测。

### 修复记录

已修复。`hasRealBodyContent` 现在：

- 允许真实有序/无序列表正文。
- 继续忽略 Markdown 标题、空行和 `{...}` 模板占位符。
- 将 `TODO`、`TBD`、`待补充`、`待确认` 识别为占位文本。
- 只有在 `未确认问题` / `Open Questions` 章节下，才允许这些占位文本作为真实正文的一部分。

新增测试覆盖：

- 真实编号列表通过。
- 只有 `TODO` / `TBD` 的编号列表不通过。
- 只有 `待补充` / `待确认` 的项目符号列表不通过。
- `{...}` 模板占位列表不通过。
- `Open Questions` / `未确认问题` 下的占位项通过。

## 问题 8：evidence 空章节缺少质量检查（已修复）

### 现象

`create-evidence.mjs` 已支持结构化章节，但 `lint` / `verify` 之前只校验 frontmatter、文件名、空壳和 capability 绑定，不检查结构化章节是否为空。

### 影响

`routes` / `call-flow` / `data` evidence 即使缺少关键章节，也可能通过 `sync` / `verify`。这会导致 agent 后续检索到 evidence 后仍找不到路由、调用关系或数据消息入口。

### 修复记录

已修复。`lint` 现在解析 evidence Markdown 的 `##` 章节，并按 evidence kind 检查：

- 所有 evidence 必须有非空 `事实摘要`，缺失为 P1。
- `routes` 必须有非空 `路由 / 接口`，缺失为 P1。
- `call-flow` 必须有非空 `调用关系`，缺失为 P1。
- `data` 必须有非空 `数据 / 消息`，缺失为 P1。
- `生成方式`、`入口路径`、`限制与疑点` 是推荐章节，缺失为 P2。

新增测试：

- `lint reports evidence empty structured sections by evidence kind`

验证：

- `node --test test/yog/lint-verify-sync.test.mjs` 通过。
- `npm test` 通过。

## 已验证的通过项

- `init` 可重复执行；已有文件按 P2 跳过。
- `create-candidate.mjs` 可写入 `needs-review` candidate。
- candidate 可通过 agent workflow 升级为 context。
- `create-capability.mjs` 可生成 draft capability。
- `create-evidence.mjs` 可生成 draft evidence。
- `sync.mjs` / `verify.mjs` 最终可通过。
- context-local `index.json` 能包含 capability 和 evidence。
- `match-scope.mjs` 能命中 capability、context、evidence。

## 建议优先级

1. P2：补模板刷新/迁移机制，避免老仓库根规则和内部说明不一致。
暂无剩余 P2 问题。

已完成：

- `call-flow` evidence kind 文件名解析。
- evidence 结构化章节生成。
- 标准 promote-candidate workflow。
- init + discover-candidates 测试验收口径与最终报告规范。
- real-body 对真实列表正文的判断。
- evidence 空章节质量检查。
