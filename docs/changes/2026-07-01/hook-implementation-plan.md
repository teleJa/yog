# Yog Hook 集成实现计划

> 状态:已实现(2026-07-02)。install-hooks.mjs、user-prompt-submit.mjs、routing-guidance.mjs 已落地,71 条测试全绿。Codex 侧最终决策为不自动写 config.toml,只复制脚本 + 返回手动开启提示。

## 目标

新增 `install-hooks` 步骤:为 Claude Code 和 Codex CLI 生成 `UserPromptSubmit` hook,在用户每轮 prompt 前注入"先读 CONTEXT-MAP.md、语义自选相关 context、读全文再动手"的指令+路由表指针。hook 是增强路径,managed block SOP 仍是可独立工作的基线。

## 已确认的平台事实(来自 codex 0.142.3 二进制 schema + WebSearch)

两个平台的 hook 契约几乎一致(Codex 照搬了 CC):
- 事件名:`UserPromptSubmit`
- 注入字段:stdout 输出**单行** JSON,`hookSpecificOutput.additionalContext`
- exit 0 = 继续并解析 stdout JSON;exit 2 = 阻断(理由走 stderr)
- CC 已知坑:裸 stdout 报错、多行 JSON 被静默丢弃 → 必须单行 JSON

## 三个已定决策

1. **脚本路径**:install-hooks 时把 hook 脚本**复制**进用户仓库的 `.claude/` 和 `.codex/` 下,配置指向仓库内脚本(可移植、随仓库走)。
2. **无知识库时**:hook 脚本检测不到 `CONTEXT-MAP.md` 时**注入一句提示**("本仓库未初始化 Yog 知识库,可运行 init"),而非静默。
3. **写入方式**:独立 `install-hooks.mjs` 步骤(不塞进 init),按需生成,可选平台。

## 关键约束:零依赖

package.json 无任何 dependencies,纯 Node `--test`。**不能引 TOML 库**。Codex config.toml 的读写必须手写最小逻辑,这是设计最脆的点(见下方 Codex 部分的取舍)。

## 共享事实源(核心抽象)

把 SOP 核心措辞抽成 `skills/yog/lib/routing-guidance.mjs`,消除漂移:

