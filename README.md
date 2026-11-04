# AITrade

面向跨境电商的 AI 运营工作台。目标不是替代 ERP，而是把选品、供应商、内容生产、上架和运营异常沉淀成可审计、可确认、可复用的工作流。

当前仓库是一个**可运行的 P1.3 AI 选品验证闭环 + 数据底座 + 纵向业务切片 + 只读连接诊断**。默认走**免费数据模式**：真实候选品、供应商和报价通过 CSV 或人工通道入库，保留来源、采集时间、运行记录和原始快照。运行工作流不需要任何收费选品 API Key。已跑通：

```text
AI 选品假设（模板 / Ollama / OpenAI-compatible）
→ 加入验证，记录真实竞品、差评、专利与物流证据
→ 供应商短名单与真实报价
→ 16 项确定性 GO / HOLD / NO-GO 门禁
→ GO 后转商品立项并导入全部报价
→ 候选品 / 供应商 / 报价真实数据接入
→ CSV 导入、幂等去重、运行记录与证据快照
→ 平台后台 / ERP / 供应商 / 人工核验数据导入
→ Amazon / Shopify / eBay 只读连接检查
→ 生成证据占位与单位经济模型
→ 商品机会看板
→ 修改成本假设并生成新版本
→ 候选品直接进入立项，无需审批
→ 录入供应商报价并计算到岸成本
→ 多供应商评分与风险提示
→ 人工定标并回写成本模型
→ 商品定义与供应商授权边界
→ 主图上传、格式校验与人工检查
→ Listing 草稿版本化与确定性发布预检
→ 多国家 × 多平台渠道目标
→ 平台字段映射与独立市场版本
→ 人工内容确认
→ 确定性发布准备门禁（8 项检查）
→ 人工发布队列确认
→ 状态同步与审计时间线
```

![AITrade 工作台：左侧统一导航、首页右上角站点切换与站点级商品机会](docs/assets/aitrade-workspace-sidebar.png)

![已立项商品与成本版本、审计记录](docs/assets/aitrade-case-approved.png)

![三家供应商报价对比与评分](docs/assets/aitrade-sourcing.png)

![人工定标、成本回写与审计记录](docs/assets/aitrade-sourcing-selected.png)

![内容工作台、已定标成本与内容门禁](docs/assets/aitrade-content-studio.png)

![Listing 发布预检与审计记录](docs/assets/aitrade-listing-preflight.png)

![店铺连接中心：只读验证、未接入状态与写连接边界](docs/assets/aitrade-connections.png)

![发布准备门禁：内容已就绪但平台 dry-run 与外部写入未开放](docs/assets/aitrade-launch-readiness.png)

## 工作台导航

桌面端采用固定左侧一级导航，把日常业务操作和系统配置分开；首页右上角保留“国家 / 市场 × 平台 / 站点”切换器。切换任一维度后，商品机会、利润指标、AI 选品和导入入口会同步进入同一个站点上下文。

| 导航分组 | 页面 | 主要用途 |
|---|---|---|
| 业务工作台 | AI 选品 `/` | 按国家 × 平台查看机会、运行 AI 选品研究并进入已立项商品 |
| 业务工作台 | AI 研究 `/ai-sourcing` | 生成机会假设、录入真实证据和供应商报价、执行确定性门禁并转立项 |
| 业务工作台 | 供应商询价 `/sourcing` | 管理报价、到岸成本、供应商评分和人工定标 |
| 业务工作台 | 数据源 `/data-sources` | 导入候选品、供应商和报价 CSV，查看运行记录与数据告警 |
| 系统 | 连接中心 `/connections` | 执行 Amazon、Shopify、eBay 只读连接诊断，查看写入边界 |
| 系统 | 系统设置 `/settings` | 配置大模型服务商、Base URL、模型名称、API Key 和连接测试 |

商品详情、内容工作台和 Listing 页面归属“AI 选品”，导入页面也归属同一工作台，保证纵向工作流有稳定的导航入口。屏幕宽度低于 960px 时，侧边栏自动收拢为顶部横向导航，避免压缩内容区；手机端导航可横向滚动。

## 当前能力

