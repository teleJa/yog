# Discover Candidates Subagent Fan-out 设计方案

- 日期：2026-07-02（第 3 轮修订 2026-07-03）
- 状态：draft（第 3 轮修订，收敛评审 P1 后待批准进入实现）
- 涉及组件：`skills/yog/SKILL.md`、`skills/yog/lib/scaffold.mjs`、`skills/yog/lib/constants.mjs`、`skills/yog/scripts/`、`templates/knowledge/`
- 关联文档：
  - `docs/changes/2026-07-01/course-live-context-generation-test-plan.md`（第 100-142 行 discover 实测编排）
  - `docs/changes/2026-07-02/discover-candidates-subagent-fanout-design-评审结果.md`（单文档门禁评审，3 个 P1）

## 0. 第 3 轮修订摘要（相对第 2 轮的实质变更）

本轮合并两份评审结论：单文档门禁评审的 3 个 P1（payload 契约 / `diskDuplicate` 类型 / symbol canonical form），以及核对代码后的设计逻辑评审（JOIN 键选择、门禁语义）。核心变更如下，后续各节按此改写：

1. **JOIN 键只认代码锚点**：`code_symbols` 交集是唯一无条件自动 JOIN 的强信号；`slug` / `name` 单独相等**不再自动合并**，降级为 `possibleDuplicates` 提示。理由：`name` / `slug` 与被否决的 keyword 一样是 agent 主观命名，按 2.3 的 asymmetry 论证不能当自动合并键（见第 6 节第 2 步）。
2. **传递聚类只走代码边**：连通分量合并只在 symbol 交集边上传递，杜绝"单条弱边链式吞并整簇"（见第 6 节第 2 步）。
3. **打分从门禁关键路径撤下，降为纯排序/展示**：分数只决定展示档位与 review 顺序，**不再驱动写入门禁**。理由：文档自认打分是启发式，不该让不可靠分数拦截整批写入（见第 6 节第 3、4 步）。
4. **数量门禁改按 JOIN 后总簇数**：恢复 `SKILL.md:83` "超过 10 个候选即停下收窄"的防洪语义，不再用"非 low 候选数"这一 low 豁免口径（那会让单批静默写入几十个 low 候选）。low 候选仍写盘，但计入门禁总数（见第 6 节第 4 步与 6.1）。
5. **candidate frontmatter 持久化 `code_symbols`**：让磁盘去重也能用 symbol 这个强信号；磁盘命中同对象时**复用磁盘已有 candidateId 更新**，而非铸造新 ID 产生同对象双文件（见第 7 节与第 9 节）。
6. **补齐 symbol canonical form 与最终 create-candidate payload 顶层契约**：消除 reduce 输出、create-candidate 调用、单测三者的字段断链，统一 `diskDuplicate` 为对象结构（见 5.1、第 6 节、第 7 节）。

## 1. 背景与问题

Yog 的 `discover-candidates` 阶段目标是：在陌生业务仓库中自动发现「多个」业务上下文候选，写入 `docs/knowledge/candidates/`，作为后续 `promote-candidate` 的输入。

当前实现有三个结构性缺口：

1. **discover 只是一段口头 agent workflow**（`SKILL.md:81`），没有明确的 subagent 编排规范。主 agent 单线程扫大仓，容易上下文溢出、召回不全，实际只发现单个候选（见测试计划 2026-07-02 记录第 309-314 行）。
2. **去重只覆盖「单候选 vs 磁盘」**。`findCandidateDuplicates`（`scaffold.mjs:224`）在每次 `create-candidate.mjs` 时对比磁盘已有候选，无法处理「同一批多个 subagent 之间」的重叠——而 fan-out 后跨面重叠是必然的。
3. **汇总、打分、门禁、批量写入全靠 agent 即兴判断**。测试计划里「主线程汇总规则」（第 122-127 行）没有任何确定性工具承载，每次执行结果不可复现。

## 2. 设计基石

本轮评审确立三条原则，它们决定后续所有设计，先单列。

### 2.1 代码是 discover 阶段的唯一真相源

**文档不是事实，是主张（claim）。** 文档存在只证明「有人曾经想这么做」，不证明「代码现在这样」。文档与代码随时漂移：文档写了代码没做、代码改了文档没跟、描述边界与真实边界不一致。

candidate 会被 promote 成知识库权威事实，源头掺入未核实的主张，就是在权威知识库最上游埋可信度漏洞。因此：

> **discover 只发现「能静态追溯到执行路径」的候选。每个候选都必须指回真实存在的代码符号，无例外。**

真相源判据是一句话——**「如果它和代码不一致，程序会不会出错？」**

**重要边界**：真相源指向**执行结构**（哪些类/方法/路由存在、如何连接），不包含**业务规则的参数值**（退款窗口期=7天、费率表、阈值配置）。后者是 enrich 阶段的业务知识，不是 discover 的锚点。

- **算真相源（会出错，自带一致性保证）**：`.java` 源码、`Mapper.xml`（MyBatis SQL）、路由/接口注解、Dubbo/Feign 接口声明、被运行时加载的**结构性配置**（服务地址、MQ topic 声明、表结构契约）。
- **不算真相源（不会出错，是主张）**：PRD、需求设计、README、OpenSpec 散文描述、配置文件中的业务规则参数值。这些降级到 promote / enrich 阶段作为核实参照。

### 2.2 discover / promote / enrich 三段式认知分层

文档价值没被否定，只是推迟到有代码地基之后才引入。信息永远从「最硬的事实」流向「最软的判断」，不逆流。

| 阶段 | 真相源 | 产物 | 谁核实 |
|---|---|---|---|
| **discover** | 代码（唯一） | 代码锚定的候选 | 确定性脚本 |
| **promote** | 代码 + 文档/PRD 交叉 | 正式 context/capability/evidence | 主线程 + 人工确认 |
| **enrich**（用户后续用 agent 补充） | 人的业务知识 | 业务边界、术语、设计意图 | 人 |

