# 工作流与审批边界

## 主流程

```text
候选品导入
  ↓
证据采集与归一化
  ↓
评论/竞品/市场分析
  ↓
单位经济模型
  ↓
[人审] 立项
  ↓
RFQ 生成与供应商筛选
  ↓
报价对比
  ↓
[人审] 供应商定标
  ↓
样品/质检/合规
  ↓
[人审] 定样
  ↓
商品定义
  ↓
主图/A+/Listing 草稿
  ↓
[人审] 内容与声明
  ↓
平台发布预检
  ↓
[人审] 发布
  ↓
运营异常监控
  ↓
[人审] 价格/广告动作
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

目标态要求状态变化只能由受控 workflow transition 完成。当前 P1.1 的人工动作由 Server Action 在事务中写入，但尚未实现完整的通用状态机。

当前 P1.1 为保持商品主状态简单，商品通过立项后仍保持 `approved`。供应商定标由 `supplier_selections` 记录；内容审批状态由 `channel_listing_versions.status` 表达，主市场 Amazon 的兼容视图同步写入 `listings.status` 与 `listing_reviews`。后续扩展完整状态机时再显式增加 `supplier_selected`、`content_approved` 等主状态。

同一商品可以有多个国家 × 平台目标。每个目标拥有独立版本和预检，不能把某个市场的 `content_approved` 当成另一个市场的状态，也不能把它映射成 `published`。

## 每个阶段的产物

| 阶段 | 自动产物 | 人工产物 | 通过条件 |
|---|---|---|---|
| 初筛 | 证据包、风险清单 | 补充判断 | 证据完整 |
| 立项 | 成本模型、GO/NO-GO | 立项决定 | 压力情景可接受 |
| 询价 | RFQ、供应商名单 | 联系人、报价录入 | 至少 1 家有效报价；建议 3 家 |
| 定标 | 到岸成本、报价对比、评分卡、成本回写 | 定标决定与说明 | 压力盈利且质量分 ≥ 50；少于 3 家需说明原因 |
| 打样 | 缺陷汇总、整改建议 | 质检结论 | 关键缺陷关闭 |
| 定样 | 样品与合规汇总 | 定样决定 | 样品费和交期确认 |
| 商品定义 | 产品规格、卖点、禁用声明 | 商品负责人确认 | 规格与利润一致 |
| 内容 | 图片资产、Listing JSON | 品牌/合规审核 | 预检通过 |
| 发布 | 平台 payload | 发布审批 | 平台 dry-run 通过 |
| 运营 | 异常单、实验建议 | 审批动作 | 未越过风险阈值 |

## 默认审批阈值

阈值应按店铺实际调整，第一版建议：

- 售价调整超过 3%：人审
- 调整后低于成本模型价格底线：禁止
- 单日广告预算增加超过 20%：人审
- 新建广告活动：人审
- 任何 Listing 发布或重大修改：人审
- 任何退款/赔付/付款：人审
- 供应商定标、定样和首单采购：人审

## 当前实现边界（P1.1）

当前实际可运行路径：

```text
候选品 / 供应商 / 报价 CSV 或人工接入
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
→ 人工内容批准
→ 审计留痕
```

已经落地：

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
- 主图服务端校验文件头、MIME 和大小，文件进入本地受控目录；四项人工检查通过后才能用于内容审批。
- Listing 每次保存创建新版本，确定性预检覆盖长度、完整性、搜索词字节和高风险声明。
- 内容批准要求预检无错误且存在已审核主图，记录审核人、说明、预检快照和审计日志。
- 同一商品可以覆盖多个国家和平台；国家和平台组合幂等创建，每个目标独立递增 Listing 版本。
- Amazon、Shopify、TikTok Shop、eBay、CSV / 人工各自使用独立适配规则；店铺状态为 `unconfigured`，外部 ID 为空。
- `content_approved` 明确不代表 `published`；审计记录中外部动作为 `none`。

P1.1 的护栏：

- 真实数据导入默认只做持久化，不联系供应商、不发送 RFQ、不定标、不签合同、不下单、不付款。
- Keepa 只能用于只读商品数据同步；销量、费用和评级仍需人工核验，不能把估算值当成已核实事实。
- 1688 / Alibaba 数据必须通过官方开放平台和商家授权接入；未授权网页抓取不得作为生产数据源。
- Amazon SP-API 只能用于已授权自有店铺的运营数据与发布能力，不能充当竞品销量来源。
- 系统推荐只是排序结果，不能自动定标。
- 少于 3 家有效报价仍可定标，但必须填写例外/定标说明。
- 商品未立项时不能录入报价或定标；未定标时不能进入内容工作台。
- 已定标商品不能继续新增报价或重复定标。
- 主图不信任客户端扩展名，必须通过文件头、MIME 和大小校验。
- 预检未通过或没有已审核主图时，不能记录内容批准。
- 渠道目标只生成本地 payload 预览；不调用平台 API，不执行 dry-run，不触发发布、改价、库存同步或广告。
- 平台只读验证成功不等于具备发布权限；不得把 `verified` 或 `credentials_valid` 当作 `published`。
- eBay client credentials 通过不代表卖家 OAuth 已验证；Amazon Seller API 可访问也不代表完整 Listing 写入权限已验收。
- 外部写 Adapter、平台 dry-run 和外部回执仍未实现；不得把 `unconfigured` 测试店铺当作可发布店铺。
- TikTok Shop / 1688 在官方 Adapter 接入前必须保持 `unsupported`，不得伪造连接状态。
- API Secret 只能通过 `.env.local` 或密钥管理系统注入，禁止写入源码、数据库、CSV、日志或聊天。

仍未实现：

- 评论、关键词和竞品证据的规模化联网采集（Keepa 目前只覆盖商品层只读字段）
- RFQ 自动生成、导出和发送
- 供应商回复解析、附件和邮件/IM 归档
- 样品、定样、质检、认证与合规文件管理
- AI 图片生成、A+ 自动排版和场景图脚本
- 品牌授权、知识产权和类目准入自动核验
- 密钥托管、eBay 卖家 OAuth、平台类目必填字段校验、平台 dry-run 和发布
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
model_version
skill_version
externalActions
```

## 禁止事项

- 禁止让模型直接计算最终财务数字而不经过确定性计算器。
- 禁止无来源的选品结论。
- 禁止在云端明文保存卖家后台密码和登录 Cookie。
- 禁止把竞品图片直接当成自有商品素材发布。
- 禁止在无预算/利润护栏时自动改价或加广告。
- 禁止在未通过合规检查时自动发布。
