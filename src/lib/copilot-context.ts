import {
  calculateTargetLandedCost,
  opportunityScore,
  recommendationFor,
} from "./economics.ts";
import { convertForeignCentsToRmb } from "./currency.ts";
import { getComparisonReports } from "./competitor-compare/storage.ts";
import { moneyIn, percent } from "./format.ts";
import { getCaseDetail } from "./repository.ts";

export type CopilotCaseSnapshot = {
  caseId: string;
  asin: string;
  title: string;
  marketplace: string;
  currency: string;
  category: string;
  status: string;
  evidenceScore: number;
  hasSupplierSelection: boolean;
  salePriceCents: number;
  landedCostCents: number;
  maxLandedFor18Cents: number;
  landedGapCents: number;
  landedGapRmb: number;
  netProfitCents: number;
  marginRate: number;
  stressProfitCents: number;
  breakEvenAdRate: number;
  adRate: number;
  returnRate: number;
  score: number;
  recommendation: "GO" | "HOLD" | "NO-GO";
  riskReasons: string[];
};

export type CopilotContext = {
  scope: "case" | "competitors" | "sourcing" | "content" | "global";
  label: string;
  badge: string;
  summaryText: string;
  quickPrompts: Array<{ label: string; prompt: string }>;
  caseSnapshot?: CopilotCaseSnapshot;
};

const DEFAULT_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: "18% 门禁倒推", prompt: "帮我分析商品 18% 净利门禁如何倒推采购成本？" },
  { label: "1688 询价压价", prompt: "1688 首次询价如何与源头工厂谈 MOQ 和打样？" },
  { label: "美日站点差异", prompt: "亚马逊美国站 vs 日本站选品注意哪些差异？" },
  { label: "防侵权排查", prompt: "Listing 标题与外观如何规避专利与品牌侵权？" },
];

