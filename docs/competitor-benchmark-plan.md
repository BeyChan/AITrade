# 竞品证据资产的两次消费：选品验证 + 内容上架落地方案

> 状态：待评审 · 2026-11-06 · 个人版
> 适用范围：`marketCode × platformCode` 隔离的选品与内容链路
> 关联约束：`docs/current-plan.md` §3 产品原则、§9 AI Skill 边界、§13 暂不纳入、§14 开工门槛

## 0. 一句话定位

**不做两个新功能，而是把已采集、却只被计数的竞品证据，变成一份贯穿两个阶段的证据资产**：选品期用于**证伪假设**，上架期用于**指导表达**。同一份数据、同一套口径、同源反查，零新建表、零新增阈值、零独立页面。

## 1. 为什么现在做：产品意图已在，缺的是系统支撑

| 事实 | 证据 |
|---|---|
| 定价要依据竞品，是写死的业务文案 | `ai-sourcing/[runId]/page.tsx:1336`「确认售价」注明「依据真实竞品价格带；利润门禁只使用这里的价格」，且依据链接必填（`:1341`）——但代码不校验，售价完全由人自填 |
| 两阶段的对照锚点都已存在 | 假设侧 `differentiator` / `pain_point` / `recommended_price_cents` / `expected_margin_rate`（`db/schema.sql:826-831`）；内容侧 `core_differentiator` / `claims_to_avoid` / `target_customer`（`:208-220`） |
| 竞品数据齐全，但只被数了数 | `competitor_snapshots`（`:863-880`）、`review_insights`（`:882-893`）字段完整；`evaluateSourcingDecision`（`src/lib/ai-sourcing.ts:425-435`）只判 `competitorCount >= 20`、`reviewSampleCount >= 15`，所有内容字段一个都没进判定 |
| 经济模型是内部自证 | `calculateEconomics`（`ai-sourcing.ts:448-455`）用自己确认的售价 × 自己的落地成本算毛利，售价不受任何市场数据约束 |
| 文档与代码不一致 | `docs/current-plan.md` §2.1／2.2／2.4 把「竞品评论分析」标为已落地，实际只有录入 + 计数 |

**结论**：这是补齐既有意图的系统支撑，不是新造概念。可以走 §14 的「一条端到端最窄竖线」验证，风险低、回归面小。

## 2. 用户、场景与要做的决定

| 节点 | 使用者 | 要做的决定 | 现在缺什么 | 本方案交付 |
|---|---|---|---|---|
| 选品验证 | 运营 | GO / HOLD / 补采哪类证据 | 能证伪假设的外部反证 | 「假设 vs 竞品集」对照清单 + 覆盖度 |
| 内容撰写 | 运营 | 五点写什么、哪些话不能写 | 可引用的差评缺口与禁区 | 只读对标卡 + AI 草稿提案 |
| 发布前检查 | 运营 | 能否提交人工发布 | 文案与已确认差异化的一致性提示 | 只提示不阻断的 advisory |

## 3. 设计原则（硬约束，不可协商）

1. **确定性算数，AI 只归纳与起草**（§3）：分位数、分布、覆盖度、结论判定全部纯函数；模型不产出结论、不产出财务数字。
2. **证据同源**：定义唯一 `CompetitorBenchmark` 结构，选品端与内容端共用，禁止两处各算各的。
3. **统一量纲 + 作用域隔离**（§3「比较前必须先统一量纲」）：竞品价格只在**同一 run（同市场 × 平台 × 币种）**内聚合；`competitor_snapshots` 无 `currency` 字段，由 `batch.currency` 隐含，跨市场不合并、不做汇率换算；`observed_at` 只标注新鲜度，不做时间加权。
4. **默认不落库、人审后 apply**（`ai-proposals/contract.ts:44` `ProposalProvenance`、`:59` `ProposalTarget`、`:120` `canTransitionProposalStatus`）。
5. **只提示不阻断**：§14 开工门槛明确「真实样本校准前不写阈值规则」。因此不新增 GO/HOLD 阈值、不改 `passed`、不改证据完备度计分；对标提示走独立 `advisories`，不进 `findings` / `score`。
6. **失败静默回退**：模型不可用或模板模式下，确定性画像仍完整可见，页面不空白、不报错。
7. **不爬取平台页面、不自动发现竞品**（§13、README 边界）；但这不等于「什么都不自动」——搜索深链、结构化批量导入、按已知 ASIN 补字段都属于系统内召回，是允许的，边界见 §5.4。
8. **不做独立竞品页**：AI 是横向能力层（L3 已定案），能力挂回假设详情与内容页原对象。
9. **自动召回 ≠ 自动筛选**：系统自动铺开候选池、自动回填字段，但「哪些竞品纳入基准」「断言是否成立」必须由人确认。验证的语义是找反证；让系统替人挑竞品，等于让被告自己选证人。

