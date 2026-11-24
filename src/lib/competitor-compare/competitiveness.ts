import {
  isVerifiedCompetitorField,
  type CompetitorComparisonReport,
  type CompetitorProfile,
} from "./types.ts";

export type QuantitativePillar = {
  key: string;
  label: string;
  score: number;
  max: number;
  metricValue: string; // 客观计算出的原始指标值（例如 品牌HHI=1420, CV=0.28）
  verdict: "excellent" | "good" | "fair" | "poor" | "unavailable";
  /** 该支柱是否有真实观测数据支撑；false 时不计入总分分母，绝不用假默认值充数 */
  isAvailable: boolean;
  explanation: string;
};

export type ProductIndexScore = {
  totalScore: number; // 0 - 100 整数分（仅基于有效观测支柱归一化）
  grade: "S" | "A" | "B" | "C"; // S(>=85), A(70-84), B(50-69), C(<50)
  decision: "GO" | "HOLD" | "NO-GO";
  headline: string;
  summaryText: string;
  /** 真实证据完整度 (0-100%)：有真实观测值支撑的支柱权重占比 */
  evidenceCompleteness: number;
  mathEvidence: {
    hhi: number; // 品牌级赫芬达尔指数
    hhiBasis: "brand_sales" | "brand_shelf" | "insufficient";
    brandCr3Percent: number; // Top 3 品牌占比 (%)
    reviewLogMoat: number; // 评论对数阻力 (0-1)
    priceCV: number; // 有效售价变异系数
    bayesianRating: number; // 贝叶斯加权均分
    marginPercent: number | null; // 测算毛利率（无真实售价时为 null）
    verifiedSalesCount: number; // 有真实月销标签的样本数
  };
  pillars: {
    monopolyRivalry: QuantitativePillar; // 1. 品牌 HHI 垄断与自由度 (15分)
    reviewMoat: QuantitativePillar; // 2. 评论对数进入阻力 (15分)
    priceAndMargin: QuantitativePillar; // 3. 价格分层与毛利垫 (25分)
    painPointGap: QuantitativePillar; // 4. 贝叶斯痛点改良胜率 (25分)
    salesCapacity: QuantitativePillar; // 5. 存量动销与容量规模 (20分)
  };
};

export type ProductIndexOptions = {
  /** 来自确定性财务引擎 calculateEconomics 的实时测算净利率/毛利率（%） */
  overrideMarginPercent?: number | null;
};

function normalizeBrandName(brand: string | undefined, asin: string): string {
  const clean = (brand || "").trim();
  if (!clean || /^(待确认品牌|未知品牌|品牌|unknown|n\/a|generic|—|-)$/i.test(clean)) {
    return `__unbranded_${asin}`;
  }
  return clean.toLowerCase();
}

function effectivePriceOf(item: CompetitorProfile): number {
  if (typeof item.effectivePriceCents === "number" && item.effectivePriceCents > 0) {
    return item.effectivePriceCents;
  }
  return item.priceCents;
}

function verifiedMonthlySalesOf(item: CompetitorProfile): number | null {
  if (typeof item.boughtPastMonth === "number" && item.boughtPastMonth > 0) {
    return item.boughtPastMonth;
  }
  if (isVerifiedCompetitorField(item, "monthlySalesEst") && item.monthlySalesEst > 0) {
    return item.monthlySalesEst;
  }
  return null;
}

/**
 * 科学量化：计算商品指数 (Product Index, 0~100 分)
 * 严守「观测值优先」铁律：只用真实抓到/核实的数据打分，抓不到的支柱标为 unavailable 不计入分母。
 */