- 统一侧边导航：桌面端固定展示“业务工作台 / 系统”，当前页面自动高亮，商品详情、内容与导入页面保持父级导航高亮
- 独立“数据源”工作台 `/data-sources`，统一展示数据源就绪度、真实数据量、最近 20 次导入和告警
- CSV 导入 API `/api/ingestion` 支持候选品、供应商和报价，不需要任何付费 API Key
- CSV 文件上传或直接粘贴导入；候选品最多 200 行，供应商和报价最多 1,000 行，CSV 最大 2 MB
- 中英文字段名兼容，重复 `asin + marketplace` 幂等跳过；供应商按平台 + 外部 ID、规范化链接或名称去重
- 候选品导入显式绑定“国家 × 平台站点”；同一商品可关联多个站点，机会看板和指标严格按当前站点隔离
- 每个导入批次生成 `ingestion_runs`，记录文件、入口方式、新增/更新/跳过/失败、快照、告警和完成时间
- 每条真实数据保留 `source_code`、`source_record_id`、`observed_at` 和 `evidence_snapshots` 原始快照
- 候选品支持销量区间、币种、BSR、关键词搜索量、卖家数、变体数和完整成本假设
- 报价支持运费、关税率、币种、有效期、开模费、付款条件、Incoterms、认证和供应商外部 ID
- 数据源页面默认只显示 CSV / 人工免费通道，不把收费选品 Key 作为运行前提
- 收费或订阅型研究连接器不进入默认工作流；历史 API 路由不会主动调用，也不会要求配置 Key
- AI 选品按当前「国家 × 平台」生成 5 个不同方向，默认模板模式免 Key，也可选 Ollama 或 OpenAI-compatible 模型
- AI 只生成假设、验证任务和查询词，不伪造销量、评论、供应商、报价、专利、物流或利润事实
- 真实竞品快照、差评、专利、物流证据、供应商短名单和报价均要求来源 URL、观察时间、录入人和原始快照
- 16 项确定性门禁覆盖研究优先级、竞品数、差评样本、供应商数、报价数、到岸成本、净利率、压力利润、证据完整度、MOQ、交期、样品评分、专利风险、物流风险、首单现金占用和汇率依据
- 只有确定性 GO 才能转商品立项；转入时复制全部供应商、RFQ 占位记录、真实报价和证据，再进入供应商比价与人工定标
- 非 USD 站点必须记录可追溯汇率来源；`sent_at` 只代表已确认发送时间，报价录入和转立项不会伪造发送时间
- AI 选品全程固定记录 `externalActions: none`、`published: false`，不会自动联系供应商、发 RFQ、下单、付款或发布
- 独立“连接中心” `/connections`：Amazon 验证 LWA + Seller API，Shopify 验证自有店铺只读访问，eBay 只验证应用凭证
- 每次连接检查写入 `connector_health_checks` 和 `connector.health_checked` 审计；页面与数据库均不保存或回显 Token、Secret
- TikTok Shop 与 1688 明确显示“尚未接入”，检查结果标记为 `unsupported`，不发起外部请求，也不伪造连接状态
- 确定性单位经济模型：净收入、佣金、广告、退货损失、压力测试、ROI
- 首页右上角即时切换国家/市场与平台站点，无需点击“应用”；页面会按当前站点展示商品机会，并同步计算候选数、GO 数与平均净利率
- 成本参数修改与版本化历史
- 候选品直接进入立项，不再维护独立审批流程
- 成本版本和关键动作写入审计日志
- 供应商档案和报价录入，报价包含运费、关税率、质量分、MOQ、交期、样品费和认证
- 确定性到岸成本、单位经济模型、综合评分和风险标签
- 供应商横向对比、系统推荐与人工定标
- 定标后自动生成新的成本模型版本，并记录定标人、说明、评分快照和成本版本
- 同一商品只允许人工定标一次；定标后锁定新增报价和重复定标
- 供应商定标后解锁商品定义工作台，记录产品事实、目标用户、差异点、规格和禁用声明
- 主图仅接受真实 JPG / PNG / WebP（最大 8 MB）并保存到本地；白底、商品完整、文字水印和分辨率由人逐项确认
- Listing 标题、五点描述、描述和后台搜索词结构化保存；每次保存生成新版本
- 确定性发布预检检查长度、完整性、搜索词 UTF-8 字节和常见高风险声明
- 只有预检通过且至少有一张已人工检查的主图时，才允许记录人工内容确认
- 商品定义、图片上传与检查、Listing 版本和内容确认全部写入审计时间线
- 同一商品可创建多个国家 × 平台渠道目标，各自维护 locale、currency、Listing 版本和预检结果
- 内置 Amazon、Shopify、TikTok Shop、eBay、CSV / 人工的本地字段映射预览；Amazon 保留 SP-API 形状，Shopify 默认 draft，TikTok Shop 保留 selling points
- 平台渠道目标仍使用未配置的本地测试店铺，外部 ID 保持为空；内容确认审计写入 `externalActions: none`
- 渠道级发布准备门禁按最新版本、本地预检、内容确认、主图检查、正式店铺、写 Adapter、平台 dry-run 和当前版本发布队列确认 8 项条件确定性计算
- 发布准备状态为 `blocked`、`local_ready`、`dry_run_unsupported`、`approval_pending`、`approved_for_publish`；只有 `approval_pending` 无阻断项时，人工才能确认进入内部发布队列
- `channel_launch_reviews` 固化确认时的检查快照、确认人、说明和版本 ID，并强制记录 `externalActions: none`、`published: false`
- 4 个演示商品和真实数据导入模板；示例模板明确标注为示例，不冒充认证供应商或真实市场结论

