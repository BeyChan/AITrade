# 工作流与安全边界

> 当前实现状态为 **P2.0 AI 证据收件箱 + P2.1 内部供应商草稿**。已支持文本、CSV、JSON、Markdown 的结构化提取、字段审核、事务应用和门禁重算；也支持基于已录入事实生成 RFQ、缺失信息追问和报价到期提醒内部草稿。**尚不支持图片/截图/PDF OCR、草稿外部发送、自动联系供应商或自动发布**。P2.2 及之后内容仍是规划与实施约束。

## 主流程

```text
AI 生成 5 个机会假设
  ↓
[人工确认] 加入验证
  ↓
真实竞品 / 差评 / 专利 / 物流证据
  ↓
机会验证内 AI 智能录入：文本 / CSV / JSON / Markdown → 候选字段
  ↓
[人工审核] 低置信度、冲突、敏感字段
  ↓
事务写入证据、供应商短名单与报价，并重算门禁
  ↓
供应商短名单与真实报价
  ↓
16 项确定性门禁（GO / HOLD / NO-GO）
  ↓
[仅 GO] 转商品立项
  ↓
候选品导入
  ↓
证据采集与归一化
  ↓
评论/竞品/市场分析
  ↓
单位经济模型
  ↓
[人工确认] 立项
  ↓
AI 供应商助手：RFQ / 追问 / 到期提醒内部草稿
  ↓
[人工审阅并复制] 人在系统外部沟通，系统不发送
  ↓
报价对比
  ↓
[人工确认] 供应商定标
  ↓
样品/质检/合规
  ↓
[人工确认] 定样
  ↓
商品定义
  ↓
主图/A+/Listing 草稿
  ↓
[人工确认] 内容与声明
  ↓
本地确定性发布预检
  ↓
发布准备门禁（8 项检查）
  ↓
正式店铺 + 官方写 Adapter + 平台 dry-run
  ↓
[人工确认] 进入内部发布队列
  ↓
平台发布与外部回执（当前未实现）
  ↓
运营异常监控
  ↓
[人工确认] 价格/广告动作
  ↓
实际利润复盘
  ↓
反哺选品与成本模型
```

## 状态定义

```text
discovered
screening
approved
sourcing
sampling
product_defined
content_ready
listing_ready
preflight_passed
published
operating
archived
rejected
```

目标态要求状态变化只能由受控 workflow transition 完成。当前人工动作由 Server Action 在事务中写入，但尚未实现完整的通用状态机。

当前为保持商品主状态简单，商品直接立项后保持 `approved`。供应商定标由 `supplier_selections` 记录；内容确认状态由 `channel_listing_versions.status` 表达，主市场 Amazon 的兼容视图同步写入 `listings.status` 与 `listing_reviews`。后续扩展完整状态机时再显式增加 `supplier_selected`、`content_approved` 等主状态。

同一商品可以有多个国家 × 平台目标。每个目标拥有独立版本和预检，不能把某个市场的 `content_approved` 当成另一个市场的状态，也不能把它映射成 `published`。

## AI 自动化任务状态

AI 自动化采用“单编排器 + 专用 Skill”，不是多个 Agent 自由协商。每次上传、粘贴或生成草稿只创建一条持久化任务，由固定步骤执行。

```text
queued
  ↓
running ─────────────→ failed
  ├─→ ready ──────────→ applied
  └─→ needs_review ───→ ready ─→ applied
```

任务状态含义：

- `queued`：原始 artifact 已保存，等待执行。
- `running`：正在解析文本或调用模型。
- `needs_review`：存在低置信度、来源缺失、来源冲突、高风险字段或人工修改。
- `ready`：所有必填字段均为 `auto_accepted` 或 `accepted`，且无阻断项，等待幂等应用。
- `applied`：已在事务中写入业务表，并触发必要的确定性重算。
- `failed`：解析、模型、Schema 或应用失败；保留原始证据，可重试。