docs/PRD 的业务框定能力没丢，而是挪到 promotion（`SKILL.md:99` 已有 boundary-verify subagent）与 enrich。这条分界线比「docs 也当发现眼镜」更自洽。

### 2.3 fan-out 是「多副眼镜」，reduce 的真名是 JOIN

discover 的 subagent **不按目录分区（scope partition）**，而是**按证据来源分视角（lens partition）**：每个 agent 看**同一个仓库**，各自抽取一种代码信号。

按业务模块分区在这里不可行：(1) 要按模块分区得先知道有哪些模块，而那正是 discover 要发现的，循环论证；(2) Spring 服务仓顶层是分层（`controller/service/mapper`）而非分模块，业务特性横切所有层，硬按目录切只会让每个 agent 只看到半个候选。

lens 模型下，**同一个业务对象被多副眼镜各看到一次是设计目的，不是重复 bug**：「课程飞书链接」在 controller 眼镜里是 `createCourseLink` 入口，在 data 眼镜里是缓存 mapper，在 service-flow 眼镜里是整条调用链。因此：

> **reduce 的本质是 JOIN（把一个对象的多面证据聚成一条富证据候选），不是 dedup（删噪声）。** 跨面一致本身就是最强可信度信号。

会侵蚀召回的不是 JOIN，而是「把两个不同对象错并成一个」。按 2.1「代码是唯一真相源」的同一条逻辑：**只有代码锚点（`code_symbols` 交集）才是客观、高精度、可复现的对象身份信号**；`slug` / `name` 是 agent 主观命名，与 keyword 一样属于「拍脑袋分类」，两个不同对象被起成同名（如都叫「课程管理」）的概率并不比共享 `课程` 关键词低。

因此 JOIN 键的准入标准与 2.1 判据一致——**「这个信号错了，代码会不会跟着错？」**：symbol 会（它就是代码），name / slug / keyword 都不会。所以：

> **自动 JOIN 只认 `code_symbols` 交集。`slug` / `name` / `keyword` / `possible_context` 一律不单独触发自动合并**，只在已有 symbol 边把两个候选连上之后，作为「同簇佐证」使用；单独命中时降级为 `possibleDuplicates` 提示，交人判断（见第 6 节第 2 步）。

这条比第 2 轮「slug/name 也自动 JOIN」更自洽：它让 JOIN 键与 discover 的唯一真相源对齐，不在 asymmetry 论证里留一条自我违背的弱边。

## 3. 目标与非目标

### 目标

- 把 discover 扫描阶段规范成 **3 副代码眼镜并行 fan-out**，以上下文隔离和召回覆盖为首要价值，加速为副产品。
- 定义 subagent 的**结构化输出契约**，每个候选强制携带代码锚点，让主线程可确定性 JOIN。
- 新增确定性的**汇总/JOIN/门禁脚本**，把测试计划中主线程手工做的事沉淀成可复现工具。
- 保证写入的 candidate body **不留空章节**（当前 `createCandidate` 只填「触发信号」一节）。

### 非目标

- 不把「语义理解 / 业务边界判断」做成脚本——那是 promote/enrich 的 agent + 人的职责，discover 只做代码锚定发现。
- 不在 discover 引入 docs/PRD 作为发现输入（见 2.1）；文档核实推迟到 promote。
- 不改变 candidate 不进入 `index.json` / `INDEX.md` 的既有约束。
- 不改动 `promote-candidate` 的 payload 契约（只优化 discover 入口，不动 promotion 出口）。
- 不做 fuzzy / semantic / embedding 去重；JOIN 只在确定性的对象身份信号上进行。
- subagent 之间零耦合、无实时通信，只经主线程汇聚。

## 4. 总体编排

discover 拆成三个阶段，职责边界清晰：

```
主线程 (orchestrator)
  │  阶段 A: 前置门禁 + 任务拆分
  ├─ 检查 CodeGraph 已初始化；检查 candidate.md 模板存在
  │  (任一缺失即停止 discover，报告需安装/初始化的工具)
  │
  │  阶段 B: fan-out 扫描 (并行, 只读, 全部代码眼镜)
  ├──→ controller-route-agent  扫 controller/feign/Dubbo/HTTP route/client entry
  ├──→ service-flow-agent      用 CodeGraph 扫 service 调用链/跨服务依赖
  ├──→ data-contract-agent     扫 mapper/entity/DTO/XML/表关系/缓存/状态机/消息
  │         每个 agent 返回结构化候选 JSON，每个候选强制带 code_symbols
  │         (只读, 不写盘)
  │
  │  阶段 C: JOIN + 门禁 + 写入 (确定性脚本 + 主线程判断)
  ├─ reduce-candidates.mjs: 按对象身份 JOIN、证据强度打分、数量门禁、磁盘冲突预检
  ├─ 主线程复核「疑似重复提示」与「>10 收窄」
  └─ 对 writable 候选调 create-candidate.mjs 批量写入
```

**关键设计原则**：subagent 只做「只读扫描 + 候选建议」，绝不写 `docs/knowledge/`。所有写盘、JOIN、门禁集中在主线程，避免并行写冲突，也让「发现」与「落盘」两个决策点分离。

### 为什么是这 3 副眼镜（而非 4，不含 docs-agent）

三个面按**代码证据来源**正交切分，全部锚定在代码上：

- `controller-route-agent`：外部入口型信号（controller、feign、Dubbo service、HTTP route、client entry）。
- `service-flow-agent`：流程型信号（service 调用链、核心业务服务、跨服务依赖）。
- `data-contract-agent`：数据契约型信号（mapper、entity、DTO、XML、表关系、缓存、状态机、消息）。

