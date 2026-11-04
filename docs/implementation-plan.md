# AITrade 实施蓝图

## 0. 当前实现状态（P1.1）

当前仓库已经实现一条可运行的本地纵向切片：

```text
候选品 / 供应商 / 报价 CSV 或人工接入
→ 导入运行、幂等去重与证据快照
→ 可选 Keepa ASIN 只读同步
→ Amazon / Shopify / eBay 只读连接诊断与审计
→ 证据占位与确定性单位经济模型
→ 商品机会看板
→ 成本模型版本化与人工立项
→ 人工录入供应商报价
→ 到岸成本、综合评分与风险提示
→ 人工定标并回写新成本版本
→ 商品定义
→ 主图上传与逐项人工检查
→ Listing 草稿版本化与确定性预检
→ 多国家 × 多平台渠道目标
→ 平台字段映射与独立市场版本
→ 人工内容批准
→ 确定性发布准备门禁（8 项检查）
→ 人工发布队列审批（仅内部队列）
→ 审计时间线
```

已实现的能力边界：

- 统一数据源工作台和 `/api/ingestion` 已支持候选品、供应商、报价与 Keepa 通道。
- CSV 导入会写入 `ingestion_runs`、`evidence_snapshots`，并保留来源、记录 ID 和采集时间。
- 供应商按平台 + 外部 ID、规范化链接或名称归一化去重；报价按规范化哈希幂等去重。
- Keepa 是可选只读 Adapter；没有 `KEEPA_API_KEY` 时返回 409，不发起外部请求，不伪造数据。
- `/connections` 与 `/api/connections/check` 提供平台只读授权诊断；Amazon 验证 LWA + Seller API，Shopify 验证自有店铺读取，eBay 只验证应用凭证。
- 连接检查写入 `connector_health_checks` 和 `connector.health_checked` 审计；不保存或返回 Secret、Refresh Token、Access Token。
- TikTok Shop 和 1688 仍标记为 `unsupported`，不发起外部请求；eBay 应用凭证成功不代表卖家 OAuth 已验证。
- 确定性单位经济模型、成本版本、人工立项和审计日志已经打通。
- 供应商与报价由人工录入；到岸成本、压力情景利润和评分由确定性代码计算。
- 少于 3 家有效报价仍可定标，但必须填写定标说明；系统推荐不能替代人工决策。
- 定标后锁定新增报价和重复定标，并生成新的成本模型版本。
- 只有完成供应商人工定标的商品才能进入内容工作台。
- 商品定义由人保存，内容包括商品名称、目标用户、核心差异点、规格、包装和禁用声明。
- 主图仅接受真实 JPG / PNG / WebP，最大 8 MB；文件保存到本地受控目录，并通过应用接口读取。
- 主图必须由人确认背景、商品完整性、无未经批准文字/水印以及分辨率与画质。
- Listing 每次保存都会创建新版本；确定性预检检查长度、完整性、搜索词 UTF-8 字节和常见高风险声明。
- 内容批准要求预检无错误，并至少有一张通过人工检查的主图；审批人、说明、预检结果和图片 ID 都会留痕。
- `content_approved` 只表示某个国家 × 平台版本通过内部内容门禁，不是 `published`，不会调用平台 API 或产生任何外部发布动作。
- 同一商品可以创建多个国家 × 平台目标；每个目标有独立的 locale、currency、Listing 版本、平台 payload 和预检结果。
- 已内置 Amazon、Shopify、TikTok Shop、eBay、CSV / 人工的本地字段映射；渠道目标仍使用 `unconfigured` 的本地测试店铺，外部 ID 保持为空。
- 渠道发布准备由确定性代码计算，状态包括 `blocked`、`local_ready`、`dry_run_unsupported`、`approval_pending`、`approved_for_publish`；检查覆盖最新版本、本地预检、内容批准、主图审核、正式店铺、官方写 Adapter、真实平台 dry-run 和当前版本发布队列审批。
- `channel_launch_reviews` 绑定当前渠道 Listing 版本，并固化检查快照、审批人、说明与决策；只有 `approval_pending` 且无阻断项时才能写入。
- 发布队列审批只表示批准进入内部队列，不是平台发布。当前所有平台的 `dryRunSupported` 和 `publishingSupported` 均为 `false`，所有检查和审批结果固定记录 `externalActions: none`、`published: false`，外部商品 ID 保持为空。

