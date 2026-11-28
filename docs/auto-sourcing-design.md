# 全自动选品方案设计（候选池 + 自动算账分级，GO 由人确认）

> 目标终点（已与需求方确认）：系统自动发现候选、拉真实数据、算账、分级；**最终 GO 保留人工确认**。不破解项目三条硬边界：不做未授权爬虫、不把 AI 生成数据当真实售价、不自动定标/下单。
>
> 日期：2026-11-24 · 基于 HEAD `767c4b93` · 图结构见 `graphify-out/GRAPH_REPORT.md`

---

## 0. 核心判断：卡点在哪

全自动的瓶颈**不在算账**，这几件事已经是纯函数、零人工：

| 环节 | 现成能力 | 位置 |
|---|---|---|
| 单位经济算账 | `calculateEconomics()` / `calculateTargetLandedCost()` | `src/lib/economics.ts:76,165` |
| 机会分与建议 | `opportunityScore()` / `recommendationFor()` | `src/lib/economics.ts:248,262` |
| 证据不足自动降级 | `evaluateDecisionStage()`（无真实证据 → GO 自动降 HOLD） | `src/lib/economics.ts:288` |
| 市场格局/合规快筛 | `evaluateFastScreen()`（HHI、CR3、评论中位数、合规红线） | `src/lib/sourcing-funnel.ts:379` |
| 约束过滤 | `checkHypothesisAgainstConstraints()` | `src/lib/sourcing-funnel.ts:115` |
| 候选看板状态 | `deriveCandidateKanbanStage()`（6 列） | `src/lib/sourcing-funnel.ts:533` |
| 真实竞品/报价入库 | `importCandidatesCsv()` / `importKeepaByAsins()` / `importQuotesCsv()` | `src/lib/ingestion.ts` |
| 假设→案卷 | `promoteHypothesisToProductCase()` | `src/app/actions.ts:709` |

**真正缺的两块：**

1. **候选发现源**：`fetchKeepaCandidates()` 只接受 `asins[]`（单次≤100），**不能按关键词搜索**。没有"品类/关键词 → 候选 ASIN 列表"这一步，全自动无法启动。
2. **编排层 + 调度**：现有流程靠用户在多个页面间手动触发（生成假设 → 扫搜索页 → 录成本 → 定标）。没有任何 `cron`/`setInterval` 调度，也没有把上面这些纯函数串成一条流水线的 orchestrator。

所以四个方案的差异，**本质是"候选发现 + 数据真实性"怎么解决**，算账层完全复用、不用重写。

---

## 1. 方案③ 数据泵 + 全自动判定（推荐主干）

人只保留一个动作：给一次真实数据种子（上传 CSV 或配 Keepa Key）；之后整条流水线自动跑完，输出带分级的候选池。

### 数据流

```
[人一次输入] 种子：品类关键词 + 站点 + 约束 + (CSV 或 Keepa Key)
      │
      ▼
① 候选发现   AI 发散假设(ai-sourcing) → 关键词 → 竞品 ASIN 种子池
      │        （AI 只负责"去哪找"，不提供价格数字）
      ▼
② 真实数据泵 importKeepaByAsins(asins) / CSV
      │        → 真实售价、BSR、评论数写入 opportunity_evidence
      ▼
③ 自动快筛   evaluateFastScreen() → 淘汰：大牌垄断/评论壁垒/合规红线
      ▼
④ 自动算账   platformEconomicDefaults(售价) → calculateEconomics()
             → opportunityScore() → evaluateDecisionStage()
             → 无真实报价 ⇒ 全部 provisional（建议 HOLD，不签发 GO）
      ▼
⑤ 自动分级   S / A / B / HOLD / 淘汰 + 每条附机器可读理由
      ▼
⑥ 候选池看板 人只审 S/A 级 → 录真实报价 → 系统重算 → verified GO → 人确认立项
```

### 改动清单