## 明确边界

P1.3 默认覆盖“AI 机会假设 → 真实竞品 / 差评 / 专利 / 物流证据 → 供应商短名单与报价 → 确定性 GO / HOLD / NO-GO → GO 转商品立项 → 供应商比价与人工定标 → 商品定义 → 主图人审 → 多国家/多平台 Listing 草稿与本地预检 → 人工内容确认 → 发布准备门禁 → 内部发布队列确认”。它是可运行的 AI 运营原型，不是生产系统。

当前真实接入状态：

- **已实现 AI 选品验证**：5 个机会假设、真实证据录入、供应商短名单、真实报价、16 项确定性门禁和 GO 转立项
- **已实现**：候选品 CSV、供应商 CSV、报价 CSV、人工报价录入和可追溯导入运行
- **已实现只读诊断**：Amazon SP-API 自有店铺、Shopify Admin API、eBay 应用凭证
- **已实现内部确认**：渠道发布准备检查与人工发布队列确认；确认只进入内部队列，不产生平台发布
- **只做本地适配预览**：Amazon、Shopify、TikTok Shop、eBay Listing 字段映射
- **已注册但未接入**：TikTok Shop Partner API、1688 / Alibaba 官方授权接口
- **尚未实现**：所有平台的真实平台 dry-run、写 Adapter、eBay 卖家 OAuth 完整链路、发布与外部回执

以下能力尚未实现：

- 选品证据的规模化自动采集；当前通过人工/CSV 记录真实来源，自动联网采集仍需合规数据通道
- 自动生成/导出 RFQ、自动联系供应商、询价回复解析
- 样品管理、打样、质检和合规文件归档
- AI 图片生成、A+ 自动排版、品牌授权自动核验和类目合规引擎
- 平台密钥托管、eBay 卖家 OAuth、平台 dry-run、发布、改价、库存同步和广告操作
- 登录、角色权限和多租户
- 未授权平台爬虫和规模化联网抓取；收费选品数据不作为默认依赖

系统不会自动生成或发送 RFQ、联系供应商、定标、签合同、下单或付款，也不会把本地 Listing 草稿发布到平台。AI 选品页面生成的只是待验证假设；任何市场事实、供应商报价和证据都必须由真实来源补齐。CSV 导入只入库，所有真实导入默认记录 `externalActions: none`；已支持的连接诊断仅记录 `read_only`。连接验证成功只证明当前凭证可完成对应只读请求，不代表平台发布权限、类目合规或商品已上架。当前所有平台均为 `dryRunSupported=false`、`publishingSupported=false`；`approved_for_publish` 只表示确认进入内部发布队列，不等于平台发布，外部商品 ID 仍为空。演示数据只用于验证系统和计算逻辑，不代表真实市场结论或图片授权。

## 技术栈

- Next.js 16 + React 19 + TypeScript
- PGlite（本地嵌入式 PostgreSQL）
- Node.js 20.9+
- 不依赖 Docker

数据库目录默认为 `.data/aitrade`，位于 `.gitignore` 中。SQL 保持 PostgreSQL 兼容，后续可以迁移到正式 PostgreSQL。

## 本地启动

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。

生产模式验证：

```bash
npm run build
npm start
```