export function calculateProductIndex(
  report: Omit<CompetitorComparisonReport, "productIndex">,
  options?: ProductIndexOptions,
): ProductIndexScore {
  const items = report.competitors;
  const count = items.length;

  if (count === 0) {
    return {
      totalScore: 0,
      grade: "C",
      decision: "NO-GO",
      headline: "无有效竞品样本",
      summaryText: "缺少竞品对比样本，无法客观计算商品科学指数",
      evidenceCompleteness: 0,
      mathEvidence: {
        hhi: 0,
        hhiBasis: "insufficient",
        brandCr3Percent: 0,
        reviewLogMoat: 0,
        priceCV: 0,
        bayesianRating: 0,
        marginPercent: null,
        verifiedSalesCount: 0,
      },
      pillars: {
        monopolyRivalry: { key: "hhi", label: "品牌 HHI 集中度", score: 0, max: 15, metricValue: "N/A", verdict: "unavailable", isAvailable: false, explanation: "零样本数据" },
        reviewMoat: { key: "moat", label: "评论对数门槛", score: 0, max: 15, metricValue: "N/A", verdict: "unavailable", isAvailable: false, explanation: "零样本数据" },
        priceAndMargin: { key: "margin", label: "价格分层与毛利垫", score: 0, max: 25, metricValue: "N/A", verdict: "unavailable", isAvailable: false, explanation: "零样本数据" },
        painPointGap: { key: "gap", label: "痛点改良进攻胜率", score: 0, max: 25, metricValue: "N/A", verdict: "unavailable", isAvailable: false, explanation: "零样本数据" },
        salesCapacity: { key: "sales", label: "真实动销规模", score: 0, max: 20, metricValue: "N/A", verdict: "unavailable", isAvailable: false, explanation: "零样本数据" },
      },
    };
  }

  // 收集真实观测到的月销（优先 Amazon 前台「X+ bought in past month」）
  const verifiedSalesEntries = items
    .map((item) => ({ item, sales: verifiedMonthlySalesOf(item) }))
    .filter((entry): entry is { item: CompetitorProfile; sales: number } => entry.sales !== null);

  // ==========================================
  // 1. 数学支柱 1: 品牌级 HHI 垄断指数与 CR3 (满分 15 分)
  // ==========================================
  let hhi = 0;
  let hhiBasis: ProductIndexScore["mathEvidence"]["hhiBasis"] = "insufficient";
  let brandCr3Percent = 0;
  let hhiScore = 0;
  let hhiVerdict: QuantitativePillar["verdict"] = "unavailable";
  let hhiAvailable = false;
  let hhiExp = "";
  let hhiMetric = "样本不足";

  if (count < 4) {
    hhiExp = `当前有效竞品样本仅 ${count} 款（统计基准要求 ≥ 4 款），品牌集中度无法客观成立，该项暂不计分；建议在搜索页采集 Top 20。`;
  } else {
    hhiAvailable = true;
    const brandWeights = new Map<string, number>();

    if (verifiedSalesEntries.length >= 4) {
      hhiBasis = "brand_sales";
      for (const { item, sales } of verifiedSalesEntries) {
        const key = normalizeBrandName(item.brand, item.asin);
        brandWeights.set(key, (brandWeights.get(key) ?? 0) + sales);
      }
    } else {
      hhiBasis = "brand_shelf";
      for (const item of items) {
        const key = normalizeBrandName(item.brand, item.asin);
        brandWeights.set(key, (brandWeights.get(key) ?? 0) + 1);
      }
    }

    const totalWeight = [...brandWeights.values()].reduce((a, b) => a + b, 0) || 1;
    const brandShares = [...brandWeights.values()]
      .map((w) => (w / totalWeight) * 100)
      .sort((a, b) => b - a);

    hhi = Math.round(brandShares.reduce((acc, s) => acc + s * s, 0));
    brandCr3Percent = Math.round(brandShares.slice(0, 3).reduce((acc, s) => acc + s, 0));
    const basisLabel = hhiBasis === "brand_sales" ? "销量口径" : "坑位口径";
    hhiMetric = `品牌 HHI ${hhi} · CR3 ${brandCr3Percent}%`;

    if (hhi < 1500 && brandCr3Percent < 45) {
      hhiScore = 15;
      hhiVerdict = "excellent";
      hhiExp = `按品牌聚合（${basisLabel}）HHI=${hhi}，Top 3 品牌仅占 ${brandCr3Percent}%，市场充分分散，无单一寡头锁死流量。`;
    } else if (hhi <= 2400 && brandCr3Percent <= 60) {
      hhiScore = 11;
      hhiVerdict = "good";
      hhiExp = `按品牌聚合（${basisLabel}）HHI=${hhi}，Top 3 品牌占 ${brandCr3Percent}%（适度集中），细分场景和改良款仍有切入空间。`;
    } else if (hhi <= 3500) {
      hhiScore = 6;
      hhiVerdict = "fair";
      hhiExp = `按品牌聚合（${basisLabel}）HHI=${hhi}，Top 3 品牌占 ${brandCr3Percent}%（寡头主导），新品需极强差异化避开正面厮杀。`;
    } else {
      hhiScore = 2;
      hhiVerdict = "poor";
      hhiExp = `按品牌聚合（${basisLabel}）HHI=${hhi}，Top 3 品牌垄断 ${brandCr3Percent}% 份额，中小卖家极易成为炮灰。`;
    }
  }

  // ==========================================
  // 2. 数学支柱 2: 评论对数进入阻力模型 (满分 15 分)
  // 仅使用真实采集/人工核实的 reviewCount
  // ==========================================
  const verifiedReviews = items
    .filter((i) => isVerifiedCompetitorField(i, "reviewCount") && i.reviewCount >= 0)
    .map((i) => i.reviewCount)
    .sort((a, b) => a - b);

  let reviewAvailable = false;
  let medianReviews = 0;
  let moatRatio = 0;
  let reviewScore = 0;
  let reviewVerdict: QuantitativePillar["verdict"] = "unavailable";
  let reviewExp = "尚未采集到真实评论数，该项暂不计分。";
  let reviewMetric = "未采集";

  if (verifiedReviews.length > 0) {
    reviewAvailable = true;
    medianReviews = verifiedReviews[Math.floor(verifiedReviews.length / 2)]!;
    const maxBenchmarkLog = Math.log(10000 + 1);
    const currentLog = Math.log(medianReviews + 1);
    moatRatio = Math.min(1, Math.max(0, currentLog / maxBenchmarkLog));
    reviewScore = Math.round(15 * (1 - moatRatio * 0.85));
    reviewMetric = `中位 ${medianReviews.toLocaleString()} 评`;

    if (medianReviews < 350) {
      reviewVerdict = "excellent";
      reviewExp = `真实评论中位数仅 ${medianReviews} 条（对数阻力 ${moatRatio.toFixed(2)}），老链接口碑壁垒低，新品靠早期好评即可站稳。`;
    } else if (medianReviews <= 1200) {
      reviewVerdict = "good";
      reviewExp = `真实评论中位数约 ${medianReviews} 条（对数阻力 ${moatRatio.toFixed(2)}），处于健康推新区间，获评成本可控。`;
    } else if (medianReviews <= 3500) {
      reviewVerdict = "fair";
      reviewExp = `真实评论中位数达 ${medianReviews} 条，存在明显口碑壁垒，需靠差异化卖点削弱买家对评论数的依赖。`;
    } else {
      reviewVerdict = "poor";
      reviewExp = `真实评论中位数高达 ${medianReviews} 条（头部壁垒极厚），新品冷启动转化率压力极大。`;
    }
  }

  // ==========================================
  // 3. 数学支柱 3: 有效售价变异系数(CV)与毛利安全垫 (满分 25 分)
  // 仅使用真实采集/人工核实的售价（有 Coupon 时优先用券后实付价）
  // ==========================================
  const verifiedPrices = items
    .filter((i) => isVerifiedCompetitorField(i, "priceCents") && effectivePriceOf(i) > 0)
    .map((i) => effectivePriceOf(i));

  let priceAvailable = false;
  let priceCV = 0;
  let marginPercent: number | null = null;
  let priceAndMarginScore = 0;
  let priceMarginVerdict: QuantitativePillar["verdict"] = "unavailable";
  let priceMarginExp = "尚未采集到真实售价，无法测算价格分层与毛利安全垫，该项暂不计分。";
  let priceMarginMetric = "未采集售价";

  if (verifiedPrices.length > 0) {
    priceAvailable = true;
    const priceMean = verifiedPrices.reduce((a, b) => a + b, 0) / verifiedPrices.length;
    const priceVariance = verifiedPrices.reduce((acc, p) => acc + Math.pow(p - priceMean, 2), 0) / verifiedPrices.length;
    priceCV = verifiedPrices.length >= 2 ? Number((Math.sqrt(priceVariance) / (priceMean || 1)).toFixed(2)) : 0;

    // 优先使用外部确定性财务引擎实时测算的净利率；否则基于有效售价区间给出保守毛利评估
    const hasOverride = typeof options?.overrideMarginPercent === "number" && Number.isFinite(options.overrideMarginPercent);
    if (hasOverride) {
      marginPercent = Number(options!.overrideMarginPercent!.toFixed(1));
    } else {
      // 仅当有真实售价时，根据客单价粗估毛利垫（高客单 FBA 占比更低，绝不虚报）
      const p50Cents = report.priceStats.p50 > 0 ? report.priceStats.p50 : priceMean;
      const estimatedSafeMargin = p50Cents >= 3500 ? 32 : p50Cents >= 2000 ? 25 : 16;
      marginPercent = estimatedSafeMargin;
    }

    let marginPartScore = 0;
    if (hasOverride) {
      // 确定性净利率口径：18% 为立项硬门禁
      if (marginPercent >= 25) marginPartScore = 15;
      else if (marginPercent >= 18) marginPartScore = 12;
      else if (marginPercent >= 10) marginPartScore = 6;
      else marginPartScore = 1;
    } else {
      if (marginPercent >= 35) marginPartScore = 15;
      else if (marginPercent >= 25) marginPartScore = 11;
      else if (marginPercent >= 18) marginPartScore = 7;
      else marginPartScore = 2;
    }

    let cvPartScore = 0;
    if (verifiedPrices.length < 2) cvPartScore = 5;
    else if (priceCV >= 0.22) cvPartScore = 10;
    else if (priceCV >= 0.12) cvPartScore = 7;
    else cvPartScore = 3;

    priceAndMarginScore = marginPartScore + cvPartScore;
    if (priceAndMarginScore >= 20) priceMarginVerdict = "excellent";
    else if (priceAndMarginScore >= 14) priceMarginVerdict = "good";
    else if (priceAndMarginScore >= 9) priceMarginVerdict = "fair";
    else priceMarginVerdict = "poor";

    const marginLabel = hasOverride ? `参考测算净利率 ${marginPercent}%` : `客单推演毛利垫 ~${marginPercent}%`;
    priceMarginMetric = `${marginLabel} · CV ${priceCV}`;
    priceMarginExp = `${marginLabel}（${hasOverride ? "已联动当前询价与平台费用，仅供竞品研究参考" : "竞品研报不做正式利润门禁；正式核算请使用独立成本核算单"}），券后有效售价变异系数 CV=${priceCV}，${
      verifiedPrices.length < 2
        ? "当前仅 1 个真实价格样本，建议补充更多竞品观察价格带分布"
        : priceCV >= 0.2
          ? "价格分层清晰，存在中高端溢价切入空间"
          : "价格带高度密集，需警惕同质化低价内卷"
    }。`;
  }

  // ==========================================
  // 4. 数学支柱 4: 贝叶斯修正评分与差评痛点改良胜率 (满分 25 分)
  // 仅使用真实采集/人工核实的 rating 与真实差评痛点
  // ==========================================
  const verifiedRatings = items
    .filter((i) => isVerifiedCompetitorField(i, "rating") && i.rating > 0)
    .map((i) => i.rating);

  const isPlaceholderText = (t: string) =>
    /^(暂未采集|尚未采集|待采集|请先用|（模板示意）)/.test(t.trim());

  const realWeaknesses = (report.summary.commonWeaknesses || []).filter(
    (w) => Boolean(w && w.trim() && !isPlaceholderText(w)),
  );
  const actionablePainCount = (report.painPointMatrix || []).filter(
    (p) => p.category === "structural_design" || p.category === "packaging_accessories",
  ).length;
  const weaknessCount = Math.max(realWeaknesses.length, actionablePainCount);
  const hasRealStrategy = Boolean(
    report.summary.attackVector?.trim() &&
    !isPlaceholderText(report.summary.attackVector) &&
    report.summary.marketVacuum?.trim() &&
    !isPlaceholderText(report.summary.marketVacuum),
  );

  let gapAvailable = false;
  let bayesianRating = 0;
  let gapScore = 0;
  let gapVerdict: QuantitativePillar["verdict"] = "unavailable";
  let gapExp = "尚未采集到真实评分与买家差评，无法判断改良胜率，该项暂不计分。";
  let gapMetric = "未采集评分/差评";

  if (verifiedRatings.length > 0 || weaknessCount > 0) {
    gapAvailable = true;
    const C = 10;
    const m = 4.2;
    if (verifiedRatings.length > 0) {
      const totalR = verifiedRatings.reduce((acc, r) => acc + r, 0);
      bayesianRating = Number(((C * m + totalR) / (C + verifiedRatings.length)).toFixed(2));
      if (bayesianRating < 4.0) gapScore += 13;
      else if (bayesianRating <= 4.25) gapScore += 10;
      else if (bayesianRating <= 4.45) gapScore += 6;
      else gapScore += 2;
    } else {
      gapScore += 6;
    }

    if (weaknessCount >= 2 && hasRealStrategy) gapScore += 12;
    else if (weaknessCount >= 1 && hasRealStrategy) gapScore += 8;
    else if (weaknessCount >= 1) gapScore += 5;

    if (weaknessCount === 0) gapVerdict = "fair";
    else if (gapScore >= 20) gapVerdict = "excellent";
    else if (gapScore >= 15) gapVerdict = "good";
    else if (gapScore >= 10) gapVerdict = "fair";
    else gapVerdict = "poor";

    gapMetric = bayesianRating > 0
      ? `${bayesianRating}★ · ${weaknessCount} 项痛点`
      : `${weaknessCount} 项真实痛点`;

    gapExp = weaknessCount === 0
      ? `真实评分贝叶斯均值 ${bayesianRating}★；当前尚未采集详情页买家差评，请用扩展进入详情页采集差评后再锁定改良靶心。`
      : `真实评分贝叶斯均值 ${bayesianRating > 0 ? `${bayesianRating}★` : "待补"}，已锁定 ${weaknessCount} 个真实差评痛点${
          actionablePainCount > 0 ? `（含 ${actionablePainCount} 项工程/包装可改良项）` : ""
        }。`;
  }

  // ==========================================
  // 5. 数学支柱 5: 存量真实动销规模 (满分 20 分)
  // 严格只用 Amazon 前台抓到的「X+ bought in past month」或人工核实月销；抓不到就不打分！
  // ==========================================
  let salesAvailable = false;
  let medianSales = 0;
  let salesScore = 0;
  let salesVerdict: QuantitativePillar["verdict"] = "unavailable";
  let salesMetric = "未抓到月销标签";
  let salesExp = "当前页面未抓取到 Amazon 官方「bought in past month」动销标签，为避免编造假销量，该项不计入评分。";

  if (verifiedSalesEntries.length > 0) {
    salesAvailable = true;
    const sortedSales = verifiedSalesEntries.map((e) => e.sales).sort((a, b) => a - b);
    medianSales = sortedSales[Math.floor(sortedSales.length / 2)]!;
    salesMetric = `中位 ${medianSales.toLocaleString()}+/月 (${verifiedSalesEntries.length}款)`;

    if (medianSales >= 300 && medianSales <= 3000) salesScore = 20;
    else if (medianSales > 3000) salesScore = 15;
    else if (medianSales >= 100) salesScore = 11;
    else salesScore = 5;

    if (salesScore >= 18) salesVerdict = "excellent";
    else if (salesScore >= 13) salesVerdict = "good";
    else if (salesScore >= 8) salesVerdict = "fair";
    else salesVerdict = "poor";

    salesExp = `基于 ${verifiedSalesEntries.length} 款抓到官方月销下限的竞品，中位月销 ≥ ${medianSales.toLocaleString()} 件，需求真实可验证。`;
  }

  // ==========================================
  // 综合总分归一化 (仅对 isAvailable 的支柱动态归一化)
  // ==========================================
  const allPillars: QuantitativePillar[] = [
    { key: "hhi", label: "品牌 HHI 集中度", score: hhiScore, max: 15, metricValue: hhiMetric, verdict: hhiVerdict, isAvailable: hhiAvailable, explanation: hhiExp },
    { key: "moat", label: "评论对数门槛", score: reviewScore, max: 15, metricValue: reviewMetric, verdict: reviewVerdict, isAvailable: reviewAvailable, explanation: reviewExp },
    { key: "margin", label: "价格分层与毛利垫", score: priceAndMarginScore, max: 25, metricValue: priceMarginMetric, verdict: priceMarginVerdict, isAvailable: priceAvailable, explanation: priceMarginExp },
    { key: "gap", label: "痛点改良进攻胜率", score: gapScore, max: 25, metricValue: gapMetric, verdict: gapVerdict, isAvailable: gapAvailable, explanation: gapExp },
    { key: "sales", label: "真实动销规模", score: salesScore, max: 20, metricValue: salesMetric, verdict: salesVerdict, isAvailable: salesAvailable, explanation: salesExp },
  ];

  const totalPossibleWeight = allPillars.reduce((sum, p) => sum + p.max, 0);
  const availableWeight = allPillars.filter((p) => p.isAvailable).reduce((sum, p) => sum + p.max, 0);
  const availableScore = allPillars.filter((p) => p.isAvailable).reduce((sum, p) => sum + p.score, 0);
  const evidenceCompleteness = Math.round((availableWeight / totalPossibleWeight) * 100);

  const totalScore = availableWeight > 0
    ? Math.min(100, Math.max(0, Math.round((availableScore / availableWeight) * 100)))
    : 0;

  let grade: ProductIndexScore["grade"] = "B";
  let decision: ProductIndexScore["decision"] = "HOLD";
  let headline = "";

  if (evidenceCompleteness < 45) {
    grade = totalScore >= 70 ? "B" : "C";
    decision = "HOLD";
    headline = `证据完整度仅 ${evidenceCompleteness}% · 暂缓裁决（请补采真实数据）`;
  } else if (totalScore >= 85) {
    grade = "S";
    decision = "GO";
    headline = "S 级 · 极具进攻优势 (强烈推荐立项)";
  } else if (totalScore >= 70) {
    grade = "A";
    decision = "GO";
    headline = "A 级 · 胜算清晰 (建议立项验证)";
  } else if (totalScore >= 50) {
    grade = "B";
    decision = "HOLD";
    headline = "B 级 · 竞争胶着 (保留观察/等待降本)";
  } else {
    grade = "C";
    decision = "NO-GO";
    headline = "C 级 · 高阻力内卷 (不建议盲目入场)";
  }

  const summaryParts = [
    `商品指数 ${totalScore} 分（${grade} 级 · ${decision}，证据完整度 ${evidenceCompleteness}%）。`,
    hhiAvailable ? `品牌集中度 HHI=${hhi}（Top 3 占 ${brandCr3Percent}%）` : "",
    reviewAvailable ? `真实评论中位数 ${medianReviews} 条` : "",
    verifiedRatings.length > 0 ? `贝叶斯均分 ${bayesianRating}★` : "",
    salesAvailable ? `官方月销中位 ≥${medianSales} 件` : "",
  ].filter(Boolean);

  return {
    totalScore,
    grade,
    decision,
    headline,
    summaryText: summaryParts.join("，"),
    evidenceCompleteness,
    mathEvidence: {
      hhi,
      hhiBasis,
      brandCr3Percent,
      reviewLogMoat: Number(moatRatio.toFixed(2)),
      priceCV,
      bayesianRating,
      marginPercent,
      verifiedSalesCount: verifiedSalesEntries.length,
    },
    pillars: {
      monopolyRivalry: allPillars[0]!,
      reviewMoat: allPillars[1]!,
      priceAndMargin: allPillars[2]!,
      painPointGap: allPillars[3]!,
      salesCapacity: allPillars[4]!,
    },
  };
}