| 类型 | 文件 | 内容 |
|---|---|---|
| 新增 | `src/lib/auto-pipeline/orchestrator.ts` | 核心编排：串 ①→⑤，每步独立可重入、失败隔离 |
| 新增 | `src/lib/auto-pipeline/grading.ts` | 分级规则：`S/A/B/HOLD/ELIMINATED`，依赖 `evaluateDecisionStage` 的 `stage` 与 `blockedReasons` |
| 新增 | `src/lib/auto-pipeline/types.ts` | `AutoRunConfig` / `AutoCandidate` / `AutoGrade` / `AutoRunSummary` |
| 新增 | `src/app/api/auto-pipeline/route.ts` | POST 触发一次批量运行；GET 查运行状态与结果 |
| 新增 | `src/app/auto-pipeline/page.tsx` + `auto-pipeline-client.tsx` | 配置表单 + 候选池分级看板 |
| 新增 | `db/schema.sql` + migration | `auto_pipeline_runs`(run 元信息/状态/耗时) + `auto_candidates`(候选、等级、理由 JSON、关联 hypothesis)。**不新建数据表存竞品**，复用 `opportunity_evidence`/`competitor_snapshots` |
| 修改 | `src/components/app-sidebar.tsx` | "选品"子项加"自动选品"（或替换 `/discover` 入口） |
| 修改 | `src/lib/audit-logs.ts` 调用点 | 每次自动运行记一条审计：谁触发、多少候选、多少淘汰 |

### 分级规则草案（grading.ts）

| 等级 | 判定 | 人的动作 |
|---|---|---|
| S | `evaluateFastScreen` 全 pass + 净利率 ≥ 24% + score ≥ 75 | 优先录报价，可直接推进 |
| A | 快筛 pass + 净利率 18–24% | 录报价后复核 |
| B | 快筛 hold（竞品不足）但 economics 达标 | 补扫竞品 |
| HOLD | `evaluateDecisionStage` 返回 provisional 且 raw=GO | 等真实报价 |
| 淘汰 | 快筛 fail（垄断/评论壁垒/合规红线）或 raw=NO-GO | 无需处理，留审计 |

关键：**任何等级都不输出"GO"**。`GO` 只在人录入真实报价后、由既有 `evaluateDecisionStage()` 在 verified 阶段产生——这条边界写进类型：`AutoCandidate.verdict: "HOLD" | "NO-GO" | "PENDING"`，**类型层面禁止自动 GO**。

### 风险

- **候选发现仍是半自动**：AI 发散出的方向需要转化成可拉数的 ASIN。若用户没有 ASIN 种子池，①会退化成"关键词建议"，需人工去搜索页取 ASIN。缓解：把 Chrome 扩展的"当前页 Top 20 ASIN 批量导出"做成种子入口——扩展已有解析能力，改动小。
- **Keepa 有 API 配额与费用**：`registry.ts` 里已标注 `KEEPA_API_KEY`；批量拉数要加并发上限与缓存，避免重复扣费。
- **成本假设是估算**：`platformEconomicDefaults()` 是平台默认值，不是真实报价。流水线必须显式标注 `pricingSource: "estimated"`，界面上不能显示成"已核实利润"。
- **运行幂等**：重复跑同一批种子不能产生重复候选；用 `requestKey` + ASIN 去重（现成模式见 `createAISourcingBatch`）。

### 工作量
中等。核心编排约一个文件 + 一张表 + 一个页面，其余全是调用现成函数。

---

## 2. 方案① 授权 API 流水线（真·全自动，合规）

在方案③基础上，把"候选发现"和"报价获取"也自动化，全程真实数据。

### 数据流
```
关键词/品类 → Keepa Best Sellers / 类目榜单 API → 真实 ASIN 池（自动发现）
     → Keepa 拉真实售价/BSR → 1688 官方接口查供应报价（真实）
     → calculateEconomics → evaluateDecisionStage（verified）
     → 分级 → 人只做最终 GO 确认
```

### 改动清单
| 类型 | 文件 | 内容 |
|---|---|---|
| 新增 | `src/lib/connectors/keepa-search.ts` | Keepa Best Sellers / 类目榜单适配器，输出 ASIN 列表（现有 `keepa.ts` 只按 ASIN 拉详情） |
| 新增 | `src/lib/connectors/alibaba1688.ts` | 1688 官方开放平台适配器：按关键词搜供应商品、取价格区间/MOQ。仅读，不发 RFQ |
| 修改 | `src/lib/connectors/registry.ts` | `alibaba_1688` 的 `adapterImplemented: false → true`；`amazon_sp_api` 保持 `false`（SP-API 不能作竞品销量源，见现有 note） |
| 修改 | `src/lib/ingestion.ts` | 加 `importKeepaSearchResults()` / `import1688Quotes()`，复用 `withIngestionRun()` 记账 |
| 复用 | 方案③全部 | 编排层、分级、看板、表结构原样复用 |