首次启动时，如果 `product_cases` 为空，会自动写入 4 个演示商品。

## 站点级商品机会

首页是站点工作区入口。在页面右上角选择“国家 / 市场”和“平台 / 站点”，任一选择变化后会立即刷新，无需再点击应用按钮；地址栏会保留当前范围，例如：

```text
/?market=US&platform=amazon#opportunities
/?market=US&platform=tiktok_shop#opportunities
```

商品机会不是按商品表里的单一 `marketplace` 字段粗略过滤，而是通过 `product_case_sites(case_id, market_code, platform_code)` 显式归一：

- 首页只显示明确关联到当前 `国家 × 平台` 的候选品，或已经建立同站点渠道目标的商品
- 切换国家或平台后，机会列表、机会数、建议 GO 和平均净利率会一起变化
- 同一商品可以在多个站点分别立项；从 Amazon 再导入 TikTok Shop 时会新增站点关系，不复制商品
- 旧数据启动时只回填为原 `marketplace × amazon`，不会自动出现在其他平台
- 非 Amazon 候选品不会自动生成 Amazon 测试店铺或 Listing

从首页、`/import` 或数据源工作台导入候选品时，必须确认目标国家与平台；导入成功后会返回对应站点机会页。CSV 中的 `marketplace` 会被当前选择的国家覆盖，避免文件内容和页面范围不一致。

## AI 选品验证闭环（P1.3）

入口：`/ai-sourcing`。页面会继承首页当前的国家和平台，例如：

```text
/ai-sourcing?market=US&platform=amazon
/ai-sourcing?market=GB&platform=amazon
/ai-sourcing?market=JP&platform=amazon
```

操作路径：

1. 输入类目和研究简报，系统固定生成 5 个不重复的机会假设，并给出研究优先级。
2. 把值得验证的假设加入验证，系统生成竞品、差评、专利、物流、供应商和报价待办。
3. 录入真实竞品快照、差评证据、专利结论、物流结论和供应商短名单；所有证据必须带来源 URL、观察时间和录入人。
4. 录入至少 3 家供应商的真实报价，系统确定性计算到岸成本、净利率、压力利润和首单现金占用。
5. 查看 16 项门禁。缺数据或未达阈值是 HOLD，确认专利风险是 NO-GO，全部通过才是 GO。
6. 只有 GO 才能转商品立项。系统会复制全部真实报价和证据，并创建待人工处理的 RFQ 占位记录；`sent_at` 保持为空，表示系统没有发送 RFQ。
7. 转入后继续进入供应商比价、人工定标、商品定义、主图检查和多国家多平台 Listing 草稿。

## 大模型设置

入口：左侧导航“系统 → 系统设置”，或直接打开 `/settings`。首页的模型状态卡和“大模型设置”按钮也会跳到该页面。

支持三种模式：

- **免 Key 模板模式**：默认模式，不需要任何外部模型或 API Key。
- **本地 Ollama**：填写本机或内网 Ollama 地址，数据不经过第三方模型 API。
- **OpenAI 兼容接口**：支持 OpenAI、DeepSeek、自建网关及其他兼容 `/chat/completions` 的服务。

设置页可以填写服务商、Base URL、模型名称、API Key 和操作人，并提供“测试连接”。配置优先级固定为：

```text
页面保存的设置
→ 环境变量
→ 默认模板
```

安全边界：

- API Key 只在服务端读取，使用 AES-256-GCM 加密后保存到本机 `.data` 目录。
- 页面和接口只显示脱敏尾号，不返回完整 Key，审计日志不记录 Key。
- API Key 输入框留空保存时保留已有 Key；“清除已保存的 Key”会把页面配置回退到无 Key 状态。
- “测试连接”只使用当前表单值验证，不保存配置。
- 模型请求失败时自动回退模板，不阻断选品流程。
- 可通过 `AI_SETTINGS_ENCRYPTION_KEY` 固定加密密钥；不配置时会自动生成本地密钥文件。

环境变量仅作为页面配置的回退方式，完整模板见 `.env.example`：

```bash
AI_PROVIDER=template                 # template | ollama | openai-compatible
AI_BASE_URL=
AI_MODEL=
AI_API_KEY=
AI_SETTINGS_ENCRYPTION_KEY=
```

## 接入真实数据（P1.2）