**不设 docs-scan-agent**（相对测试计划第 104-108 行的有意偏离）。原因见 2.1：文档是主张不是事实，让未核实的文档主张直接变候选，会在权威知识库最上游埋可信度漏洞，且会产生「文档描述了、代码里却不存在」的幽灵候选。docs/PRD 的业务框定推迟到 promote 阶段（`SKILL.md:99` 的 boundary-verify subagent）与 enrich 阶段。这样 discover 产出的每个候选都可指回真实代码符号，发现层语义更纯粹。

三副眼镜看的是同一个仓库、抽取不同代码信号，相邻面**有意重叠**（一个入口对象会被 controller-route 与 service-flow 同时命中），靠阶段 C 的 JOIN 收敛，而不是靠切分做到互斥——这规避了「MECE 切分把对象漏在边界缝里」的风险。

眼镜数量是**下限 3、可扩展**：大仓可按子域再拆（如 `service-flow-agent` 拆成 `order-flow` / `payment-flow`），但每副眼镜输出契约不变。

**其他可能 lens 的排除理由**：
- **infrastructure-agent**（MQ、缓存、定时任务）：MQ topic、缓存 key、消息契约都是数据契约的一种，已归入 `data-contract-agent`；定时任务的执行入口是 controller 的变体，归入 `controller-route-agent`。
- **test-agent**（从集成测试反推业务场景）：集成测试的调用链是流程的一种表达，已被 `service-flow-agent` 覆盖（测试代码路径与业务代码路径同构）。
- **config-agent**（配置文件业务规则）：见 2.1，配置参数值（退款窗口期=7天）是业务规则而非执行结构，不作为 discover 锚点，推迟到 enrich 阶段。

这三副眼镜的正交性保证：每个 lens 抽取的信号类型在"真相源是执行结构"的约束下不可再分，且覆盖了 Spring 分层架构的全部代码证据来源。

## 5. Subagent 输出契约

每个 subagent 的 final message **必须是一个 JSON 对象**（不是散文），主线程直接解析。契约如下：

```json
{
  "agent": "controller-route-agent",
  "scan_scope": ["src/main/java/**/controller/**", "src/main/java/**/feign/**"],
  "tools_used": ["codegraph"],
  "candidates": [
    {
      "candidateId": "course-live-link-entry",
      "name": "课程直播链接入口",
      "summary": "一句话业务含义",
      "business_boundary": "负责的业务边界描述",
      "responsibilities_hint": "可能负责什么",
      "non_responsibilities_hint": "可能不负责什么",
      "code_symbols": ["CourseLinkFeignController#createCourseLink"],
      "evidence_paths": ["src/.../CourseLinkFeignController.java"],
      "keywords": ["课程", "飞书", "直播", "链接"],
      "possible_contexts": ["course-live", "feishu-integration"],
      "confidence": "high",
      "confidence_reason": "为什么给这个分",
      "skip_reason": ""
    }
  ],
  "skipped": [
    { "name": "xxx", "skip_reason": "无稳定业务信号 / 纯技术工具类 / 无代码锚点" }
  ]
}
```

字段约束（对齐 2.1 代码唯一真相源）：

- `candidateId`：kebab-case，匹配 `ID_PATTERN`（`[a-z][a-z0-9-]*`），否则阶段 C 拒收。
- **`code_symbols`：必填，至少 1 项**。这是候选的存在性证明——无代码锚点即不是合法候选，直接进 `rejected`。这是相对旧契约（symbol 可选）最重要的收紧。
- `evidence_paths`：至少 1 项，作为符号所在文件的佐证。
- **`service-flow-agent` 的链路符号上报策略**（量化要求，见 5.2）：报**入口符号 + 直接调用的 1-2 层核心服务符号 + 数据层锚点符号**，不递归报所有 helper。
  - 示例：对 `createCourseLink` 链路，报 `[CourseLinkFeignController#createCourseLink, CourseLinkService#createFeiShuCourseLink, FeiShuLinkCacheMapper.save]`（3-5 个关键符号）而非整个 20+ 符号的完整调用树。
  - 原因见 5.2：它是三副眼镜之间 symbol-JOIN 的**桥**，既要搭到入口和数据实现连通，又要避免符号爆炸淹没核心信号。
- `confidence`：仅 `high | medium | low`。**跨 agent 不可直接比**——阶段 C 用证据强度重新打分，见第 6 节。
- 无法落候选的项必须进 `skipped[]` 并写 `skip_reason`，不允许静默丢弃（便于评估召回）。

### 5.1 `code_symbols` canonical form

`code_symbols` 是 JOIN 强键，必须使用可复现的 canonical form。subagent 不得输出自然语言描述、文件路径、路由字符串或未归一的方法名作为 `code_symbols`。

| 符号类型 | canonical form | 示例 | 是否参与强 JOIN |
|---|---|---|---|
| Java 方法 | `Class#method` | `CourseLinkFeignController#createCourseLink` | 是 |
| Java 类型 / DTO / Entity | `Class` | `CourseLinkRequest` | 是 |
| MyBatis Mapper 方法 | `MapperClass#statementId` | `FeiShuLinkCacheMapper#save` | 是 |
| Dubbo / Feign 接口方法 | `InterfaceClass#method` | `CourseLinkFeignClient#createCourseLink` | 是 |

规则：
- `Class` 使用简单类名，不带 package；同名类冲突时，subagent 必须在 `evidence_paths` 中给出对应文件路径，reduce 仍只用 `Class#method` 做强 JOIN。
- 不保留参数签名；重载方法在 discover 阶段按同一业务入口处理。若重载确实代表不同业务对象，必须用不同 `candidateId/name` 区分，并在 `evidence` 正文里说明。
- `Class.method`、`package.Class#method`、`Class#method(args)`、空字符串、文件路径、HTTP route、MQ topic、缓存 key 都不是合法 `code_symbols`。前三类可由 reduce 归一为 canonical form；无法归一的项移入该候选的 `invalidSymbols[]`，不参与强 JOIN。
- 若一个候选所有 `code_symbols` 都无法归一，该候选进入 `rejected[]`，原因是 `code_symbols has no canonical entries`。
- HTTP route、MQ topic、缓存 key、表名、配置 key 仍可作为证据写入 `evidence_paths` 或 candidate `evidence` 正文，但不作为 symbol 强 JOIN 键。