export async function loadCopilotContext(pathname: string): Promise<CopilotContext> {
  const cleanPath = (pathname || "/").split("?")[0] || "/";

  // 1. 案卷上下文（含详情、询价、内容、渠道矩阵、战报）
  const caseMatch = cleanPath.match(/^\/cases\/([^/]+)/);
  if (caseMatch && caseMatch[1]) {
    const caseId = decodeURIComponent(caseMatch[1]);
    try {
      const detail = await getCaseDetail(caseId);
      if (detail) {
        const { productCase, costModel, hasSupplierSelection } = detail;
        const currency = productCase.currency || costModel?.assumptions.currency || "USD";
        const assumptions = costModel?.assumptions;
        const result = costModel?.results;

        if (assumptions && result) {
          const score = opportunityScore(
            result,
            productCase.monthly_sales_estimate,
            productCase.review_count,
            productCase.evidence_score,
          );
          const recommendation = recommendationFor(result, score);
          const target18 = calculateTargetLandedCost({
            currency,
            salePriceCents: assumptions.salePriceCents,
            fbaFeeCents: assumptions.fbaFeeCents,
            referralRate: assumptions.referralRate,
            adRate: assumptions.adRate,
            returnRate: assumptions.returnRate,
            returnProcessingCents: assumptions.returnProcessingCents,
            returnRecoveryRate: assumptions.returnRecoveryRate,
            couponCents: assumptions.couponCents,
            storageCents: assumptions.storageCents,
            otherCostCents: assumptions.otherCostCents,
            targetMarginRate: 0.18,
          });
          const landedGapCents = assumptions.landedCostCents - target18.maxLandedCostCents;
          const landedGapRmb = convertForeignCentsToRmb(Math.abs(landedGapCents), currency);
          const riskReasons: string[] = [];
          if (!result.isProfitable) riskReasons.push("基准情景亏损");
          if (result.stressProfitCents <= 0) riskReasons.push("压力情景亏损");
          if (result.marginRate < 0.18) riskReasons.push("净利率未达 18% 硬门禁");
          if (productCase.evidence_score < 50) riskReasons.push("证据完整度偏低");
          if (!hasSupplierSelection) riskReasons.push("尚未完成供应商定标");

          const snapshot: CopilotCaseSnapshot = {
            caseId: productCase.id,
            asin: productCase.asin,
            title: productCase.title,
            marketplace: productCase.marketplace,
            currency,
            category: productCase.category,
            status: productCase.status,
            evidenceScore: productCase.evidence_score,
            hasSupplierSelection,
            salePriceCents: assumptions.salePriceCents,
            landedCostCents: assumptions.landedCostCents,
            maxLandedFor18Cents: target18.maxLandedCostCents,
            landedGapCents,
            landedGapRmb,
            netProfitCents: result.netProfitCents,
            marginRate: result.marginRate,
            stressProfitCents: result.stressProfitCents,
            breakEvenAdRate: result.breakEvenAdRate,
            adRate: assumptions.adRate,
            returnRate: assumptions.returnRate,
            score,
            recommendation,
            riskReasons,
          };

          const summaryLines = [
            `当前页面：商品案卷（${cleanPath}）`,
            `商品：${productCase.title}（ASIN: ${productCase.asin}，站点: ${productCase.marketplace}，类目: ${productCase.category}）`,
            `当前判定：${recommendation}（机会分 ${score}/100，证据完整度 ${productCase.evidence_score}%）`,
            `售价：${moneyIn(currency, assumptions.salePriceCents)}，采购与落地成本：${moneyIn(currency, assumptions.landedCostCents)}`,
            `单件净利：${moneyIn(currency, result.netProfitCents)}，净利率：${percent(result.marginRate)}（18% 门禁最高允许到岸价：${moneyIn(currency, target18.maxLandedCostCents)}，${landedGapCents > 0 ? `当前超标 ${moneyIn(currency, landedGapCents)} / 约 ¥${landedGapRmb}` : `尚有余量 ${moneyIn(currency, Math.abs(landedGapCents))}`}）`,
            `压力情景净利：${moneyIn(currency, result.stressProfitCents)}，广告盈亏平衡点：${percent(result.breakEvenAdRate)}（当前设定 ACoS ${percent(assumptions.adRate)}）`,
            `供应商定标：${hasSupplierSelection ? "已完成" : "待定标"}；风险卡点：${riskReasons.length ? riskReasons.join("、") : "无"}`,
          ];

          return {
            scope: "case",
            label: `案卷 · ${productCase.asin} (${productCase.category})`,
            badge: `${recommendation} · ${percent(result.marginRate)}`,
            summaryText: summaryLines.join("\n"),
            caseSnapshot: snapshot,
            quickPrompts: [
              {
                label: "诊断 18% 门禁破局方案",
                prompt: "结合当前案卷真实数字，帮我诊断如何突破 18% 净利门禁并降低压测风险？",
              },
              {
                label: "生成 1688 压价话术",
                prompt: "根据当前案卷的最高允许到岸价，帮我写一段给 1688 工厂的阶梯报价与压价话术。",
              },
              {
                label: "广告与退货风险评估",
                prompt: "分析当前案卷的广告盈亏平衡点与退货敏感度，上线前要设哪些止损线？",
              },
              {
                label: "防侵权与合规核查",
                prompt: "针对当前案卷所在站点与类目，上架前必须排查哪些外观专利与认证风险？",
              },
            ],
          };
        }
      }
    } catch {
      // 忽略异常并回退到全局上下文
    }
  }

  // 2. 竞品对比工作台上下文
  if (cleanPath.startsWith("/competitors")) {
    try {
      const reports = await getComparisonReports();
      const latest = reports[0];
      if (latest) {
        const summaryLines = [
          `当前页面：竞品对比工作台（共 ${reports.length} 份研报）`,
          `最新研报：${latest.title}（${latest.marketCode} · ${latest.platformCode}，共 ${latest.competitors.length} 款竞品，已采集实价样本 ${latest.priceStats.verifiedSampleCount} 条）`,
          `价格带：P25 ${moneyIn(latest.currency, latest.priceStats.p25)} / P50 ${moneyIn(latest.currency, latest.priceStats.p50)} / P75 ${moneyIn(latest.currency, latest.priceStats.p75)}`,
          latest.productIndex
            ? `商品指数：${latest.productIndex.totalScore} 分（${latest.productIndex.grade} 级，${latest.productIndex.decision}）`
            : "",
        ].filter(Boolean);
        return {
          scope: "competitors",
          label: `竞品研报 · ${latest.title.slice(0, 22)}`,
          badge: `${latest.competitors.length} 款竞品`,
          summaryText: summaryLines.join("\n"),
          quickPrompts: [
            { label: "切入价格带建议", prompt: "结合当前竞品研报的价格分位，我的新品应该定在什么价格带最容易起量？" },
            { label: "反制竞品差评", prompt: "如何把竞品的高频差评转化为产品微改良和五点卖点？" },
            { label: "18% 门禁倒推", prompt: "按当前竞品中位价倒推 18% 净利门禁，1688 拿货上限是多少？" },
            { label: "样本可信度核查", prompt: "当前竞品样本量与垄断度还缺哪些证据才能放心立项？" },
          ],
        };
      }
    } catch {
      // 回退默认
    }
  }

  if (cleanPath.startsWith("/sourcing")) {
    return {
      scope: "sourcing",
      label: "寻源与供应商中台",
      badge: "1688 比价",
      summaryText: "当前页面：寻源与供应商中台（1688 寻源、报价录入、供应商横向比价与人工定标）。",
      quickPrompts: DEFAULT_PROMPTS,
    };
  }

  if (cleanPath.startsWith("/content") || cleanPath.startsWith("/image-studio")) {
    return {
      scope: "content",
      label: "内容与视觉工坊",
      badge: "Listing & 生图",
      summaryText: "当前页面：内容工作台 / AI 生图工坊（五点打磨、合规雷达扫描、视觉 Skill 生图）。",
      quickPrompts: DEFAULT_PROMPTS,
    };
  }

  return {
    scope: "global",
    label: "全站操盘手工作台",
    badge: "全局视图",
    summaryText: "当前页面：AITrade 全局工作台。",
    quickPrompts: DEFAULT_PROMPTS,
  };
}