进入“数据源”页面 `/data-sources`，可以分别导入候选品、供应商和报价。默认免费模式不需要 API Key；旧的“导入候选品”页面 `/import` 仍保留兼容，但新字段和运行记录以数据源工作台为准。

### 候选品 CSV

模板：`public/candidates-template-v2.csv`

最小字段：

```text
asin,marketplace,title,competitor_price
```

推荐完整字段：

```text
source,source_record_id,observed_at,asin,marketplace,category,title,url,
competitor_price,currency,monthly_sales_min,monthly_sales_max,review_count,
rating,bsr,keyword,keyword_search_volume,seller_count,variation_count,
landed_cost,fba_fee,referral_rate,ad_rate,return_rate,return_processing,
return_recovery_rate,coupon,storage_cost,other_cost,notes
```

- `title` 和 `competitor_price` 必须有有效值
- 导入前选择目标“国家 / 市场”和“平台 / 站点”；站点归属写入 `product_case_sites`
- 没有 `asin` 时会生成临时编号；同一 `asin + marketplace` 重复导入会跳过
- 没有 `landed_cost` 时暂按售价的 30% 估算，仅适合早期筛查，不能替代真实报价
- 当前成本模型不盈利的候选品会被拒绝导入
- `monthly_sales_min` / `monthly_sales_max` 会保留区间，估算值为区间中位数
- `observed_at` 不会被导入时间覆盖；没有填写时使用导入时刻
- 比率字段可写 `15` 或 `15%`，系统按百分比解释

### 供应商 CSV

模板：`public/suppliers-template.csv`

关键字段：

```text
supplier_platform,external_supplier_id,supplier_name,supplier_url,
country,contact,category,rating,verified,moq,lead_time_days,
certifications,observed_at
```

供应商身份按以下顺序归一化：平台 + 外部供应商 ID、平台 + 规范化链接、平台 + 名称。重复导入会更新档案，不会重复建档；规范化链接会移除常见追踪参数并统一大小写。

### 报价 CSV

模板：`public/quotes-template.csv`

报价必须用 `asin + marketplace` 或 `case_id` 关联一个**已人工立项**的商品。关键字段：

```text
case_id,asin,marketplace,supplier_platform,external_supplier_id,
supplier_name,supplier_url,supplier_contact,supplier_country,
supplier_category,unit_price,freight_per_unit,duty_rate,quality_score,
moq,lead_time_days,payment_terms,incoterm,sample_fee,tooling_fee,
certifications,quote_valid_until,currency,observed_at
```

报价通过规范化报价哈希幂等去重。导入会创建或复用供应商、报价、来源快照和审计记录，但不会生成或发送 RFQ，不会自动定标，也不会产生采购承诺。

### 为什么不接收费数据源

AITrade 默认不接入任何订阅型选品 API，也不需要生成付费 Key。Sorftime 适配器已移除；Keepa 仅暂时保留后端兼容能力，不显示在默认界面，也不会被工作流自动调用。覆盖全类目的实时销量、BSR 和历史趋势通常属于收费数据服务；为了避免把工作流建立在持续订阅上，本项目改用以下免费且可追溯的输入：

- 平台后台或 ERP 导出的商品 / 订单 / 广告数据
- 1688、Alibaba、供应商 Excel 或人工整理的供应商档案
- 供应商邮件、聊天或报价单整理出的 CSV
- 平台官方提供的自有店铺只读授权（仅用于自己的店铺数据，不是竞品销量来源）

这不会自动取得完整的竞品市场数据，但能保证没有付费 Key 也能完成“导入 → 确认 → 成本模型 → 供应商比价 → 主图 / Listing 预检”的闭环。

### 店铺连接中心（P1.1）

进入 `/connections` 运行只读授权检查，或调用：

```bash
curl -X POST http://localhost:3000/api/connections/check \
  -H 'Content-Type: application/json' \
  -d '{"code":"shopify","actor":"本地管理员"}'
```

支持范围：

- `amazon_sp_api`：刷新 LWA Token，并调用 Seller API 的 `marketplaceParticipations`，确认自有店铺与市场访问权限
- `shopify`：调用 Admin REST `shop.json`，只读取店铺名、币种和国家；域名必须是 `*.myshopify.com`
- `ebay`：只验证 client credentials 应用凭证；这不等于卖家 OAuth 或 Sell API 权限已验证
- `tiktok_shop` / `alibaba_1688`：返回 `unsupported`，不发起外部请求