为保持现有数据模型简单，商品主状态在立项后仍保持 `approved`。供应商定标由 `supplier_selections` 表达，内容审批状态由 `listings.status` 和 `listing_reviews` 表达；后续扩展完整状态机时再统一迁移。

尚未实现：评论/关键词规模化采集、RFQ 自动生成与发送、询价回复解析、样品/质检、AI 图片生成、A+ 自动排版、品牌授权自动核验、密钥托管、eBay 卖家 OAuth、平台类目与必填字段校验、真实平台 dry-run、官方写 Adapter、发布、改价、库存同步、广告操作和运营复盘。Amazon SP-API 与 Shopify 只完成只读授权诊断，eBay 只完成应用凭证诊断；TikTok Shop 和 1688 尚未接入。所有平台均没有真实外部写连接。当前版本没有登录、角色权限和多租户能力，不能直接作为生产系统使用。

## 1. 落地原则

1. **先做运营工作台，不做另一个全功能 ERP。**
2. **先跑通一条纵向链路，不先做全链路大平台。**
3. **确定性计算用代码，判断和生成用模型。**
4. **所有 Agent 输出必须是结构化产物，不能只有聊天记录。**
5. **有外部副作用的动作默认需要人工审批。**
6. **优先官方 API；网页自动化只作为无 API 时的兜底。**
7. **每个结论必须保留来源、时间、版本和置信度。**

## 2. 初始假设

- 首发平台：Amazon 美国/日本站。
- 首发类目：宠物用品（与参考视频一致，但系统不写死类目）。
- 团队：1～5 人，小团队运营。
- 第一版采用半自动模式：AI 生成报告和草稿，人做关键决策。
- 独立站以后可接 Medusa；Amazon 主战场不把 Medusa 当中枢。

## 3. 产品形态

### 3.1 商品机会看板

按阶段展示每个商品机会：

```text
发现 → 初筛 → 立项 → 询价 → 打样 → 商品定义
→ 内容制作 → 待发布 → 运营中 → 已归档 / 已否决
```

每张卡片展示：

- 当前阶段和负责人
- 市场、类目、目标售价
- 基准/压力情景净利润
- 证据完整度
- 未解决风险
- 下一步动作
- 最近一次审批记录

### 3.2 任务与审批中心

- Agent 完成的分析和生成结果进入任务中心。
- 人可以批准、驳回、要求补充证据。
- 高风险动作单独形成审批单。
- 所有状态变化写入审计日志。

### 3.3 资产库

统一管理：

- 竞品与市场证据
- 供应商报价和附件
- 样品/质检记录
- 原始产品图、主图、场景图、A+ 图
- Listing 草稿和平台版本
- 广告实验记录

## 4. MVP 纵向切片

### 4.1 输入

P1.0 已支持候选品 CSV 文件上传或文本粘贴。推荐字段：

```text
source, source_record_id, observed_at, asin, marketplace, category,
title, url, competitor_price, currency, monthly_sales_min,
monthly_sales_max, review_count, rating, bsr, keyword,
keyword_search_volume, seller_count, variation_count, landed_cost,
fba_fee, referral_rate, ad_rate, return_rate, return_processing,
return_recovery_rate, coupon, storage_cost, other_cost, notes
```

供应商和报价也分别支持 CSV 导入；报价必须关联已人工立项的商品。没有官方 API 或尚未取得授权的渠道继续使用可追溯 CSV/人工通道，避免把项目卡在接口权限上，同时禁止用未授权爬虫或伪造数据绕过接入。

### 4.2 选品与立项

系统执行：

1. 归一化候选品数据。
2. 采集可获得的竞品、关键词、评论和社媒证据。
3. 提取评论主题、差评原因、用户需求和对产品动作。
4. 运行确定性单位经济模型。
5. 生成证据包、风险清单和 GO/NO-GO 建议。
6. 人审立项。

