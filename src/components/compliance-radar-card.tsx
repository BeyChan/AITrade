import type { ComplianceRadarResult } from "@/lib/compliance-radar";

export function ComplianceRadarCard({ radar }: { radar: ComplianceRadarResult }) {
  const isSafe = radar.passed && radar.criticalCount === 0;

  return (
    <section
      className="section"
      style={{
        border: isSafe ? "1px solid var(--line)" : "1.5px solid var(--red)",
        background: isSafe ? "#ffffff" : "#fdfbfb",
        borderRadius: "14px",
        padding: "20px",
        marginBottom: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "14px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              className="eyebrow"
              style={{ color: isSafe ? "var(--green)" : "var(--red)", fontWeight: 800, margin: 0, lineHeight: 1 }}
            >
              RISK RADAR SHIELD · 侵权与合规安全盾
            </span>
            <span
              className={`badge ${isSafe ? "badge-success" : "badge-danger"}`}
              style={{ fontSize: "11px", margin: 0, lineHeight: 1, display: "inline-flex", alignItems: "center" }}
            >
              {isSafe ? "合规排查通过" : `发现 ${radar.criticalCount} 处高危风险`}
            </span>
          </div>
          <h3 style={{ margin: "4px 0 0 0", fontSize: "16px", color: "var(--ink)", fontWeight: 800 }}>
            Listing 竞品商标侵权与亚马逊违禁敏感词自检
          </h3>
          <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
            自动排查 24+ 知名竞品 Trademark、医疗化/FDA 宣称、农药杀菌词（FIFRA 误杀高发区）与站外引流词。
          </p>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "24px",
              fontWeight: 900,
              color: isSafe ? "var(--green)" : "var(--red)",
              lineHeight: 1,
            }}
          >
            {radar.score} <span style={{ fontSize: "12px", fontWeight: 600 }}>分</span>
          </div>
          <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
            {radar.criticalCount} 阻断 · {radar.warningCount} 提醒
          </div>
        </div>
      </div>

      <div
        style={{
          fontSize: "12px",
          padding: "10px 14px",
          borderRadius: "8px",
          background: isSafe ? "var(--green-soft)" : "var(--red-soft)",
          color: isSafe ? "var(--green)" : "var(--red)",
          lineHeight: "1.5",
          marginBottom: radar.findings.length > 0 ? "14px" : "0",
        }}
      >
        <strong>诊断结论：</strong> {radar.summary}
      </div>

      {radar.findings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {radar.findings.map((f) => {
            const isCrit = f.riskLevel === "critical";
            const fieldLabel =
              f.field === "title"
                ? "商品标题"
                : f.field === "bullets"
                ? `五点卖点 (第 ${f.fieldIndex} 条)`
                : f.field === "description"
                ? "商品描述"
                : "后台搜索词";

            return (
              <div
                key={f.id}
                style={{
                  background: "#ffffff",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: isCrit ? "1px solid rgba(161, 61, 57, 0.3)" : "1px solid var(--line)",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: isCrit ? "var(--red)" : "var(--amber)",
                        color: "#ffffff",
                      }}
                    >
                      {isCrit ? "高危阻断" : "合规预警"}
                    </span>
                    <strong style={{ color: "var(--ink)" }}>触发词: &quot;{f.word}&quot;</strong>
                    <span style={{ color: "var(--muted)", fontSize: "11px" }}>（位于 {fieldLabel}）</span>
                  </div>
                </div>

                <div style={{ color: "var(--ink)", marginBottom: "4px", lineHeight: "1.4" }}>
                  {f.reason}
                </div>

                {f.suggestedReplacement && (
                  <div style={{ fontSize: "11px", color: "var(--green)", fontWeight: 600 }}>
                    💡 建议合规替换为: <span style={{ textDecoration: "underline" }}>{f.suggestedReplacement}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