所需非敏感配置和凭证变量如下，完整模板见 `.env.example`：

```bash
AMAZON_SP_API_REGION=na # na | eu | fe
AMAZON_SP_API_CLIENT_ID=
AMAZON_SP_API_CLIENT_SECRET=
AMAZON_SP_API_REFRESH_TOKEN=

SHOPIFY_SHOP_DOMAIN=your-shop.myshopify.com
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2026-10

EBAY_ENVIRONMENT=production # sandbox 仅用于测试
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
```

检查结果写入 `connector_health_checks`，记录状态、验证层级、耗时、检查人和非敏感详情；审计动作是 `connector.health_checked`，并固定记录 `credentialsExposed: false`。所有外部请求超时为 15 秒。缺少凭证时接口返回 `409 not_configured`，不会写入成功记录或发起网络请求。

当前写连接数仍为 0：没有新增、修改、发布、改价、库存写入、订单写入、退款或付款接口。

## 成本口径

```text
净收入 =（售价 − Coupon）×（1 − 退货率）
佣金 = 净收入 × 佣金率
广告 = 扣 Coupon 前收入 × 广告占比
退货损失 = 退货率 ×（退货处理费 + 采购成本 × (1 − 残值率)）
单件净利 = 净收入 − 采购 − FBA − 佣金 − 广告 − 退货损失 − 仓储 − 其他
```

压力情景：

- 售价下降 10%
- 采购成本上升 20%
- 广告占比上升 20%
- 退货率增加 2 个百分点

建议规则：

- 压力情景不盈利：`NO-GO`
- 机会分 ≥ 65 且净利率 ≥ 18%：`GO`
- 其他：`HOLD`

## 供应商询价与人工定标

候选品直接立项后，会出现在“供应商询价”页面。当前流程是人工录入真实询价结果，系统负责确定性计算、横向比较和操作留痕：

1. 录入供应商档案与报价：采购单价、单件运费、关税率、MOQ、交期、质量分、样品费、贸易条款、付款条件和认证信息。
2. 系统计算到岸成本与单位经济结果：

   ```text
   关税 =（采购单价 + 单件运费）× 关税率
   到岸成本 = 采购单价 + 单件运费 + 关税
   ```

3. 按综合评分排序：成本 45%、质量 25%、交期 15%、MOQ 10%、样品费与认证 5%。
4. 只有“压力情景净利 > 0 且质量评分 ≥ 50”的报价通过入选门槛。系统推荐只是排序建议，不能替代人工定标。
5. 建议至少比较 3 家有效报价；少于 3 家仍可定标，但定标说明为必填。
6. 人工确认后，系统创建 `supplier_selections` 记录，把所选报价的到岸成本写入新的成本模型版本，并记录定标人、说明、评分快照和审计日志。

同一商品只允许人工定标一次。定标后，页面锁定新增报价和重复定标；联系供应商、打样、下单和付款仍保留人工控制。

当前实现不改变商品主状态枚举：商品仍为 `approved`，供应商是否已定标由 `supplier_selections` 表达。这样可以避免把“已立项”和“已定标”错误合并成同一个状态。

## 商品定义、主图与内容确认

供应商定标后可从定标结果或商品详情进入内容工作台：

1. 保存商品定义：商品名称、目标用户、核心差异点、规格材质、包装清单、禁用声明和编辑人。
2. 上传主图。服务端检查文件头与 MIME 类型，只接受 JPG / PNG / WebP，最大 8 MB；文件通过受控接口读取，不信任任意客户端路径。
3. 人工逐项确认白底或纯色背景、商品完整性、无未经授权文字/水印、分辨率与画质，并记录检查人、说明和审计日志。
4. 保存 Listing 草稿。标题、五条卖点、描述和后台搜索词都会进入确定性预检；每次保存创建新版本，旧版本保留。
5. 预检通过且至少一张主图通过人工检查后，记录人工内容确认。

当前预检不替代任何平台的真实 dry-run，也不检查真实品牌授权、认证文件、类目必填字段或知识产权。`content_approved` 不是 `published`：它只表示该国家 × 平台版本已通过内部内容门禁，系统不会调用外部平台接口。

## 多国家、多平台上市矩阵

完成商品定义和主图检查后，可以从商品详情或内容工作台进入“上市矩阵”：

