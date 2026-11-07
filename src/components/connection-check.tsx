"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConnectorDiagnosticResult } from "@/lib/connectors/diagnostics";

type ApiResult = Partial<ConnectorDiagnosticResult> & { error?: string; code?: string };

export function ConnectionCheckButton({
  code,
  name,
  supported,
}: {
  code: string;
  name: string;
  supported: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function checkConnection() {
    setPending(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/connections/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, actor: "本地管理员" }),
      });
      const payload = (await response.json()) as ApiResult;
      if (!response.ok) {
        if (payload.code === "not_configured") {
          throw new Error(`${payload.error || "连接器未配置"}。请在卡片的「凭证设置」中填写并保存，无需重启服务。`);
        }
        throw new Error(payload.error || `${name} 检查失败`);
      }
      setMessage(payload.message || "检查完成");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "连接检查失败");
    } finally {
      setPending(false);
    }
  }

  if (!supported) return <span className="connection-unsupported">官方 Adapter 尚未实现，当前禁止发起虚假连接。</span>;

  return (
    <div className="connection-actions">
      <button className="button secondary compact-button" type="button" onClick={checkConnection} disabled={pending}>
        {pending ? "正在只读检查…" : "运行只读检查"}
      </button>
      {message ? <span className="connection-result success">{message}</span> : null}
      {error ? <span className="connection-result error">{error}</span> : null}
    </div>
  );
}