必须输出：

- `selection_report`
- `evidence_snapshot`
- `cost_model`
- `risk_list`
- `decision_recommendation`

### 4.3 供应商 RFQ 与人工定标

用户批准立项后：

1. 生成 RFQ 包：规格、目标成本、MOQ、认证、包装、交期要求。
2. 从供应商库/人工导入名单中选择 3～5 家。
3. 导出询价单或通过可用渠道发送。
4. 录入报价、MOQ、交期、账期、认证和样品费用。
5. 生成报价对比和供应商评分卡。
6. 人审确定供应商；打样、定样和质检进入下一阶段。

第一版不把“自动给阿里供应商打电话”作为必做项。

当前 P1.0 已实现步骤 4～6 的 CSV/人工录入、幂等去重、来源快照、评分对比、人工定标和成本回写。步骤 1～3 的 RFQ 自动生成、名单管理和对外发送仍未实现；导入报价只创建 `quote_imported` RFQ 记录，`sent_at` 保持为空，审计记录 `externalActions: none`、`rfqSent: false`。

### 4.4 商品定义、主图与 Listing 内容（P1.0 已实现）

目标态是在样品与合规通过后进入内容制作。当前 P1.0 为缩短验证路径，允许完成供应商人工定标后直接进入内容工作台；样品、质检、定样和认证文件归档仍是后续能力。

当前已落地：

1. 人工保存商品定义：商品名称、目标用户、核心差异点、规格材质、包装清单、禁用声明和编辑人。
2. 上传一张主图。服务端校验文件头、MIME、扩展名和大小，只接受 JPG / PNG / WebP，最大 8 MB，并保存到本地受控目录。
3. 人工确认白底或纯色背景、商品完整、无未经批准文字/水印、分辨率与画质；系统记录审核人、说明和审计日志。
4. 人工保存 Listing 草稿，包括品牌、标题、五点描述、商品描述和后台搜索词。
5. 每次保存 Listing 都创建新版本，保留旧版本和对应的自动预检结果。
6. 确定性预检通过且至少一张主图通过人工检查后，允许记录人工内容批准。

当前不自动生成图片或 Listing 文案，不做 A+ 排版、品牌授权核验、知识产权判断、认证文件校验或平台类目必填字段校验。人工内容批准也不触发平台发布。

### 4.5 确定性发布预检（P1.0 已实现，非平台发布）

当前预检完全在本地运行，不调用外部平台接口。已检查：

- 标题非空、长度上限和过短提示。
- 五条卖点是否完整、是否超过长度上限、是否重复。
- 商品描述是否为空或超过长度上限。
- 后台搜索词是否为空、UTF-8 字节上限和分隔符提示。
- 品牌是否为空，以及品牌名是否出现在商品描述中。
- “最佳、第一、保证、治愈、100%、零风险”等常见高风险或绝对化表述。
- 内容批准前再次确认预检无错误，并确认存在已通过人工检查的主图。

预检评分用于展示和排序风险，不代替真实合规审核。以下仍未实现：

- Amazon 类目必填字段、变体关系和属性映射
- SP-API dry-run、与现有 Listing 的冲突检查
- 平台图片规格的自动核验
- 品牌授权、知识产权、认证文件和类目准入自动核验
- 平台 payload 的最终合法性、价格与库存一致性和真实 dry-run
- 平台发布、改价、库存同步、广告及任何外部写操作

发布必须继续保留人工审批和审计记录；在当前版本中，系统只能把特定渠道版本标记为 `content_approved`，不能标记为 `published`。

### 4.6 多国家、多平台适配层（P1.0 已实现）

P1.0 把“商品事实”和“渠道版本”拆开：

```text
product_cases
→ products
→ product_market_variants（国家 / locale / currency）
→ channel_accounts（平台店铺，当前 unconfigured）
→ channel_listings（国家 × 平台目标）
→ channel_listing_versions（独立版本、payload、预检、批准）
```

已实现的适配能力：