### 5.2 三副眼镜之间的 symbol-JOIN 连通性

砍掉 docs-agent 后 JOIN 键统一为 symbol（人人都有），但**连通性仍不完整**。同一个对象在三副眼镜里报的符号集可能不相交：

- controller-route → `CourseLinkFeignController#createCourseLink`（入口符号）
- data-contract → `FeiShuLinkCacheMapper#save`、`FeiShuLinkFolderMapper`（数据符号）
- service-flow → 整条链 `CourseLinkFeignController#createCourseLink → CourseLinkService#createFeiShuCourseLink → FeiShuLinkService#createFeiShuDocumentUrl → FeiShuLinkCacheMapper#save`

controller 的符号集与 data 的符号集**天然不相交**，只做两两 symbol 交集永远连不上。真正把它们连起来的是 **service-flow 报的调用链**——它同时含入口符号与下游数据符号，因此能分别与 controller、data 相交，充当**桥**。

推论：**symbol-JOIN 三方连通，当且仅当 service-flow 的符号集足够宽能同时搭到入口和数据。** 若桥断（链路报得不全），同一对象会以 2~3 个部分连通的碎片进来。处理策略见第 6 节——**碎片放行，不强行连**：误分裂代价 = review 时人多看一条（可见、可恢复）；误合并代价 = 永久丢一个对象（静默、不可逆）。代价不对称决定「不确定就不 JOIN」。

## 6. 汇总脚本 `reduce-candidates.mjs`（新增）

本方案唯一的新脚本，把测试计划第 122-127 行的「主线程汇总规则」沉淀成确定性工具。它**只做纯计算 + 磁盘冲突预检，不写候选文件**：输入一批 subagent 候选，输出 JOIN、打分、门禁判定后的结果，供主线程决策。

### 输入（stdin JSON）

```json
{
  "repoRoot": "/path/to/repo",
  "knowledgeRoot": "docs/knowledge",
  "payload": {
    "batches": [ /* 每个 subagent 输出的 JSON 对象，见第 5 节 */ ],
    "maxCandidates": 10
  }
}
```

### 处理流程（严格按序，两趟：先 JOIN 后打分）

**第 0 步 展平**：把所有 batch 的 `candidates[]` 合并成一个列表，每项记录来源 agent。

**第 1 步 格式校验（不短路，即使后续触发 gate 也要完整记录）**：以下任一不满足移入 `rejected[]` 并记原因：
- `candidateId` 不匹配 `ID_PATTERN`；
- `name` 为空；
- `summary` 为空；
- `code_symbols` 为空，或归一后没有任何 canonical symbol（违背 2.1 代码唯一真相源，无锚点不是合法候选）；
- `evidence_paths` 为空。

格式校验时对 `code_symbols` 执行 5.1 的 canonicalization，并把结果写入候选内部字段 `canonicalSymbols[]`。后续 JOIN 和打分只使用 `canonicalSymbols[]`，原始 `code_symbols` 保留到输出中用于审计；无法归一的项放入 `invalidSymbols[]`。

格式校验结果始终完整记录在输出的 `rejected[]`，即使后续第 4 步触发数量门禁返回退出码 1，用户也能同时看到两类问题。

**第 2 步 JOIN 分组（对象身份信号，不打分）**：这是「合并」而非「打分」，必须先做——因为「一个对象被几副眼镜命中」要 JOIN 后才知道。

JOIN 键只用**代码锚点身份信号**（指向同一个具体执行对象，客观、高精度）：

| 规则 | 判据 | 动作 |
|---|---|---|
| symbol 交集 | `canonicalSymbols` 有交集（同一 `Class#method` / `Class` / `MapperClass#statementId`） | **自动 JOIN** |

**主观命名与话题相似信号（candidateId / name / keyword / possible_context）不参与自动 JOIN**——它们是 agent 拍脑袋的分类或命名，两个不同对象常共享 `课程`、`飞书` 这类词，也可能被不同 agent 起成同一个宽泛名字。拿它们当键会把不同对象错并、静默丢召回。它们降级为「疑似提示」，见第 5 步。

JOIN 用**连通分量聚类**，且只在 `canonicalSymbols` 交集边上传递（A~B 有 symbol 交集、B~C 有 symbol 交集 → A/B/C 并一簇；每条边都是代码锚点强边，链式合并可接受）。合并一簇时：
- 证据取并集（`canonicalSymbols`、原始 `code_symbols`、`evidence_paths` 去重合并）；
- `hitAgents[]` = 簇内所有来源 agent 去重；
- **代表候选**：证据数量最多者胜，并列时 slug 字典序最小者——保证结果稳定可复现；
- `mergedFrom[]` 记录被并入的原始 candidateId 与来源 agent。

**第 3 步 证据强度打分（JOIN 之后，此时才有跨面命中信息）**：不信任 subagent 的原始档位，用可复现公式对每个**已合并的簇**统一打分：

```
score = min(code_symbols 并集去重数, 10) * 2   // cap 在 10，避免工具类误判
      + evidence_paths 并集去重数 * 1
      + (hitAgents 数 >= 2 ? +3 : 0)            // 跨面共识是最强信号，JOIN 后才算得出
归一档位: score >= 8 -> high, 4-7 -> medium, < 4 -> low
```

**计数边界说明**：
- `code_symbols 并集去重数`：簇内所有来源 agent 报告的符号合并后按 `canonicalSymbols` 去重（避免同一符号被多 agent 重复计数）。
- 符号数 cap 在 10：防止"被到处调用的工具类候选"因 50+ 符号得到虚高分数，而核心业务入口只有 3 个符号却被低估。
- 极端情况处理：如果簇的 symbols 去重后仍 >10 但跨 agent 命中数 <2，说明是单 agent 过度报告，cap 保证它不会因符号数量碾压真正的跨面共识候选。

