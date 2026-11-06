# AITrade

跨境电商运营工作台：选品假设 → 证据核验 → 供应商与成本 → 商品内容 → 发布前检查。AI 只生成待验证假设，结论由证据和确定性规则决定。

![选品工作台](docs/assets/aitrade-workspace-sidebar.png)

![供应商询价](docs/assets/aitrade-sourcing.png)

![内容工作台](docs/assets/aitrade-content-studio.png)

## 功能

- 首页「今日待办」按动作分组；顶栏常驻当前对象、所处阶段和下一步，按「国家 × 平台」隔离数据。
- AI 推荐类目与商品机会，附验证任务和找货线索。
- 供应商半自动发现：从选品方向生成中文搜索词，在 1688 当前页由用户触发采集，按确定性规则去重、评分并生成 TOP 10 候选。
- 候选支持 2–4 个横向对比、人工核验、排除和短名单；短名单可生成可复制的内部 RFQ 草稿。
- 证据收件箱（文本 / CSV / JSON / Markdown）与供应商 RFQ 草稿，均需人工审核，不对外发送。
- 确定性门禁给出 GO / HOLD / NO-GO；到岸成本、净利率、压力利润由代码计算，不交给模型。
- 候选品、供应商、报价支持 CSV 或人工录入，保留来源与原始快照。
- Listing 草稿、多站点版本、本地发布预检；导入与决策全量留痕。

AI 模块实现见 `src/lib/ai-proposals/`、`src/lib/ai-inbox/`、`src/lib/ai-supplier-assistant/`。

## 快速开始

Node.js 20.9+，本机直接运行，无需 Docker。

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。数据默认写入当前目录 `.data/`，首次启动生成演示数据。生产构建：`npm run build && npm start`。

## 半自动供应商发现

完整路径：选品方向 → 打开 1688 → 用户触发采集 → TOP 10 → 候选对比 → 人工核验 / 排除 → 短名单 → RFQ 内部草稿。

1. 在 AI 选品支线的供应商发现区选择搜索方向，点击“开始找供应商”。
2. 点击“打开 1688”进入对应中文搜索页。1688 链接使用 GBK 编码，避免中文关键词乱码。
3. 使用以下任一方式导入当前页可见商品：
   - Chrome 扩展：在扩展目录 `extensions/aitrade-supplier-capture/` 加载已解压扩展；从页面复制扩展配置并保存，再在 1688 搜索结果页点击“采集当前页并导入 AITrade”。
   - 采集书签：把页面提供的书签拖到浏览器书签栏，在 1688 当前搜索结果页点击运行。
   - 手动导入：把书签复制的 JSON 或包含商品标题和 1688 链接的文本粘贴到采集结果，再点击“导入并生成 TOP 10”。
4. 对比候选后打开来源，核对供应商主体、产品一致性、MOQ、交期和公开信息。只有勾选人工核验的候选才会进入短名单；不匹配的候选可记录原因后排除。
5. 短名单候选可生成 RFQ 内部草稿。草稿只提供复制，系统没有发送入口。

采集只处理用户点击时已经出现在当前 1688 页面上的商品卡，不后台爬取、不自动翻页、不登录、不绕过验证码，也不依赖需要企业主体或企业支付宝的 1688 API。搜索命中不等于供应商已核验，候选信息仍需人工复核。

## 数据接入

在 `/data-sources` 导入 CSV，不需要 API Key：

| 数据 | 模板 |
|---|---|
| 候选品 | `public/candidates-template-v2.csv` |
| 供应商 | `public/suppliers-template.csv` |
| 报价 | `public/quotes-template.csv` |

系统不自动抓取平台数据、不联系供应商、不发布；缺失数据只显示为待补证据。

## AI 模型

默认本地模板，无需 Key。`/settings` 可切换 Ollama 或 OpenAI 兼容接口，请求失败自动回退模板；API Key 不回显到页面。环境变量示例见 [.env.example](.env.example)。

## 边界

- 平台连接只读，不支持真实写入或发布。
- 1688 供应商采集是浏览器侧、用户触发的半自动流程；不自动联系供应商、不发送 RFQ、不下单、不付款。
- 本地原型，无登录、角色权限与多租户；演示商品不代表真实市场结论。
- P3.0 经营报表计算层是纯函数试算，尚未接入真实结算单与库存快照。

## 常用命令

```bash
npm run typecheck   # 类型检查
npm test            # 单元测试
npm run build       # 生产构建
npm run db:reset    # 清空本地数据库
npm run report:dry-run -- --help   # 报表试算（只读、不写库）
npm run screenshots # 改 UI 后重拍截图，图片随提交一起更新
```

报表试算的口径参数由 `--config` 显式给出，不内置阈值；列名依据平台公开规范，仍需用真实导出核对。代码图谱重建用 `graphify extract . --code-only` 与 `graphify cluster-only . --no-label`，不要用 `graphify update .`。

## 项目结构

```text
src/app/        页面、Server Actions 与 API
src/lib/        确定性计算、导入、AI 提取与报表管线
scripts/        报表试算 CLI 与截图脚本
db/schema.sql   表结构
```
