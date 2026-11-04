"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type IngestionKind = "candidates" | "suppliers" | "quotes" | "keepa";

type IngestionResult = {
  runId?: string;
  status?: "completed" | "partial";
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
  kind: Exclude<IngestionKind, "keepa">;
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
    description: "接入平台后台导出、第三方选品工具导出或人工整理的候选品表。系统保留来源、采集时间、销量区间和原始快照。",
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

const keepaMarkets = ["US", "GB", "DE", "FR", "IT", "ES", "JP", "CA", "IN", "MX", "BR", "AU"];

export function DataSourceImport() {
  const router = useRouter();
  const [kind, setKind] = useState<IngestionKind>("candidates");
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [asins, setAsins] = useState("");
  const [marketplace, setMarketplace] = useState("US");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IngestionResult | null>(null);
  const mode = modes.find((item) => item.kind === kind);

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

    const formData = new FormData();
    formData.set("kind", kind);
    if (kind === "keepa") {
      formData.set("asins", asins);
      formData.set("marketplace", marketplace);
    } else {
      if (file) formData.set("file", file);
      if (csvText.trim()) formData.set("csvText", csvText);
    }

    try {
      const response = await fetch("/api/ingestion", { method: "POST", body: formData });
      const payload = (await response.json()) as IngestionResult;
      if (!response.ok) {
        if (payload.code === "not_configured") {
          throw new Error(`${payload.error || "连接器未配置"}。请把凭证写入 .env.local 后重启服务，不要把密钥发到聊天里。`);
        }
        throw new Error(payload.error || "导入失败");
      }
      setResult(payload);
      if (kind !== "keepa") {
        setFile(null);
        setCsvText("");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
    } finally {
      setPending(false);
    }
  }

  const canSubmit =
    kind === "keepa" ? asins.trim().length > 0 : Boolean(file || csvText.trim());

  return (
    <div className="source-workbench">
      <section className="panel source-import-panel">
        <div className="panel-header source-panel-header">
          <div>
            <div className="eyebrow">Real data intake</div>
            <h2>接入真实业务数据</h2>
            <p>CSV 是当前可立即使用的数据主通道；Keepa 是可选只读竞品数据连接器。</p>
          </div>
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
          <button
            className={kind === "keepa" ? "source-tab active" : "source-tab"}
            type="button"
            role="tab"
            aria-selected={kind === "keepa"}
            onClick={() => selectKind("keepa")}
          >
            Keepa
          </button>
        </div>

        <form onSubmit={handleSubmit} className="stack source-form">
          {mode ? (
            <>
              <div className="source-form-intro">
                <div>
                  <h3>{mode.title}</h3>
                  <p>{mode.description}</p>
                </div>
                <a className="button ghost compact-button" href={mode.template} download>
                  下载{mode.templateName}
                </a>
              </div>

              <div className="dropzone">
                <h3>选择 CSV 文件</h3>
                <p className="muted">UTF-8，最大 2 MB；候选品单次最多 200 行，供应商和报价最多 1,000 行。</p>
                <input
                  key={mode.kind}
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
                  placeholder={mode.placeholder}
                />
                <span className="help">文件和粘贴内容二选一。导入后会显示运行 ID、失败数、跳过数、告警和原始快照数。</span>
              </div>
            </>
          ) : (
            <>
              <div className="source-form-intro">
                <div>
                  <h3>从 Keepa 同步竞品商品</h3>
                  <p>只读请求商品价格、评论、销量和 BSR。未配置 KEEPA_API_KEY 时系统不会发起任何外部请求。</p>
                </div>
                <span className="info-pill">只读 API</span>
              </div>

              <div className="form-grid keepa-form-grid">
                <div className="field">
                  <label htmlFor="keepa-marketplace">Amazon 市场</label>
                  <select id="keepa-marketplace" value={marketplace} onChange={(event) => setMarketplace(event.target.value)}>
                    {keepaMarkets.map((market) => <option key={market} value={market}>{market}</option>)}
                  </select>
                </div>
                <div className="field full">
                  <label htmlFor="keepa-asins">ASIN（换行或逗号分隔）</label>
                  <textarea
                    id="keepa-asins"
                    value={asins}
                    onChange={(event) => setAsins(event.target.value)}
                    placeholder={"B0XXXXXXXX\nB0YYYYYYYY"}
                  />
                  <span className="help">单次最多 100 个 ASIN；同步后仍会生成待立项审批，不会自动采购。</span>
                </div>
              </div>
            </>
          )}

          <div className="button-row">
            <button className="button primary" type="submit" disabled={pending || !canSubmit}>
              {pending ? "正在导入…" : kind === "keepa" ? "同步 Keepa 商品" : "开始导入"}
            </button>
            <span className="source-safe-note">外部动作：不会发送 RFQ、自动定标、发布、下单或付款</span>
          </div>

          {result ? (
            <div className={result.status === "partial" ? "result-box warning" : "result-box success"}>
              <strong>{result.status === "partial" ? "导入完成，但有需要处理的记录" : "导入完成"}</strong>
              <div className="result-metrics">
                <span>新增 {result.imported ?? 0}</span>
                <span>更新 {result.updated ?? 0}</span>
                <span>跳过 {result.skipped ?? 0}</span>
                <span>失败 {result.errors ?? 0}</span>
                <span>快照 {result.snapshots ?? 0}</span>
              </div>
              {result.runId ? <div className="run-id">runId: {result.runId}</div> : null}
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
          <h3>真实数据接入边界</h3>
          <ul className="guardrail-list">
            <li>候选品、供应商和报价都保留原始 payload、来源标识与观察时间。</li>
            <li>销量允许保留区间，不把第三方估算改写成确定事实。</li>
            <li>报价必须关联已立项商品，未立项记录只报错，不创建报价。</li>
            <li>Amazon SP-API 只用于自有店铺，不能拿来伪造竞品销量。</li>
            <li>未获官方授权的平台不采用爬虫接入。</li>
          </ul>
        </section>
        <section className="card">
          <h3>接入顺序建议</h3>
          <div className="source-steps">
            <span><b>01</b> 先导入 10–20 个真实候选品</span>
            <span><b>02</b> 人工审批，确认值得立项的商品</span>
            <span><b>03</b> 导入供应商档案和至少 3 份报价</span>
            <span><b>04</b> 人工对比、定标，再进入内容和上架预检</span>
          </div>
        </section>
      </aside>
    </div>
  );
}