## 4. 数据契约：零新建表

### 4.1 字段映射与反查路径

| 来源 | 字段 | 选品端 | 内容端 |
|---|---|---|---|
| `opportunity_hypotheses`（`:822`） | `differentiator`、`pain_point`、`recommended_price_cents`、`expected_margin_rate` | 三面对照的断言锚点 | 一致性比对基准 |
| `case_content_profiles`（`:208`） | `core_differentiator`、`claims_to_avoid` | — | 对标基准、禁用声明词表 |
| `competitor_snapshots`（`:863`） | `price_cents`、`rating`、`review_count`、`bsr`、`seller_count`、`variation_count`、`observed_at`、`source_url`、`asin`、`title` | 价格带／分布／覆盖度／去重 | 定价落点、共同卖点线索 |
| `review_insights`（`:882`） | `theme`、`sentiment`、`sample_size`、`representative_quote`、`competitor_snapshot_id` | 加权主题 TOP N | 五点描述缺口（带原文引用） |
| `opportunity_hypotheses.product_case_id`（`:839`，转立项回填于 `ai-sourcing-repository.ts:1680`） | — | 立项时打通 | **反查链入口** |

反查：`product_cases.id` → `SELECT ... FROM opportunity_hypotheses WHERE product_case_id = $1` → 该假设的 snapshots + insights。**不复制、不快照**，选品期补采的证据自动出现在内容页。

### 4.2 唯一输出结构

```ts
type CompetitorBenchmark = {
  scope: { runId; hypothesisId; caseId?; marketCode; platformCode; currency };
  coverage: {
    competitorCount; dedupedCount; priceBandCount; themeCount;
    withSourceUrlRate; freshnessDaysP50; sufficient: boolean;
  };
  price: { p25; p50; p75; min; max; hypothesisPricePosition? };
  distribution: { ratingP50; reviewCountP50; bsrP50 };
  themes: Array<{ theme; weightedCount; sampleSize; quote; evidenceRefs }>;
  contradictions: Array<{
    assertion; field; verdict: 'supported' | 'unverified' | 'contradicted';
    evidenceRefs; note;
  }>;
};
```

`coverage.sufficient` **仅作展示标记，不参与任何门禁**（原则 5）。

### 4.3 归一化规则

- 价格：整数分，仅同 run 同币种参与分位；不换算、不跨市场合并。
- 去重：`asin` 优先、`source_url` 兜底去重 —— 直接解决「20 条同质快照照样 GO」的漏洞。
- 主题：`sample_size` 加权，`theme` 按大小写与空白归一，保留 `representative_quote` 原文。
- 新鲜度：`observed_at` 距今中位数；过期只标注，不剔除、不阻断。

## 5. 功能规格

### 5.1 选品端：竞品画像 + 假设对照（M0）

数据入口按 §5.4 的三层召回设计，**不要求逐条手填**：搜索深链已可用，M0 打通 CSV／JSON 多行批量导入，Keepa 字段补全作为 M2 增强。

- 新模块 `src/lib/competitor-insights.ts`，纯函数、无 IO：
  `buildCompetitorProfile(snapshots, insights, scope)`、`contradictHypothesis(profile, hypothesis)`、`loadBenchmarkForCase(caseId)`。
- 复用现有查询：`ai-sourcing-repository.ts:733`（竞品）、`:928`（差评写入）、`:1404`／`:1411`（计数）、`:1741`／`:1742`（汇总），不新增 SQL 表。
- UI：`src/app/ai-sourcing/[runId]/page.tsx`，`?tab=hypotheses`（tab 定义 `:60`）竞品卡片区（`:528`）上方插**只读**画像块：
  - 上半：价格带 P25/P50/P75 + 假设定价落点、评分／评论／BSR 中位数、**覆盖度条**（数量 / 去重后数量 / 价格带数 / 主题数 / URL 齐备率 / 新鲜度）。
  - 下半：三面对照表：

    | 假设断言 | 竞品侧对照 | 能证伪什么 |
    |---|---|---|
    | `differentiator` + `pain_point` | `review_insights.theme` 加权频次 | 痛点是否真实、差异化是否已被覆盖 |
    | `recommended_price_cents` / `confirmed_price_cents` | `price_cents` 分位 | 定价是否无依据溢价 |
    | `expected_margin_rate` | 竞品价格带 × 自己落地成本 | 毛利在市场价里能否成立 |

  - 空态：「无可用竞品证据」+ 跳转录入表单（`:1310`）。