1. 选择国家/市场和平台，创建独立渠道目标。同一商品、国家、平台组合幂等复用。
2. 每个国家维护独立的 `product_market_variant`，继承市场 locale、currency 和计量口径；每个平台维护独立的 `channel_listing` 与版本序列。
3. 保存 Listing 时生成三层产物：canonical snapshot、平台适配 payload、本地预检结果。不同目标不会覆盖彼此的版本。
4. 当前内置市场为 US、GB、DE、JP、SG、MY、AU；内置平台为 Amazon、Shopify、TikTok Shop、eBay 和 CSV / 人工。
5. 渠道店铺默认是 `unconfigured` 的测试店铺。页面会明确显示连接器未接入、外部 ID 为“未连接”、不会发布。
6. 人工内容确认同时要求本地预检通过和至少一张已检查主图，并写入检查人、版本、市场、平台及 `externalActions: none` 审计记录。

![同一商品的国家 × 平台渠道矩阵](docs/assets/aitrade-channel-matrix.png)

![渠道目标、独立版本、本地预检与未连接状态](docs/assets/aitrade-channel-targets.png)

## 发布准备门禁与内部发布队列

内容确认后，渠道目标还需要通过确定性的发布准备检查。系统会同时评估 8 项条件：

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

状态按门禁顺序收敛为：

| 状态 | 含义 |
|---|---|
| `blocked` | 最新版本、本地预检、内容确认或主图检查仍有缺口 |
| `local_ready` | 本地内容已就绪，但正式平台店铺尚未连接 |
| `dry_run_unsupported` | 店铺条件已满足，但真实平台 dry-run 或官方写 Adapter 尚未实现 |
| `approval_pending` | 全部前置检查通过，等待人工确认进入内部发布队列 |
| `approved_for_publish` | 当前版本已确认进入内部发布队列，但尚未向平台发布 |

只有 `approval_pending` 且无阻断项时，确认动作才会在服务端重新计算并写入 `channel_launch_reviews`。确认绑定当前 Listing 版本 ID，旧版本确认不能复用；检查与确认分别记录 `channel.launch_readiness_checked`、`channel.launch_queue_approved` 审计动作。

当前所有平台的 `dryRunSupported` 和 `publishingSupported` 均为 `false`，Amazon、Shopify、TikTok Shop、eBay 与 CSV / 人工都不支持真实平台 dry-run 或外部发布。因此 `approved_for_publish` 不是 `published`，外部商品 ID 仍为空，两个字段始终保持：

```text
externalActions = none
published = false
```

## 常用命令

```bash
npm run typecheck  # TypeScript 检查
npm test           # 成本、AI 选品门禁、供应商、Listing、CSV、连接诊断与导入审计测试
npm run build      # 生产构建
npm run dev -- -p 3100  # 指定 3100 端口启动开发服务
npm run db:reset   # 删除本地数据库，下次启动重新初始化演示数据
```

环境变量参考 `.env.example`。本地覆盖请使用 `.env.local`：

```bash
PGLITE_DATA_DIR=/absolute/path/to/aitrade-data
```

`db:reset` 会删除整个本地数据库，仅在确认不需要现有数据时使用。

## 自测状态（2026-11-04）

本轮已在生产模式下完成自动检查和真实浏览器验收：

