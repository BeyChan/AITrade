"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type IngestionKind = "candidates" | "suppliers" | "quotes";

type IngestionResult = {
  runId?: string;
  status?: "completed" | "partial" | "failed";
  imported?: number;
  updated?: number;
  skipped?: number;
  errors?: number;
  snapshots?: number;
  warnings?: string[];
  error?: string;
  code?: string;
};

const modes: Array<{
  kind: IngestionKind;
  label: string;
  title: string;
  description: string;
  template: string;
  templateName: string;
  placeholder: string;
}> = [
  {
    kind: "candidates",
    label: "候选品",
    title: "导入选品与市场信号",
    description: "接入平台后台导出、ERP 导出或人工整理的候选品表。无需订阅、无需 API Key，系统保留来源、采集时间、销量区间和原始快照。",
    template: "/candidates-template-v2.csv",
    templateName: "候选品模板",
    placeholder:
      "asin,marketplace,category,title,competitor_price,currency,monthly_sales_min,monthly_sales_max,review_count,rating,observed_at\nB0XXXXX,US,宠物用品,Example product,39.99,USD,800,1200,340,4.3,2026-11-04T08:00:00Z",
  },
  {
    kind: "suppliers",
    label: "供应商",
    title: "导入供应商档案",
    description: "按供应商平台 + 外部 ID、规范化链接或名称去重；认证、MOQ、交期和来源都会保留在档案与证据快照中。",
    template: "/suppliers-template.csv",
    templateName: "供应商模板",
    placeholder:
      "supplier_platform,external_supplier_id,supplier_name,supplier_url,country,contact,category,rating,verified,moq,lead_time_days,certifications,observed_at\n1688,SUP-EXAMPLE,示例供应商（请替换）,https://example.com/supplier/1,CN,contact@example.com,宠物用品,4.7,true,500,25,ISO9001,2026-11-04T08:00:00Z",
  },
  {
    kind: "quotes",
    label: "报价",
    title: "导入供应商报价",
    description: "报价只能关联已立项商品。相同来源、供应商和报价内容会幂等跳过；系统不会发送 RFQ，也不会自动定标。",
    template: "/quotes-template.csv",
    templateName: "报价模板",
    placeholder:
      "asin,marketplace,supplier_platform,external_supplier_id,supplier_name,unit_price,freight_per_unit,duty_rate,quality_score,moq,lead_time_days,currency,observed_at\nB0SAMPLE002,US,1688,SUP-EXAMPLE,示例供应商（请替换）,5.20,1.10,8%,82,500,25,USD,2026-11-04T08:00:00Z",
  },
];

const importMarkets = [
  ["US", "美国"],
  ["GB", "英国"],
  ["DE", "德国"],
  ["JP", "日本"],
  ["SG", "新加坡"],
  ["MY", "马来西亚"],
  ["AU", "澳大利亚"],
] as const;
const importPlatforms = [
  ["amazon", "Amazon"],
  ["shopify", "Shopify"],
  ["tiktok_shop", "TikTok Shop"],
  ["ebay", "eBay"],
  ["manual", "CSV / 人工"],
] as const;