- 门禁联动（只读）：`evaluateSourcingDecision` 返回结构增加 `coverage` 展示字段，**不改 `gates`、不改计分、不改 GO/HOLD**。
- 确认售价联动（低成本高价值）：`confirmHypothesisPriceAction` 提交时，若价格落在 P25 以下或 P90 以上，页面提示「该定价偏离竞品价格带，请核对依据链接」，不阻断保存。

### 5.2 内容端：竞品对标（M1 / M2）

- **只读对标卡（默认自动带出、零操作）**：内容页 `src/app/cases/[id]/content/page.tsx` 商品定义 section（`:124`）上方，经 `product_case_id` 实时反查并自动展开，运营不需要重新搜索或选择竞品；展示价格带与本品定价落点、TOP N 差评缺口（带原文与来源链接）、`core_differentiator` 是否被缺口支撑、`claims_to_avoid` 清单。无唯一假设关联时显示「无唯一竞品证据来源」并要求人工选择，不自动挑一个。
- **三项 advisory**（`ListingPreflightResult` 新增 `benchmarkAdvisories: PreflightFinding[]`，与 `findings` 并列，**不进 `errorCount` / `warningCount` / `score` / `passed`**，保证零回归）：
  | code | 触发 | 实现 |
  |---|---|---|
  | `BENCHMARK_GAP_UNCOVERED` | 五点未覆盖的高频差评缺口数 > 0 | 对标卡主题 vs `content.bullets` |
  | `BENCHMARK_COMPARATIVE_CLAIM` | 文案出现竞品品牌或未验证比较级 | 复用 `findRiskyClaims`（`src/lib/listing.ts:147`）+ 竞品 title/brand 词表 |
  | `BENCHMARK_CLAIM_CONFLICT` | 命中 `claims_to_avoid` 或与 `contradicted` 断言冲突 | `case_content_profiles.claims_to_avoid` |
  - `PreflightFinding.field` 已含 `claims`（`listing.ts:14`），无需改基础类型。预检 section（`:291`）单独渲染 advisory 区。
  - `preflightChannelContent`（`src/lib/channels.ts:228`）与 `evaluateLaunchReadiness`（`src/lib/launch-readiness.ts:97`）**本期不动**；多站点版本复用同一份缺口清单，按 `getChannelProfile`（`:193`）做长度／语言适配。
- **AI 五点草稿（M2）**：`generateStructuredJSON`（`src/lib/ai-provider.ts:200`）输出每条 bullet 的 `sourceQuote` + `confidence` + `evidenceRefs` + `requiresReview: true`；走 `ai-inbox/apply.ts:239 applyAiInboxTask` / `:92 reviewAiInboxField` 人审链，`ProposalCard` 展示、`digest.ts` 聚合首页待办。**采纳后才写 `listings.content`**，`saveListingDraftAction`（`actions.ts:634`）人工入口保持不变。
- **合规边界**沿用内容页既有文案（`:89`）：不得把竞品图片或未核验声明当自有素材；AI 草稿不得引入 benchmark 中不存在的规格、认证或比较级。

### 5.3 两阶段衔接（最易出错处）

- 转立项时**不复制** benchmark，内容页实时反查，避免两处口径漂移。
- 内容页修改 `core_differentiator` **不回写**选品期假设；对标卡显示「内容定义与选品假设不一致」，由人判断。
- 一个 case 对应多个 hypothesis 时要求人工选择证据来源，不自动合并、不自动取最新。

### 5.4 「自动带出竞品」的四层与边界

用户诉求是「别让我一条条手填」，不是「让系统替我决定竞品是谁」。把「自动」拆成四层，前三层的主体能力项目已具备或只需打通：

