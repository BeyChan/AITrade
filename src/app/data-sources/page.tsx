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
          <div className="eyebrow">数据导入 · CSV / 人工录入</div>
          <h1>用已有数据，<br />推进选品验证和上架准备。</h1>
          <p>
            平台后台导出、ERP 记录、供应商报价和人工核验结果，都可以通过 CSV 或页面录入。
            系统会保留来源、观察时间和原始快照，不要求先订阅选品 API。
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
          <div className="metric-label">导入批次</div>
          <div className="metric-value">{freeRuns.length}</div>
          <div className="metric-note">最近 20 次本地导入记录</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">原始证据快照</div>
          <div className="metric-value">{dashboard.stats.snapshotCount}</div>
          <div className="metric-note">保留导入时的原始内容</div>
        </article>
      </section>

      <div className="notice source-notice">
        <span className="badge badge-success">数据边界</span>
        <span>
          <strong>系统只处理你主动导入的数据。</strong> 平台销量、评论和供应商信息不会自动抓取；
          联系供应商、发布 Listing、改价、下单和付款仍需在对应平台人工完成。
        </span>
      </div>

      <DataSourceImport />

      <section className="panel source-panel">
        <div className="panel-header">
          <div>
            <h2>可用导入通道</h2>
            <p>以下通道在本机处理 CSV 或人工录入，不需要 API Key；每次导入都会生成运行记录。</p>
          </div>
          <span className="badge badge-success">CSV / 人工</span>
        </div>

        <div className="table-wrap">
          <table className="source-table">
            <thead>
              <tr>
                <th>数据源</th>
                <th>类型</th>
                <th>状态</th>
                <th>已存快照</th>
                <th>关联记录</th>
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
          <h3>可以先导入哪些数据</h3>
          <p>候选品、供应商和报价都可以通过 CSV 导入。数据可来自 Amazon、Shopify、TikTok Shop、eBay 后台导出、ERP、1688 供应商表格或人工核验表。</p>
        </article>
        <article className="card">
          <h3>市场数据从哪里来</h3>
          <p>实时销量、BSR 和历史趋势通常来自付费数据服务。系统不自动抓取这些数据；你可以导入已有报表，或补充人工核验记录。</p>
        </article>
        <article className="card">
          <h3>主图与商品页怎么处理</h3>
          <p>主图上传后在内容工作台人工检查；Listing 使用本地字段映射和发布预检。正式发布仍需对应店铺的官方授权。</p>
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
