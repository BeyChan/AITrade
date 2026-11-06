# AITrade

跨境电商运营工作台：选品假设 → 证据核验 → 供应商与成本 → 商品内容 → 发布前检查。AI 只生成待验证假设，结论由证据和确定性规则决定。

![选品工作台](docs/assets/aitrade-workspace-sidebar.png)

![供应商询价](docs/assets/aitrade-sourcing.png)

![内容工作台](docs/assets/aitrade-content-studio.png)

## 功能

- 首页任务型工作台，按「国家 × 平台」隔离数据，并汇总待确认 AI 提案。
- AI 推荐类目与商品机会，附验证任务和找货线索。
- 证据收件箱（文本 / CSV / JSON / Markdown）与供应商 RFQ 草稿，均需人工审核，不对外发送。
- 确定性门禁给出 GO / HOLD / NO-GO；到岸成本、净利率、压力利润由代码计算，不交给模型。
- 候选品、供应商、报价支持 CSV 或人工录入，保留来源与原始快照。
- Listing 草稿、多站点版本、本地发布预检；导入与决策全量留痕。

AI 模块实现见 `src/lib/ai-inbox/`、`src/lib/ai-supplier-assistant/`。

## 快速开始

Node.js 20.9+，本机直接运行，无需 Docker。

```bash
npm install
npm run dev
```

打开 <http://localhost:3000>。数据默认写入当前目录 `.data/`，首次启动生成演示数据。生产构建：`npm run build && npm start`。

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