- Amazon：输出 SP-API 形状的 marketplace、locale、currency 与 attributes。
- Shopify：输出 draft product、handle、tags 和 HTML 描述。
- TikTok Shop：输出标题、描述、selling points、locale 和 currency。
- eBay：输出占位 draft payload，并显式提示 Sell API 未连接。
- CSV / 人工：输出人工核对字段，不执行导出。
- 每个平台可以使用不同的长度、卖点数量、关键词字节和高风险声明规则。

当前边界：适配器只做本地字段转换和预检，不包含认证、签名、限流、重试、幂等发布、回执对账或平台错误映射。真实接入时必须把凭据放在密钥管理系统中，禁止在数据库明文保存卖家后台密码、Cookie 或长期 API secret。

### 4.7 平台只读连接诊断（P1.1 已实现）

连接中心先解决“凭证能否安全访问自有店铺”，再考虑任何写动作：

```text
.env.local / 密钥管理
→ 只读诊断
→ connector_health_checks
→ connector.health_checked 审计
→ 人工验收
→ 本地内容门禁与发布准备检查
→ 正式店铺 + 官方写 Adapter + 平台 dry-run（后续）
→ [人审] 批准进入内部发布队列（P1.1 已实现）
→ 幂等写入与外部回执（后续）
```

已支持：

- Amazon SP-API：使用 LWA refresh token 换取短时 access token，调用 `sellers/v1/marketplaceParticipations` 验证自有店铺与市场访问；区域支持 `na`、`eu`、`fe`。
- Shopify Admin API：只调用 `shop.json` 读取店铺名、币种和国家；域名必须是 `*.myshopify.com`，API 版本使用 `YYYY-MM`。
- eBay：只调用 client credentials token 端点验证应用凭证；卖家 OAuth 和 Sell API 权限没有验证。
- TikTok Shop / 1688：没有实现诊断，返回 `unsupported` 且 `externalRequestAttempted: false`。

安全与审计约束：

- 缺少必需配置时返回 `409 not_configured`，不发起外部请求。
- 所有外部请求超时为 15 秒。
- 健康记录只保存状态、验证层级、耗时、检查人和非敏感详情。
- 审计记录 `connector.health_checked`，包含 `externalActions` 和 `credentialsExposed: false`。
- 诊断成功不等于发布权限、类目合规或平台 dry-run 通过；当前写连接数量固定为 0。

### 4.8 发布准备门禁与内部发布队列（P1.1 已实现）

发布准备由确定性代码计算，不依赖模型自由判断。每次检查评估以下 8 项：

```text
LATEST_VERSION
LOCAL_PREFLIGHT
CONTENT_APPROVED
MAIN_IMAGE_APPROVED
PRODUCTION_ACCOUNT
WRITE_ADAPTER
PLATFORM_DRY_RUN
VERSION_LAUNCH_APPROVAL
```

状态机按以下顺序收敛：

| 状态 | 条件与含义 |
|---|---|
| `blocked` | 最新版本、本地预检、内容批准或主图审核仍有缺口 |
| `local_ready` | 本地内容检查通过，但还没有连接非演示的正式平台店铺 |
| `dry_run_unsupported` | 店铺条件满足，但官方写 Adapter 或真实平台 dry-run 不可用 |
| `approval_pending` | 全部前置检查通过，等待人工批准进入内部发布队列 |
| `approved_for_publish` | 当前版本已人工批准进入内部发布队列，仍未调用平台发布接口 |

审批约束：

- 审批动作必须在服务端重新计算最新状态，只接受 `approval_pending` 且阻断项为 0 的版本。
- 审批记录写入 `channel_launch_reviews`，绑定 `channel_listing_id` 与 `channel_version_id`；旧版本审批不能复用于新版本。
- 记录审批人、说明、检查快照与决策，并写入 `channel.launch_readiness_checked`、`channel.launch_queue_approved` 审计动作。
- `WRITE_ADAPTER` 和 `PLATFORM_DRY_RUN` 必须分别验证。本地预检通过不能冒充平台 dry-run。
- 当前所有平台均为 `dryRunSupported=false`、`publishingSupported=false`，所以真实路径最多到达 `dry_run_unsupported`；`approval_pending` 与 `approved_for_publish` 只是为后续官方能力预留的受控状态。
- 所有发布准备结果和队列审批固定保持 `externalActions=none`、`published=false`。`approved_for_publish` 不生成平台 Listing ID，也不代表商品已上架。

