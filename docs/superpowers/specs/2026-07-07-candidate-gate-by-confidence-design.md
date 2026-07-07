# 候选门禁按信度分层设计

- 日期: 2026-07-07
- 状态: 已修订,待实现
- 范围: Yog `discover-candidates` 工作流的候选数量门禁

## 背景与问题

`discover-candidates` 三路扫描(controller / service / data)的输出经
`reduce-candidates.mjs` 聚合成 cluster 后,会遇到一个数量门禁
(`skills/yog/lib/scaffold.mjs:844`):

```js
if (clusters.length > maxCandidates) {  // maxCandidates 默认 10
  return { code: 1, output: { gate: 'narrow-scope-required',
    writable: [], lowConfidence: [], ... } };  // 全部清空,一个不写
}
```

这个门禁是**全有或全无**:只要 cluster 总数超过 10,整批被拒,连高信度的
真业务对象也不写入 `docs/knowledge/candidates/`,要求人工缩小扫描范围重跑。

实际问题(真实案例):大仓库一次扫出 19 个 cluster,其中不乏高信度真对象,
但因总数 > 10 全部被挡。根因是**门禁用"数量"当噪音的粗糙代理指标,却没用上
reducer 已经算好的每个 cluster 的信度分数**。数量多不等于噪音多——高信度候选
数量多恰恰是好事。

### 现有信度机制(复用,不改)

`scoreCluster()`(`scaffold.mjs:658-665`)已为每个 cluster 打分并分档:

```
score = min(identitySymbols 数量, 10) × 2   // 身份符号,可做自动 JOIN,权重最高
      + min(supportingSymbols 数量, 10) × 1 // 佐证符号
      + evidencePaths 数量 × 1              // 证据文件路径
      + (hitAgents ≥ 2 ? 3 : 0)             // 多路 agent 交叉命中加成

confidence = score >= 8 ? 'high' : (score >= 4 ? 'medium' : 'low')
```

推论:`low` 档基本是"单路 agent 扫出、佐证薄"的孤立候选——噪音主要来源;
`high` 档几乎都是多路交叉验证过的同一业务对象,天然可信。本设计不改打分公式,
只改门禁如何**使用**这些分数。

## 目标

1. 高信度候选不再被数量门禁连累,一律自动写入。
2. 数量门禁降级为只守噪音大头:仅对 medium+low 合并计数生效。
3. 阈值可在 `.yog/config.json` 配置,默认 10,不写死。
4. 门禁触发时产出一份人类可读的被挡候选诊断报告(md),返回其路径 + 统计,
   让"缩小范围"从盲猜变成有依据的决策。

## 非目标

- 不改 `scoreCluster` 打分公式与 high/medium/low 阈值。
- 不改 reducer 的 JOIN 逻辑(仍只按 `identity_symbols` 交集自动 JOIN,不做主观合并)。
- 不改磁盘去重(`diskDuplicates`)与批内去重(`batchDuplicates`)门禁语义。
- reducer 仍为纯函数,不落盘(见职责边界)。

## 设计

### 1. 配置项

`.yog/config.json` 新增 `discover` 段:

```json
{
  "knowledgeRoot": "docs/knowledge",
  "codeFactProvider": { "type": "codegraph", "status": "configured" },
  "discover": {
    "maxMidLowCandidates": 10
  }
}
```

- 由 `init.mjs`(经 `scaffold.mjs:44-49` 的 `mergeConfig`)在初始化时写入默认结构。
- `mergeConfig` 必须深合并 `discover` 段:保留 `existing.discover` 的未知字段,只在
  `maxMidLowCandidates` 缺失时补默认值 10。
- 已初始化的老仓库缺该字段时,读取回落到默认 10,不报错(向后兼容)。
- `payload.maxCandidates` 如果出现,必须是正整数;否则按调用方输入错误返回 `code: 2`。
- `config.discover.maxMidLowCandidates` 如果不是正整数,记录 P2 issue 并回落默认 10,
  避免历史仓库因手工配置错误阻断 discovery。

### 2. 门禁语义(核心改动,`scaffold.mjs:reduceCandidates`)

取值优先级:

```
payload.maxCandidates            // 显式覆盖,保留向后兼容
  → config.discover?.maxMidLowCandidates
  → 10                           // 硬编码兜底
```

> 说明:`payload.maxCandidates` 现语义是"cluster 总数上限",改后复用为
> "medium+low 合并计数上限"。保留同名参数以维持调用方兼容;其数值现在只约束中低信度批次。

判定改动:先按 `confidence` 把 clusters 分成两组,门禁只看中低信度组:

