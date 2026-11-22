"use client";

import Link from "next/link";
import type { AntiListingResult } from "@/lib/competitor-compare/anti-listing";
import { countDraftPlaceholders } from "./helpers";

type AvailableCaseOption = { id: string; title: string; asin: string | null };

type Props = {
  antiListing: AntiListingResult;
  bulletsCopied: boolean;
  availableCases: AvailableCaseOption[];
  selectedCaseId: string;
  isApplyingCase: boolean;
  isConfirmed: boolean;
  appliedSuccessCaseId: string | null;
  applyFindings: Array<{ severity: string; message: string }>;
  onCopyBulletsText: (data: AntiListingResult) => void;
  onClose: () => void;
  onSelectCaseId: (id: string) => void;
  onApplyToCase: () => void;
};

export function AntiListingPanel({
  antiListing,
  bulletsCopied,
  availableCases,
  selectedCaseId,
  isApplyingCase,
  isConfirmed,
  appliedSuccessCaseId,
  applyFindings,
  onCopyBulletsText,
  onClose,
  onSelectCaseId,
  onApplyToCase,
}: Props) {
  return (
    <section className="panel" style={{ padding: "24px", background: "var(--surface-subtle)", border: "1.5px solid var(--green)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--green)" }}>ANTI-COMPETITOR LISTING STUDIO · 反制竞品内容</div>
          <h4 style={{ margin: "4px 0 0 0", fontSize: "17px", color: "var(--ink)", fontWeight: 800 }}>
            规避差评痛点 · 差异化五点描述草稿 (Bullet Points)
          </h4>
          <p style={{ margin: "4px 0 0 0", color: "var(--muted)", fontSize: "12px" }}>
            针对买家差评给出改良方向草稿；认证、测试次数、性能倍数、保修等一律以占位呈现，须在打样与检测后据实替换才可发布。
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="button primary"
            onClick={() => onCopyBulletsText(antiListing)}
            style={{ fontSize: "12px", padding: "5px 12px", height: "32px", borderRadius: "8px" }}
          >
            {bulletsCopied ? "✅ 已复制五点文案" : "📋 复制完整五点描述"}
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

      {countDraftPlaceholders(antiListing) > 0 && (
        <div
          className="result-box warning"
          role="status"
          style={{ marginBottom: "16px", fontSize: "12px", lineHeight: "1.5" }}
        >
          <strong>待核实占位：{countDraftPlaceholders(antiListing)} 处。</strong>{" "}
          这是一份文案骨架，不是可直接发布的成品。所有 [VERIFY: …] 需按打样实测、检测报告与平台合规要求填实；含占位的文案只能作为内部草稿保存，不得直接上架或对外投放。
        </div>
      )}

      {/* 反制标题 */}
      <div style={{ background: "var(--paper)", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "16px" }}>
        <div style={{ fontSize: "12px", color: "var(--green)", fontWeight: 700, marginBottom: "4px" }}>
          ✦ 推荐差异化商品标题 (Anti-Title):
        </div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", lineHeight: "1.4" }}>
          {antiListing.antiTitle}
        </div>
      </div>

      {/* 5 条靶向反制五点 */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)" }}>五点描述靶向拆解：</div>
        {antiListing.bullets.map((b, idx) => (
          <div
            key={idx}
            style={{
              background: "var(--paper)",
              padding: "12px 14px",
              borderRadius: "10px",
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
              <strong style={{ fontSize: "12px", color: "var(--green)" }}>{b.headline}</strong>
              <span
                style={{
                  fontSize: "12px",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "var(--red-soft)",
                  color: "var(--red)",
                  fontWeight: 600,
                }}
              >
                🎯 {b.counterTarget}
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "var(--ink)", lineHeight: "1.5" }}>
              {b.content}
            </div>
          </div>
        ))}
      </div>

      {/* 3 个 A+ 差异化对比模块 */}
      {antiListing.aplusModules && antiListing.aplusModules.length > 0 && (
        <div style={{ background: "var(--surface-subtle)", padding: "14px", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>
            🖼️ A+ 页面差异化模块构想（只描述本品，不贬损竞品）：
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
            {antiListing.aplusModules.map((m, mi) => (
              <div key={mi} style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "12px" }}>
                <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: "3px" }}>{m.title}</div>
                <div style={{ color: "var(--muted)", marginBottom: "4px" }}>{m.description}</div>
                <div style={{ color: "var(--green)", fontStyle: "italic" }}>💡 构图: {m.visualSuggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 业务打通：一键写入选品商品 Listing 草稿 */}
      <div
        style={{
          background: "var(--paper)",
          padding: "14px 16px",
          borderRadius: "10px",
          border: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "2px" }}>
            📥 一键写入商品 Listing 草稿
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)" }}>
            将本套反制文案直接沉淀到商品库（自动生成新的文案版本，可随时在商品详情页微调与导出）：
          </div>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {availableCases.length > 0 ? (
            <>
              <select
                value={selectedCaseId}
                onChange={(e) => onSelectCaseId(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  fontSize: "12px",
                  background: "var(--surface-subtle)",
                  color: "var(--ink)",
                  maxWidth: "260px",
                }}
              >
                {availableCases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.asin || "新产品"})
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button primary"
                disabled={isApplyingCase || !selectedCaseId || !isConfirmed}
                title={isConfirmed ? "写入商品草稿（保留原品牌与搜索词）" : "请先在研报标题栏点击「我已核对，确认可用」"}
                onClick={onApplyToCase}
                style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "8px" }}
              >
                {isApplyingCase ? "写入中..." : isConfirmed ? "确认写入商品" : "需先核对研报"}
              </button>
            </>
          ) : (
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>当前站点暂无已立项商品</span>
          )}
          {appliedSuccessCaseId && (
            <Link
              href={`/cases/${appliedSuccessCaseId}/content`}
              className="button secondary"
              style={{ fontSize: "12px", padding: "6px 12px", height: "34px", borderRadius: "8px", color: "var(--green)" }}
            >
              前往商品详情 &rarr;
            </Link>
          )}
        </div>
        {applyFindings.length > 0 && (
          <div
            className="result-box warning"
            style={{ marginTop: "12px", fontSize: "12px", lineHeight: "1.5" }}
            role="status"
          >
            <strong>发布预检结果（写入的是草稿，尚未发布）：</strong>
            <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px" }}>
              {applyFindings.map((finding, i) => (
                <li key={i} style={{ color: finding.severity === "error" ? "var(--red)" : "var(--ink)" }}>
                  [{finding.severity === "error" ? "阻断" : "提示"}] {finding.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