原始 subagent confidence 保留为 `agent_confidence` 备查，归一档位只用于展示排序与 review 优先级，不参与写入门禁。（注：已无 docs 面，不再有「+1 docs 命中」项；`code_symbols` 必填也已在第 1 步保证，无需「无 symbol 降级」补丁。）

**第 4 步 数量门禁**：JOIN 后**总簇数** `> maxCandidates`（默认 10）→ 置 `gate: "narrow-scope-required"`，`writable` / `lowConfidence` 返回空，**短路后续步骤**（不再算 diskDuplicates），主线程据此要求收窄扫描范围。low 候选仍然写盘，但必须计入数量门禁，避免单批静默写入几十个低置信候选。

**第 5 步 装配输出分区**（gate ok 时）：
- 归一 `high | medium` 的簇 → `writable[]`（含 `create-candidate` 最终 payload，见第 7 节字段映射）；
- 归一 `low` 的簇 → 仍写入，但进 `lowConfidence[]` 单列（**不丢弃**，同样含 `create-candidate` 最终 payload）。理由见 6.1；
- deterministic 未 JOIN、但 `candidateId` / `name` / `keyword` / `possible_context` 有交集的簇对 → 记入 `possibleDuplicates[]`（**仅提示，不合并、不阻断**），交主线程/人判断。

**第 6 步 磁盘冲突预检**：对 `writable[] + lowConfidence[]` 每个候选，复用 `findCandidateDuplicates` 与磁盘已有候选比对。命中冲突时，元素上写入 `diskDuplicate: { matched: true, candidateIds: [...] }` 并返回退出码 3；未命中时省略 `diskDuplicate` 字段。

**冲突匹配策略**：用**簇内所有原始 candidateId**（代表候选 ID + `mergedFrom[]` 中的所有 ID）与磁盘候选比对，而非仅用代表候选 ID。避免以下混乱：
- 新批次 controller-agent 报 `course-link-a`，service-agent 报 `course-link-b`
- JOIN 后合并为 `course-link-a`（代表候选）
- 磁盘已有 `course-link-b`
- 若只用代表 ID 匹配会漏检，用户看到写入建议是 `course-link-a` 但实际与磁盘 `course-link-b` 冲突

冲突标记固定为对象结构：`diskDuplicate: { matched: true, candidateIds: ["course-link-b"] }`，明确匹配到了哪些磁盘候选。全文不得再使用 `diskDuplicate: true` 布尔口径。

**冲突后的主线程动作**：
- 默认不直接写新文件，避免同一对象出现两个 candidate 文档。
- 若 `candidateIds` 只有 1 个，主线程应优先复用磁盘已有 `candidateId` 更新该 candidate 的正文与 frontmatter，追加新证据并保留原 review 状态。
- 若 `candidateIds` 有多个，或人判断它们不是同一业务对象，必须人工确认后再选择“更新某个已有 candidate”或“显式创建独立 candidate”。显式创建独立 candidate 时才允许传 `confirmDuplicate: true`。
- 更新已有 candidate 时，frontmatter 也必须持久化 `code_symbols`（canonical symbols）、`keywords`、`possible_contexts` 的并集，使后续磁盘去重能继续使用代码锚点强信号。

**冲突确认后的写入契约**：
- 不新增脚本，扩展 `create-candidate.mjs` / `createCandidate()` 支持 `updateExisting: true` 和 `updateCandidateId`。这样候选创建与候选更新仍由同一个写入入口负责，避免再引入第二套 Markdown 注入逻辑。
- 更新已有 candidate 的输入 payload 必须包含：
  - `updateExisting: true`
  - `updateCandidateId`: 磁盘已有 candidate id，必须来自 `diskDuplicate.candidateIds[]`
  - `confirmDuplicate: true`
  - 新候选最终 payload 的 `candidateId/name/summary/body/code_symbols/keywords/possibleContexts/evidence/...`
- 更新目标路径固定为 `docs/knowledge/candidates/<updateCandidateId>.md`；`candidateId` 字段只作为新证据来源记录，不用于生成新文件名。
- frontmatter 合并策略：
  - `keywords`、`possible_contexts`、`code_symbols` 取磁盘旧值与新 payload 的并集，去重后稳定排序；
  - `name`、`status`、`promoted_to`、`created_at` 默认保留磁盘旧值；
  - 若磁盘旧 `name` 为空，才用新 payload `name` 补齐；
  - 不得把 `status` 从 `needs-review` 自动改成其它状态。
- 正文合并策略：
  - `触发信号`、`相关证据` 追加新证据，按行去重；
  - `可能的业务含义`、`可能归属的上下文`、`为什么暂不创建正式 Context`、`需要确认的问题` 只在旧章节为空或仍为 `[待补充：...]` 时用新 payload 兜底填充；
  - `处理结果` 保持旧值；若旧值为空，写入固定 `待 review / promote`。
- 输出结构固定为：
  ```json
  {
    "updated": true,
    "created": false,
    "candidateId": "course-link-b",
    "path": "docs/knowledge/candidates/course-link-b.md",
    "mergedFields": ["keywords", "possible_contexts", "code_symbols", "触发信号", "相关证据"],
    "issues": []
  }
  ```
- 显式创建独立候选只在人工判断“不是同一业务对象”时使用。此时仍走既有 `confirmDuplicate: true` 创建路径，输出 `created: true, updated: false`。

### 6.1 low confidence 不丢弃（修正上一轮的召回反噬）

candidate 是 needs-review 暂存区，`SKILL.md:89` 本就说候选「normally low or medium」——low 是常态，不是噪声。上一轮把 low 直接滤进 `skipped` 永不写盘，与「召回覆盖为首要价值」（3 目标）直接冲突：一个单 agent、单 symbol 命中的薄候选恰恰是 fan-out 想捞的。

