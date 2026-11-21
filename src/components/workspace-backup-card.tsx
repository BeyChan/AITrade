"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function WorkspaceBackupCard({ pinEnabled }: { pinEnabled: boolean }) {
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setMessage(null);
    setRestoring(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const res = await fetch("/api/settings/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      const result = (await res.json()) as {
        ok?: boolean;
        restoredCounts?: Record<string, number>;
        error?: string;
      };
      if (!res.ok || !result.ok) {
        setError(result.error || "恢复失败");
        return;
      }
      const totalRows = Object.values(result.restoredCounts ?? {}).reduce((a, b) => a + b, 0);
      setMessage(`已幂等合并恢复 ${totalRows} 条业务记录（已有记录自动跳过，未覆盖 API Key）。`);
      router.refresh();
    } catch {
      setError("备份文件解析失败，请确认选择的是 AITrade 导出的 JSON 备份文件。");
    } finally {
      setRestoring(false);
      e.target.value = "";
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

        <label className="button secondary" style={{ cursor: restoring ? "wait" : "pointer" }}>
          {restoring ? "正在合并恢复…" : "从备份文件恢复数据"}
          <input
            type="file"
            accept="application/json,.json"
            disabled={restoring}
            onChange={handleRestoreFile}
            style={{ display: "none" }}
          />
        </label>

        <span style={{ fontSize: "13px", color: "var(--muted)" }}>
          若部署到公网/内网供多人使用，只需在环境变量设置 <code>APP_ACCESS_PIN=你的口令</code> 即可自动启用登录保护。
        </span>
      </div>

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
    </section>
  );
}
