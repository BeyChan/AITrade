"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type ImportResponse = {
  imported?: number;
  updated?: number;
  skipped?: number;
  errors?: number;
  snapshots?: number;
  warnings?: string[];
  error?: string;
  code?: string;
};

export default function ImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [site, setSite] = useState({ market: "US", platform: "amazon" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSite({
      market: (params.get("market") || "US").toUpperCase(),
      platform: (params.get("platform") || "amazon").toLowerCase(),
    });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setResult(null);
    const formData = new FormData();
    formData.set("kind", "candidates");
    formData.set("market", site.market);
    formData.set("platform", site.platform);
    if (file) formData.set("file", file);
    if (csvText.trim()) formData.set("csvText", csvText);

    try {
      const response = await fetch("/api/ingestion", { method: "POST", body: formData });
      const payload = (await response.json()) as ImportResponse;
      if (!response.ok) throw new Error(payload.error || "导入失败");
      setResult(payload);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page page-narrow">
      <div className="breadcrumb"><Link href="/">商品机会</Link> / 导入候选品</div>
      <section className="hero">
        <div>
          <div className="eyebrow">CSV intake · {site.market} × {site.platform}</div>
          <h1>导入 {site.market} 站点候选品</h1>
          <p>本次导入固定归属于首页选中的国家站点。CSV 中的 marketplace 会以当前站点覆盖，避免同一批候选品被错误归到其他市场。</p>
        </div>
      </section>

      <div className="import-layout">
        <section className="section">
          <form onSubmit={handleSubmit} className="stack">
            <div className="dropzone">
              <h3>选择 CSV 文件</h3>
              <p className="muted">支持 UTF-8、中文或英文字段名，单次最多 200 行。</p>
              <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>

            <div className="field">
              <label htmlFor="csvText">或者直接粘贴 CSV</label>
              <textarea
                id="csvText"
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                placeholder={`asin,marketplace,category,title,competitor_price,currency,monthly_sales_min,monthly_sales_max,review_count,rating,observed_at\nB0XXXXX,${site.market},宠物用品,Example product,39.99,USD,800,1200,340,4.3,2026-11-04T08:00:00Z`}
              />
              <span className="help">文件与粘贴内容二选一。必需字段：title、competitor_price；建议同时填写 source、source_record_id 和 observed_at。</span>
            </div>

            <div className="button-row">
              <button className="button primary" type="submit" disabled={pending || (!file && !csvText.trim())}>
                {pending ? "正在导入…" : "导入并生成成本模型"}
              </button>
              <a className="button ghost" href="/candidates-template-v2.csv" download>下载模板 v2</a>
            </div>

            {result ? (
              <div className="result-box success">
                导入完成：新增 {result.imported ?? 0} 个，更新 {result.updated ?? 0} 个，跳过重复 {result.skipped ?? 0} 个，保存快照 {result.snapshots ?? 0} 条。{" "}
                <Link href={`/?market=${encodeURIComponent(site.market)}&platform=${encodeURIComponent(site.platform)}#opportunities`} style={{ fontWeight: 800, textDecoration: "underline" }}>查看 {site.market} 站点商品机会</Link>
              </div>
            ) : null}
            {error ? <div className="result-box error">{error}</div> : null}
          </form>
        </section>

        <aside className="stack">
          <section className="card">
            <h3>最小字段</h3>
            <div className="pill-list">
              <span className="info-pill">asin</span>
              <span className="info-pill">marketplace（自动覆盖为 {site.market}）</span>
              <span className="info-pill">title</span>
              <span className="info-pill">competitor_price</span>
            </div>
            <p>其他字段可留空。采购成本未填时按售价 30% 估算；该值只是建模占位，必须在供应商定标前替换为真实报价。</p>
          </section>
          <section className="card">
            <h3>可选市场字段</h3>
            <p>currency、monthly_sales_min、monthly_sales_max、review_count、rating、bsr、keyword、seller_count、variation_count、source、source_record_id、observed_at。</p>
            <p>比率字段可写 <strong>15</strong> 或 <strong>15%</strong>，系统按百分比解释。</p>
          </section>
          <section className="card">
            <h3>导入护栏</h3>
            <p>当前成本模型不盈利的候选品会被拒绝导入，避免把明显亏损的项目带入审批队列。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