## 5. 工作流实现方式

### 5.1 不使用“一个超级 Agent”

拆成可独立测试的 Skill：

```text
market_research
review_mining
economics_calculator
supplier_sourcing
quote_comparison
product_definition
image_planning
listing_generation
compliance_checker
launch_preflight
ops_watch
```

每个 Skill 的输入和输出都有 JSON Schema。模型只负责需要语言理解和生成的部分。

### 5.2 编排方式

第一版优先使用代码编排：

- Web 创建 workflow run。
- Worker 异步执行步骤。
- 每一步写入 `workflow_steps`。
- 失败可重试，重复执行保持幂等。
- 人工审批通过 signal/API 恢复流程。

后续如需跨天、跨周等待和复杂补偿，再引入 Temporal；不要一开始为了“架构感”增加复杂度。

### 5.3 Dify 的定位

Dify 可用于：

- Prompt 试验
- 知识库检索
- Skill 原型验证

但 Dify 不作为数据库、审批系统或最终业务状态的唯一来源。业务数据必须掌握在自己的 PostgreSQL 中。

## 6. 核心数据模型

### 6.1 商品与机会

- `product_cases`：商品机会主表
- `case_evidence`：来源、URL、抓取时间、原始内容、摘要
- `data_sources`：数据源注册表、能力声明、凭证变量名和就绪状态
- `ingestion_runs`：每次导入的文件、入口、行数、结果、告警和完成状态
- `evidence_snapshots`：候选品、供应商、报价等导入原始内容的可追溯快照
- `connector_health_checks`：平台只读授权检查的状态、验证层级、耗时、检查人和非敏感详情
- `cost_models`：假设参数、计算结果、模型版本
- `approvals`：审批门、决策、审批人、意见
- `audit_logs`：所有关键状态与配置变化

### 6.2 供应与样品

- `suppliers`：供应商档案
- `supplier_external_ids`：供应商外部 ID、规范化链接、身份键和首次/最近出现时间
- `rfqs`：询价单
- `quotes`：报价、MOQ、交期、账期、Incoterms
- `quote_documents`：报价来源快照、链接、校验和与导入元数据
- `supplier_selections`：人工定标结果、定标说明、评分快照和成本版本
- `sample_reports`：样品、缺陷、质检结论
- `compliance_documents`：认证和合规文件

### 6.3 内容与上架

- `assets`：图片、视频、文档及其来源和版本
- `asset_lineage`：原图、生成图、局部编辑之间的关系
- `listings`：平台字段 JSON、状态、外部 ID
- `listing_reviews`：内容、合规和平台预检结果

### 6.4 运营与复盘

- `issues`：竞品、库存、广告、差评、Listing 异常
- `experiments`：广告/价格单变量实验
- `actual_results`：实际销量、成本、退款、广告和利润
- `forecast_errors`：预测与实际差异，用于校准模型

## 7. 技术选型

### 7.1 推荐组合

- Web/API：Next.js + TypeScript
- Worker：Python
- 数据库：PostgreSQL
- 向量检索：pgvector
- 队列：Redis + BullMQ 或 Celery
- 文件：MinIO / S3
- Agent 原型：Dify（可选）
- 图片生成/编辑：ComfyUI + 分割/局部重绘模型
- 电商接口：Amazon SP-API
- 独立站交易层：Medusa（可选）
- 部署：Docker Compose；先在单机/VPS 跑通，再云化

### 7.2 连接器顺序

