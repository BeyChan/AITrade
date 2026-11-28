"use client";

import { useMemo, useState } from "react";
import {
  COMPLIANCE_ATTRIBUTE_OPTIONS,
  evaluatePrelaunchCompliance,
  type ProductComplianceAttribute,
} from "@/lib/prelaunch-compliance";
import { convertForeignCentsToRmb } from "@/lib/currency";
import type { AppMode } from "@/lib/app-mode";

type Props = {
  marketCode: string;
  productTitle: string;
  category: string;
  mode: AppMode;
};

export function PrelaunchCompliancePanel({ marketCode, productTitle, category, mode }: Props) {
  const [selected, setSelected] = useState<ProductComplianceAttribute[]>([]);
  const [patentChecked, setPatentChecked] = useState(false);

  const assessment = useMemo(
    () => evaluatePrelaunchCompliance(marketCode, selected, `${category} ${productTitle}`),
    [marketCode, selected, category, productTitle],
  );

  function toggleAttr(id: ProductComplianceAttribute) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  const riskBadgeClass =
    assessment.riskLevel === "high"
      ? "is-no-go"
      : assessment.riskLevel === "medium"
        ? "is-hold"
        : "is-go";
  const riskLabel =
    assessment.riskLevel === "high"
      ? "高合规门槛"
      : assessment.riskLevel === "medium"
        ? "中等认证要求"
        : "常规低风险";
  const estRmb = convertForeignCentsToRmb(assessment.totalEstimatedCostUsd * 100, "USD", mode);

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>立项前置合规与专利红线（{assessment.marketCode} 站）</h2>
          <p>在向工厂付定金前勾选商品属性，自动识别目标站强制认证、预估合规费用与专利检索入口。</p>
        </div>
        <span className={`verdict-pill ${riskBadgeClass}`}>{riskLabel}</span>
      </div>

      <div className="compliance-attr-grid">
        {COMPLIANCE_ATTRIBUTE_OPTIONS.map((opt) => {
          const active = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              className={`compliance-attr-chip${active ? " is-active" : ""}`}
              onClick={() => toggleAttr(opt.id)}
              title={opt.hint}
            >
              <strong>{opt.label}</strong>
              <span>{opt.hint}</span>
            </button>
          );
        })}
      </div>

      {assessment.certifications.length > 0 ? (
        <div className="compliance-cert-list">
          <div className="compliance-cert-summary">
            <span>识别到 <strong>{assessment.certifications.length}</strong> 项强制合规要求</span>
            <span className="mono">
              预估认证预算：<strong>${assessment.totalEstimatedCostUsd.toLocaleString()}</strong>（约 ¥{estRmb.toLocaleString()}）
            </span>
          </div>
          {assessment.certifications.map((cert) => (
            <div key={cert.code} className="compliance-cert-item">
              <div className="compliance-cert-top">
                <span className="badge badge-danger">{cert.code}</span>
                <strong>{cert.name}</strong>
                <span className="muted mono">${cert.estimatedCostUsd} · {cert.leadWeeks}</span>
              </div>
              <p>{cert.reason}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="notice" style={{ marginTop: 12 }}>
          <span className="badge badge-success">LOW RISK</span>
          <span>未勾选特殊受限属性，当前仅需完成常规外观/商标侵权检索与基础材质合规确认。</span>
        </div>
      )}

      <div className="compliance-patent-bar">
        <div className="compliance-patent-links">
          {assessment.patentLinks.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="button secondary"
              title={link.note}
            >
              {link.label}
            </a>
          ))}
        </div>
        <label className="compliance-check-label">
          <input
            type="checkbox"
            checked={patentChecked}
            onChange={(e) => setPatentChecked(e.target.checked)}
          />
          <span>{patentChecked ? "已完成本品外观专利与商标库人工初查" : "确认：下单打样前已完成专利与商标初查"}</span>
        </label>
      </div>
    </section>
  );
}