- `npm run typecheck`：通过
- `npm test`：63 / 63 通过
- `npm run build`：通过
- 新版工作台导航已在 1512px 桌面、900px 平板和 390px 手机宽度完成浏览器验收；桌面固定侧栏，窄屏自动切换为顶部横向导航，主内容无横向溢出
- 侧边栏当前页高亮正常；商品详情、内容工作台和导入页均归属“AI 选品”，系统设置和连接中心分别保持独立选中状态
- 浏览器逐页打开 `/`、`/ai-sourcing`、`/settings`、`/sourcing`、`/data-sources`、`/connections`：均返回 200，无 404；`/approvals` 仅保留兼容跳转
- 使用 `127.0.0.1:3100` 实际请求首页、AI 选品的 US / GB / JP 站点及主要业务页，确认端口可达且没有 404
- 免费模式验收：`/data-sources` 只显示候选品、供应商、报价三个 CSV 通道和“0 付费 Key”，不显示收费数据源表单或 Key 地址
- 浏览器验收了“已内容确认版本”和“草稿版本”两种发布准备状态：前者显示 `本地内容已就绪` 与 4 个阻断项，后者显示 `本地门禁未完成`
- 两种状态均显示平台 dry-run 不支持、`externalActions=none`、`published=false`；发布队列确认按钮只在满足 `approval_pending` 时可用
- 首页 `US × Amazon` 显示 7 个机会；切换 `US × TikTok Shop` 显示 0 个，并出现该站点的导入入口
- 首页国家/平台选择器、站点指标、机会列表和导入链接使用同一 `market + platform` 上下文，正式数据库未重置
- Shopify 未配置凭证时检查返回 `409 not_configured`，页面不显示“已连接”，也不写入成功记录
- TikTok Shop / 1688 始终显示“尚未接入”；即使检查请求被调用，也只返回 `unsupported` 且 `externalRequestAttempted: false`
- 连接中心固定显示“写连接 0”；没有新增发布、改价、库存、订单或付款写接口
- 默认数据源页面不加载收费同步任务面板，也不要求生成任何付费 Key；CSV 导入链路保持可用

本轮验收同时修复了一个界面状态缺陷：未实现的平台不再因为环境变量是否填写而显示“待验证”或“未配置”，而是始终显示“尚未接入”。上面的连接中心截图来自修复后的本地生产构建。

## 目录

```text
src/app/                 页面、Server Actions 和导入 API
src/app/ai-sourcing/     AI 选品批次、假设、证据、报价与决策工作台
src/app/data-sources/    真实数据源工作台
src/app/connections/     平台连接中心与只读授权诊断
src/app/api/ingestion/   候选品、供应商与报价 CSV 导入 API
src/app/api/connections/ 平台连接检查 API
src/components/app-sidebar.tsx 工作台侧边导航与当前页高亮
src/components/topbar-site-scope.tsx 顶部区块上下文与国家 × 平台切换
src/lib/ai-provider.ts  模板 / Ollama / OpenAI-compatible 假设生成与回退
src/lib/ai-sourcing.ts  假设校验、研究优先级、平台成本参数与 16 项确定性门禁
src/lib/ai-sourcing-repository.ts AI 选品持久化、证据校验、报价和转立项事务
src/lib/ingestion.ts     导入编排、幂等、运行记录、快照与审计
src/lib/connectors/      CSV 与平台诊断 Connector 注册表
src/lib/connection-diagnostics.ts 连接检查持久化与审计
src/lib/economics.ts     确定性单位经济计算
src/lib/sourcing.ts      到岸成本、供应商评分与风险规则
src/lib/listing.ts       Listing 结构、确定性发布预检与风险词提示
src/lib/channels.ts      市场上下文与平台字段映射、平台差异化本地预检
src/lib/launch-readiness.ts 确定性的发布准备状态机、8 项检查与阻断原因
src/lib/storage.ts       主图格式校验与本地受控存储
src/lib/csv.ts           CSV 解析、字段兼容和导入映射
src/lib/repository.ts    数据访问、导入、定标和内容门禁事务
db/schema.sql            PostgreSQL 兼容表结构
docs/                    实施蓝图和工作流安全边界
```

## 文档

- [实施蓝图](docs/implementation-plan.md)
- [工作流与安全边界](docs/workflow-and-guardrails.md)

## 下一步

1. 用真实国家和平台数据跑通“5 个假设 → 真实证据 → 3 家报价 → GO → 转立项 → 定标”，并保留来源快照和审计
2. 配置 Ollama 或 OpenAI-compatible 模型，对真实类目做提示词质量、假设差异度和回退稳定性验收
3. 用真实 Amazon / Shopify / eBay 店铺凭证运行只读验收，确认权限范围、区域与店铺归属
4. 在只读验收通过后实现真实平台 dry-run、官方写 Adapter、幂等写入与外部回执，并继续以人工确认控制任何外部发布
5. 通过 TikTok Shop / 1688 官方开放平台完成应用申请、店铺授权和诊断；在此之前继续使用可追溯 CSV/人工通道
6. 样品、质检、供应商认证与合规文件归档
7. A+ 布局、场景图脚本、主图生成和品牌素材授权记录
8. RFQ 模板、导出、人工确认发送与供应商回复归档

当前版本不自动联系供应商、不自动付款、不自动退款、不自动生成品牌授权、不无确认改价、不无确认发布。