字段状态为：

```text
extracted
auto_accepted
needs_review
accepted
rejected
missing
```

其中 `extracted`、`needs_review`、`missing` 仍需处理；`auto_accepted`、`accepted` 可应用；`rejected` 不写入业务事实。人工动作只有 `accept | correct | reject`，没有任务级的“批准”或“取消”状态。

模型可以建议，但不能决定最终状态。最终决策由服务端根据来源定位、Schema、冲突、白名单和置信度计算。

## AI 字段级自动接受规则

默认建议：

| 条件 | 处理 |
|---|---|
| 原文明确、字段在自动接受白名单、无冲突、置信度 ≥ 0.90 | `auto_accepted` |
| 需要单位/币种换算、同义字段映射或置信度 0.70～0.90 | `needs_review` |
| 多来源冲突、来源无法定位、置信度 < 0.70 | `needs_review` |
| 认证、专利、合规声明、品牌授权、供应商最终身份 | `needs_review` 或 `blocked`，永不自动通过 |
| 模型推断销量、利润、风险或“已认证” | `blocked`，不得作为事实 |

自动接受必须同时满足：

1. 字段可从 artifact 原文片段定位；当前使用原文 offset，OCR block 定位属于后续能力。
2. 字段在明确的自动接受白名单。
3. 值通过类型、范围、币种和单位校验。
4. 无其他来源冲突。
5. 置信度达到配置阈值。
6. 不涉及高风险声明或商业承诺。
7. 幂等键已生成。
8. 审计包含模型、Prompt、Schema、来源和应用结果。

置信度不是“真实概率”，不能单独作为自动通过依据。金额、认证、专利和合规字段宁可多审，不可误放。

## 四类 AI 工作流的审批点

| 工作流 | 可自动完成 | 必须人工确认 | 当前状态 |
|---|---|---|---|
| AI 证据收件箱 | 文本/CSV/JSON/Markdown 分类、字段提取、来源定位、去重、冲突提示 | 低置信度字段、来源冲突、供应商身份、联系方式、认证/专利/合规事实、评论摘要 | P2.0 已实现（文本输入；OCR 未实现） |
| AI 供应商助手 | RFQ、缺失信息追问、报价到期提醒内部草稿；可选模型润色主题与开场 | 复核并复制草稿、对外发送、供应商定标、首单采购 | P2.1 第一阶段已实现；OCR/PDF 与发送未实现 |
| AI Listing 操作员 | 标题/卖点/描述草稿、本地化、平台字段检查、图片 brief | 商品事实、合规声明、内容确认、发布 | P2.2 规划 |
| AI 运营分析员 | 报表映射、利润对账、异常检测、行动建议 | 改价、广告预算、补货、清仓、退款 | P2.3 规划 |

统一原则：

- AI 只能生成内部草稿，不能把草稿状态当成外部执行结果。
- AI 输出先进入暂存表，再通过事务写入领域表。
- 应用 AI 字段后必须重新运行确定性门禁，不允许模型直接写 GO / NO-GO。
- 外部发送、发布、改价、广告、采购、付款、退款永远走人工审批。
- AI 服务不可用时，现有 CSV、人工录入和确定性流程仍必须可用。

## 外部动作分级

```text
L0 只读：解析文件、读取已授权报表
L1 内部草稿：RFQ、Listing、行动建议、提醒
L2 外部写入：发送、发布、改价、广告、补货、下单
L3 禁止自动：付款、退款、赔付、删除、绕过平台风控
```

- L0 可自动，但必须保留来源和访问审计。
- L1 可自动，但产物必须标记为未审批草稿。
- L2 必须有人工批准、幂等键和外部回执；没有回执不得标记成功。
- L3 AI 不得执行，必须走专用人工流程。

## 发布准备状态

发布准备由确定性代码计算，状态只会是：

