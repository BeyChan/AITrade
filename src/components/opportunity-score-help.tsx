"use client";

import { useState } from "react";

type Props = {
  score?: number;
  inline?: boolean;
};

export function OpportunityScoreHelp({ score, inline = false }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ display: "inline-flex", alignItems: "center" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          padding: "2px 6px",
          color: "var(--green)",
          fontSize: "12px",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          textDecoration: "underline",
        }}
        title="查看机会分计算逻辑与商品指数的关系"
      >
        <span>ℹ️ 机会分说明</span>
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
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "grid",
            placeItems: "center",
            padding: "20px",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              padding: "24px 28px",
              maxWidth: "560px",
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              position: "relative",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
              <div>
                <span className="eyebrow" style={{ color: "var(--green)" }}>量化指标说明</span>
                <h3 style={{ margin: "4px 0 0 0", fontSize: "18px", fontWeight: 800 }}>
                  机会分 (Opportunity Score) 计算体系
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
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

            <div style={{ fontSize: "13px", lineHeight: "1.6", color: "var(--ink)", marginBottom: "16px" }}>
              <div style={{ background: "#f8faf8", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "12px" }}>
                <strong style={{ color: "var(--green)" }}>📐 机会分 (0～100 分) 的确定性计算公式：</strong>
                <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px", fontSize: "12px" }}>
                  <li><strong>净利率得分 (40分)：</strong>净利率越高得分越高（30% 净利率为基准满分）</li>
                  <li><strong>单件净利得分 (20分)：</strong>单件绝对盈利金额（$30 净利为满分）</li>
                  <li><strong>市场动销得分 (15分)：</strong>月销量预估规模（月销 2,000 件为满分）</li>
                  <li><strong>证据完整度 (15分)：</strong>参数与核验证据链的完整性得分</li>
                  <li><strong>竞争扣分 (扣 0~10分)：</strong>根据竞品评论数做扣除（避免陷入高评论竞争）</li>
                </ul>
                <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--muted)" }}>
                  ★ <strong>决策门槛：</strong>得分 <strong>≥ 65 分</strong> 且 <strong>净利率 ≥ 18%</strong> 时系统判定为 <strong>GO</strong>。
                </div>
              </div>

              <div style={{ background: "var(--green-soft)", padding: "12px 14px", borderRadius: "10px", border: "1px solid rgba(31, 122, 85, 0.2)" }}>
                <strong style={{ color: "var(--green)" }}>🔄 它与「商品指数 (Product Index)」的关系：</strong>
                <div style={{ fontSize: "12px", marginTop: "4px" }}>
                  <div><strong>• 商品指数 (竞品对比页面)：</strong>解决的是<em>“在外部看对手，这个品类卷不卷、有没有切入胜算”</em>（考核 HHI 集中度、评论对数阻力、差评痛点缺口）。</div>
                  <div style={{ marginTop: "4px" }}><strong>• 机会分 (当前商品详情页)：</strong>解决的是<em>“拿到工厂真实报价后，算清账目看能不能真赚钱”</em>（考核到岸成本、海运 FBA 费、扣除广告后的净利润）。</div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
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