因此 low 候选**仍然写盘**，只是单列 `lowConfidence[]` 并标 `confidence: low`，让主线程/review 决定是否 promote。真正被排除写盘的只有第 1 步格式不合格的 `rejected`。这守住 asymmetry：宁可多留一条低置信候选给人看，不可静默丢一个对象。

### 输出（stdout JSON）

```json
{
  "gate": "ok",
  "stats": {
    "raw": 14, "afterFormat": 12, "clusters": 7,
    "writable": 5, "lowConfidence": 2, "possibleDuplicates": 1,
    "diskDuplicates": 0, "rejected": 2
  },
  "writable": [ /* high|medium 簇，含 create-candidate 最终 payload，可直接写盘 */ ],
  "lowConfidence": [ /* low 簇，含 create-candidate 最终 payload，仍写盘，交 review */ ],
  "possibleDuplicates": [ /* candidateId/name/keyword/possible_context 交集的簇对，仅提示不合并 */ ],
  "rejected": [ /* 格式/证据/无代码锚点不合格，不写盘 */ ]
}
```

`diskDuplicate` 作为 `writable[]` / `lowConfidence[]` 元素上的对象标记，不单列数组；未命中磁盘冲突时省略该字段。

### 退出码（对齐现有脚本约定，见 `SKILL.md:34`，含优先级）

按优先级从高到低短路返回，避免歧义：

- `2`：输入格式错误（`batches` 结构非法）——最优先。
- `1`：`gate: narrow-scope-required`（触发 >10 门禁，gate blocker）。gate 命中时短路，不再计算磁盘冲突。
- `3`：`gate: ok` 且 `writable/lowConfidence` 中存在 `diskDuplicate?.matched === true`，需人工确认后再写。
- `0`：`gate: ok` 且无磁盘冲突。`possibleDuplicates` 非空**不影响**退出码（它只是提示，不阻断）。

## 7. Candidate body 补全（改动 `createCandidate`）

当前 `createCandidate`（`scaffold.mjs:475`）只把 `payload.body` 注入「触发信号」一节，模板另外 6 个章节全部留空。这与项目「不留空章节」的既有质量目标（见 2026-07-02 修复记录）冲突。

改动：`create-candidate.mjs` payload 扩展可选字段，`createCandidate` 按章节分别 `injectAfterHeading`。

### 7.1 subagent 字段 → candidate 章节映射（修上一轮的字段断链）

第 5 节 subagent 契约用 `business_boundary` / `responsibilities_hint` 等命名，而 candidate 模板章节是中文标题、`create-candidate.mjs` 历史 payload 用 `body`。两套命名必须有明确翻译层，否则 `reduce-candidates.mjs` 的 `writable[]` 无法「直接透传」。翻译在 **reduce 装配 `writable[]` 时**完成，产出 create-candidate 可直接吃的 payload：

| candidate 模板章节 | create-candidate payload 字段 | 来源（reduce 从簇里取） | 缺省兜底 |
|---|---|---|---|
| 触发信号 | `triggerSignals`（兼容旧 `body`） | 各 agent `summary` + 命中 agent 列表拼装 | 必填，无则该簇不该进 writable |
| 可能的业务含义 | `businessMeaning` | 代表候选 `business_boundary` | `[待补充：promote 阶段从文档/PRD 核实]` |
| 可能归属的上下文 | `possibleContexts`（frontmatter） | 簇内 `possible_contexts` 并集 | 空数组 |
| 相关证据 | `evidence` | 簇 `code_symbols` + `evidence_paths` 并集渲染成列表 | 必有（code_symbols 必填保证） |
| 为什么暂不创建正式 Context | `notFormalReason` | 固定：`needs-review：业务边界与归属待人工确认` | 同左 |
| 需要确认的问题 | `openQuestions` | 由 `responsibilities_hint` / `non_responsibilities_hint` 转成待确认问句；`possibleDuplicates` 命中时追加「疑似与 X 重复，待确认」 | `[待补充：业务边界与职责范围需在 promote 阶段确认]` |
| 处理结果 | —（脚本固定写） | 固定：`待 review / promote` | 同左 |

**兜底内容标识**：所有兜底占位符必须带 `[待补充：...]` 前缀，明确区分真实输入与自动生成占位，避免 review 时误以为是 agent 判断结果。

frontmatter 的 `keywords` / `possible_contexts` / `code_symbols` 由簇并集写入，供磁盘去重与后续路由用。`code_symbols` 写 canonical symbols，不写原始未归一字符串。

`createCandidate` 逐节 `injectAfterHeading`，任何字段缺失走兜底，**保证 7 章节开箱非空**。

### 7.2 `create-candidate` 最终 payload 契约

`reduce-candidates.mjs` 输出到 `writable[]` / `lowConfidence[]` 的每个元素必须可直接作为 `create-candidate.mjs` 的 `payload` 使用。最终 payload 至少包含：

```json
{
  "candidateId": "course-live-link-entry",
  "name": "课程直播链接入口",
  "summary": "一句话业务含义",
  "body": "触发信号正文，兼容旧 create-candidate 调用",
  "triggerSignals": "触发信号正文，等于 body 或由 body 兜底",
  "businessMeaning": "[待补充：promote 阶段从文档/PRD 核实]",
  "possibleContexts": ["course-live"],
  "keywords": ["课程", "直播"],
  "code_symbols": ["CourseLinkFeignController#createCourseLink"],
  "evidence": "- symbol: CourseLinkFeignController#createCourseLink\n- path: src/...",
  "notFormalReason": "needs-review：业务边界与归属待人工确认",
  "openQuestions": "[待补充：业务边界与职责范围需在 promote 阶段确认]"
}
```

