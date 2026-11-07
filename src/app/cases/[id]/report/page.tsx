import Link from "next/link";
import { notFound } from "next/navigation";
import { getCaseDetail, getContentDetail } from "@/lib/repository";
import { emptyListingContent, normalizeListingContent } from "@/lib/listing";
import { opportunityScore, recommendationFor } from "@/lib/economics";
import { money, percent } from "@/lib/format";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function CaseExecutiveReportPage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getCaseDetail(id);
  if (!detail) notFound();

  const contentDetail = await getContentDetail(id);
  const currentListing = contentDetail?.listing
    ? normalizeListingContent(contentDetail.listing.content)
    : emptyListingContent();

  const { productCase, costModel, evidence } = detail;
  const result = costModel?.results;
  const assumptions = costModel?.assumptions;
  const score = result
    ? opportunityScore(
        result,
        productCase.monthly_sales_estimate,
        productCase.review_count,
        productCase.evidence_score,
      )
    : 0;
  const recommendation = result ? recommendationFor(result, score) : "HOLD";

  // 提取 1688 RFQ 证据
  const rfqEvidence = evidence.find((e) => e.evidence_type === "supplier_rfq");
  const rfqPayload = (rfqEvidence?.payload || null) as {
    productName?: string;
    targetPriceRmb?: number;
    suggestedMoq?: string;
    criticalImprovements?: Array<{ component: string; painPointTargeted: string; manufacturingStandard: string }>;
    qualityStandard?: string[];
  } | null;

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", padding: "32px 24px" }}>
      {/* 顶部操作工具栏 (打印时自动隐藏) */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <Link
          href={`/cases/${id}`}
          style={{ fontSize: "13px", color: "var(--muted)", textDecoration: "none" }}
        >
          &larr; 返回商品案卷详情
        </Link>
        <div style={{ display: "flex", gap: "10px" }}>
          <a
            href={`/api/cases/${id}/flatfile`}
            className="button secondary"
            style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "8px" }}
          >
            📥 下载亚马逊 Flat File
          </a>
          <PrintButton />
        </div>
      </div>

      {/* 报告主排版容器 */}
      <article
        style={{
          background: "#ffffff",
          padding: "36px 40px",
          borderRadius: "14px",
          border: "1px solid var(--line)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.03)",
        }}
      >
        {/* 报表头部 */}
        <div
          style={{
            borderBottom: "2px solid var(--green)",
            paddingBottom: "20px",
            marginBottom: "24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ fontSize: "12px", color: "var(--green)", fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase" }}>
              AITrade · Product Investment Memo
            </div>
            <h1 style={{ margin: "6px 0 4px 0", fontSize: "22px", color: "var(--ink)", fontWeight: 900 }}>
              {productCase.title}
            </h1>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
              ASIN / SKU: <strong>{productCase.asin}</strong> · 站点: {productCase.marketplace} · 类目: {productCase.category} · 责任操盘手: {productCase.owner}
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div
              style={{
                display: "inline-block",
                padding: "6px 14px",
                borderRadius: "8px",
                background: recommendation === "GO" ? "var(--green-soft)" : "var(--amber-soft)",
                color: recommendation === "GO" ? "var(--green)" : "var(--amber)",
                fontWeight: 900,
                fontSize: "16px",
              }}
            >
              {recommendation} · {score} 分
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
              报告生成时间: {new Date().toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* 1. 财务经济与压力测试模型 */}
        <section style={{ marginBottom: "28px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 800, color: "var(--ink)", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>一、单位经济财务模型与压力保本核算</span>
          </h2>

          {result && assumptions ? (
            <div style={{ background: "#f9fbf9", borderRadius: "10px", border: "1px solid var(--line)", padding: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "14px", textAlign: "center" }}>
                <div style={{ background: "#ffffff", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>销售单价</div>
                  <strong style={{ fontSize: "15px", color: "var(--ink)" }}>{money(assumptions.salePriceCents)}</strong>
                </div>
                <div style={{ background: "#ffffff", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>到岸采购成本</div>
                  <strong style={{ fontSize: "15px", color: "var(--ink)" }}>{money(assumptions.landedCostCents)}</strong>
                </div>
                <div style={{ background: "#ffffff", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>单件净利润</div>
                  <strong style={{ fontSize: "15px", color: "var(--green)" }}>{money(result.netProfitCents)}</strong>
                </div>
                <div style={{ background: "#ffffff", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>基准净利率</div>
                  <strong style={{ fontSize: "15px", color: "var(--green)" }}>{percent(result.marginRate)}</strong>
                </div>
              </div>

              <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse", color: "var(--ink)" }}>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 8px", color: "var(--muted)" }}>FBA 配送履约费</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{money(assumptions.fbaFeeCents)}</td>
                    <td style={{ padding: "6px 8px", color: "var(--muted)" }}>压力测试保本单价 (Stress Break-Even)</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{money(result.stressProfitCents > 0 ? assumptions.salePriceCents * 0.85 : assumptions.salePriceCents)}</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 8px", color: "var(--muted)" }}>亚马逊佣金比率</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{percent(assumptions.referralRate)}</td>
                    <td style={{ padding: "6px 8px", color: "var(--muted)" }}>压力情景净利润 (降价15%+退货飙升)</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: result.stressProfitCents > 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                      {money(result.stressProfitCents)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 8px", color: "var(--muted)" }}>预估退货与损耗率</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{percent(assumptions.returnRate)}</td>
                    <td style={{ padding: "6px 8px", color: "var(--muted)" }}>预估月度利润贡献 (按月销{productCase.monthly_sales_estimate}件)</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 800, color: "var(--green)" }}>
                      {money(result.netProfitCents * productCase.monthly_sales_estimate)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ fontSize: "12px", color: "var(--muted)" }}>暂无成本核算模型</p>
          )}
        </section>

        {/* 2. 1688 供应链改良与工艺标准 */}
        {rfqPayload && (
          <section style={{ marginBottom: "28px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 800, color: "var(--ink)", marginBottom: "12px" }}>
              二、1688 工艺改良与采购定制标准
            </h2>
            <div style={{ background: "#fbfcfb", padding: "14px", borderRadius: "10px", border: "1px solid var(--line)", fontSize: "12px" }}>
              <div style={{ display: "flex", gap: "20px", marginBottom: "10px" }}>
                <span>采购品名: <strong>{rfqPayload.productName}</strong></span>
                <span>目标采购价: <strong>¥{rfqPayload.targetPriceRmb}</strong></span>
                <span>建议首单 MOQ: <strong>{rfqPayload.suggestedMoq}</strong></span>
              </div>

              {rfqPayload.criticalImprovements && rfqPayload.criticalImprovements.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ fontWeight: 700, color: "var(--muted)", marginBottom: "2px" }}>针对竞品痛点的工业工艺要求：</div>
                  {rfqPayload.criticalImprovements.map((item, idx) => (
                    <div key={idx} style={{ background: "#ffffff", padding: "8px 10px", borderRadius: "6px", border: "1px solid var(--line)" }}>
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>{idx + 1}. 部件: {item.component} (靶向痛点: {item.painPointTargeted})</div>
                      <div style={{ color: "var(--green)", marginTop: "2px" }}>标准要求: {item.manufacturingStandard}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* 3. 反制五点描述 (Listing Bullet Points) */}
        {currentListing && currentListing.bullets && currentListing.bullets.length > 0 && (
          <section style={{ marginBottom: "28px" }}>
            <h2 style={{ fontSize: "15px", fontWeight: 800, color: "var(--ink)", marginBottom: "12px" }}>
              三、差异化反制五点文案 (Counter-Bullets)
            </h2>
            <div style={{ background: "#ffffff", padding: "14px", borderRadius: "10px", border: "1px solid var(--line)", fontSize: "12px", lineHeight: "1.5" }}>
              <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>
                标题 (Title): {currentListing.title}
              </div>
              <ol style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "6px" }}>
                {currentListing.bullets.map((b, idx) => (
                  <li key={idx} style={{ color: "var(--ink)" }}>{b}</li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* 4. 签署决策盖章栏 */}
        <section style={{ borderTop: "1px solid var(--line)", paddingTop: "20px", marginTop: "32px", fontSize: "12px", color: "var(--muted)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "24px" }}>
            <div>
              <div>选品开发审核人：___________________</div>
              <div style={{ marginTop: "6px", fontSize: "11px" }}>意见：[ ] 同意立项  [ ] 需重新议价</div>
            </div>
            <div>
              <div>供应链采购确认：___________________</div>
              <div style={{ marginTop: "6px", fontSize: "11px" }}>打样周期：_____ 天 | 质检标准已确认</div>
            </div>
            <div>
              <div>运营负责人签批：___________________</div>
              <div style={{ marginTop: "6px", fontSize: "11px" }}>首批试单预算：___________________</div>
            </div>
          </div>
        </section>
      </article>

      {/* 打印专用样式 */}
      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: #ffffff !important;
          }
          article {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
