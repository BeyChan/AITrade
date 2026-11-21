"use client";

import { useEffect, useState } from "react";
import type { SampleLogRecord, SampleLogStatus } from "@/app/api/cases/[id]/samples/route";
import { getFxRate } from "@/lib/currency";
import { shortDate } from "@/lib/format";
import { FX_UPDATED_EVENT } from "./topbar-fx-widget";

const STATUS_META: Record<SampleLogStatus, { label: string; cls: string }> = {
  ordered: { label: "已下单发样", cls: "badge-neutral" },
  received: { label: "已收货待验", cls: "status-researching" },
  passed: { label: "验收通过", cls: "badge-success" },
  failed: { label: "验收淘汰", cls: "badge-danger" },
  returned: { label: "已退样", cls: "badge-neutral" },
};

const SHIPPING_MODES = [
  { label: "美森快船 (¥22/kg)", rateCnyPerKg: 22 },
  { label: "普船海派 (¥14/kg)", rateCnyPerKg: 14 },
  { label: "空派专线 (¥48/kg)", rateCnyPerKg: 48 },
];

export function SourcingPracticalTools({
  caseId,
  initialSamples = [],
}: {
  caseId: string;
  initialSamples?: SampleLogRecord[];
}) {
  // 1. 人民币与箱规头程快捷换算器
  const [unitPriceCny, setUnitPriceCny] = useState("28");
  const [fxRate, setFxRate] = useState(() => String(getFxRate("USD")));
  const [fxTouched, setFxTouched] = useState(false);

  useEffect(() => {
    function onFxUpdated() {
      if (!fxTouched) {
        setFxRate(String(getFxRate("USD")));
      }
    }
    if (!fxTouched) {
      setFxRate(String(getFxRate("USD")));
    }
    window.addEventListener(FX_UPDATED_EVENT, onFxUpdated);
    return () => window.removeEventListener(FX_UPDATED_EVENT, onFxUpdated);
  }, [fxTouched]);
  const [weightKg, setWeightKg] = useState("0.45");
  const [lengthCm, setLengthCm] = useState("22");
  const [widthCm, setWidthCm] = useState("16");
  const [heightCm, setHeightCm] = useState("9");
  const [freightRateCny, setFreightRateCny] = useState("22");

  const cny = Math.max(0, Number(unitPriceCny) || 0);
  const fx = Math.max(0.1, Number(fxRate) || 7.25);
  const realKg = Math.max(0, Number(weightKg) || 0);
  const l = Math.max(0, Number(lengthCm) || 0);
  const w = Math.max(0, Number(widthCm) || 0);
  const h = Math.max(0, Number(heightCm) || 0);
  const freightRate = Math.max(0, Number(freightRateCny) || 0);

  const volWeightKg = (l * w * h) / 6000;
  const billedWeightKg = Math.max(realKg, volWeightKg);
  const isVolumetric = volWeightKg > realKg && volWeightKg > 0;
  const unitUsd = cny / fx;
  const freightUsd = (billedWeightKg * freightRate) / fx;
  const estimatedLandedUsd = unitUsd + freightUsd;

  // FBA 尺寸降档临界提示（英寸）
  const dimsIn = [l / 2.54, w / 2.54, h / 2.54].sort((a, b) => b - a);
  const longestIn = dimsIn[0] ?? 0;
  const shortestIn = dimsIn[2] ?? 0;
  let fbaSizeTip = "";
  if (shortestIn > 0.75 && shortestIn <= 1.2) {
    fbaSizeTip = `最短边 ${shortestIn.toFixed(2)} in，若压缩至 ≤ 0.75 in（1.9 cm），有机会降入小号标准尺寸，单件省约 $0.8–$1.5！`;
  } else if (shortestIn > 8 && shortestIn <= 9.2) {
    fbaSizeTip = `最短边 ${shortestIn.toFixed(2)} in，超过大号标准件 8 in 上限！若压缩至 ≤ 8 in（20.3 cm），可避免升档为超大件，单件省约 $3+！`;
  } else if (longestIn > 18 && longestIn <= 19.5) {
    fbaSizeTip = `最长边 ${longestIn.toFixed(2)} in，若压缩至 ≤ 18 in（45.7 cm），可避免超大件附加费！`;
  }

  // 2. 拿样与验货日记
  const [samples, setSamples] = useState<SampleLogRecord[]>(initialSamples);
  const [supplierName, setSupplierName] = useState("");
  const [sampleCostCny, setSampleCostCny] = useState("");
  const [shippingCostCny, setShippingCostCny] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [status, setStatus] = useState<SampleLogStatus>("ordered");
  const [qualityRating, setQualityRating] = useState("4");
  const [pros, setPros] = useState("");
  const [defects, setDefects] = useState("");
  const [savingSample, setSavingSample] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  async function handleAddSample(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierName.trim()) {
      setSampleError("请填写工厂名称");
      return;
    }
    setSampleError(null);
    setSavingSample(true);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: supplierName.trim(),
          sampleCostCny: Number(sampleCostCny) || 0,
          shippingCostCny: Number(shippingCostCny) || 0,
          trackingNo: trackingNo.trim(),
          status,
          qualityRating: status === "ordered" ? null : Number(qualityRating),
          pros: pros.trim(),
          defects: defects.trim(),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; sample?: SampleLogRecord; error?: string };
      if (!res.ok || !json.ok || !json.sample) {
        setSampleError(json.error || "保存失败");
        return;
      }
      setSamples((prev) => [json.sample!, ...prev]);
      setSupplierName("");
      setSampleCostCny("");
      setShippingCostCny("");
      setTrackingNo("");
      setPros("");
      setDefects("");
    } catch {
      setSampleError("网络异常，请重试");
    } finally {
      setSavingSample(false);
    }
  }

  async function handleStatusChange(sampleId: string, nextStatus: SampleLogStatus) {
    const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/samples`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sampleId, status: nextStatus }),
    });
    const json = (await res.json()) as { ok?: boolean; sample?: SampleLogRecord };
    if (res.ok && json.ok && json.sample) {
      setSamples((prev) => prev.map((s) => (s.id === sampleId ? json.sample! : s)));
    }
  }

  async function handleDeleteSample(sampleId: string) {
    const res = await fetch(
      `/api/cases/${encodeURIComponent(caseId)}/samples?sampleId=${encodeURIComponent(sampleId)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      setSamples((prev) => prev.filter((s) => s.id !== sampleId));
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "18px", marginBottom: "20px" }}>
      {/* 1688 人民币 & 头程换算器 */}
      <section className="section" style={{ margin: 0 }}>
        <div className="section-header">
          <div>
            <h2>1688 人民币 & 头程快捷换算</h2>
            <p>填工厂人民币报价和包装尺寸，自动判抛货体积重并折算美金到岸成本。</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
          <label className="field">
            <span>工厂拿货价 (CNY ¥)</span>
            <input type="number" step="0.1" value={unitPriceCny} onChange={(e) => setUnitPriceCny(e.target.value)} />
          </label>
          <label className="field">
            <span>汇率 (USD/CNY)</span>
            <input
              type="number"
              step="0.01"
              value={fxRate}
              onChange={(e) => {
                setFxTouched(true);
                setFxRate(e.target.value);
              }}
            />
          </label>
          <label className="field">
            <span>单件实重 (kg)</span>
            <input type="number" step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
          </label>
          <label className="field">
            <span>头程单价 (¥/kg)</span>
            <input type="number" step="1" value={freightRateCny} onChange={(e) => setFreightRateCny(e.target.value)} />
          </label>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "8px 0 10px" }}>
          {SHIPPING_MODES.map((m) => (
            <button
              key={m.label}
              type="button"
              className="button ghost"
              style={{ fontSize: "12px", padding: "4px 8px" }}
              onClick={() => setFreightRateCny(String(m.rateCnyPerKg))}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", marginBottom: "12px" }}>
          <label className="field">
            <span>长 (cm)</span>
            <input type="number" step="0.5" value={lengthCm} onChange={(e) => setLengthCm(e.target.value)} />
          </label>
          <label className="field">
            <span>宽 (cm)</span>
            <input type="number" step="0.5" value={widthCm} onChange={(e) => setWidthCm(e.target.value)} />
          </label>
          <label className="field">
            <span>高 (cm)</span>
            <input type="number" step="0.5" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "10px",
            padding: "12px",
            borderRadius: "10px",
            border: "1px solid var(--line)",
            background: "var(--canvas)",
          }}
        >
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>单件采购价</div>
            <strong className="mono" style={{ fontSize: "16px" }}>${unitUsd.toFixed(2)}</strong>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
              单件头程 ({isVolumetric ? "抛货计费" : "实重计费"} {billedWeightKg.toFixed(2)}kg)
            </div>
            <strong className="mono" style={{ fontSize: "16px" }}>${freightUsd.toFixed(2)}</strong>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>预估到岸成本</div>
            <strong className="mono" style={{ fontSize: "16px", color: "var(--green)" }}>
              ${estimatedLandedUsd.toFixed(2)}
            </strong>
          </div>
        </div>

        {fbaSizeTip ? (
          <div className="notice warn" style={{ marginTop: "10px", marginBottom: 0 }}>
            <span className="badge status-review_pending">省钱提醒</span>
            <span>{fbaSizeTip}</span>
          </div>
        ) : null}
      </section>

      {/* 拿样与验货日记 */}
      <section className="section" style={{ margin: 0 }}>
        <div className="section-header">
          <div>
            <h2>拿样与验货日记（{samples.length} 条）</h2>
            <p>记录每家厂的样品费、快递单号、实测做工评分与避坑瑕疵，避免翻微信找记录。</p>
          </div>
        </div>

        <form onSubmit={handleAddSample} className="stack" style={{ gap: "10px", marginBottom: "14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "8px" }}>
            <label className="field">
              <span>工厂 / 店铺名 *</span>
              <input
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="例如：宁波宏达塑胶厂"
              />
            </label>
            <label className="field">
              <span>样品费 (¥)</span>
              <input type="number" step="1" value={sampleCostCny} onChange={(e) => setSampleCostCny(e.target.value)} placeholder="50" />
            </label>
            <label className="field">
              <span>运费 (¥)</span>
              <input type="number" step="1" value={shippingCostCny} onChange={(e) => setShippingCostCny(e.target.value)} placeholder="12" />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr", gap: "8px" }}>
            <label className="field">
              <span>快递单号</span>
              <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="SF123456..." />
            </label>
            <label className="field">
              <span>状态</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as SampleLogStatus)}>
                <option value="ordered">已下单发样</option>
                <option value="received">已收货待验</option>
                <option value="passed">验收通过</option>
                <option value="failed">验收淘汰</option>
                <option value="returned">已退样</option>
              </select>
            </label>
            <label className="field">
              <span>做工评分</span>
              <select value={qualityRating} onChange={(e) => setQualityRating(e.target.value)}>
                <option value="5">5 分 · 极佳</option>
                <option value="4">4 分 · 良好</option>
                <option value="3">3 分 · 一般</option>
                <option value="2">2 分 · 较差</option>
                <option value="1">1 分 · 踩坑</option>
              </select>
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <label className="field">
              <span>实测亮点</span>
              <input value={pros} onChange={(e) => setPros(e.target.value)} placeholder="静音效果好、材质厚实…" />
            </label>
            <label className="field">
              <span>瑕疵 / 避雷点</span>
              <input value={defects} onChange={(e) => setDefects(e.target.value)} placeholder="盖子偏松、包装易压变形…" />
            </label>
          </div>

          {sampleError ? <div style={{ color: "var(--red)", fontSize: "13px" }}>{sampleError}</div> : null}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className="button primary" disabled={savingSample}>
              {savingSample ? "记录中…" : "添加拿样记录"}
            </button>
          </div>
        </form>

        {samples.length > 0 ? (
          <div className="stack" style={{ gap: "8px" }}>
            {samples.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  background: "var(--canvas)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <strong>{s.supplierName}</strong>
                    <span className={`badge ${STATUS_META[s.status].cls}`}>{STATUS_META[s.status].label}</span>
                    {s.qualityRating ? <span className="badge badge-neutral">做工 {s.qualityRating}/5</span> : null}
                    <span className="mono" style={{ fontSize: "12px", color: "var(--muted)" }}>
                      ¥{(s.sampleCostCny + s.shippingCostCny).toFixed(0)}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <select
                      value={s.status}
                      onChange={(e) => handleStatusChange(s.id, e.target.value as SampleLogStatus)}
                      aria-label="更新拿样状态"
                      style={{
                        fontSize: "12px",
                        padding: "3px 6px",
                        borderRadius: "6px",
                        border: "1px solid var(--line)",
                        background: "var(--paper)",
                        color: "var(--ink)",
                      }}
                    >
                      <option value="ordered">已下单</option>
                      <option value="received">已收货</option>
                      <option value="passed">验收通过</option>
                      <option value="failed">验收淘汰</option>
                      <option value="returned">已退样</option>
                    </select>
                    <button
                      type="button"
                      className="button ghost"
                      style={{ fontSize: "12px", padding: "3px 8px" }}
                      onClick={() => handleDeleteSample(s.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {s.trackingNo ? `快递：${s.trackingNo} · ` : ""}
                  记录人：{s.createdBy} · {shortDate(s.createdAt)}
                </div>
                {s.pros ? <div style={{ fontSize: "13px", color: "var(--green)" }}>亮点：{s.pros}</div> : null}
                {s.defects ? <div style={{ fontSize: "13px", color: "var(--red)" }}>瑕疵：{s.defects}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: "13px" }}>
            暂无拿样记录。发样后随手记一笔，实测评分和瑕疵永久留在案卷里。
          </p>
        )}
      </section>
    </div>
  );
}