```text
blocked
local_ready
dry_run_unsupported
approval_pending
approved_for_publish
```

含义：

- `blocked`：最新版本、本地预检、内容确认或主图检查仍有缺口。
- `local_ready`：本地内容已就绪，但正式平台店铺尚未连接。
- `dry_run_unsupported`：店铺条件已满足，但官方写 Adapter 或真实平台 dry-run 不可用。
- `approval_pending`：全部前置检查通过，等待人工确认进入内部发布队列。
- `approved_for_publish`：当前版本已确认进入内部发布队列，但尚未向平台发布。

每次检查固定评估 8 项：`LATEST_VERSION`、`LOCAL_PREFLIGHT`、`CONTENT_APPROVED`、`MAIN_IMAGE_APPROVED`、`PRODUCTION_ACCOUNT`、`WRITE_ADAPTER`、`PLATFORM_DRY_RUN`、`VERSION_LAUNCH_APPROVAL`。当前所有平台均为 `dryRunSupported=false`、`publishingSupported=false`，不能把本地预检冒充平台 dry-run，也不能把队列确认当作平台发布。

## 每个阶段的产物

| 阶段 | 自动产物 | 人工产物 | 通过条件 |
|---|---|---|---|
| AI 假设 | 5 个方向、研究优先级、验证待办 | 选择值得验证的方向 | 方向不重复且可验证 |
| 选品验证 | 16 项门禁、成本与风险快照 | 真实证据、供应商和报价 | GO；HOLD 继续补证，NO-GO 停止 |
| 立项 | 成本模型、GO/NO-GO | 立项决定 | 仅确定性 GO 可转入 |
| 询价 | RFQ、供应商名单 | 联系人、报价录入 | 至少 1 家有效报价；建议 3 家 |
| 定标 | 到岸成本、报价对比、评分卡、成本回写 | 定标决定与说明 | 压力盈利且质量分 ≥ 50；少于 3 家需说明原因 |
| 打样 | 缺陷汇总、整改建议 | 质检结论 | 关键缺陷关闭 |
| 定样 | 样品与合规汇总 | 定样决定 | 样品费和交期确认 |
| 商品定义 | 产品规格、卖点、禁用声明 | 商品负责人确认 | 规格与利润一致 |
| 内容 | 图片资产、Listing JSON | 品牌/合规检查 | 预检通过 |
| 发布准备 | 8 项确定性检查、阻断项清单 | 补齐本地门禁 | 正式店铺、写 Adapter 和平台 dry-run 均通过 |
| 发布队列 | 当前版本检查快照 | 人工确认进入内部队列 | `approval_pending` 且无阻断项 |
| 发布 | 平台 payload 与外部回执 | 发布确认 | 真实 dry-run 通过且发布 Adapter 可用；当前未实现 |
| 运营 | 异常单、实验建议 | 确认动作 | 未越过风险阈值 |

## AI 选品门禁

AI 只能生成机会假设、查询词和待办，不得生成或补全销量、评论、供应商、报价、专利、物流和利润事实。进入验证后，系统必须同时检查：

1. AI 研究优先级达到阈值。
2. 至少 20 个真实竞品快照。
3. 至少 50 条真实差评样本。
4. 至少 3 家供应商短名单。
5. 至少 3 份同币种真实报价。
6. 最低到岸成本不超过阈值。
7. 首报价净利率至少 18%。
8. 压力情景利润为正。
9. 证据完整度至少 80%。
10. MOQ 不超过阈值。
11. 交期不超过阈值。
12. 至少一份样品评分达标。
13. 专利风险已人工检查且不是 found。
14. 物流风险已人工检查且不是 found。
15. 首单现金占用不超过阈值。
16. 非 USD 报价存在可追溯汇率来源。

缺证据或未达阈值输出 HOLD；已确认专利风险输出 NO-GO；全部通过输出 GO。只有 GO 可以转商品立项，系统不得绕过门禁自动立项。