```js
// 一句话核心指令(managed block 和 hook 都引用)
export function routingCoreInstruction(knowledgeRoot) {
  return `Before requirement analysis, solution design, interface changes, or business-rule judgments, first read ${knowledgeRoot}/CONTEXT-MAP.md, select relevant contexts by matching the request against each context's summary, responsibilities, and non-responsibilities, then read the full CONTEXT.md and related capability and evidence documents before designing or changing behavior.`;
}
// hook 注入用的精简提示(指令 + 路由表指针,控 token)
export function hookAdditionalContext(knowledgeRoot) { ... }
// 无知识库时的提示
export function hookMissingKnowledgeNotice() { ... }
```

`managed-block.mjs` 改为引用 `routingCoreInstruction`,保持现有 6 条规则结构不变(measured block 的其余 5 条规则原样保留),只让第 1-2 条从共享源生成。这样 managed block 和 hook 措辞同源,详略各异。

## 新增文件

### 1. `skills/yog/lib/routing-guidance.mjs`
共享 SOP 措辞源(上述三个导出函数)。

### 2. `skills/yog/hooks/user-prompt-submit.mjs`(被复制进用户仓库的模板脚本)
平台无关的 hook 脚本。逻辑:
- 从 stdin 读平台传入的 JSON(不强依赖其结构;用 try/catch 容错,任何解析失败都安全 exit 0 不阻断)
- 用 `resolveRepoContext` 找 repoRoot + knowledgeRoot(复用现有 lib)。注意:hook 脚本被复制到 `.claude/`/`.codex/` 后,它 import 的 lib 路径会变——**改为脚本自包含**,不 import Yog lib(见下方取舍),自己用 `findUp` 找 `.yog/config.json` 读 knowledgeRoot,或退化为默认 `docs/knowledge`。
- 检测 `{knowledgeRoot}/CONTEXT-MAP.md`:存在 → 输出核心指令;不存在 → 输出未初始化提示
- 始终输出**单行** JSON `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}`,exit 0
- 绝不 exit 2(hook 是增强,绝不阻断用户 prompt)

### 3. `skills/yog/scripts/install-hooks.mjs`
遵循现有脚本契约(stdin JSON `{repoRoot, payload}` → stdout `{issues, ...}`)。payload 可选 `platforms: ["claude","codex"]`(默认两个)。调用 `lib/scaffold.mjs` 新增的 `installHooks()`。

## 修改文件

### `skills/yog/lib/scaffold.mjs` — 新增 `installHooks(input)`
- 复制 `skills/yog/hooks/user-prompt-submit.mjs` → `{repoRoot}/.claude/hooks/yog-user-prompt-submit.mjs` 和 `{repoRoot}/.codex/hooks/yog-user-prompt-submit.mjs`
- **CC**:读/建 `{repoRoot}/.claude/settings.json`(JSON,可安全解析合并),在 `hooks.UserPromptSubmit` 数组里 upsert 一条指向复制后脚本的 `command`。用 marker 注释无法在 JSON 里放,改用**幂等 upsert**:按 command 路径去重,已存在则跳过。
- **Codex**:只复制 hook 脚本到 `.codex/hooks/`,**不碰 `config.toml`**。在返回结果里给出一段手动开启提示(P2 issue + 可粘贴的配置说明:`[features] hooks = true` 及 `[hooks]` 段该怎么写、脚本路径)。让用户自己决定是否启用。
- 返回 `{issues, installed: [...paths], platforms, codexManualHint}`。

### `skills/yog/lib/managed-block.mjs`
第 1-2 条规则改为调用 `routingCoreInstruction(knowledgeRoot)`,其余不动。**这会改变生成文本** → 连带更新断言(见测试)。

### `skills/yog/SKILL.md`
新增 `install-hooks.mjs` 到 Scripts 清单;加一节说明 hook 是增强、managed block 是基线、hook 脚本被复制进仓库、无知识库时注入提示。

## Codex config.toml:不自动修改(简化决策)

零依赖 = 不能可靠解析/合并任意 TOML。且用户明确要求简化:**install-hooks 不碰 Codex 的 `config.toml`**。改为:
- 复制 hook 脚本到 `.codex/hooks/yog-user-prompt-submit.mjs`
- 返回一段手动开启提示(P2 issue),内容为可直接粘贴的配置:`[features] hooks = true` + `[hooks]` 段该怎么指向复制出的脚本

好处:零风险(绝不破坏用户已有 config.toml)、零依赖、不受 TOML 语法不确定性影响。用户按提示手动追加即可启用。

## hook 脚本自包含的取舍

hook 脚本被复制到 `.claude/hooks/` 后,相对 Yog lib 的 import 路径会断。两个选择:
- **自包含(推荐)**:脚本不 import 任何 Yog lib,自带极简 `findUp` + 读 `.yog/config.json` 逻辑(约 20 行)。代价:`findUp` 逻辑有第二份拷贝,但它极简、稳定、几乎不会变。
- 保留 import:则脚本不能复制,只能用绝对路径引用 pluginRoot 下的原件 —— 与"复制进仓库"决策冲突。

采用**自包含**,与决策 1 一致。

## 测试(遵循 test/yog/ 的 spawnSync 契约)

新增 `test/yog/install-hooks.test.mjs`:
1. install-hooks 在空仓库生成 `.claude/settings.json`(合法 JSON,含指向复制脚本的 UserPromptSubmit command)
2. 生成 `.claude/hooks/yog-user-prompt-submit.mjs` 和 `.codex/hooks/` 副本
3. Codex:复制 `.codex/hooks/yog-user-prompt-submit.mjs`,不创建/不修改 `config.toml`,返回含手动开启提示(P2 + 配置片段)
4. 幂等:重复 install 不产生重复 command 条目
5. hook 脚本行为(直接 spawn 复制出的脚本):
   - 有 CONTEXT-MAP.md → 输出单行 JSON,含 additionalContext,exit 0
   - 无 CONTEXT-MAP.md → 输出未初始化提示,exit 0
   - stdin 喂垃圾/空 → 不崩溃,exit 0
   - 断言输出是**单行**(无 `\n` 在 JSON 内部)
6. `platforms` payload 只装一个平台时只生成对应配置

更新 `test/yog/init.test.mjs` 和 `full-flow.test.mjs`:managed block 文本因引用共享源而变 → 更新受影响断言(核心指令措辞若保持不变则可能无需改;若微调则同步)。

更新 `test/yog/script-contract.test.mjs`:install-hooks 空 stdin 应作为结构化输入被接受(遵循现有契约)。

## 验证

`npm test` 全绿。重点验证 hook 脚本输出是单行 JSON(CC 静默丢弃多行的坑)。

## 不做(明确排除)

- 不做中文分词/match-scope 召回(pure agent 方向,规模大了才做)
- 不把 hook 塞进 init(独立步骤)
- **不自动修改 Codex config.toml**(只复制脚本 + 给手动开启提示)
- 不改 CONTEXT-MAP.md 结构、不加 Typical asks 字段

## 待你确认的残留不确定

- Codex `[hooks]` 的确切 TOML 数组语法未从一手官方文档确认(codex 从二进制推断为 `UserPromptSubmit = [{ command = "...", timeout = N }]`)。由于我们不自动写 config.toml、只在提示里给这段语法,即使有偏差也只影响提示文本,用户实测后自行调整,零破坏风险。
