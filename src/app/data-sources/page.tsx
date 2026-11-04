import Link from "next/link";
import { ConnectorSyncJobs } from "@/components/connector-sync-jobs";
import { DataSourceImport } from "@/components/data-source-import";
import { getConnectorSyncDashboard } from "@/lib/connector-sync";
import { getDataSourcesDashboard } from "@/lib/ingestion";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  available: "可用",
  configured: "已配置",
  not_configured: "未配置",
  planned: "规划中",
};

const runStatusLabels: Record<string, string> = {
  running: "运行中",
  completed: "完成",
  partial: "部分完成",
  failed: "失败",
};

export default async function DataSourcesPage() {
  const [dashboard, syncDashboard] = await Promise.all([
    getDataSourcesDashboard(),
    getConnectorSyncDashboard(),
  ]);
  const csvSources = dashboard.sources.filter((source) => source.kind === "csv" || source.kind === "manual");
  const apiSources = dashboard.sources.filter((source) => source.kind === "api" || source.kind === "feed");

  return (
    <div className="page">
      <div className="breadcrumb"><Link href="/">商品机会</Link> / 数据源</div>
      <section className="hero source-hero">
        <div>
          <div className="eyebrow">P1.2 · Durable connector sync</div>
          <h1>真实数据先入库，<br />再让 AI 做判断。</h1>
          <p>
            当前把选品、供应商和报价通过可追溯的 CSV 通道接入，并支持 Keepa 与 Sorftime MCP 的只读同步任务。
            Sorftime 用于 Amazon 类目/ASIN 研究；每条数据都有来源、观察时间、原始快照、API 调用记录和数据新鲜度，不用聊天里的“估算值”冒充事实。
          </p>
        </div>
        <Link className="button secondary" href="/import">快速导入候选品</Link>
      </section>

      <section className="metrics-grid" aria-label="真实数据指标">
        <article className="metric-card">
          <div className="metric-label">真实候选品</div>
          <div className="metric-value">{dashboard.stats.realCandidateCount}</div>
          <div className="metric-note">不含演示商品</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">供应商档案</div>
          <div className="metric-value">{dashboard.stats.supplierCount}</div>
          <div className="metric-note">按外部 ID、链接或名称去重</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已入库报价</div>
          <div className="metric-value">{dashboard.stats.quoteCount}</div>
          <div className="metric-note">{dashboard.stats.snapshotCount} 条原始证据快照</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已配置 API</div>
          <div className="metric-value">{dashboard.stats.configuredApiCount}</div>
          <div className="metric-note">CSV 无需密钥，可直接使用</div>
        </article>
      </section>

      <div className="notice source-notice">
        <span className="badge badge-success">READ ONLY</span>
        <span>
          <strong>导入只代表数据入库。</strong> 系统不会自动发送 RFQ、联系供应商、定标、发布 Listing、改价、下单或付款。
          内容批准也不等于平台上架。
        </span>
      </div>

      <DataSourceImport />

      <ConnectorSyncJobs dashboard={syncDashboard} />

      <section className="panel source-panel">
        <div className="panel-header">
          <div>
            <h2>数据源状态</h2>
            <p>“可用”表示无需密钥即可导入；“未配置”表示 Adapter 已就绪但缺少环境变量；“规划中”表示尚未实现。</p>
          </div>
          <span className="badge badge-neutral">{apiSources.length} 个 API 连接器</span>
        </div>

        <div className="table-wrap">
          <table className="source-table">
            <thead>
              <tr>
                <th>数据源</th>
                <th>类型</th>
                <th>状态</th>
                <th>已存快照</th>
                <th>供应商 / 报价</th>
                <th>上次同步</th>
                <th>外部动作</th>
              </tr>
            </thead>
            <tbody>
              {[...csvSources, ...apiSources].map((source) => (
                <tr key={source.code}>
                  <td>
                    <strong>{source.name}</strong>
                    <div className="source-note">{source.note}</div>
                    {source.credentialEnv.length ? (
                      <div className="source-credentials">{source.credentialEnv.join(" · ")}</div>
                    ) : null}
                  </td>
                  <td className="source-kind">{source.kind.toUpperCase()}</td>
                  <td>
                    <span className={`source-status ${source.readiness}`}>
                      <span className="source-status-dot" />
                      {statusLabels[source.readiness] ?? source.readiness}
                    </span>
                  </td>
                  <td>{source.snapshotCount.toLocaleString("zh-CN")}</td>
                  <td>{source.supplierCount} / {source.quoteCount}</td>
                  <td>{source.last_synced_at ? formatDate(source.last_synced_at) : "尚未同步"}</td>
                  <td>{source.externalActions === "read_only" ? "只读" : "无"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel source-panel">
        <div className="panel-header">
          <div>
            <h2>最近导入运行</h2>
            <p>每次导入都记录文件、发起人、结果、告警和运行 ID，便于追溯错误与重复数据。</p>
          </div>
          <span className="badge badge-neutral">最近 {dashboard.runs.length} 次</span>
        </div>

        {dashboard.runs.length === 0 ? (
          <div className="empty-state">
            <h3>还没有导入运行</h3>
            <p>从上方选择一个导入类型开始；第一次导入后这里会出现运行记录。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="source-table run-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>数据源</th>
                  <th>文件 / 方式</th>
                  <th>状态</th>
                  <th>新增</th>
                  <th>更新</th>
                  <th>跳过</th>
                  <th>失败</th>
                  <th>快照</th>
                  <th>告警</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.runs.map((run) => (
                  <tr key={run.id}>
                    <td className="run-time">{formatDate(run.started_at)}</td>
                    <td>{run.source_code}</td>
                    <td>{run.file_name || run.import_kind}</td>
                    <td><span className={`run-status ${run.status}`}>{runStatusLabels[run.status] ?? run.status}</span></td>
                    <td>{run.imported_count}</td>
                    <td>{run.updated_count}</td>
                    <td>{run.skipped_count}</td>
                    <td>{run.error_count}</td>
                    <td>{run.snapshot_count}</td>
                    <td>
                      {run.warnings.length ? (
                        <details className="run-warnings">
                          <summary>{run.warnings.length} 条</summary>
                          <ul>{run.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}</ul>
                        </details>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="source-bottom-grid">
        <article className="card">
          <h3>当前可以直接接入</h3>
          <p>候选品 CSV、供应商 CSV、报价 CSV 已可立即使用；配置 SORFTIME_API_KEY 后可对 Amazon 类目或最多 20 个 ASIN 做只读研究。建议从平台后台、ERP、1688/Alibaba 导出或人工核验表开始。</p>
        </article>
        <article className="card">
          <h3>下一步 API 顺序</h3>
          <p>Sorftime 用于类目和商品研究，Keepa 用于竞品价格/销量信号；销量均为第三方估算。Amazon SP-API、Shopify、TikTok Shop 和 eBay 只处理自有店铺，1688/Alibaba 必须走官方开放平台授权。</p>
        </article>
        <article className="card">
          <h3>密钥放置</h3>
          <p>写入本机 <code>.env.local</code> 或正式密钥管理系统，并重启服务。Sorftime 使用 <code>SORFTIME_API_KEY</code>；不要把 API Key、Token 或店铺凭证粘贴到聊天、CSV 或源码中。</p>
        </article>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Singapore",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