### 关键约束与风险
- **资质门槛**：1688 开放平台需企业资质审核，周期不可控；`registry.ts` 已明确"不采用未授权爬虫"。
- **SP-API 定位**：`registry.ts` 写明它是"自有店铺 Listing/库存/订单，不能作为竞品销量数据源"——全自动选品**不能依赖 SP-API 发现竞品**。
- **API 成本**：Keepa 按调用计费，类目榜单 + 批量详情叠加，需设预算上限。
- **1688 价格 ≠ 可成交报价**：搜索页标价是起订量阶梯价，不能直接当"真实工厂报价"签发 GO；`evaluateDecisionStage` 的 `hasVerifiedSupplierQuote` 仍需人工确认报价后才置真。

### 工作量
大。主要是两个 adapter + 资质流程，编排层可复用方案③。

---

## 3. 方案② AI Agent 发散（最快出 demo，但数据非真实）

完全复用现有的 `competitor-auto-import.ts`（`mode: "model" | "template" | "bulk_text"`）和 `ai-sourcing`，让 Agent 自动跑"生成假设 → 生成竞品画像 → 快筛 → 分级"。

### 改动清单
| 类型 | 文件 | 内容 |
|---|---|---|
| 新增 | `src/lib/auto-pipeline/agent-loop.ts` | 多轮 Agent 编排：生成假设 → 自评 → 淘汰 → 输出候选池 |
| 新增 | `src/app/api/auto-pipeline/route.ts` | 同方案③，数据源换成 AI 生成 |
| 修改 | `src/lib/competitor-auto-import.ts` | 给 AI 生成条目打 `evidenceSource: "ai_generated"` 标记（当前已有 `mode` 字段，但未在下游门禁中区分真伪） |

### 致命约束
AI 生成的竞品价格**不是真实售价**。`evaluateDecisionStage()` 明确规定：
> "缺少真实竞品价格证据（仅靠估算或 AI 假设，不能签发正式 GO）" → GO 强制降 HOLD。

所以方案②**只能输出线索与 HOLD，永远出不了真 GO**。它的价值是"全自动找方向"，不是"全自动立项"。作为方案③的上游线索生成器是合理的，单独作为终点则不满足需求。

### 工作量
小。但需明确标注生成数据的来源，避免污染真实证据链。

---

## 4. 方案④ 浏览器自动采集（不推荐）

Playwright/扩展自动翻页抓 Amazon + 1688。数据真实、全自动，但：
- 直接违反 README "不做后台爬虫" 边界；
- 平台风控封号、页面改版即失效，维护成本高；
- 与产品"本地可审计工具"的定位冲突。

**建议排除。** 若确需真实搜索页数据，走方案①的官方 API 或方案③的"扩展导出 ASIN 种子"。

---

## 5. 推荐组合与分期

```
第 1 期：方案③ 主干
  └─ 数据泵 + 自动算账分级 + 候选池看板 + 类型层禁止自动 GO
  └─ 入口：用户上传 CSV / 配 Keepa Key / 扩展导出 ASIN 种子
  └─ 产出：S/A/B/HOLD/淘汰 五级候选池，GO 仍需人录真实报价确认

第 2 期（并行准备资质）：方案① 接 Keepa 榜单 + 1688 官方
  └─ 替换③的"候选发现"为自动，数据全部真实
  └─ 保留人工 GO 确认（产品定位不变）

方案②作为③的上游可选开关：用户想要"先看 AI 发散了哪些方向"时打开，
  结果标记 ai_generated，仅作线索，不进真实证据链。
```

---

## 6. 待拍板的设计决策

1. **分级阈值**：S 级"净利率 ≥ 24%、score ≥ 75"是否合适？现有 `DEFAULT_SOURCING_THRESHOLDS` 与 `evaluateDecisionStage` 的 targetMarginRate=0.18 是硬门禁，分级阈值应高于它、但不能写死。
2. **是否引入新表**：`auto_pipeline_runs` + `auto_candidates` 两张新表 vs 完全复用 `ai_sourcing_runs`/`opportunity_hypotheses` 加字段。前者清晰、后者改动小——倾向前者。
3. **触发方式**：本地工具用"一键跑一批"的 Server Action 即可；是否要常驻定时（cron）？当前项目无任何调度基础设施，建议先不做。
4. **扩展种子入口**：是否把 Chrome 扩展的"当前页 Top 20 ASIN 批量导出"纳入第 1 期？它决定了方案③能否真正跑起来。
