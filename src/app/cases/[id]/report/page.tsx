import Link from "next/link";
import { notFound } from "next/navigation";
import { getCaseDetail, getContentDetail } from "@/lib/repository";
import { CaseStepper } from "@/components/case-stepper";
import { StatusBadge } from "@/components/badges";
import { PageHeader } from "@/components/ui";
import { deriveCaseWorkflowSnapshot } from "@/lib/case-stage";
import { emptyListingContent, normalizeListingContent } from "@/lib/listing";
import { evaluateDecisionStage, opportunityScore, recommendationFor } from "@/lib/economics";
import { money, percent } from "@/lib/format";
import { getAppMode } from "@/lib/app-mode";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function CaseExecutiveReportPage({ params }: PageProps) {
  const { id } = await params;
  const [detail, appMode] = await Promise.all([getCaseDetail(id), getAppMode()]);
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
  const hasRealCompetitorEvidence =
    productCase.competitor_price_cents > 0 &&
    evidence.some((e) =>
      ["marketplace", "bulk_text_import", "manual_verified", "captured", "competitor_capture", "csv_import"].includes(
        String((e as { source_type?: string }).source_type ?? e.evidence_type ?? ""),
      ) || Boolean(e.evidence_type),
    );
  const gate =
    result && assumptions
      ? evaluateDecisionStage({
          assumptions,
          results: result,
          score,
          hasVerifiedSupplierQuote: detail.validQuoteCount > 0,
          hasRealCompetitorEvidence,
        })
      : null;
  const recommendation = gate ? gate.recommendation : result ? recommendationFor(result, score) : "HOLD";
  const workflow = deriveCaseWorkflowSnapshot({
    caseId: productCase.id,
    status: productCase.status,
    recommendation: result ? recommendationFor(result, score) : "HOLD",
    hasNoGoException: detail.hasNoGoException,
    hasCostModel: Boolean(costModel),
    quoteCount: detail.quoteCount,
    validQuoteCount: detail.validQuoteCount,
    hasSupplierSelection: detail.hasSupplierSelection,
    approvedMainImageCount: detail.approvedMainImageCount,
    hasApprovedContent: detail.hasApprovedContent,
    listingStatus: contentDetail?.listing?.status ?? null,
    hasFlatFileExported: detail.hasFlatFileExported,
    hasMediaPackExported: detail.hasMediaPackExported,
  });

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
    <div className="page">
      <PageHeader
        className="no-print"
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "商品案卷", href: "/cases" },
          { label: productCase.asin, href: `/cases/${productCase.id}` },
          { label: "决策战报" },
        ]}
        eyebrow="立项评审报告 / PDF"
        title={productCase.title}
        meta={
          <>
            <StatusBadge status={productCase.status} />
            <span className="badge badge-neutral">{productCase.marketplace}</span>
            <span className="badge badge-neutral">{productCase.category}</span>
            <span className="muted">
              ASIN: <strong>{productCase.asin}</strong> · 责任操盘手: {productCase.owner}
            </span>
          </>
        }
        actions={
          <>
            <Link href={`/cases/${id}`} className="button secondary">
              返回商品案卷
            </Link>
            {workflow.permissions.canExportDeliveryPack ? (
              <a
                href={`/api/cases/${id}/flatfile`}
                className="button secondary"
                download
              >
                📥 下载 Flat File
              </a>
            ) : null}
            <PrintButton />
          </>
        }
      />

      <div className="no-print" style={{ marginBottom: "20px" }}>
        <CaseStepper
          caseId={productCase.id}
          status={productCase.status}
          recommendation={result ? recommendationFor(result, score) : "HOLD"}
          hasNoGoException={detail.hasNoGoException}
          hasCostModel={Boolean(costModel)}
          quoteCount={detail.quoteCount}
          validQuoteCount={detail.validQuoteCount}
          hasSupplierSelection={detail.hasSupplierSelection}
          approvedMainImageCount={detail.approvedMainImageCount}
          hasApprovedContent={detail.hasApprovedContent}
          listingStatus={contentDetail?.listing?.status ?? null}
          hasFlatFileExported={detail.hasFlatFileExported}
          hasMediaPackExported={detail.hasMediaPackExported}
          allowDemoBypass={appMode === "sandbox" || productCase.is_demo}
        />
      </div>

      {/* 4. 战报主排版容器 (作为标准 panel 满宽融入页面排版) */}
      <article
        className="panel report-memo-sheet"
        style={{
          background: "var(--paper)",
          padding: "40px 48px",
          borderRadius: "12px",
          border: "1px solid var(--line)",
        }}
      >
        {/* 战报头部标题与评审评级 */}
        <div
          style={{
            borderBottom: "2px solid var(--green)",
            paddingBottom: "20px",
            marginBottom: "28px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "12px",
                color: "var(--green)",
                fontWeight: 800,
                letterSpacing: "1.2px",
                textTransform: "uppercase",
              }}
            >
              AITrade · Product Investment Memo
            </div>
            <h2
              style={{
                margin: "8px 0 6px 0",
                fontSize: "22px",
                color: "var(--ink)",
                fontWeight: 900,
                letterSpacing: "-0.01em",
              }}
            >
              {productCase.title}
            </h2>
            <div style={{ fontSize: "13px", color: "var(--muted)" }}>
              ASIN / SKU: <strong style={{ color: "var(--ink)" }}>{productCase.asin}</strong> · 目标站点:{" "}
              <strong>{productCase.marketplace}</strong> · 类目: <strong>{productCase.category}</strong> · 责任操盘手:{" "}
              <strong>{productCase.owner}</strong>
            </div>
          </div>

          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "24px" }}>
            {/* 落章式判定：战报是拿去签批的纸质单据，这一处允许大声，
                三态三色，NO-GO 用印泥朱红。改造前 GO 与其余两态是二元三元，NO-GO 与 HOLD 同色。 */}
            <div
              className={`memo-stamp ${
                recommendation === "GO"
                  ? "is-go"
                  : recommendation === "NO-GO"
                    ? "is-no-go"
                    : "is-hold"
              }`}
            >
              {recommendation} · {score} 分
            </div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "6px" }}>
              战报生成日期: {new Date().toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* 老板一页决策摘要卡（两段式门禁 + 操盘手核心红线） */}
        {result && assumptions && gate ? (
          <section
            style={{
              marginBottom: "28px",
              padding: "16px 20px",
              borderRadius: "10px",
              border: "1px solid var(--line)",
              background: "var(--canvas)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
              <strong style={{ fontSize: "14px", color: "var(--ink)" }}>核心决策摘要（两段式立项门禁）</strong>
              <span
                className={`badge ${gate.stage === "verified" ? "badge-success" : "badge-warn"}`}
                style={{ fontSize: "12px" }}
              >
                {gate.stageLabel}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: "12px",
              }}
            >
              <div style={{ padding: "10px 12px", background: "var(--paper)", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>稳态净利率（18% 门禁）</div>
                <strong style={{ fontSize: "18px", fontFamily: "var(--font-mono)", color: result.marginRate >= 0.18 ? "var(--green)" : "var(--red)" }}>
                  {percent(result.marginRate)}
                </strong>
              </div>
              <div style={{ padding: "10px 12px", background: "var(--paper)", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>盈亏平衡 ACoS（广告红线）</div>
                <strong style={{ fontSize: "18px", fontFamily: "var(--font-mono)", color: "var(--ink)" }}>
                  {percent(result.breakEvenAdRate)}
                </strong>
              </div>
              <div style={{ padding: "10px 12px", background: "var(--paper)", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>压测净利率（价-10%/本+20%）</div>
                <strong style={{ fontSize: "18px", fontFamily: "var(--font-mono)", color: result.stressMarginRate > 0 ? "var(--green)" : "var(--red)" }}>
                  {percent(result.stressMarginRate)}
                </strong>
              </div>
              <div style={{ padding: "10px 12px", background: "var(--paper)", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>18% 门禁最高允许到岸成本</div>
                <strong style={{ fontSize: "18px", fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                  {gate.maxLandedAchievable ? money(gate.maxLandedCostCents) : "当前售价无解"}
                </strong>
              </div>
            </div>

            {gate.blockedReasons.length > 0 ? (
              <div
                style={{
                  marginTop: "12px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "var(--amber-soft)",
                  border: "1px solid var(--amber)",
                  fontSize: "12px",
                  color: "var(--ink)",
                }}
              >
                <strong>正式 GO 门禁阻断原因：</strong>
                {gate.blockedReasons.join("；")}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* 一、财务经济与压力测试模型 */}
        <section style={{ marginBottom: "32px" }}>
          <h2
            style={{
              fontSize: "16px",
              fontWeight: 800,
              color: "var(--ink)",
              marginBottom: "14px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>一、单位经济财务模型与压力保本核算</span>
          </h2>

          {result && assumptions ? (
            <div
              style={{
                background: "var(--surface-subtle)",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                padding: "18px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: "14px",
                  marginBottom: "16px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    background: "var(--paper)",
                    padding: "12px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "2px" }}>销售单价</div>
                  <strong style={{ fontSize: "17px", color: "var(--ink)" }}>{money(assumptions.salePriceCents)}</strong>
                </div>
                <div
                  style={{
                    background: "var(--paper)",
                    padding: "12px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "2px" }}>到岸采购成本</div>
                  <strong style={{ fontSize: "17px", color: "var(--ink)" }}>{money(assumptions.landedCostCents)}</strong>
                </div>
                <div
                  style={{
                    background: "var(--paper)",
                    padding: "12px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "2px" }}>测算单件净利</div>
                  <strong style={{ fontSize: "17px", color: "var(--green)" }}>{money(result.netProfitCents)}</strong>
                </div>
                <div
                  style={{
                    background: "var(--paper)",
                    padding: "12px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                  }}
                >
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "2px" }}>基准净利率</div>
                  <strong style={{ fontSize: "17px", color: "var(--green)" }}>{percent(result.marginRate)}</strong>
                </div>
              </div>

              <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", color: "var(--ink)" }}>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px", color: "var(--muted)", width: "22%" }}>FBA 配送履约费</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, width: "18%" }}>
                      {money(assumptions.fbaFeeCents)}
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--muted)", width: "35%" }}>
                      压力测试保本单价 (Stress Break-Even)
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, width: "25%" }}>
                      {money(
                        result.stressProfitCents > 0
                          ? assumptions.salePriceCents * 0.85
                          : assumptions.salePriceCents,
                      )}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px", color: "var(--muted)" }}>平台佣金费率</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>
                      {percent(assumptions.referralRate)}
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--muted)" }}>极限抗压净利 (降价15% + 退货飙升)</td>
                    <td
                      style={{
                        padding: "8px 10px",
                        textAlign: "right",
                        color: result.stressProfitCents > 0 ? "var(--green)" : "var(--red)",
                        fontWeight: 700,
                      }}
                    >
                      {money(result.stressProfitCents)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 10px", color: "var(--muted)" }}>预估退货与损耗率</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>
                      {percent(assumptions.returnRate)}
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--muted)" }}>
                      预估月度利润贡献 (按月销 {productCase.monthly_sales_estimate} 件)
                    </td>
                    <td
                      style={{
                        padding: "8px 10px",
                        textAlign: "right",
                        fontWeight: 800,
                        color: "var(--green)",
                        fontSize: "14px",
                      }}
                    >
                      {money(result.netProfitCents * productCase.monthly_sales_estimate)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                padding: "20px",
                background: "var(--surface-subtle)",
                borderRadius: "8px",
                border: "1px dashed var(--line)",
                fontSize: "13px",
                color: "var(--muted)",
              }}
            >
              暂无已核准的成本核算模型。请在寻源阶段录入供应商报价并完成定标审批。
            </div>
          )}
        </section>

        {/* 二、1688 供应链改良与工艺标准 (永不断号) */}
        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", marginBottom: "14px" }}>
            二、1688 工艺改良与采购定制标准
          </h2>
          {rfqPayload ? (
            <div
              style={{
                background: "var(--surface-subtle)",
                padding: "16px 18px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                fontSize: "13px",
                color: "var(--ink)",
              }}
            >
              <div style={{ display: "flex", gap: "24px", marginBottom: "12px", flexWrap: "wrap" }}>
                <span>
                  采购品名: <strong>{rfqPayload.productName}</strong>
                </span>
                <span>
                  目标采购价: <strong>¥{rfqPayload.targetPriceRmb}</strong>
                </span>
                <span>
                  建议首单 MOQ: <strong>{rfqPayload.suggestedMoq}</strong>
                </span>
              </div>

              {rfqPayload.criticalImprovements && rfqPayload.criticalImprovements.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontWeight: 700, color: "var(--muted)", marginBottom: "2px" }}>
                    针对竞品痛点的工业工艺要求：
                  </div>
                  {rfqPayload.criticalImprovements.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: "var(--paper)",
                        padding: "10px 12px",
                        borderRadius: "6px",
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                        {idx + 1}. 部件: {item.component} (靶向痛点: {item.painPointTargeted})
                      </div>
                      <div style={{ color: "var(--green)", marginTop: "4px" }}>
                        标准要求: {item.manufacturingStandard}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: "18px 20px",
                background: "var(--surface-subtle)",
                borderRadius: "8px",
                border: "1px dashed var(--line)",
                fontSize: "13px",
                color: "var(--muted)",
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: "4px" }}>
                待补充供应链工艺定制标准
              </div>
              当前案卷暂未生成 1688 RFQ 结构化工艺要求。可在「供应商寻源」阶段提取竞品差评并生成针对性模具改良与验厂质检标准。
            </div>
          )}
        </section>

        {/* 三、差异化反制五点文案 (Listing Bullet Points) (永不断号) */}
        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", marginBottom: "14px" }}>
            三、差异化反制五点文案 (Counter-Bullets)
          </h2>
          {currentListing && (currentListing.title?.trim() || currentListing.bullets?.some((b) => b.trim().length > 0)) ? (
            <div
              style={{
                background: "var(--surface-subtle)",
                padding: "16px 20px",
                borderRadius: "10px",
                border: "1px solid var(--line)",
                fontSize: "13px",
                lineHeight: "1.6",
              }}
            >
              <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: "10px", fontSize: "14px" }}>
                标题 (Title): {currentListing.title || "待填写"}
              </div>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: "20px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {currentListing.bullets
                  .filter((b) => b.trim().length > 0)
                  .map((b, idx) => (
                    <li key={idx} style={{ color: "var(--ink)" }}>
                      {b}
                    </li>
                  ))}
              </ol>
            </div>
          ) : (
            <div
              style={{
                padding: "18px 20px",
                background: "var(--surface-subtle)",
                borderRadius: "8px",
                border: "1px dashed var(--line)",
                fontSize: "13px",
                color: "var(--muted)",
              }}
            >
              <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: "4px" }}>文案正在打磨中</div>
              尚未定稿反制五点文案。可在「文案与视觉」工作台由 AI 针对竞品差评缺口生成结构化文案草稿。
            </div>
          )}
        </section>

        {/* 四、签署决策盖章栏 */}
        <section
          style={{
            borderTop: "1px solid var(--line)",
            paddingTop: "24px",
            marginTop: "36px",
            fontSize: "13px",
            color: "var(--muted)",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "28px" }}>
            <div>
              <div style={{ color: "var(--ink)", fontWeight: 600 }}>选品开发审核人：___________________</div>
              <div style={{ marginTop: "8px", fontSize: "12px" }}>意见：[ ] 同意立项 [ ] 需重新议价</div>
            </div>
            <div>
              <div style={{ color: "var(--ink)", fontWeight: 600 }}>供应链采购确认：___________________</div>
              <div style={{ marginTop: "8px", fontSize: "12px" }}>打样周期：_____ 天 | 质检标准已确认</div>
            </div>
            <div>
              <div style={{ color: "var(--ink)", fontWeight: 600 }}>运营负责人签批：___________________</div>
              <div style={{ marginTop: "8px", fontSize: "12px" }}>首批试单预算：___________________</div>
            </div>
          </div>
        </section>
      </article>

      {/* 打印专用样式：仅打印 / 导出 PDF 时强制白纸黑字 */}
      <style>{`
        @media print {
          :root,
          html[data-theme="dark"] {
            --paper: #ffffff !important;
            --surface-subtle: #f8fafc !important;
            --canvas: #f8fafc !important;
            --ink: #0f172a !important;
            --muted: #526071 !important;
            --line: #e2e8f0 !important;
          }
          .no-print {
            display: none !important;
          }
          body {
            background: #ffffff !important;
            color: #0f172a !important;
            padding: 0 !important;
          }
          .page {
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          article {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}