## 默认确认阈值

阈值应按店铺实际调整，第一版建议：

- 售价调整超过 3%：人审
- 调整后低于成本模型价格底线：禁止
- 单日广告预算增加超过 20%：人审
- 新建广告活动：人审
- 任何 Listing 发布或重大修改：人审
- 任何退款/赔付/付款：人审
- 供应商定标、定样和首单采购：人审

## 当前实现边界（P2.0 + P2.1 内部草稿）

当前实际可运行路径：

```text
AI 选品假设（模板 / Ollama / OpenAI-compatible）
→ 真实竞品、差评、专利、物流证据
→ AI 证据收件箱：文本 / CSV / JSON / Markdown 字段提取
→ 人工审核并事务应用
→ 竞品快照、供应商短名单与报价、评论证据
→ 确定性门禁重算
→ 供应商短名单与真实报价
→ 16 项确定性 GO / HOLD / NO-GO
→ 仅 GO 转商品立项并导入全部报价
→ AI 供应商助手：RFQ / 追问 / 到期提醒内部草稿
→ 人工复制草稿并在系统外部沟通（系统不发送）
→ 候选品 / 供应商 / 报价 CSV 或人工接入
→ 导入运行、幂等去重与证据快照
→ 可选 Keepa ASIN 只读同步
→ Amazon / Shopify / eBay 只读连接诊断
→ 成本模型
→ 人审立项
→ 供应商与报价入库（含人工录入）
→ 确定性对比与评分
→ 人审定标并回写成本
→ 商品定义
→ 主图上传与人审
→ Listing 草稿版本化
→ 多国家 × 多平台目标与字段映射
→ 确定性本地预检
→ 人工内容确认
→ 发布准备门禁（8 项检查）
→ 人工发布队列确认（仅内部队列）
→ 审计留痕
```

已经落地：