| 层 | 含义 | 现状 | 方案处理 |
|---|---|---|---|
| **L1 自动召回入口** | 模型生成 `competitorQueries` / `reviewQueries`，按 `marketCode × platformCode` 生成平台搜索深链与公开评论检索链接 | **已实现**：`ai-sourcing/[runId]/page.tsx:426-434` 的 `QueryGroup` → `marketplaceSearchUrl()` / `googleSearchUrl()`（`:1415`、`:1419`） | 直接复用，不重复建设；批量导入页复用同一深链 |
| **L2 自动带入数据** | 粘贴一份 CSV／JSON／表格文本，一次解析 N 条竞品，AI 提取字段 → 人审 → 落库 | **半实现**：`ai-inbox/extractor.ts:15` 支持 `paste/csv/json/text/markdown`，`:252-260` 有 Tab／逗号表格解析（最多 50 行），但 `:156` 的 `table.rows[0]` **只取第一行** | **M0 必须补的一刀**：新增 `parseCompetitorBatch()` 产出多条 extraction，走 `ai-inbox/apply.ts:239` 批量人审落库。零抓取、零合规风险，解决绝大部分手填痛点 |
| **L3 自动补全字段** | 已知 ASIN → 补价格、评分、BSR、价格历史 | 连接器已有：`connectors/keepa.ts:59 fetchKeepaCandidates()`，最多 100 ASIN、重试与错误脱敏齐备，`isKeepaConfigured()`（`:46`）判断 `KEEPA_API_KEY`；但当前导入 `product_cases` 候选品、未接竞品表、未配 Key | **M2 增强，不进基线**：只按人工已确认的 ASIN 补字段，人工触发 + 人审后 apply。它回答「这几个 ASIN 的数据是什么」，**不回答「我的竞品是谁」** |
| **L4 自动发现竞品** | 系统自己搜／爬平台，决定「竞品是谁」 | 无 | **明确不做**：平台 ToS 与反爬、账号风险、数据时效不可控，且违反 §13 与 README「不后台爬取」边界 |

三条硬边界：

1. **L1–L3 只做召回与回填，不做筛选**。自动召回的竞品一律标为「待确认」，未经人审不进入 `competitor_snapshots`、不参与画像分位。模型只产出搜索词与字段提取，**禁止生成 ASIN／价格／评论数**（`ai-provider.ts` 提示词已禁止编造竞品事实；`ai-inbox/schema.ts:72` 明确「没有明确出现时留空，不自动生成」）。
2. **内容端是 100% 自动带出、零操作**。`product_case_id` 实时反查，内容页与多站点版本默认展开同一份 benchmark 与缺口清单，运营不需要重新搜索或选择竞品；无关联时才要求人工指定来源。
3. **自动越容易，采样偏差风险越高**。一键导入 50 条来自同一搜索结果页的同质竞品，比手填 20 条更容易制造「证据充分」的假象。因此 L2 必须与 `asin` / `source_url` 去重、覆盖度提示同批上线，否则「自动」反而放大 §1 的门禁漏洞。

## 6. 职责边界（对齐 §9）

| 环节 | AI | 确定性代码 | 人工 |
|---|---|---|---|
| 画像聚合 | 不参与 | 分位、分布、去重、覆盖度 | 录入真实快照 |
| 缺口归纳 | 归纳主题、起草五点（带引用） | 加权、样本量、阈值外的展示判定 | 确认主题是否成立 |
| 结论与门禁 | 不给结论 | GO/HOLD、毛利、预检 | 做 GO/HOLD 决定 |
| 落库与发布 | 不自动写 | 仅人审后 apply | 采纳提案、确认发布 |

AI 输出统一遵循 §9 的 `summary / evidenceRefs / affectedEntities / recommendedActions / confidence / requiresReview`；无证据引用不得写入业务表。

## 7. 分期与验收（§14 最窄竖线）

M0 严格按 §14 的「数据进来 → 落库 → 计算 → 页面显示」打通一条竖线，因此**起点是 L2 批量导入而不是手填表单**：没有可批量进入的数据，画像功能无法被真实验证。

| 期 | 交付 | 验收 | 明确不改 |
|---|---|---|---|
| **M0** 打通一条竖线 | **L2 CSV／JSON 多行批量导入（数据入口）** + `competitor-insights.ts` 纯函数 + 选品端只读画像 + 内容页反查对标卡（无 AI、无 advisory） | 一条 CSV 多行 → 人审 → 落库 → 画像端到端可用；合成数据 + 真实录入样本各一组单测；分位／加权结果与 SQL 手算一致；模板模式下可见；无证据空态正确；`npm test` 全绿 | GO/HOLD 判定、既有页面结构、数据库 |
| **M1** 一致性与覆盖度 | 三项 advisory + 覆盖度与数量并列展示 + 确认售价偏离提示 + §2 文档修订 | 新增项不改变 `passed` 与 `score`；跨市场样本不合并；无证据时不误报；重复 ASIN 被去重 | `findings` 数组、`evaluateLaunchReadiness` |
| **M2** AI 归纳与草稿 | 缺口归纳提案 + 五点草稿提案（人审链）；**可选** L3 Keepa 按已确认 ASIN 补字段，不阻塞本期验收 | 无 `sourceQuote` 的字段被校验拒绝；提案默认不写业务表；模型不可用静默回退 M0 画像；`requiresReview` 恒为 true；未配 `KEEPA_API_KEY` 时 L3 静默跳过 | 自动发布、自动采纳、`MIN_AUTO_ACCEPT_CONFIDENCE` 口径 |