1. CSV 导入（P1.0 已实现）
2. Keepa ASIN 只读 Adapter（P1.0 已实现，需用户提供 Key 验收）
3. Amazon SP-API / Shopify 自有店铺只读诊断（P1.1 已实现，需真实凭证验收）
4. eBay 应用凭证诊断（P1.1 已实现；卖家 OAuth 仍待实现）
5. TikTok Shop / 1688 官方授权与诊断（规划中，需要应用审核和商家授权）
6. 发布准备门禁与内部发布队列审批（P1.1 已实现；队列审批不等于平台发布）
7. 真实平台 dry-run、官方写 Adapter、幂等写入与外部回执（规划中）
8. 物流商模板、评论/关键词数据、社媒与趋势数据
9. 网页自动化兜底（仅在合法合规且无官方 API 时评估）

不要从爬虫开始。爬虫是最脆弱、最容易封号、最难维护的部分。

### 7.3 凭证与外部动作边界

- 所有密钥只通过 `.env.local` 或密钥管理系统注入，变量名参考 `.env.example`。
- Keepa 只读；未配置 Key 时不得请求外部接口或生成替代数据。
- CSV 导入只入库，不发送 RFQ、不定标、不发布、不改价、不下单、不付款。
- 平台连接诊断只读；填写全部环境变量也不会自动开放写 Adapter 或发布能力。
- TikTok Shop / 1688 在官方 Adapter 实现前必须保持 `unsupported`，不得伪造连接成功。
- `content_approved` 只代表内部内容门禁通过，不等同于平台 `published`。
- 发布准备必须分开验证正式店铺、官方写 Adapter 和真实平台 dry-run；本地预检不能替代平台 dry-run。
- 当前所有平台均为 `dryRunSupported=false`、`publishingSupported=false`；发布队列审批只进入内部队列，固定记录 `externalActions: none`、`published: false`。
- `approved_for_publish` 不是平台发布结果，不得生成或伪称外部商品 ID、回执或已上架状态。

## 8. 审批门与自动化边界

### 必审

- 商品立项
- 供应商定样
- 商品合规声明
- 进入内部发布队列
- 新 Listing 发布
- 超过阈值的价格调整
- 超过预算的广告动作
- 付款、退款、赔付
- 删除或大幅修改已有 Listing

### 可自动

- 数据采集与归一化
- 评论聚类
- 成本计算
- 报价对比
- 主图/文案草稿
- 字段校验
- 异常检测
- 生成审批单和索赔材料

## 9. 验收指标

第一版不追求“无人化”，追求可量化的效率和质量：

- 100 个候选品初筛时间从 2 天降到 2 小时以内
- 单个候选品的完整成本模型生成时间小于 5 分钟
- 每个选品结论 100% 有来源和数据时间
- RFQ 生成时间小于 10 分钟
- Listing 初稿人工重写率低于 30%
- 所有发布动作 100% 有审批和审计记录
- 预测毛利与实际毛利偏差持续跟踪
- 不发生无审批的价格、广告、退款和付款动作

## 10. 交付节奏

### 第 1 周：底座

- 项目脚手架
- 数据库迁移
- 商品机会看板
- 审批与审计
- CSV 导入

### 第 2 周：选品纵向切片

- 证据快照
- 评论分析
- 成本模型
- 选品报告
- 人审立项

### 第 3 周：供应商纵向切片

- 供应商库
- RFQ
- 报价录入与对比
- 样品记录
- 定样审批

### 第 4 周：内容纵向切片

- 商品定义
- 图片资产库
- 主图/A+/Listing 草稿
- 合规检查
- 发布预检

### 第 5～6 周：试点与校准

- 10～20 个真实候选品
- 5 个 RFQ
- 3 个内容资产包
- 1 个商品从选品走到发布预检
- 统计耗时、返工率和错误来源

单人可以 6～8 周完成可用 MVP；2～3 人团队可压缩到 3～4 周。

## 11. 最重要的工程约束

1. 外键和状态机优先于 Agent 框架。
2. 所有生成结果有版本、输入快照和来源。
3. 成本计算器必须有单元测试，不能被模型随意重算。
4. 模型输出必须通过 JSON Schema 校验。
5. 外部动作必须幂等，避免重复改价、重复发布、重复退款。
6. 保存原始响应，不能只保存模型总结。
7. Prompt、Skill、模型和价格规则都要版本化。
8. 先积累真实决策数据，再谈自动优化。