- `/ai-sourcing` 支持按当前国家 × 平台生成 5 个不同假设、研究优先级、加入验证、证据、供应商短名单、真实报价和 16 项确定性决策。
- 研究生成按钮在模型处理中禁用并显示进度提示；页面渲染时生成请求幂等键，`ai_sourcing_runs.request_key` 使用唯一索引，重复提交、刷新重试或并发冲突均返回既有批次，不新增研究记录。
- 研究批次在 `/ai-sourcing` 独立列表中按创建时间倒序完整展示，并从 AI 选品工作台进入；它属于 AI 选品的二级页面，不占用主导航。删除批次会级联研究假设、证据、供应商短名单和报价，已转商品立项的数据保留；删除前二次确认，删除后写入审计日志。
- 侧边栏只保留任务域一级入口；“业务工作台”和“系统”默认展开。手动折叠是瞬时 UI 状态，只作用于当前页面，不写入 `localStorage` 或 `sessionStorage`；切换页面或刷新后恢复默认展开。
- `/ai-inbox` 支持把文本、CSV、JSON、Markdown 提交为持久化 AI 任务，识别竞品、供应商报价和评论证据，按固定 Schema 提取候选字段并保存来源摘录与 artifact 字符位置。它不再占用主导航；从机会验证页进入时会预选并过滤当前机会，应用成功后返回该机会并重算门禁。直接访问 `/ai-inbox` 仍可作为全量审核队列。
- 任务支持 `queued`、`running`、`needs_review`、`ready`、`applied`、`failed`；失败任务可重试，重复请求使用 request hash 幂等复用。
- 字段审核支持 `accept | correct | reject`；敏感字段永不自动接受，无来源、来源无法定位、冲突、币种不一致和月销量上下限矛盾均阻止应用。
- 应用前服务端重新读取数据库字段并重新校验；成功后在事务中写入 `competitor_snapshots`、`supplier_shortlists` / `sourcing_supplier_quotes`、`review_insights` 与对应 `opportunity_evidence`。
- 应用完成后重算目标机会的确定性 GO / HOLD / NO-GO；AI 不直接写入决策。
- 任务、字段、来源、审核动作和模型调用分别写入 `ai_tasks`、`ai_extracted_fields`、`ai_field_sources`、`ai_review_actions`、`ai_model_calls`，并保留 `externalActions: none` 审计。
- AI 供应商助手可在机会详情中生成 RFQ、缺失信息追问和报价到期提醒内部草稿；追问和提醒必须绑定已录入供应商，提醒必须先有真实报价且日期不得早于今天。
- 供应商草稿先由确定性模板生成完整问题列表，缺失问题始终由确定性代码追加；配置模型时只润色主题和开场。模型 JSON、Markdown、越权表述、新增数字或 Schema 校验失败时自动回退模板。
- 草稿保存事实快照、生成模式、模型、Prompt/Schema 版本和 SHA-256 幂等键；状态只有 `draft | reviewed`，可复制和标记已审阅。
- 供应商草稿没有发送入口、`sent_at` 或 `sent` 状态；审计固定记录 `externalActions: "none"`、`sent: false`。
- AI Provider 默认模板免 Key，可选 Ollama 或 OpenAI-compatible；模型失败自动回退模板，不伪造市场事实。
- 证据录入强制校验 http/https URL、观察时间不能晚于当前时间，并保留录入人、原始快照和来源。
- 非 USD 站点必须保存汇率数值和来源 URL；缺失时决策为 HOLD。
- GO 转立项会复制全部供应商、真实报价和证据，RFQ 状态为 `quote_received`，`sent_at` 为空，表示系统没有发送 RFQ。
- 统一数据源工作台与 `/api/ingestion` 支持候选品 CSV、供应商 CSV、报价 CSV、人工报价和 Keepa ASIN 只读同步。
- 每次导入写入 `ingestion_runs`；候选品、供应商和报价写入 `evidence_snapshots`，保留来源、来源记录 ID、采集时间、文件信息和原始快照。
- 导入具备幂等与去重：候选品按 ASIN + 市场，供应商按平台 + 外部 ID / 规范化链接 / 名称，报价按规范化报价哈希处理。
- CSV、人工报价导入只入库。报价导入会创建或复用 `quote_imported` RFQ 记录，但 `sent_at` 保持为空，审计写入 `externalActions: "none"` 和 `rfqSent: false`。
- Keepa 是可选只读 Adapter。没有 `KEEPA_API_KEY` 时返回 `409 not_configured`，不发起外部请求，也不生成替代数据；成功同步记录 `externalActions: "read_only"`。
- 连接中心 `/connections` 和 `/api/connections/check` 只执行平台授权诊断：Amazon 验证 LWA + Seller API，Shopify 读取店铺基本信息，eBay 只验证应用凭证。
- 检查结果写入 `connector_health_checks`，审计动作是 `connector.health_checked`；不保存 Secret、Refresh Token 或 Access Token。
- TikTok Shop / 1688 返回 `unsupported` 且不发起外部请求；eBay 应用凭证通过不代表卖家 OAuth 或 Sell API 权限通过。
- 人工录入供应商与报价，包含采购价、单件运费、关税率、质量分、MOQ、交期、样品费、贸易条款、付款条件和认证。
- 确定性计算关税、到岸成本、压力情景利润和综合评分，并标记压力不盈利、质量偏低、交期过长、MOQ 过高和认证缺失等风险。
- 人工选择供应商，记录定标人、说明、评分快照和成本版本；定标后锁定新增报价和重复定标。
- 供应商定标后解锁商品定义工作台，保存产品事实、目标用户、规格、包装清单和禁用声明。
- 主图服务端校验文件头、MIME 和大小，文件进入本地受控目录；四项人工检查通过后才能用于内容确认。
- Listing 每次保存创建新版本，确定性预检覆盖长度、完整性、搜索词字节和高风险声明。
- 内容确认要求预检无错误且存在已检查主图，记录检查人、说明、预检快照和审计日志。
- 同一商品可以覆盖多个国家和平台；国家和平台组合幂等创建，每个目标独立递增 Listing 版本。
- Amazon、Shopify、TikTok Shop、eBay、CSV / 人工各自使用独立适配规则；店铺状态为 `unconfigured`，外部 ID 为空。
- `content_approved` 明确不代表 `published`；审计记录中外部动作为 `none`。
- 发布准备门禁由 `src/lib/launch-readiness.ts` 确定性计算，覆盖最新版本、本地预检、内容确认、主图检查、正式店铺、官方写 Adapter、真实平台 dry-run 和当前版本队列确认。
- `channel_launch_reviews` 绑定当前 `channel_listing_id` 与 `channel_version_id`，固化检查快照、确认人、说明与决策；旧版本确认不能复用于新版本。
- 队列确认只在服务端重新计算为 `approval_pending` 且阻断项为 0 时接受；检查和确认分别写入 `channel.launch_readiness_checked`、`channel.launch_queue_approved` 审计。
- 当前所有平台是 `dryRunSupported=false`、`publishingSupported=false`；发布准备和队列确认始终记录 `externalActions: none`、`published: false`，外部商品 ID 保持为空。

