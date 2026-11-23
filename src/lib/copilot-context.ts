import {
  calculateTargetLandedCost,
  opportunityScore,
  recommendationFor,
} from "./economics.ts";
import { convertForeignCentsToRmb } from "./currency.ts";
import { getComparisonReports } from "./competitor-compare/storage.ts";
import { getDb } from "./db.ts";
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
  scope:
    | "case"
    | "case_sourcing"
    | "case_content"
    | "case_report"
    | "cases_list"
    | "competitors"
    | "discover"
    | "sourcing"
    | "studio"
    | "operations"
    | "settings"
    | "global";
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

export async function loadCopilotContext(pathname: string, search = ""): Promise<CopilotContext> {
  const [rawPath, embeddedQuery = ""] = (pathname || "/").split("?");
  const cleanPath = rawPath || "/";
  const queryStr = search ? search.replace(/^\?/, "") : embeddedQuery;
  const searchParams = new URLSearchParams(queryStr);

  // 1. 单品案卷上下文（细分：利润与合规 / 寻源与定标 / 文案与视觉 / 决策战报）
  const caseMatch = cleanPath.match(/^\/cases\/([^/]+)(?:\/([^/]+))?/);
  if (caseMatch && caseMatch[1]) {
    const caseId = decodeURIComponent(caseMatch[1]);
    const subStage = caseMatch[2] || "overview";
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

          const stageNameMap: Record<string, string> = {
            overview: "利润与合规沙盘",
            sourcing: "寻源与人工定标",
            content: "文案与视觉工作台",
            report: "立项决策战报",
          };
          const stageName = stageNameMap[subStage] ?? "商品案卷";

          const summaryLines = [
            `当前页面：${stageName}（${cleanPath}）`,
            `商品：${productCase.title}（ASIN: ${productCase.asin}，站点: ${productCase.marketplace}，类目: ${productCase.category}）`,
            `当前判定：${recommendation}（机会分 ${score}/100，证据完整度 ${productCase.evidence_score}%）`,
            `售价：${moneyIn(currency, assumptions.salePriceCents)}，采购与落地成本：${moneyIn(currency, assumptions.landedCostCents)}`,
            `单件净利：${moneyIn(currency, result.netProfitCents)}，净利率：${percent(result.marginRate)}（18% 门禁最高允许到岸价：${moneyIn(currency, target18.maxLandedCostCents)}，${landedGapCents > 0 ? `当前超标 ${moneyIn(currency, landedGapCents)} / 约 ¥${landedGapRmb}` : `尚有余量 ${moneyIn(currency, Math.abs(landedGapCents))}`}）`,
            `压力情景净利：${moneyIn(currency, result.stressProfitCents)}，广告盈亏平衡点：${percent(result.breakEvenAdRate)}（当前设定 ACoS ${percent(assumptions.adRate)}）`,
            `供应商定标：${hasSupplierSelection ? "已完成" : "待定标"}；风险卡点：${riskReasons.length ? riskReasons.join("、") : "无"}`,
          ];

          if (subStage === "sourcing") {
            return {
              scope: "case_sourcing",
              label: `寻源定标 · ${productCase.asin}`,
              badge: hasSupplierSelection ? "已定标" : "待定标",
              summaryText: summaryLines.join("\n"),
              caseSnapshot: snapshot,
              quickPrompts: [
                { label: "生成 1688 压价话术", prompt: "根据当前商品的 18% 门禁目标到岸价，帮我写一段给 1688 工厂的阶梯报价与压价话术。" },
                { label: "打样验收清单", prompt: "针对当前商品类目，收到 1688 样品后必须重点验哪些结构、材质与包装项？" },
                { label: "多厂比价维度", prompt: "对比 3 家工厂报价时，除了单价还要重点核对哪些隐性成本与风险？" },
                { label: "18% 门禁倒推", prompt: "结合当前案卷数字，帮我核算还能通过压价或包装减重腾出多少利润空间？" },
              ],
            };
          }

          if (subStage === "content") {
            return {
              scope: "case_content",
              label: `文案与视觉 · ${productCase.asin}`,
              badge: `${productCase.marketplace} Listing`,
              summaryText: summaryLines.join("\n"),
              caseSnapshot: snapshot,
              quickPrompts: [
                { label: "提炼高转化五点结构", prompt: "针对当前商品和站点，给我一套差异化五点卖点的结构建议与核心关键词布局。" },
                { label: "合规与侵权排雷", prompt: "当前商品在目标站点写标题和五点时，有哪些绝对不能碰的敏感词、认证词与侵权红线？" },
                { label: "主图视觉破局点", prompt: "在手机端搜索货架上，当前商品主图和副图怎么拍/生图最容易提高点击率？" },
                { label: "后台搜索词优化", prompt: "帮我规划当前商品 250 字节以内的 Amazon 后台搜索词（Search Terms）策略。" },
              ],
            };
          }

          if (subStage === "report") {
            return {
              scope: "case_report",
              label: `决策战报 · ${productCase.asin}`,
              badge: `${recommendation} · ${score}分`,
              summaryText: summaryLines.join("\n"),
              caseSnapshot: snapshot,
              quickPrompts: [
                { label: "生成立项汇报摘要", prompt: "请基于当前战报数据，帮我总结一段 150 字以内给老板/评审会的立项汇报结论。" },
                { label: "预判评审质疑点", prompt: "如果老板评审这份战报，最可能挑出的 3 个财务或市场风险质疑是什么？怎么回应？" },
                { label: "首批试单预算建议", prompt: "按当前单件成本与压测净利，首批 FBA 试单备货多少套最稳妥？" },
                { label: "诊断 18% 门禁空间", prompt: "结合当前战报数字，分析净利率与广告盈亏平衡点是否足够安全。" },
              ],
            };
          }

          return {
            scope: "case",
            label: `利润沙盘 · ${productCase.asin} (${productCase.category})`,
            badge: `${recommendation} · ${percent(result.marginRate)}`,
            summaryText: summaryLines.join("\n"),
            caseSnapshot: snapshot,
            quickPrompts: [
              { label: "诊断 18% 门禁破局方案", prompt: "结合当前案卷真实数字，帮我诊断如何突破 18% 净利门禁并降低压测风险？" },
              { label: "生成 1688 压价话术", prompt: "根据当前案卷的最高允许到岸价，帮我写一段给 1688 工厂的阶梯报价与压价话术。" },
              { label: "广告与退货风险评估", prompt: "分析当前案卷的广告盈亏平衡点与退货敏感度，上线前要设哪些止损线？" },
              { label: "防侵权与合规核查", prompt: "针对当前案卷所在站点与类目，上架前必须排查哪些外观专利与认证风险？" },
            ],
          };
        }
      }
    } catch {
      // 忽略异常并回退
    }
  }

  // 2. 我的商品台账总览 (/cases)
  if (cleanPath === "/cases") {
    try {
      const db = await getDb();
      const res = await db.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count FROM product_cases GROUP BY status`,
      );
      let total = 0;
      let approved = 0;
      let pending = 0;
      for (const row of res.rows) {
        const n = Number(row.count || 0);
        total += n;
        if (row.status === "approved") approved += n;
        if (row.status === "review_pending") pending += n;
      }
      return {
        scope: "cases_list",
        label: "我的商品台账",
        badge: `共 ${total} 款 · 已立项 ${approved}`,
        summaryText: `当前页面：我的商品台账（共 ${total} 款商品，已立项 ${approved} 款，待评审 ${pending} 款）。`,
        quickPrompts: [
          { label: "立项优先级排序", prompt: "多个候选商品同时推进时，应该按什么指标顺序决定先投哪一款？" },
          { label: "18% 门禁倒推", prompt: "帮我梳理商品 18% 净利门禁倒推采购上限的标准步骤。" },
          { label: "淘汰止损标准", prompt: "哪些信号的候选品应该直接归档淘汰，避免继续浪费打样成本？" },
          { label: "批量推进节奏", prompt: "小团队如何安排选品、1688 打样、拍图写文案的并行节奏？" },
        ],
      };
    } catch {
      // fallback below
    }
  }

  // 3. 竞品对比工作台（精准匹配当前 ?id= 研报）
  if (cleanPath.startsWith("/competitors")) {
    try {
      const reports = await getComparisonReports();
      const targetId = searchParams.get("id");
      const activeReport = (targetId ? reports.find((r) => r.id === targetId) : null) ?? reports[0];
      if (activeReport) {
        const summaryLines = [
          `当前页面：竞品对比工作台（共 ${reports.length} 份研报）`,
          `当前研报：${activeReport.title}（${activeReport.marketCode} · ${activeReport.platformCode}，共 ${activeReport.competitors.length} 款竞品，已采集实价样本 ${activeReport.priceStats.verifiedSampleCount} 条）`,
          `价格带：P25 ${moneyIn(activeReport.currency, activeReport.priceStats.p25)} / P50 ${moneyIn(activeReport.currency, activeReport.priceStats.p50)} / P75 ${moneyIn(activeReport.currency, activeReport.priceStats.p75)}`,
          activeReport.productIndex
            ? `商品指数：${activeReport.productIndex.totalScore} 分（${activeReport.productIndex.grade} 级，${activeReport.productIndex.decision}）`
            : "",
        ].filter(Boolean);
        return {
          scope: "competitors",
          label: `竞品研报 · ${activeReport.title.slice(0, 22)}`,
          badge: `${activeReport.competitors.length} 款竞品`,
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
      // fallback
    }
  }

  // 4. 实盘账本 (/operations)
  if (cleanPath.startsWith("/operations")) {
    try {
      const db = await getDb();
      const [batchRes, mapRes] = await Promise.all([
        db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM operations_batches`).catch(() => ({ rows: [] })),
        db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM channel_sku_mappings`).catch(() => ({ rows: [] })),
      ]);
      const batchCount = Number(batchRes.rows[0]?.count ?? 0);
      const mapCount = Number(mapRes.rows[0]?.count ?? 0);
      return {
        scope: "operations",
        label: "实盘账本与 FBA 库存",
        badge: `${batchCount} 批次 · ${mapCount} SKU映射`,
        summaryText: `当前页面：实盘账本（已导入 ${batchCount} 个 Settlement/FBA 对账批次，已绑定 ${mapCount} 条 SKU 采购成本映射）。`,
        quickPrompts: [
          { label: "实盘利润偏差排查", prompt: "实盘净利率比立项预测低了 5 个点以上，应该按什么顺序排查 FBA 费、广告和退货？" },
          { label: "FBA 补货与断货预警", prompt: "可售天数低于多少天必须下补货单？海运与空派怎么搭配防断货？" },
          { label: "SKU 校准回写策略", prompt: "什么时候应该把实盘结算偏差回写校准到商品成本模型中？" },
          { label: "退货率飙升止损", prompt: "实盘退货率超过 8% 时，如何快速定位是 Listing 预期偏差还是工厂批次品控问题？" },
        ],
      };
    } catch {
      // fallback
    }
  }

  // 5. 视觉工坊 (/studio, /image-studio, /video-studio, /media-library)
  if (
    cleanPath.startsWith("/studio") ||
    cleanPath.startsWith("/image-studio") ||
    cleanPath.startsWith("/video-studio") ||
    cleanPath.startsWith("/media-library")
  ) {
    const tab = searchParams.get("tab");
    const isVideo = cleanPath.startsWith("/video-studio") || tab === "video";
    const isLibrary = cleanPath.startsWith("/media-library") || tab === "library";
    const subLabel = isVideo ? "AI 视频工坊" : isLibrary ? "统一素材库" : "AI 生图工坊";
    return {
      scope: "studio",
      label: `视觉工坊 · ${subLabel}`,
      badge: isVideo ? "I2V 短视频" : isLibrary ? "素材审核" : "主图 / 场景图",
      summaryText: `当前页面：视觉工坊 - ${subLabel}（用于生成 Amazon 白底主图、场景图、A+ 图、图生视频与素材入库）。`,
      quickPrompts: [
        { label: "高点击主图构图", prompt: "Amazon 白底主图在不违规的前提下，如何通过角度、配件摆放提升手机端点击率？" },
        { label: "7 张附图规划", prompt: "标准 Amazon 7 张商品图（主图+卖点图+场景图+尺寸图+对比图）应该怎么分配？" },
        { label: "15 秒视频脚本", prompt: "帮我设计一个 15 秒 Amazon 商品主图视频的 3 镜头分镜脚本（痛点+演示+信任）。" },
        { label: "生图避坑清单", prompt: "AI 生成商品图最容易出现哪些穿帮/侵权细节，人工审核时要重点看什么？" },
      ],
    };
  }

  // 6. 选品雷达 (/discover, /ai-sourcing)
  if (
    cleanPath.startsWith("/discover") ||
    cleanPath.startsWith("/ai-sourcing")
  ) {
    return {
      scope: "discover",
      label: "选品雷达与快速选品",
      badge: "机会挖掘",
      summaryText: `当前页面：选品雷达（${cleanPath}，用于快速选品、CSV 导入与机会验证）。`,
      quickPrompts: [
        { label: "小团队选品红线", prompt: "首单预算有限的小团队，选品时应该避开哪些类目、客单价和垄断度红线？" },
        { label: "差评挖微创新", prompt: "如何从竞品 1-3 星差评中筛选出低成本、高感知的产品微改良点？" },
        { label: "18% 门禁倒推", prompt: "在没有工厂报价前，怎么快速用售价估算 18% 净利门禁的采购价上限？" },
        { label: "美日欧站点选择", prompt: "同样一款家居/宠物用品，首站优先选美国、日本还是欧洲？" },
      ],
    };
  }

  // 7. 供应商管理中台 (/sourcing)
  if (cleanPath.startsWith("/sourcing")) {
    return {
      scope: "sourcing",
      label: "寻源与供应商中台",
      badge: "1688 比价",
      summaryText: "当前页面：寻源与供应商中台（1688 寻源、工厂建档、报价录入与人工定标）。",
      quickPrompts: [
        { label: "辨别源头厂 vs 贸易商", prompt: "在 1688 找工厂时，怎么快速识别真源头工厂和二道贸易商？" },
        { label: "1688 首次询价模板", prompt: "给我一段专业、不容易被工厂当成小白敷衍的 1688 首次询价话术。" },
        { label: "抛货体积重避坑", prompt: "拿货算头程时，如何预防因外箱体积重导致实际物流费暴涨？" },
        { label: "拿样质检要点", prompt: "寄回样品后，如何建立一份 10 分钟快速验收清单决定是否定标？" },
      ],
    };
  }

  // 8. 设置 / 汇率 / 日志
  if (
    cleanPath.startsWith("/settings") ||
    cleanPath.startsWith("/fx-rates") ||
    cleanPath.startsWith("/audit-logs")
  ) {
    const label = cleanPath.startsWith("/fx-rates")
      ? "实时汇率管理"
      : cleanPath.startsWith("/audit-logs")
        ? "全链路操作日志"
        : "系统与模型设置";
    return {
      scope: "settings",
      label,
      badge: "系统配置",
      summaryText: `当前页面：${label}（${cleanPath}）。`,
      quickPrompts: [
        { label: "汇率波动安全垫", prompt: "核算多站点利润时，美元/欧元/日元汇率应该预留多少波动安全垫？" },
        { label: "模型选型建议", prompt: "选品分析、Listing 文案和生图分别推荐配置什么类型的模型性价比最高？" },
        { label: "数据备份最佳实践", prompt: "单机版 AITrade 日常使用应该怎么安排 JSON 备份与版本迁移？" },
        { label: "18% 门禁原则", prompt: "解释一下为什么 AITrade 把 18% 净利率设为默认立项门禁。" },
      ],
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
