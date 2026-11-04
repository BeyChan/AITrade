# AITrade

跨境电商运营工作台，覆盖选品假设、证据核验、供应商与成本、商品内容、Listing 草稿和发布前检查。AI 只生成待验证假设，是否通过由证据和确定性规则决定。

```text
选择国家 × 平台
→ AI 推荐 5 个候选类目（可选）
→ 生成 5 个商品机会
→ 导入或录入竞品、差评、专利、物流与供应商数据
→ 得出 GO / HOLD / NO-GO
→ 转商品立项
→ 完善成本、主图与 Listing
→ 内容确认与发布前检查
```

![AITrade 工作台](docs/assets/aitrade-workspace-sidebar.png)

![商品内容工作台](docs/assets/aitrade-content-studio.png)

![供应商报价与成本比较](docs/assets/aitrade-sourcing.png)

## 主要功能

- 首页右上角可分别切换国家和平台，机会、研究记录和导入入口均按当前站点隔离。
- 可按当前国家 × 平台生成 5 个候选类目；点击只回填类目，不自动提交研究。
- AI 研究按当前站点生成 5 个不重复机会，并给出验证任务和找货线索。
- 首页研究记录按“类目 + 研究条件”去重，按时间倒序仅展示最近 3 条。
- 候选品、供应商、报价支持 CSV 或人工录入，保留来源、观察时间和原始快照。
- 选品详情支持按售价和目标净利率反推最高到岸成本，并列出仍需核验的供应商、运费、平台费和汇率数据；缺真实报价时不会给出 GO。
- 确定性计算到岸成本、净利率、压力利润、现金占用和 GO / HOLD / NO-GO。
- 支持商品定义、主图检查、Listing 草稿、多国家多平台版本和本地预检。
- Amazon、Shopify、eBay 可做只读连接检查；TikTok Shop 与 1688 尚未接入。
- 模型支持本地模板、Ollama 和 OpenAI 兼容接口，可在 `/settings` 页面配置。
- 导入、决策、内容确认和连接检查均写入本地运行记录与审计日志。

## 快速开始

要求 Node.js 20.9+，无需 Docker。

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。数据库默认保存在 `.data/aitrade`；首次启动会写入演示数据。

生产方式：

```bash
npm run build
npm start
```

## 数据接入

进入 `/data-sources` 导入 CSV：

| 数据类型 | 模板 | 说明 |
|---|---|---|
| 候选品 | `public/candidates-template-v2.csv` | 平台后台、ERP 或人工整理的选品数据 |
| 供应商 | `public/suppliers-template.csv` | 1688、Alibaba 或供应商表格整理出的档案 |
| 报价 | `public/quotes-template.csv` | 关联已立项商品的采购、运费、关税等信息 |

CSV 不需要 API Key。每条记录会保留 `source_code`、`observed_at`、原始快照和导入运行记录；重复数据按商品、供应商或报价身份去重。

系统不会自动抓取平台销量、评论或供应商信息，也不会自动联系供应商、下单、付款或发布。缺少的数据会显示为待补证据，不会由 AI 补全。

## AI 模型

默认使用本地模板，无需 API Key。需要生成更具体的选品假设时，可在 `/settings` 选择：

- 本地 Ollama；
- OpenAI 兼容接口，例如 OpenAI、DeepSeek 或自建服务。

配置优先级为“页面设置 → 环境变量 → 默认模板”。模型请求失败时自动回退模板。环境变量示例见 [.env.example](.env.example)。

AI 类目推荐接口为 `POST /api/ai/category-recommendations`，请求体包含 `marketCode` 和 `platformCode`。服务端会重新校验国家与平台，并要求返回 5 个不同类目；推荐只表示待核验方向，不代表销量、竞争度或利润结论。

## 规则与边界

- 所有市场事实、供应商和成本数据都必须有外部来源或人工录入记录。
- 成本模型不盈利、压力情景不通过或证据不足时，不会输出 GO。
- 专利风险确认存在时直接 NO-GO。
- 所有平台当前只支持本地内容检查和发布准备状态，不支持真实平台 dry-run、写入或发布。
- 项目是本地可运行原型，不包含登录、角色权限和多租户。
- 演示商品仅用于验证系统流程，不代表真实市场结论。

## 常用命令

```bash
npm run typecheck  # TypeScript 检查
npm test           # 单元测试
npm run build      # 生产构建
npm run db:reset   # 清空本地数据库
```

## 项目结构

```text
src/app/                 页面、Server Actions 与 API
src/app/ai-sourcing/     AI 选品批次与验证
src/app/api/ai/          AI 类目推荐接口
src/app/data-sources/    CSV 与人工数据导入
src/app/connections/     平台只读连接检查
src/components/          AI 类目推荐等交互组件
src/lib/ai-provider.ts   模型调用与模板回退
src/lib/ai-sourcing.ts   假设校验与确定性门禁
src/lib/ingestion.ts     导入、去重、快照与运行记录
src/lib/economics.ts     单位经济计算
src/lib/listing.ts       Listing 预检
src/lib/channels.ts      国家与平台字段映射
db/schema.sql            PostgreSQL 兼容表结构
```

更多细节见：

- [实施蓝图](docs/implementation-plan.md)
- [工作流与安全边界](docs/workflow-and-guardrails.md)
