"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function UnlockForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || "口令错误");
        return;
      }
      const next = searchParams.get("next") || "/";
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("验证请求失败，请检查服务是否运行");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="stack" style={{ gap: "12px" }}>
      <label className="field">
        <span>访问口令</span>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="请输入访问口令"
          autoFocus
        />
      </label>
      {error ? <div style={{ color: "var(--red)", fontSize: "13px" }}>{error}</div> : null}
      <button type="submit" className="button primary" disabled={submitting || !pin.trim()}>
        {submitting ? "正在验证…" : "解锁进入工作台"}
      </button>
    </form>
  );
}

export default function UnlockPage() {
  return (
    <div className="page" style={{ maxWidth: "440px", margin: "80px auto" }}>
      <section className="section">
        <div className="section-header">
          <div>
            <h2>输入工作台访问口令</h2>
            <p>当前实例已开启共享访问保护（APP_ACCESS_PIN），验证通过后本机 30 天免输。</p>
          </div>
        </div>
        <Suspense fallback={<p className="muted">加载中…</p>}>
          <UnlockForm />
        </Suspense>
      </section>
    </div>
  );
}