P2.0 的护栏：

- AI 只生成假设，不得伪造市场事实；缺数据必须保持 HOLD，不得用模型补值。
- AI 智能录入只接受文本内容；图片、截图和 PDF OCR 尚未实现，不得宣称已自动解析。入口必须保留机会上下文，应用后必须回到对应机会验证页。
- AI 字段必须先进入暂存表；应用前由服务端重新校验当前数据库值，不信任页面提交值。
- 认证、专利、合规声明、品牌授权、供应商主体、联系方式和评论摘要必须人工确认，置信度高也不例外。
- AI 字段应用后必须重新运行确定性门禁，模型不能直接决定 GO / HOLD / NO-GO。
- 只有确定性 GO 可转商品立项；HOLD / NO-GO 不得绕过门禁。
- 专利风险为 found 时硬性 NO-GO；物流风险为 found 时阻断。
- `sent_at` 仅表示已确认的真实发送时间；人工录入、CSV 导入和 AI 转立项均不得伪造发送时间。
- 真实数据导入默认只做持久化，不联系供应商、不发送 RFQ、不定标、不签合同、不下单、不付款。
- Keepa 只能用于只读商品数据同步；销量、费用和评级仍需人工核验，不能把估算值当成已核实事实。
- 1688 / Alibaba 数据必须通过官方开放平台和商家授权接入；未授权网页抓取不得作为生产数据源。
- Amazon SP-API 只能用于已授权自有店铺的运营数据与发布能力，不能充当竞品销量来源。
- 系统推荐只是排序结果，不能自动定标。
- 少于 3 家有效报价仍可定标，但必须填写例外/定标说明。
- 商品未立项时不能录入报价或定标；未定标时不能进入内容工作台。
- 已定标商品不能继续新增报价或重复定标。
- 主图不信任客户端扩展名，必须通过文件头、MIME 和大小校验。
- 预检未通过或没有已检查主图时，不能记录内容确认。
- 渠道目标只生成本地 payload 预览；发布准备门禁不调用平台 API，不执行真实 dry-run，不触发发布、改价、库存同步或广告。
- 平台只读验证成功不等于具备发布权限；不得把 `verified` 或 `credentials_valid` 当作 `published`。
- eBay client credentials 通过不代表卖家 OAuth 已验证；Amazon Seller API 可访问也不代表完整 Listing 写入权限已验收。
- 官方写 Adapter、真实平台 dry-run 和外部回执仍未实现；不得把 `unconfigured` 或演示店铺当作可发布店铺，也不能把本地预检冒充平台 dry-run。
- `approved_for_publish` 只代表确认进入内部发布队列，不是平台发布；不得生成或伪称平台 Listing ID、发布回执或已上架状态。
- TikTok Shop / 1688 在官方 Adapter 接入前必须保持 `unsupported`，不得伪造连接状态。
- API Secret 只能通过 `.env.local` 或密钥管理系统注入，禁止写入源码、数据库、CSV、日志或聊天。