装配规则：
- `candidateId`、`name`、`summary` 从代表候选继承；任一缺失时，该簇进入 `rejected[]`，不得进入 `writable[]` / `lowConfidence[]`。
- `triggerSignals` 由簇内各 agent 的 `summary`、`hitAgents[]` 和关键 `canonicalSymbols[]` 拼装；`body = triggerSignals`，用于兼容旧 `createCandidate()` 的 `payload.body` 校验。
- `createCandidate()` 内部使用 `effectiveBody = payload.body ?? payload.triggerSignals` 做真实内容校验；旧调用只传 `body` 仍合法，新调用传两者时二者应保持一致。
- `code_symbols` 来自簇内 `canonicalSymbols[]` 并集，去重后稳定排序；`createCandidate()` 将该字段写入 candidate frontmatter 的 `code_symbols: [...]`。
- `evidence` 必须由 `canonicalSymbols[]` 与 `evidence_paths` 并集渲染，不能为空。
- `possibleContexts` / `keywords` 使用簇内并集，去重后稳定排序。
- `businessMeaning`、`openQuestions` 可用 7.1 的 `[待补充：...]` 兜底，但 `candidateId`、`name`、`summary`、`body/effectiveBody`、`code_symbols`、`evidence` 不允许兜底为空。

### 7.3 向后兼容

所有新字段可选。旧调用（只传 `body`）行为不变：`body` 仍注入「触发信号」，其余 6 节走兜底占位而非留空。现有调用点与测试无需改动即可通过。

## 8. SKILL.md / 模板文案更新

1. `SKILL.md` 的 `## Init And Candidate Discovery` 段：把 discover 从「口头 workflow」升级为「三阶段 fan-out 编排」，明确：
   - 阶段 B 是 **3 副代码眼镜**（controller-route / service-flow / data-contract），只读、输出结构化 JSON、每候选强制 `code_symbols`；**不含 docs-scan-agent**（并说明文档核实推迟到 promote）；
   - 阶段 C 必须先跑 `reduce-candidates.mjs` 做 JOIN + 门禁再写盘，不允许主 agent 跳过汇总脚本直接逐个 `create-candidate`；
   - discover 报告字段：`raw / afterFormat / clusters / writable / lowConfidence / possibleDuplicates / rejected` 计数，及每个写入候选的命中 agent、代码符号、归一档位（归一档位仅表示 review 优先级，非写入门禁依据）。
   - **门禁口径必须与 `SKILL.md:83` 的既有防洪语义一致**：改写 `SKILL.md` 时保持「超过 10 个候选即停下、要求收窄范围」，只把计数对象明确为「JOIN 后总簇数」（含 low），不得改成「非 low 候选数」这类会让单批静默写入几十个 low 候选的口径。
2. `SKILL.md` 的 `## Scripts` 列表新增 `reduce-candidates.mjs` 条目。
3. `SKILL.md` 现有「Each auto-discovered candidate body must include」段（`:85-89`）改为对齐 2.1：候选证据必须是代码符号/路由/mapper 等执行路径构件，不再把 docs/OpenSpec 列为候选证据来源（它们是 promote 阶段的核实参照）。
4. `templates/knowledge/AGENTS.md` 的 Code Facts 段：补一句「discover 走 3 副代码眼镜 fan-out + reduce JOIN，候选须有代码锚点」（保持简短）。
5. discover 前置条件收敛为要求 CodeGraph 已初始化，否则停止。fan-out 不放松此门禁。

## 9. 改动清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `skills/yog/lib/scaffold.mjs` | 改 | 新增 `reduceCandidates()`（含 5.1 symbol canonicalization）；扩展 `createCandidate()` 逐节注入 + 兜底 + 写入 `code_symbols` frontmatter；支持 `updateExisting/updateCandidateId` 更新已有 candidate |
| `skills/yog/lib/constants.mjs` | 改 | 若 symbol canonical form 需要正则/枚举常量（如合法符号形态），在此集中定义，供 reduce 与测试共用 |
| `skills/yog/scripts/reduce-candidates.mjs` | 新增 | 薄封装，读 stdin 调 `reduceCandidates()` |
| `skills/yog/scripts/create-candidate.mjs` | 不改 | 已是薄封装，继续调用 scaffold；更新已有 candidate 也通过 payload 进入同一入口 |
| `templates/knowledge/templates/candidate.md` | 改 | frontmatter 新增 `code_symbols: []` 字段，使 canonical symbols 可持久化，供后续磁盘去重用代码锚点强信号比对 |
| `skills/yog/lib/lint.mjs` / `frontmatter` 相关 | 核查 | 确认 candidate frontmatter 新增 `code_symbols` 不触发既有 lint 误报；如需要，补充对该字段的宽松解析 |
| `skills/yog/SKILL.md` | 改 | discover 三阶段编排 + 3 眼镜 + reduce + 脚本列表 + 候选证据口径 + 门禁按总簇数口径 |
| `templates/knowledge/AGENTS.md` | 改 | 补一句 fan-out + 代码锚点提示 |
| `test/yog/reduce-candidates.test.mjs` | 新增 | 见验证方案 |
| `test/yog/candidate.test.mjs` | 改/新增 | 覆盖 body 章节补全 + `code_symbols` frontmatter 写入 + `updateExisting` 合并更新 |

## 10. 验证方案

`reduceCandidates()` 是纯函数（除第 6 步磁盘预检外无 IO），单测友好。必测场景：