依赖：M1 依赖 M0 的画像口径稳定；M2 与 M1 共用提案契约，可与 M1 后期并行；L3 依赖 M0 已有可确认的 ASIN，不强依赖 M1。

## 8. 指标（对齐 §12，只观测、不做自动阈值）

| 指标 | 口径 | 目的 |
|---|---|---|
| 竞品样本覆盖度 | 去重后竞品数 × 价格带数 × 差评主题数 | 替代单一 `competitorCount` |
| 门禁误过率 | 人工复核中「同质样本被判证据充分」占比 | 验证覆盖度是否真的补上漏洞 |
| 差评主题 → 五点命中率 | 高频缺口被采纳进 bullet 的比例 | 验证内容端是否用上了选品证据 |
| 定价偏离核对率 | 提示后依据链接被修订的比例 | 验证定价联动有效性 |
| AI 提案采纳率 | accepted / (accepted + rejected) | 校准提示词与置信度 |

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 采样偏差：人只搜得到自己想找的竞品 | 去重后数量、价格带数、主题数与数量并列展示；样本集中在单一价格带时显式提示「证据可能不足」 |
| 量纲错配：表无 `currency` 字段 | 同 run 聚合，跨市场不合并；将来补字段后再放开 |
| 证据过期 | 只标注 `freshnessDaysP50`，不剔除、不阻断 |
| AI 幻觉 / 把对标做成抄竞品 | 强制 `sourceQuote` + `evidenceRefs`；复用 `findRiskyClaims` 与 `claims_to_avoid`；草稿不自动落库 |
| 阈值过早固化 | 只提示不阻断，不新增门禁（§14） |
| 选品与内容口径漂移 | 实时反查，不复制快照；不一致时提示而非自动同步 |

## 10. 明确不做

平台页面爬取与「系统自动发现竞品」（L4）；让 AI 生成竞品事实（ASIN／价格／评论数）；自动筛选并直接纳入基准的竞品；卖家／店铺维度监控；价格与 BSR 趋势；独立竞品分析页；AI 直接改 Listing 或自动发布；跨市场合并分位；新增 GO/HOLD 阈值；新建表或字段；改动 `evaluateLaunchReadiness`。

**L1–L3 的自动召回、批量带入与字段补全是允许且鼓励的**，不在上述排除项内；排除的是「系统替人决定竞品是谁」与「未经人审即纳入基准」。

## 11. 需同步修订 `docs/current-plan.md`

- §2.1／2.2／2.4：「竞品评论分析已落地」→「竞品证据录入与计数已落地；画像、假设对照与内容对标未实现」。
- §9 AI Skill 边界表新增一行「竞品对标」：AI 归纳缺口与草稿 / 确定性算分位与覆盖度 / 人工确认采纳。
- §12 增加「竞品样本覆盖度」口径。

## 附录：验收用例清单

- [ ] 20 条快照全部同价、零差评主题时，覆盖度显著低于 20 条分散样本，GO/HOLD 判定不变。
- [ ] 同一 ASIN 重复录入 3 次，`dedupedCount` 只计 1。
- [ ] 假设定价落在 P90 以上时显示溢价提示，依据链接仍可正常保存。
- [ ] 两个不同 `marketCode` 的 run，价格分位不合并。
- [ ] `observed_at` 为 180 天前时标注新鲜度，但不剔除样本、不报错。
- [ ] 无 `product_case_id` 关联的内容页显示「无可用竞品证据」，不抛异常。
- [ ] 五点全部未覆盖高频缺口时产生 advisory，`passed` 与 `score` 与改动前一致。
- [ ] 模型返回 400 / 超时时，画像块仍完整渲染，无错误提示。
- [ ] AI 提案缺 `sourceQuote` 时被校验拒绝，且未写入 `listings`。
- [ ] 粘贴 10 行 CSV 竞品时产生 10 条待审字段，而非只解析首行；全部为待确认状态。
- [ ] 未经人审的召回竞品不进入 `competitor_snapshots`、不参与画像分位与覆盖度计算。
- [ ] 搜索深链按 `marketCode × platformCode` 落到对应站点，差评词落到公开评论检索。
- [ ] 一键导入 50 条同价同质竞品时，去重与覆盖度提示生效，覆盖度仍显示偏低。
- [ ] 内容页在有关联假设时默认展开对标卡，运营无需任何额外操作。