P2.1 内部供应商草稿的护栏：

- 草稿只能绑定已加入验证的机会；追问和到期提醒必须绑定该机会下已录入的供应商。
- 到期提醒必须先存在该供应商的真实报价；提醒日期只能是真实存在的今天或未来日期，且不得表述为供应商已确认的报价有效期。
- RFQ、追问和提醒的完整问题列表由确定性代码生成，模型不得删除或替换缺失问题。
- 模型只允许改写主题和开场，必须输出 JSON；新增输入以外的数字、Markdown、越权表述或 Schema 不匹配时回退确定性模板。
- 草稿状态只有 `draft | reviewed`，审阅不等于已发送；不得生成 `sent_at`、外部消息 ID 或发送回执。
- 复制和审阅仅供内部使用，不调用邮件、IM、供应商平台或其他外部写接口。
- 审计必须固定记录 `externalActions: "none"`、`sent: false`；事实快照和幂等键不可省略。

仍未实现：

- 图片、截图、PDF 与扫描件的 OCR/视觉提取；当前只支持文本、CSV、JSON、Markdown
- 邮件正文、邮件附件和 IM 会话的自动归档与增量同步
- 评论、关键词和竞品证据的规模化自动采集；当前通过真实人工/CSV 证据录入闭环，Keepa 目前只覆盖商品层只读字段
- 报价单图片/截图/PDF OCR、PDF 导出、邮件/IM 发送和自动联系供应商
- 供应商回复解析、附件和邮件/IM 自动归档
- AI Listing 文案生成、平台类目必填字段检查、主图初筛和 payload 草稿
- 结算、广告、库存、退货报表导入与 AI 运营分析
- 样品、定样、质检、认证与合规文件管理
- AI 图片生成、A+ 自动排版和场景图脚本
- 品牌授权、知识产权和类目准入自动核验
- 密钥托管、eBay 卖家 OAuth、真实平台 dry-run、官方写 Adapter 和平台发布
- TikTok Shop Partner API 和 1688 / Alibaba 官方授权诊断与 Adapter
- Amazon、Shopify、eBay 的真实写 Adapter、幂等写入与外部回执
- 发布后改价、广告、库存和运营复盘
- 登录、角色权限、多租户和真实生产部署

## 审计要求

每个动作至少记录：

```text
who
what
when
before
after
reason
evidence
workflow_run_id
ai_task_id
field_id
model
prompt_version
schema_version
source_id
externalActions
```

发布准备相关审计动作：

```text
channel.launch_readiness_checked
channel.launch_queue_approved
```

两条审计都必须保留当前 Listing 版本、检查项与阻断项快照，并确认 `externalActions: none`、`published: false`。

## 禁止事项

- 禁止让模型直接计算最终财务数字而不经过确定性计算器。
- 禁止无来源的选品结论。
- 禁止在云端明文保存卖家后台密码和登录 Cookie。
- 禁止把竞品图片直接当成自有商品素材发布。
- 禁止在无预算/利润护栏时自动改价或加广告。
- 禁止在未通过合规检查时自动发布。
- 禁止让 AI 直接写核心业务表；必须先进入暂存表并通过规则校验。
- 禁止用模型置信度替代来源定位和确定性校验。
- 禁止多个 Agent 通过自由文本互相传递业务事实；交接必须使用结构化数据。
- 禁止把 AI 草稿、内部队列或本地预检标记为已发送、已发布或已有外部回执。