export function DataSourceImport() {
  const router = useRouter();
  const [kind, setKind] = useState<IngestionKind>("candidates");
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [marketplace, setMarketplace] = useState("US");
  const [platformCode, setPlatformCode] = useState("amazon");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IngestionResult | null>(null);
  const csvMode = modes.find((item) => item.kind === kind) ?? modes[0];

  function selectKind(nextKind: IngestionKind) {
    setKind(nextKind);
    setFile(null);
    setCsvText("");
    setError("");
    setResult(null);
  }

  function selectFile(selected: File | null) {
    setError("");
    if (selected && selected.size > 2 * 1024 * 1024) {
      setFile(null);
      setError("CSV 文件不能超过 2 MB");
      return;
    }
    setFile(selected);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.set("kind", kind);
      if (file) formData.set("file", file);
      if (csvText.trim()) formData.set("csvText", csvText);
      if (kind === "candidates") {
        formData.set("market", marketplace);
        formData.set("platform", platformCode);
      }
      const response = await fetch("/api/ingestion", { method: "POST", body: formData });
      const payload = (await response.json()) as IngestionResult;
      setResult(payload);
      router.refresh();
      if (!response.ok) throw new Error(payload.error || "导入失败");
      setFile(null);
      setCsvText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      setPending(false);
    }
  }

  const canSubmit = Boolean(file || csvText.trim());

  return (
    <div className="source-workbench">
      <section className="panel source-import-panel">
        <div className="panel-header source-panel-header">
          <div>
            <div className="eyebrow">Free data intake</div>
            <h2>免费数据接入</h2>
            <p>不依赖订阅型选品 API。平台后台、ERP、1688 或人工核验数据导出为 CSV 后即可入库。</p>
          </div>
          <span className="badge badge-success">0 付费 Key</span>
        </div>

        <div className="source-tabs" role="tablist" aria-label="导入数据类型">
          {modes.map((item) => (
            <button
              className={kind === item.kind ? "source-tab active" : "source-tab"}
              key={item.kind}
              type="button"
              role="tab"
              aria-selected={kind === item.kind}
              onClick={() => selectKind(item.kind)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="stack source-form">
          <div className="source-form-intro">
            <div>
              <h3>{csvMode.title}</h3>
              <p>{csvMode.description}</p>
            </div>
            <a className="button ghost compact-button" href={csvMode.template} download>
              下载{csvMode.templateName}
            </a>
          </div>

          {kind === "candidates" ? (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="candidate-market">候选品归属国家 / 市场</label>
                <select id="candidate-market" value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
                  {importMarkets.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="candidate-platform">候选品归属平台站</label>
                <select id="candidate-platform" value={platformCode} onChange={(event) => setPlatformCode(event.target.value)}>
                  {importPlatforms.map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}
                </select>
              </div>
              <span className="help full">CSV 内的 marketplace 会以这里选择的国家覆盖；平台归属会持久化，机会只显示在对应国家 × 平台站点。</span>
            </div>
          ) : null}

          <div className="dropzone">
            <h3>选择 CSV 文件</h3>
            <p className="muted">UTF-8，最大 2 MB；候选品单次最多 200 行，供应商和报价最多 1,000 行。</p>
            <input
              key={kind}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            />
          </div>

          <div className="field">
            <label htmlFor="source-csv-text">或者直接粘贴 CSV</label>
            <textarea
              id="source-csv-text"
              className="source-csv-textarea"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder={csvMode.placeholder}
            />
            <span className="help">文件和粘贴内容二选一。导入后会显示运行 ID、失败数、跳过数、告警和原始快照数。</span>
          </div>

          <div className="button-row">
            <button className="button primary" type="submit" disabled={pending || !canSubmit}>
              {pending ? "正在导入…" : "开始导入"}
            </button>
            <span className="source-safe-note">无需 API Key；不会发送 RFQ、自动定标、发布、下单或付款</span>
          </div>

          {result ? (
            <div className={result.status === "partial" ? "result-box warning" : result.status === "failed" ? "result-box error" : "result-box success"}>
              <strong>
                {result.status === "partial"
                  ? "导入完成，但有需要处理的记录"
                  : result.status === "failed"
                    ? "导入失败，未写入伪造数据"
                    : "导入完成"}
              </strong>
              <div className="result-metrics">
                <span>新增 {result.imported ?? 0}</span>
                <span>更新 {result.updated ?? 0}</span>
                <span>跳过 {result.skipped ?? 0}</span>
                <span>失败 {result.errors ?? 0}</span>
                <span>快照 {result.snapshots ?? 0}</span>
              </div>
              {result.runId ? <div className="run-id">runId: {result.runId}</div> : null}
              {kind === "candidates" ? (
                <a className="text-link" href={`/?market=${encodeURIComponent(marketplace)}&platform=${encodeURIComponent(platformCode)}#opportunities`}>
                  查看该国家 × 平台站点的商品机会 →
                </a>
              ) : null}
              {result.warnings?.length ? (
                <ul className="result-warnings">
                  {result.warnings.slice(0, 8).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              ) : null}
            </div>
          ) : null}
          {error ? <div className="result-box error">{error}</div> : null}
        </form>
      </section>

      <aside className="stack">
        <section className="card source-guardrail-card">
          <div className="eyebrow">Guardrails</div>
          <h3>免费模式的边界</h3>
          <ul className="guardrail-list">
            <li>不使用任何订阅型选品 API，也不需要 Sorftime、Keepa 或其他付费 Key。</li>
            <li>候选品、供应商和报价都保留原始 payload、来源标识与观察时间。</li>
            <li>平台后台导出和人工核验表可以直接导入，成本以真实报价为准。</li>
            <li>报价必须关联已立项商品，未立项记录只报错，不创建报价。</li>
            <li>不抓取未获官方授权的数据，不把估算值写成确定事实。</li>
          </ul>
        </section>
        <section className="card">
          <h3>推荐免费流程</h3>
          <div className="source-steps">
            <span><b>01</b> 从平台后台、ERP 或选品工具导出候选品 CSV</span>
            <span><b>02</b> 人工审批，确认值得立项的商品</span>
            <span><b>03</b> 导入供应商档案和至少 3 份真实报价</span>
            <span><b>04</b> 人工对比、定标，再进入主图和上架预检</span>
          </div>
        </section>
      </aside>
    </div>
  );
}
