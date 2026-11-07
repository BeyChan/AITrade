"use client";

import { useEffect, useState } from "react";

export function OpportunityScoreHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div style={{ display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        className="button ghost"
        onClick={() => setOpen(true)}
        style={{ fontSize: "12px", padding: "4px 10px", textDecoration: "none" }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        ℹ️ 指标说明
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 9999,
            display: "grid",
            placeItems: "center",
            padding: "20px",
          }}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="选品分与商品指数说明"
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              padding: "24px 28px",
              maxWidth: "580px",
              width: "100%",
              maxHeight: "86vh",
              overflowY: "auto",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
              <div>
                <span className="eyebrow" style={{ color: "var(--green)" }}>量化指标说明</span>
                <h3 style={{ margin: "4px 0 0 0", fontSize: "18px" }}>选品分与商品指数</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭说明"
                style={{
                  background: "#f0f4f1",
                  border: "none",
                  borderRadius: "50%",
                  width: "28px",
                  height: "28px",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  fontSize: "16px",
                  color: "var(--muted)",
                }}
              >
                &times;
              </button>
            </div>

            <div style={{ fontSize: "13px", lineHeight: "1.6" }}>
              <div style={{ background: "#f8faf8", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "12px" }}>
                <strong style={{ color: "var(--green)" }}>机会分（列表里的「选品分」，0～100）</strong>
                <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px", fontSize: "12px" }}>
                  <li><strong>净利率得分（40 分）：</strong>30% 净利率为满分基准</li>
                  <li><strong>单件净利得分（20 分）：</strong>$30 净利为满分</li>
                  <li><strong>市场动销得分（15 分）：</strong>月销 2,000 件为满分</li>
                  <li><strong>证据完整度（15 分）：</strong>参数与核验证据链完整性</li>
                  <li><strong>竞争扣分（0～10 分）：</strong>按竞品评论数扣减</li>
                </ul>
              </div>

              <div style={{ background: "#fff8f0", padding: "12px 14px", borderRadius: "10px", border: "1px solid #efd9bd", marginBottom: "12px", fontSize: "12px" }}>
                <strong>GO 不是「分数够高」就能拿到。</strong>系统会逐项检查门禁：机会分 ≥65、已核实竞品证据 ≥20（AI / 模板素材不算）、差评样本 ≥50、供应商 ≥3、报价 ≥3、证据完整度 ≥80、净利率 ≥18%、样品评分 ≥80、MOQ ≤500、交期 ≤30 天、非 USD 需录入可追溯汇率等。<strong>全部通过才是 GO</strong>；出现净利率不足、压力利润 ≤0、专利或物流阻断等硬失败直接 NO-GO；其余为 HOLD。机会分只是其中一项。
              </div>

              <div style={{ background: "var(--green-soft)", padding: "12px 14px", borderRadius: "10px", border: "1px solid rgba(31, 122, 85, 0.2)", fontSize: "12px" }}>
                <strong style={{ color: "var(--green)" }}>商品指数（竞品对比工作台，0～100）</strong>
                <div style={{ marginTop: "4px" }}>
                  用 HHI 集中度、评论对数阻力、价格变异系数与贝叶斯评分描述「这个赛道卷不卷」，<strong>仅供选品参考，不参与 GO 判定</strong>。两个分数回答的是不同问题，不能互相替代。
                </div>
                <div style={{ marginTop: "6px", color: "var(--muted)" }}>
                  AI 或本地模板生成的竞品价格、评分、评论数会标注「待核实」，不计入价格分位，也不计入竞品门禁；只有人工录入或浏览器采集并确认的证据才参与计算。
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
              <button
                type="button"
                className="button primary"
                onClick={() => setOpen(false)}
                style={{ fontSize: "12px", padding: "6px 16px", borderRadius: "8px" }}
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