**正向场景**：
- **JOIN — symbol only**：只有 `canonicalSymbols` 交集触发自动合并；同 slug / 同 name 但无 symbol 交集时不合并，只进入 `possibleDuplicates`。
- **JOIN — 桥连通**：controller 候选（入口符号）与 data 候选（mapper 符号）无直接交集，但 service-flow 候选链路同时含两者 → 三者并成一簇。
- **JOIN — 碎片放行**：service-flow 链路只报代表符号、桥断 → 同对象留 2 个碎片候选，均放行、不强行合并。
- **不拿主观信号 JOIN**：两个不同对象仅共享 candidateId、name、keyword `课程` 或 possible_context `course` → **不合并**，记入 `possibleDuplicates`，退出码不受影响。
- **两趟顺序**：跨 2 agent 命中的簇因 `+3` 升到 high；验证 `+3` 在 JOIN 之后才计入（先打分算不出）。
- **code_symbols 必填**：无 `code_symbols` 的候选进 `rejected`，不进任何写盘分区。
- **low 不丢弃**：单 agent 单 symbol 薄候选归一 low → 进 `lowConfidence[]` 而非被丢，仍可写盘。
- **数量门禁**：JOIN 后总簇数 >10 → `gate: narrow-scope-required`、`writable` / `lowConfidence` 空、退出码 1、短路不算磁盘冲突。
- **磁盘冲突**：与已有 candidate 冲突 → 元素标 `diskDuplicate: {matched: true, candidateIds: [...]}`、退出码 3。
- **单冲突更新**：`updateExisting: true` + 单个 `updateCandidateId` → 更新已有 candidate，不创建新文件；frontmatter 并集去重，正文证据追加去重，输出 `updated: true`。
- **多冲突人工选择**：多个 `candidateIds` 时，只有显式传入其中一个 `updateCandidateId` 才更新；未选择时继续返回确认所需信息，不写盘。
- **显式创建独立候选**：人工判断不是同一对象并传 `confirmDuplicate: true` 且不传 `updateExisting` → 创建独立候选，输出 `created: true, updated: false`。
- **退出码优先级**：非法 batch → 2 优先于一切；gate 命中 → 1 优先于 3。
- **最终 payload 可写**：`reduceCandidates()` 输出的每个 `writable[]` / `lowConfidence[]` 元素都能直接作为 `create-candidate.mjs` payload，包含 `candidateId/name/summary/body/code_symbols/evidence` 必填字段。
- **body 补全**：`createCandidate` 传全字段 → 7 章节非空；只传 `body` → 其余走兜底非空；跑现有 lint 不报 `empty shell`。

**异常输入容错场景（新增）**：
- **非法 JSON 输入**：subagent 返回散文而非 JSON → 脚本返回退出码 2，`issues` 明确报告哪个 batch 解析失败。
- **空 candidates 数组**：某 agent 返回 `{candidates: [], skipped: [...]}` → 正常处理，不报错，`stats.raw` 反映实际输入数。
- **符号格式归一**：`code_symbols` 含 `Class.method`、`package.Class#method`、`Class#method(args)` 时可归一为 canonical form；空字符串、文件路径、HTTP route 等无法归一的项进 `invalidSymbols[]`，若没有任何 canonical symbol 则该候选进 `rejected`。
- **损坏的磁盘候选**：磁盘已有 candidate 的 frontmatter 损坏无法解析 → `findCandidateDuplicates` 跳过该文件并记录警告，不阻断处理。
- **缺失必填字段**：`candidateId`、`name`、`summary` 任一缺失 → 进 `rejected`，明确列出缺失字段。
- **批量格式错误 + gate 同时触发**：第 1 步格式校验**不短路**，`rejected[]` 完整记录所有格式问题，即使后续触发 gate 返回退出码 1，用户也能同时看到两类问题。

回归：`npm test` 全绿。当前基线 `test/yog/` 下约 72 处 `test()` 断言（测试计划第 283 行「60/60」为断言组口径，二者不同，回归以 `npm test` 实际输出为准）。

端到端复测：在 `services/course` 真实仓库按测试计划第 4 步跑 3 眼镜 fan-out，记录 `raw / clusters / writable / lowConfidence` 与召回抽样，验证不再「只发现 1 个飞书候选」，且每个候选都有代码符号锚点。

## 11. 分期落地

- **P1（核心）**：`reduceCandidates()` + `reduce-candidates.mjs` + 单测；`createCandidate` 逐节注入 + 单测。
- **P2（编排文案）**：`SKILL.md` 三阶段编排 + 3 眼镜 + 脚本列表 + 候选证据口径；`templates/knowledge/AGENTS.md` 提示。
- **P3（验证）**：`npm test` 回归 + `services/course` 端到端 fan-out 复测，回填测试计划实测记录。

## 12. 风险与权衡

- **打分是启发式**：证据数量不完全等于业务重要性。缓解：本轮已把打分从写入门禁的关键路径撤下——归一档位只用于**展示排序与 review 优先级**，写入门禁改由「JOIN 后总簇数 > maxCandidates」这一确定性口径驱动（第 6 节第 4 步）。启发式分数不再能拦截或放行整批写入，且 low 不丢弃、最终 promote 由主线程/人拍板，脚本不做终审。
- **subagent 输出非结构化**：agent 返回散文而非 JSON 会导致解析失败。缓解：契约写死在 SKILL.md 与 subagent prompt，`reduceCandidates()` 对非法 batch 结构返回退出码 2 并明确报错。
- **桥断导致对象碎片化**：service-flow 链路报得不全会让同一对象留多个碎片。缓解：契约要求 service-flow 报完整链路符号（5.2）；残留碎片按 asymmetry 放行，交 review 收敛，不追求脚本层完美聚合。
- **fan-out 成本**：3 subagent 比单线程贵。权衡：discover 是低频、一次性的知识库冷启动动作，上下文隔离与召回覆盖收益远大于 token 成本；加速是真实副产品。
- **不含 docs-agent 的取舍**：discover 阶段候选命名可能偏技术腔、业务术语不足。缓解：这是有意取舍（2.1 代码唯一真相源），业务框定推迟到 promote（`SKILL.md:99` boundary-verify）与 enrich，用文档交叉核实 + 人补语义，而非在最上游注入未核实主张。
- **过度工程化质疑**：discover 本质是 agent 能力，脚本不应越界做语义判断。本方案严格把脚本限制在「确定性 JOIN / 打分 / 门禁」，语义扫描、业务边界与终审仍是 agent + 人的职责。
