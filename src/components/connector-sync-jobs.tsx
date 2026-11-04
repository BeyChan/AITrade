"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConnectorSyncDashboard, ConnectorSyncJobRow } from "@/lib/types";

const jobStatusLabels: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  completed: "完成",
  partial: "部分完成",
  failed: "失败",
};

const freshnessLabels: Record<string, string> = {
  fresh: "新鲜",
  stale: "已过期",
  unknown: "未知",
};

export function ConnectorSyncJobs({ dashboard }: { dashboard: ConnectorSyncDashboard }) {
  const router = useRouter();
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function retry(job: ConnectorSyncJobRow) {
    setPendingJobId(job.id);
    setError("");
    try {
      const response = await fetch(`/api/sync/jobs/${encodeURIComponent(job.id)}/retry`, { method: "POST" });
      const payload = (await response.json()) as { error?: string; code?: string };
      if (!response.ok) {
        if (payload.code === "not_configured") {
          throw new Error(`${payload.error || "连接器未配置"}。请先配置 ${credentialName(job.source_code)} 并重启服务。`);
        }
        throw new Error(payload.error || "重试失败");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重试失败");
    } finally {
      setPendingJobId(null);
    }
  }

  return (
    <section className="panel source-panel sync-panel">
      <div className="panel-header">
        <div>
          <h2>连接器同步任务与数据新鲜度</h2>
          <p>
            Keepa 与 Sorftime 共用可追溯任务队列。每个任务记录请求、重试、API 调用耗时和导入结果；Adapter 自动重试 408/429/5xx，任务级失败可人工重试。
          </p>
        </div>
        <div className="sync-summary-pills">
          <span className="badge badge-neutral">运行中 {dashboard.stats.runningCount}</span>
          <span className="badge badge-danger">失败 {dashboard.stats.failedCount}</span>
          <span className="badge badge-neutral">需关注 {dashboard.stats.staleSourceCount}</span>
        </div>
      </div>

      {dashboard.cursors.length ? (
        <div className="sync-cursor-grid">
          {dashboard.cursors.map((cursor) => (
            <article className={`sync-cursor-card ${cursor.freshness}`} key={cursor.id}>
              <div className="sync-cursor-top">
                <strong>{cursor.source_code.toUpperCase()} · {cursor.marketplace}</strong>
                <span className={`sync-freshness ${cursor.freshness}`}>{freshnessLabels[cursor.freshness]}</span>
              </div>
              <div className="sync-cursor-meta">
                <span>上次成功：{cursor.last_success_at ? formatDate(cursor.last_success_at) : "从未"}</span>
                <span>连续失败：{cursor.consecutive_failures}</span>
                <span>上次导入：{numberValue(cursor.cursor.lastImportedCount)} 个</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <h3>还没有成功同步记录</h3>
          <p>配置 Key 后执行一次 Keepa 或 Sorftime 任务；成功后会按数据源和市场显示新鲜度、连续失败次数与游标摘要。</p>
        </div>
      )}

      {error ? <div className="result-box error sync-error">{error}</div> : null}

      {dashboard.jobs.length ? (
        <div className="table-wrap">
          <table className="source-table run-table sync-job-table">
            <thead>
              <tr>
                <th>创建时间</th>
                <th>数据源</th>
                <th>研究方式</th>
                <th>市场</th>
                <th>状态</th>
                <th>尝试</th>
                <th>新增 / 快照</th>
                <th>API / 耗时</th>
                <th>下次可重试</th>
                <th>错误</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.jobs.map((job) => (
                <tr key={job.id}>
                  <td className="run-time">
                    {formatDate(job.created_at)}
                    <div className="sync-job-id">{job.id.slice(0, 8)}</div>
                  </td>
                  <td>{sourceLabel(job.source_code)}</td>
                  <td>{modeLabel(job.request_payload.mode)}</td>
                  <td>{job.marketplace}</td>
                  <td><span className={`run-status ${job.status}`}>{jobStatusLabels[job.status] ?? job.status}</span></td>
                  <td>{job.attempt}/{job.max_attempts}</td>
                  <td>{job.summary.imported ?? 0} / {job.summary.snapshots ?? 0}</td>
                  <td>{job.summary.apiCallCount ?? 0} 次 / {formatDuration(job.summary.durationMs)}</td>
                  <td>{job.next_run_at ? formatDate(job.next_run_at) : "—"}</td>
                  <td>
                    {job.error_message ? (
                      <details className="run-warnings sync-error-details">
                        <summary>查看原因</summary>
                        <p>{job.error_message}</p>
                      </details>
                    ) : "—"}
                  </td>
                  <td>
                    {job.status === "failed" && job.attempt < job.max_attempts ? (
                      <button
                        className="button ghost sync-retry-button"
                        type="button"
                        disabled={pendingJobId === job.id}
                        onClick={() => retry(job)}
                      >
                        {pendingJobId === job.id ? "重试中…" : "重试"}
                      </button>
                    ) : job.run_id ? (
                      <span className="sync-run-id">{job.run_id.slice(0, 8)}</span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <h3>还没有连接器任务</h3>
          <p>在上方 Keepa 或 Sorftime 标签页创建任务；失败任务会在这里保留调用审计并允许重试。</p>
        </div>
      )}
    </section>
  );
}

function sourceLabel(sourceCode: string) {
  if (sourceCode === "keepa") return "Keepa";
  if (sourceCode === "sorftime") return "Sorftime";
  return sourceCode;
}

function credentialName(sourceCode: string) {
  if (sourceCode === "sorftime") return "SORFTIME_API_KEY";
  return "KEEPA_API_KEY";
}

function modeLabel(mode: unknown) {
  if (mode === "category") return "类目研究";
  if (mode === "asin") return "ASIN 研究";
  return "ASIN 同步";
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

function formatDuration(value: number | undefined) {
  if (!value) return "0 ms";
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value.toLocaleString("zh-CN") : "0";
}
