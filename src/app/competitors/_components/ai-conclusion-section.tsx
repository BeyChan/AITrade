"use client";

import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import { shortDate } from "@/lib/format";

type Props = {
  currentReport: CompetitorComparisonReport;
  isGeneratingConclusion: boolean;
  handleGenerateConclusion: () => void;
};

export function AiConclusionSection({
  currentReport,
  isGeneratingConclusion,
  handleGenerateConclusion,
}: Props) {
  return (
          <section id="section-conclusion" className="panel" style={{ padding: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
              <div>
                <div className="eyebrow" style={{ color: "var(--green)" }}>AI DECISION CONCLUSION · 手动触发</div>
                <h4 style={{ margin: "2px 0 0 0", fontSize: "17px", color: "var(--ink)", fontWeight: 800 }}>
                  AI 综合结论与立项裁决
                </h4>
              </div>
              <button
                type="button"
                className={currentReport.aiConclusion ? "button secondary" : "button primary"}
                disabled={isGeneratingConclusion}
                onClick={handleGenerateConclusion}
                style={{ fontSize: "12px", padding: "7px 14px", height: "34px", borderRadius: "10px" }}
              >
                {isGeneratingConclusion
                  ? "AI 正在综合研判中..."
                  : currentReport.aiConclusion
                    ? "🔄 重新生成 AI 结论"
                    : "✨ 生成 AI 综合结论"}
              </button>
            </div>

            {!currentReport.aiConclusion ? (
              <div
                style={{
                  padding: "20px",
                  borderRadius: "12px",
                  background: "var(--surface-subtle)",
                  border: "1px dashed var(--line)",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: "13px",
                  lineHeight: 1.6,
                }}
              >
                当前暂无 AI 综合结论（默认不自动生成，避免无意义消耗额度）。<br />
                建议补齐 1688 进价与买家差评后，点击右上角 <strong>「✨ 生成 AI 综合结论」</strong> 获取最终 GO / HOLD / NO-GO 研判。
              </div>
            ) : (() => {
              const c = currentReport.aiConclusion;
              const verdictBadge =
                c.verdict === "GO"
                  ? "badge-success"
                  : c.verdict === "NO-GO"
                    ? "badge-danger"
                    : "badge-warn";
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div
                    style={{
                      padding: "16px 18px",
                      borderRadius: "12px",
                      background: "var(--surface-subtle)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
                      <span className={`badge ${verdictBadge}`} style={{ fontSize: "13px", fontWeight: 800, padding: "3px 10px" }}>
                        AI 裁决：{c.verdict}
                      </span>
                      <strong style={{ fontSize: "15px", color: "var(--ink)" }}>{c.headline}</strong>
                      {c.bestCandidateAsin ? (
                        <span className="badge badge-neutral mono" style={{ fontSize: "11px" }}>
                          推荐对标：{c.bestCandidateAsin}
                        </span>
                      ) : null}
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--ink)", lineHeight: 1.65 }}>
                      {c.summary}
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                    {c.keyRisks.length > 0 ? (
                      <div style={{ padding: "14px 16px", borderRadius: "12px", background: "var(--red-soft)", border: "1px solid rgba(161, 61, 57, 0.2)" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--red)", marginBottom: "6px" }}>
                          ⚠️ 核心风险与证据缺口
                        </div>
                        <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "var(--ink)", lineHeight: 1.55 }}>
                          {c.keyRisks.map((risk, idx) => (
                            <li key={idx} style={{ marginBottom: "3px" }}>{risk}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {c.recommendedActions.length > 0 ? (
                      <div style={{ padding: "14px 16px", borderRadius: "12px", background: "var(--green-soft)", border: "1px solid rgba(31, 122, 85, 0.25)" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "6px" }}>
                          ✅ 下一步可执行动作
                        </div>
                        <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "var(--ink)", lineHeight: 1.55 }}>
                          {c.recommendedActions.map((act, idx) => (
                            <li key={idx} style={{ marginBottom: "3px" }}>{act}</li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </div>

                  <div style={{ fontSize: "11px", color: "var(--muted)", textAlign: "right" }}>
                    生成模型：{c.modelUsed} · {shortDate(c.generatedAt)}
                  </div>
                </div>
              );
            })()}
          </section>
  );
}
