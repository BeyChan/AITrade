"use client";

import type { SupplierRfqDraft } from "@/lib/competitor-compare/supplier-rfq";

type Props = {
  rfqData: SupplierRfqDraft;
  rfqCopied: boolean;
  onCopyRfqText: (rfq: SupplierRfqDraft) => void;
  onClose: () => void;
};

export function SupplierRfqPanel({ rfqData, rfqCopied, onCopyRfqText, onClose }: Props) {
  return (
    <section className="panel" style={{ padding: "24px", background: "var(--surface-subtle)", border: "1.5px solid #28543f" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--green)" }}>SUPPLIER SOURCING RFQ · 1688 工业改良询价单</div>
          <h4 style={{ margin: "4px 0 0 0", fontSize: "17px", color: "var(--ink)", fontWeight: 800 }}>
            🏭 针对竞品痛点的工厂开模/打样采购定制单 ({rfqData.productName})
          </h4>
          <p style={{ margin: "4px 0 0 0", color: "var(--muted)", fontSize: "12px" }}>
            把买家差评转成工程问询项；MOQ、认证、测试与验收参数均由工厂回填，不预设既成事实。
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="button primary"
            onClick={() => onCopyRfqText(rfqData)}
            style={{ fontSize: "12px", padding: "5px 12px", height: "32px", borderRadius: "8px", background: "#28543f" }}
          >
            {rfqCopied ? "✅ 已复制旺旺话术" : "📋 复制旺旺询价话术"}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "16px", cursor: "pointer", padding: "0 6px" }}
            title="收起"
          >
            &times;
          </button>
        </div>
      </div>

      {/* 核心指标胶囊 */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div style={{ background: "var(--paper)", padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>目标采购单价: </span>
          <strong style={{ fontSize: "14px", color: "var(--green)" }}>¥{rfqData.targetPriceRmb.toFixed(2)}</strong>
        </div>
        <div style={{ background: "var(--paper)", padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>建议试单 MOQ: </span>
          <strong style={{ fontSize: "13px", color: "var(--ink)" }}>{rfqData.suggestedMoq}</strong>
        </div>
      </div>

      {!rfqData.priceBasisVerified && (
        <div
          className="result-box warning"
          role="status"
          style={{ marginBottom: "16px", fontSize: "12px", lineHeight: "1.5" }}
        >
          <strong>目标采购单价仅作议价起点。</strong>{" "}
          当前研报的竞品售价未经人工核实（真实价格样本 0 条），该价格由示意分位推导，不代表市场行情；正式询价前请先补录或采集真实竞品售价。
        </div>
      )}

      {/* 改良部件与工业标准列表 */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>
          🛠️ 待工厂确认的改良项与工艺要求：
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {rfqData.criticalImprovements.map((item, idx) => (
            <div
              key={idx}
              style={{
                background: "var(--paper)",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ fontWeight: 700, color: "var(--ink)" }}>
                  {idx + 1}. 部件：{item.component}
                </span>
                <span style={{ color: "var(--red)", fontSize: "12px", background: "var(--red-soft)", padding: "1px 6px", borderRadius: "4px" }}>
                  靶向痛点: {item.painPointTargeted}
                </span>
              </div>
              <div style={{ color: "var(--green)", fontWeight: 600 }}>
                ⚙️ 工业工艺标准: <span style={{ color: "var(--ink)", fontWeight: 400 }}>{item.manufacturingStandard}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 质检验货标准 */}
      {rfqData.qualityStandard && rfqData.qualityStandard.length > 0 && (
        <div style={{ background: "var(--surface-subtle)", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--line)", marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "6px" }}>
            🧪 打样与出货质检验收要求：
          </div>
          <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "var(--ink)", lineHeight: "1.5" }}>
            {rfqData.qualityStandard.map((q, idx) => (
              <li key={idx}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 阿里旺旺完整文本 */}
      <div style={{ background: "var(--paper)", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>阿里旺旺 / 微信工厂对接话术预览：</span>
          <button
            type="button"
            onClick={() => onCopyRfqText(rfqData)}
            style={{ background: "none", border: "none", color: "var(--green)", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}
          >
            {rfqCopied ? "已复制" : "复制文本"}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            fontSize: "12px",
            lineHeight: "1.5",
            color: "var(--ink)",
            fontFamily: "ui-monospace, monospace",
            background: "var(--surface-subtle)",
            padding: "10px",
            borderRadius: "6px",
          }}
        >
          {rfqData.formattedText}
        </pre>
      </div>
    </section>
  );
}
