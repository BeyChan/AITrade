"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DryRunPreview = {
  fileName: string;
  rawPayload: unknown;
  schemaVersion: number;
  exportedAt: string | null;
  totalRows: number;
  previewCounts: Array<{ table: string; label: string; count: number }>;
  containsSensitiveKeys: boolean;
};

export function WorkspaceBackupCard({ pinEnabled }: { pinEnabled: boolean }) {
  const router = useRouter();
  const [inspecting, setInspecting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [preview, setPreview] = useState<DryRunPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setMessage(null);
    setPreview(null);
    setInspecting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const res = await fetch("/api/settings/backup?dryRun=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const result = (await res.json()) as {
        ok?: boolean;
        schemaVersion?: number;
        exportedAt?: string | null;
        totalRows?: number;
        previewCounts?: Array<{ table: string; label: string; count: number }>;
        containsSensitiveKeys?: boolean;
        error?: string;
      };
      if (!res.ok || !result.ok) {
        setError(result.error || "备份文件预检失败");
        return;
      }
      setPreview({
        fileName: file.name,
        rawPayload: json,
        schemaVersion: result.schemaVersion ?? 1,
        exportedAt: result.exportedAt ?? null,
        totalRows: result.totalRows ?? 0,
        previewCounts: result.previewCounts ?? [],
        containsSensitiveKeys: Boolean(result.containsSensitiveKeys),
      });
    } catch {
      setError("备份文件解析失败，请确认选择的是 AITrade 导出的 JSON 备份文件。");
    } finally {
      setInspecting(false);
      e.target.value = "";
    }
  }

  async function handleConfirmRestore() {
    if (!preview) return;
    setError(null);
    setMessage(null);
    setRestoring(true);
    try {
      const res = await fetch("/api/settings/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview.rawPayload),
      });
      const result = (await res.json()) as {
        ok?: boolean;
        restoredCounts?: Record<string, number>;
        preRestoreSnapshot?: string | null;
        error?: string;
      };
      if (!res.ok || !result.ok) {
        setError(result.error || "恢复失败");
        return;
      }
      const totalRows = Object.values(result.restoredCounts ?? {}).reduce((a, b) => a + b, 0);
      const snapshotHint = result.preRestoreSnapshot
        ? `（恢复前已自动快照至 ${result.preRestoreSnapshot}）`
        : "";
      setMessage(
        `已事务安全地幂等合并恢复 ${totalRows} 条业务记录（已有记录自动跳过，未覆盖 API Key）${snapshotHint}。`,
      );
      setPreview(null);
      router.refresh();
    } catch {
      setError("恢复请求异常，当前库未受损，可重试。");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>整库数据备份与团队共享安全</h2>
          <p>一键备份全部选品案卷、竞品研报、1688 工厂、打样日记与实盘账本（自动脱敏，不含 API Key）。</p>
        </div>
        <span className={`badge ${pinEnabled ? "badge-success" : "badge-neutral"}`}>
          {pinEnabled ? "已开启口令保护 (APP_ACCESS_PIN)" : "本机免口令模式"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <a href="/api/settings/backup" className="button primary" download>
          一键导出整库备份 (JSON)
        </a>

        <label className="button secondary" style={{ cursor: inspecting || restoring ? "wait" : "pointer" }}>
          {inspecting ? "正在预检备份文件…" : restoring ? "正在合并恢复…" : "从备份文件恢复数据（先预检）"}
          <input
            type="file"
            accept="application/json,.json"
            disabled={inspecting || restoring}
            onChange={handleSelectRestoreFile}
            style={{ display: "none" }}
          />
        </label>

        <span style={{ fontSize: "13px", color: "var(--muted)" }}>
          若部署到公网/内网供多人使用，只需在环境变量设置 <code>APP_ACCESS_PIN=你的口令</code> 即可自动启用登录保护。
        </span>
      </div>

      {preview ? (
        <div
          className="panel"
          style={{
            marginTop: "14px",
            padding: "14px 16px",
            border: "1px solid var(--accent)",
            background: "var(--accent-soft)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div>
              <strong style={{ color: "var(--ink)" }}>恢复前预检：{preview.fileName}</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "13px" }}>
                共检测到 <strong>{preview.totalRows}</strong> 条业务记录
                {preview.exportedAt ? ` · 导出于 ${preview.exportedAt.slice(0, 19).replace("T", " ")}` : ""}
                {preview.containsSensitiveKeys ? " · 检测到敏感字段（恢复时将自动过滤）" : " · 已确认不含明文 API Key"}
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="button primary"
                disabled={restoring || preview.totalRows === 0}
                onClick={handleConfirmRestore}
              >
                {restoring ? "恢复中…" : "确认合并恢复（自动先快照）"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={restoring}
                onClick={() => setPreview(null)}
              >
                取消
              </button>
            </div>
          </div>

          {preview.previewCounts.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
              {preview.previewCounts.map((item) => (
                <span key={item.table} className="badge badge-neutral">
                  {item.label}：{item.count}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div className="notice" style={{ marginTop: "12px", marginBottom: 0 }}>
          <span className="badge badge-success">恢复完成</span>
          <span>{message}</span>
        </div>
      ) : null}
      {error ? (
        <div className="notice warn" style={{ marginTop: "12px", marginBottom: 0 }}>
          <span className="badge badge-danger">失败</span>
          <span>{error}</span>
        </div>
      ) : null}

      <details style={{ marginTop: "14px", fontSize: "13px", color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink)" }}>
          数据库目录（.data/）异常或换机应急恢复说明
        </summary>
        <ol style={{ margin: "8px 0 0", paddingLeft: "20px", lineHeight: 1.7 }}>
          <li>若遇到本机异常断电导致 <code>.data/aitrade</code> 损坏，先停止服务，将最近导出的 JSON 备份或 <code>.data/backups/pre-restore-*.json</code> 另存安全位置。</li>
          <li>在项目根目录执行 <code>npm run db:reset</code> 清空损坏的本地数据库文件（不影响你导出的 JSON 备份）。</li>
          <li>重新运行 <code>npm run dev</code> 或 <code>npm start</code>，打开 <code>/settings</code> 点击上方「从备份文件恢复数据」导入最近 JSON 备份即可完整还原。</li>
          <li>API Key 保存在独立的 <code>.data/aitrade.ai-key</code> 中，与业务备份物理分离；换机后重新填入 Key 即可，避免密钥随备份泄露。</li>
        </ol>
      </details>
    </section>
  );
}