```js
const high = clusters.filter(c => c.confidence === 'high');
const midLow = clusters.filter(c => c.confidence !== 'high'); // medium + low 合并
const gated = midLow.length > threshold;
```

分档行为(合并计数 A + high 照写 A):

| 分档 | 门禁未触发 | 门禁触发(midLow 超限) |
|------|-----------|----------------------|
| high | 进 `writable` | **进 `writable`,不受连累** |
| medium | 进 `writable` | **挡下,不写**,列入 `gatedCandidates[]` |
| low | 进 `lowConfidence` | **挡下,不写**,列入 `gatedCandidates[]` |

reducer 返回结构变化:

- `gate`: 触发时为 `'mid-low-scope-required'`;否则沿用现有 `'ok'` /
  `'batch-duplicates-require-resolution'`。
- `stats` 新增 `high`(高信度数)、`midLow`(中低信度数)、`threshold`(生效阈值)。
- `stats` 新增 `thresholdSource`(`payload` / `config` / `default`),用于最终报告解释阈值来源。
- 新增 `gatedCandidates[]`:被挡候选的元信息,**不含 body**,字段为
  `candidateId / name / confidence / score / hitAgents / identitySymbols`。
- 触发时 `writable` 仍含 high 候选;`lowConfidence` 为空(low 已被挡)。
- `code`: 触发 `mid-low-scope-required` 时返回 `code: 0`。这是"部分成功且允许继续写入"
  的状态,主 agent 必须继续调用 `write-candidates.mjs`,由 write 步骤写入 high 候选和
  `_gated/gated-candidates.md`。真正阻断性 gate 仍使用非 0 退出码。

边界:
- `midLow.length` 恰好 == threshold 时**不触发**;== threshold + 1 触发。
- 全 high(midLow = 0)永不触发。
- 无 high 且 midLow 超限时,`writable` 为空但仍返回 `gatedCandidates[]` 与
  `gate: 'mid-low-scope-required'`,`code: 0`;write 步骤只写诊断报告,不写候选文件。
- `diskDuplicates` / `batchDuplicates` 对 `writable` 中的 high 候选仍然生效。若 high
  候选存在重复阻断,重复门禁优先于自动写入,不得因为 mid/low 被挡而绕过去重确认。

### 3. 落盘契约(reducer 纯函数 + write 步骤落盘)

职责边界:reducer 只算不写;所有磁盘 I/O 归 `writeCandidates`。

- `reduceCandidates`(纯函数):输出 `writable`(含 high)、`gatedCandidates[]`、
  `gate`、`stats`。不碰文件系统。
- `writeCandidates`:检测到 `reduceOutput.gate === 'mid-low-scope-required'`
  (或 `gatedCandidates[]` 非空)时:
  1. 照常写入 `writable` 中的 high 候选到 `docs/knowledge/candidates/`;
  2. 将 `gatedCandidates[]` 渲染成诊断 md 落盘;
  3. 返回值新增 `gatedReportPath`(仓库相对路径)。

> 注:因为 "gate 触发但仍要写 high" 这一行为本就要求 write 步骤感知 gate,
> 在此顺手写诊断 md 最自然,reducer 纯函数契约不被破坏。
> 现有 `writeCandidates` 在 `reduceOutput.gate !== 'ok'` 时直接 `code:3` 拒写
> (`scaffold.mjs:1254-1255`),需允许 `mid-low-scope-required` 这一非阻断 gate。

写入门禁优先级:

1. `payload` 结构非法 / `payload.maxCandidates` 非正整数 → `reduceCandidates` 返回 `code: 2`,不进入 write。
2. high 候选存在 `batchDuplicates` 或未确认的 `diskDuplicates` → `writeCandidates` 返回 `code: 3`,不写候选;仍可写诊断报告,但最终状态必须提示重复确认未完成。
3. `gate: 'mid-low-scope-required'` 且 high 无重复阻断 → `writeCandidates` 写 high 候选和诊断报告,返回 `code: 0`。

诊断 md 落盘规则(A + 1):

- 路径:`docs/knowledge/candidates/_gated/gated-candidates.md`
- 策略:固定文件名,每次覆盖。永远只有一份,反映最近一次超限诊断。
- `_gated/` 目录不存在时 write 步骤 `mkdirSync(recursive)`。
- `_` 前缀目录须与正式候选隔离:实现时检查 `build-index` / review / 候选扫描
  逻辑不会把 `_gated/` 当候选读;若会,加显式排除。

诊断 md 内容结构:

```markdown
# 被门禁挡下的中低信度候选

> 生成时间: <ISO>
> 阈值: maxMidLowCandidates = <N>(来源: config / payload / default)
> 本次被挡: <midLow 数量> 个 (medium <x> / low <y>)
> 已自动写入的 high 候选: <high 数量> 个

## 说明
本次自动发现的中低信度候选数量超过阈值,已挡下不写入正式候选区。
请缩小扫描范围重跑,或用 payload.maxCandidates 放宽后重跑。

## 被挡候选清单
| candidateId | name | confidence | score | hitAgents | identity_symbols |
|---|---|---|---|---|---|
| refund | Refund | medium | 5 | controller,service | RefundService#refund |
```

### 4. 数据流

```
3 路 subagent JSON
      │
      ▼
reduceCandidates(纯函数)
   ├─ 打分分档 high / midLow
   ├─ midLow > threshold ?
   │     是 → gate='mid-low-scope-required', writable=[high], gatedCandidates=[midLow], code=0
   │     否 → 现有正常路径(writable/lowConfidence 照旧)
   ▼
writeCandidates(落盘)
   ├─ 写 high 候选 → docs/knowledge/candidates/*.md
   └─ gate 触发 → 写 docs/knowledge/candidates/_gated/gated-candidates.md
                  返回 gatedReportPath + stats
      │
      ▼
主 agent 报告:md 路径 + 统计数字(high 已写 N 个 / midLow 被挡 M 个 / 阈值)
```

## 文档改动(SKILL.md)

- L115 段:把"more than 10 candidates … ask the user to narrow the scope"
  改为新分档门禁描述——high 照写;medium+low 合并超
  `maxMidLowCandidates`(默认 10,`.yog/config.json` 可配)时中低信度被挡并写入
  `_gated/gated-candidates.md`,返回 md 路径 + 统计。
- L125 段:"more than 10 candidates requiring a narrower scope" 同步更新
  ——超限不再意味着零写入,high 仍会写。
- 暴露配置:在 init / discover 说明里点出 `discover.maxMidLowCandidates` 可配,
  `payload.maxCandidates` 仍为显式覆盖(向后兼容)。
- 脚本描述(L47-48):`reduce-candidates.mjs` / `write-candidates.mjs` 各补一句
  gated 行为。
- Stage C 编排说明必须同步更新:当 `reduce-candidates.mjs` 返回
  `gate: 'mid-low-scope-required'` 且退出码为 0 时,主 agent 仍应调用
  `write-candidates.mjs`;只有输入错误、重复阻断等非 0 状态才停止写入。

## 测试策略

框架:`node --test`,测试挂到 `test/yog/` 现有文件。

reducer 单测(`test/yog/reduce-candidates.test.mjs`):
- 构造 `high=3, midLow=12, threshold=10` → 断言 `gate='mid-low-scope-required'`、
  `writable` 只含 3 个 high、`gatedCandidates` 含 12 个且带 score/confidence、脚本退出码为 0。
- 边界:`midLow == threshold`(不触发)、`== threshold+1`(触发)。
- 全 high(midLow=0)不触发;全 low 且超限触发且 `writable` 空。
- 配置优先级:`payload.maxCandidates` 覆盖 config;config 覆盖默认;都无 = 10。
- 非法配置:`payload.maxCandidates` 非正整数返回 `code: 2`;config 非法记录 P2 并回落默认 10。

write 单测(`test/yog/create-documents.test.mjs` 或新增):
- gate 触发时断言 high 候选文件写入 + `_gated/gated-candidates.md` 生成 +
  返回 `gatedReportPath`。
- 覆盖策略:重跑覆盖旧诊断文件。
- 端到端脚本流:真实执行 `reduce-candidates.mjs` 后按退出码继续执行
  `write-candidates.mjs`,断言 high 文件和 `_gated/gated-candidates.md` 均落盘。
- 重复阻断:当 high 候选命中 disk duplicate / batch duplicate 时,断言不写候选,
  返回确认需求,且不会被 `mid-low-scope-required` 绕过。

回归(`test/yog/index.test.mjs` / `lint-verify-sync.test.mjs`):
- 确认 `_gated/` 不被候选扫描 / build-index / lint 误读为正式候选。

文档测试(`test/yog/skill-doc.test.mjs`):
- 若该测试断言 SKILL.md 关键字,更新其期望以匹配新门禁描述。

## 兼容性

- 老仓库无 `discover.maxMidLowCandidates` → 回落默认 10,行为等价于"中低信度上限 10"。
- `payload.maxCandidates` 调用方无需改动,数值语义从"总数上限"平移为"中低信度上限"。
- 与现有 `diskDuplicates` / `batchDuplicates` 门禁保持独立判定,但不得互相绕过:
  high 自动写入前仍必须通过重复确认门禁。
