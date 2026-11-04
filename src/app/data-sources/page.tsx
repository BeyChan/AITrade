import Link from "next/link";
import { DataSourceImport } from "@/components/data-source-import";
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
  const dashboard = await getDataSourcesDashboard();
  const freeSources = dashboard.sources.filter((source) => source.kind === "csv" || source.kind === "manual");
  const freeSourceCodes = new Set(freeSources.map((source) => source.code));
  const freeRuns = dashboard.runs.filter((run) => freeSourceCodes.has(run.source_code));

  return (
    <div className="page">
      <div className="breadcrumb"><Link href="/">AI 选品</Link> / 数据源</div>
      <section className="hero source-hero">
        <div>
          <div className="eyebrow">FREE DATA WORKFLOW · NO SUBSCRIPTION</div>
          <h1>不接收费数据源，<br />也能把真实业务跑起来。</h1>
          <p>
            默认工作流只使用平台后台导出、ERP、供应商报价和人工核验数据。CSV 入库无需订阅、无需 API Key，
            每条数据仍保留来源、观察时间、原始快照和运行记录。收费选品 Key 不再是运行前提。
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
          <div className="metric-label">默认付费依赖</div>
          <div className="metric-value">0</div>
          <div className="metric-note">CSV + 人工通道即可运行</div>
        </article>
      </section>

      <div className="notice source-notice">
        <span className="badge badge-success">FREE MODE</span>
        <span>
          <strong>默认不连接任何收费选品服务。</strong> 数据来自你已有的平台导出、ERP、供应商报价或人工核验结果。
          系统不会自动发送 RFQ、联系供应商、定标、发布 Listing、改价、下单或付款。
        </span>
      </div>

      <DataSourceImport />

      <section className="panel source-panel">
        <div className="panel-header">
          <div>
            <h2>免费数据源状态</h2>
            <p>“可用”表示无需密钥、无需订阅即可导入。收费 API 连接器不再显示在默认工作流中。</p>
          </div>
          <span className="badge badge-success">0 订阅</span>
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
              {freeSources.map((source) => (
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
                  <td>{source.snapshotCount}</td>
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
          <span className="badge badge-neutral">最近 {freeRuns.length} 次</span>
        </div>

        {freeRuns.length === 0 ? (
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
                {freeRuns.map((run) => (
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
          <h3>现在就能免费用</h3>
          <p>候选品 CSV、供应商 CSV、报价 CSV 已可直接使用。建议从 Amazon / Shopify / TikTok Shop / eBay 后台导出、ERP 导出、1688 供应商表格或人工核验表开始。</p>
        </article>
        <article className="card">
          <h3>为什么没有一键选品</h3>
          <p>覆盖全类目的实时销量、BSR 和历史趋势通常来自收费数据商。免费且合规的替代方式是你已有的平台导出和人工核验，不用为了跑工作流再购买一套数据订阅。</p>
        </article>
        <article className="card">
          <h3>主图与上架也不依赖付费 Key</h3>
          <p>主图先上传到商品定义并在内容工作台做人工检查；Listing 使用本地字段映射和发布预检。平台真实发布仍需对应店铺的官方授权，不会用付费选品 Key 代替。</p>
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
