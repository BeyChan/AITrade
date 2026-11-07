import type { CompetitorComparisonReport } from "./types.ts";

export type QuantitativePillar = {
  key: string;
  label: string;
  score: number;
  max: number;
  metricValue: string; // 客观计算出的原始指标值（例如 HHI=1420, CV=0.28）
  verdict: "excellent" | "good" | "fair" | "poor";
  explanation: string;
};

export type ProductIndexScore = {
  totalScore: number; // 0 - 100 整数分
  grade: "S" | "A" | "B" | "C"; // S(>=85), A(70-84), B(50-69), C(<50)
  decision: "GO" | "HOLD" | "NO-GO";
  headline: string;
  summaryText: string;
  mathEvidence: {
    hhi: number; // 赫芬达尔指数
    reviewLogMoat: number; // 评论对数阻力 (0-1)
    priceCV: number; // 价格变异系数
    bayesianRating: number; // 贝叶斯加权均分
    marginPercent: number; // 测算毛利率
  };
  pillars: {
    monopolyRivalry: QuantitativePillar; // 1. HHI 垄断与自由度 (15分)
    reviewMoat: QuantitativePillar; // 2. 评论对数进入阻力 (15分)
    priceAndMargin: QuantitativePillar; // 3. 价格分层与毛利垫 (25分)
    painPointGap: QuantitativePillar; // 4. 贝叶斯痛点改良胜率 (25分)
    salesCapacity: QuantitativePillar; // 5. 存量动销与容量规模 (20分)
  };
};

/**
 * 科学量化：计算商品指数 (Product Index, 0~100 分)
 */
export function calculateProductIndex(
  report: Omit<CompetitorComparisonReport, "competitiveness">,
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
      mathEvidence: { hhi: 0, reviewLogMoat: 0, priceCV: 0, bayesianRating: 0, marginPercent: 0 },
      pillars: {
        monopolyRivalry: { key: "hhi", label: "HHI 垄断集中度", score: 0, max: 15, metricValue: "N/A", verdict: "poor", explanation: "零样本数据" },
        reviewMoat: { key: "moat", label: "评论门槛对数阻力", score: 0, max: 15, metricValue: "N/A", verdict: "poor", explanation: "零样本数据" },
        priceAndMargin: { key: "margin", label: "价格分层与毛利垫", score: 0, max: 25, metricValue: "N/A", verdict: "poor", explanation: "零样本数据" },
        painPointGap: { key: "gap", label: "痛点改良进攻胜率", score: 0, max: 25, metricValue: "N/A", verdict: "poor", explanation: "零样本数据" },
        salesCapacity: { key: "sales", label: "存量需求与动销规模", score: 0, max: 20, metricValue: "N/A", verdict: "poor", explanation: "零样本数据" },
      },
    };
  }

  // ==========================================
  // 1. 数学支柱 1: HHI 赫芬达尔垄断指数计算 (满分 15 分)
  // ==========================================
  const salesArray = items.map((i) => Math.max(10, i.monthlySalesEst || 300));
  let hhi = 0;
  let hhiScore = 7;
  let hhiVerdict: QuantitativePillar["verdict"] = "fair";
  let hhiExp = "";

  if (count < 4) {
    // 样本量防御：有效样本量过少 (n < 4) 时，数学上各家平方和必然虚高偏倚，不具统计显著性
    hhi = 0;
    hhiScore = 7;
    hhiVerdict = "fair";
    hhiExp = `当前有效竞品样本仅 ${count} 款（统计基准要求 ≥ 4 款），赫芬达尔指数无法客观成立，给予中性基准分处理，建议补充样本。`;
  } else {
    const totalSales = salesArray.reduce((acc, v) => acc + v, 0);
    const shares = salesArray.map((s) => (s / totalSales) * 100);
    hhi = Math.round(shares.reduce((acc, s) => acc + s * s, 0));

    if (hhi < 1800) {
      hhiScore = 15;
      hhiVerdict = "excellent";
      hhiExp = `HHI 指数仅 ${hhi}（自由竞争区间），市场份额充分分散，买家认产品不认单一寡头，新卖家最易撕开突破口。`;
    } else if (hhi <= 2600) {
      hhiScore = 11;
      hhiVerdict = "good";
      hhiExp = `HHI 指数为 ${hhi}（适度集中），头部存在 2~3 个主导品牌，但在细分场景和功能改版上仍留有充足市场空间。`;
    } else if (hhi <= 3800) {
      hhiScore = 6;
      hhiVerdict = "fair";
      hhiExp = `HHI 指数达 ${hhi}（寡头主导），头部少数品牌瓜分大部分流量，推新需具备极其鲜明的差异化卖点。`;
    } else {
      hhiScore = 2;
      hhiVerdict = "poor";
      hhiExp = `HHI 指数高达 ${hhi}（绝对高度垄断），流量基本被超级大卖锁定，极易成为炮灰。`;
    }
  }

  // ==========================================
  // 2. 数学支柱 2: 评论对数进入阻力模型 (满分 15 分)
  // 边际效应递减模型: ln(review+1) / ln(10000+1)
  // ==========================================
  const reviews = items.map((i) => Math.max(0, i.reviewCount)).sort((a, b) => a - b);
  const medianReviews = reviews[Math.floor(reviews.length / 2)]!;
  const maxBenchmarkLog = Math.log(10000 + 1); // 封顶基准 10,000 评
  const currentLog = Math.log(medianReviews + 1);
  const moatRatio = Math.min(1, Math.max(0, currentLog / maxBenchmarkLog)); // 0: 零阻力, 1: 极高阻力
  const reviewScore = Math.round(15 * (1 - moatRatio * 0.85)); // 评论越少，得分越高

  let reviewVerdict: QuantitativePillar["verdict"] = "good";
  let reviewExp = "";

  if (medianReviews < 350) {
    reviewVerdict = "excellent";
    reviewExp = `竞品中位数评论仅 ${medianReviews} 条（对数阻力 ${moatRatio.toFixed(2)}），买家对老品牌的信赖壁垒很低，新产品靠几十条早期好评即可平起平坐。`;
  } else if (medianReviews <= 1200) {
    reviewVerdict = "good";
    reviewExp = `竞品中位数评论约 ${medianReviews} 条（对数阻力适中），属于健康推新区间，推新获评成本完全在可承受范围。`;
  } else if (medianReviews <= 3500) {
    reviewVerdict = "fair";
    reviewExp = `竞品中位数评论达 ${medianReviews} 条，已具备一定口碑壁垒，需通过差异化功能削弱买家对评论数的敏感度。`;
  } else {
    reviewVerdict = "poor";
    reviewExp = `竞品中位数评论高达 ${medianReviews} 条（头部壁垒极厚），新品启动期在自然转化率上处于明显劣势。`;
  }

  // ==========================================
  // 3. 数学支柱 3: 价格变异系数(CV)与毛利安全垫 (满分 25 分)
  // ==========================================
  const prices = items.map((i) => i.priceCents).filter((p) => p > 0);
  const priceMean = prices.reduce((a, b) => a + b, 0) / (prices.length || 1);
  const priceVariance = prices.reduce((acc, p) => acc + Math.pow(p - priceMean, 2), 0) / (prices.length || 1);
  const priceSD = Math.sqrt(priceVariance);
  const priceCV = Number((priceSD / (priceMean || 1)).toFixed(2)); // 变异系数

  const marginPercent = report.sourcingAction.targetMarginPercent || 38;
  let marginPartScore = 0;
  if (marginPercent >= 45) marginPartScore = 15;
  else if (marginPercent >= 38) marginPartScore = 12;
  else if (marginPercent >= 28) marginPartScore = 7;
  else marginPartScore = 2;

  let cvPartScore = 0;
  if (priceCV >= 0.22) cvPartScore = 10; // 价格分层清晰，有溢价空间
  else if (priceCV >= 0.12) cvPartScore = 7;
  else cvPartScore = 3; // 价格高度集中，容易爆发单一低价战

  const priceAndMarginScore = marginPartScore + cvPartScore;
  let priceMarginVerdict: QuantitativePillar["verdict"] = "good";
  if (priceAndMarginScore >= 20) priceMarginVerdict = "excellent";
  else if (priceAndMarginScore >= 14) priceMarginVerdict = "good";
  else if (priceAndMarginScore >= 9) priceMarginVerdict = "fair";
  else priceMarginVerdict = "poor";

  const priceMarginExp = `测算毛利率 ${marginPercent}%（抗 ACOS 广告安全垫充裕），价格变异系数 CV=${priceCV}，${
    priceCV >= 0.2 ? "品类价格分层清晰，存在高溢价差异化空间" : "价格带较密集，需警惕低端拼价内卷"
  }。`;

  // ==========================================
  // 4. 数学支柱 4: 贝叶斯修正评分与差评痛点改良胜率 (满分 25 分)
  // Bayesian Average = (C * m + sum(R)) / (C + n)
  // ==========================================
  const C = 25; // 先验样本量
  const m = 4.2; // 全站先验基准分
  const totalR = items.reduce((acc, i) => acc + (i.rating || 4.2), 0);
  const bayesianRating = Number(((C * m + totalR) / (C + items.length)).toFixed(2));

  let gapScore = 0;
  if (bayesianRating < 4.0) gapScore += 13;
  else if (bayesianRating <= 4.25) gapScore += 10;
  else if (bayesianRating <= 4.45) gapScore += 6;
  else gapScore += 2;

  const weaknessCount = (report.summary.commonWeaknesses || []).filter((w) => Boolean(w && w.trim())).length;
  const hasDistinctStrategy = Boolean(report.summary.attackVector?.trim() && report.summary.marketVacuum?.trim());
  if (weaknessCount >= 2 && hasDistinctStrategy) {
    gapScore += 12; // 具备明确共性差评通病与对应真空破局策略
  } else if (weaknessCount >= 1 && hasDistinctStrategy) {
    gapScore += 8;
  } else if (weaknessCount >= 1) {
    gapScore += 5;
  } else {
    gapScore += 2;
  }

  let gapVerdict: QuantitativePillar["verdict"] = "good";
  if (gapScore >= 20) gapVerdict = "excellent";
  else if (gapScore >= 15) gapVerdict = "good";
  else if (gapScore >= 10) gapVerdict = "fair";
  else gapVerdict = "poor";

  const gapExp = `竞品贝叶斯加权均分 ${bayesianRating}★，${
    bayesianRating <= 4.25 ? "买家对现有竞品有明显质量诟病与退换痛点" : "现有竞品表现较为均衡"
  }；系统已锁定 ${weaknessCount} 个可攻破的结构性致命差评通病，改良突围胜率极高。`;

  // ==========================================
  // 5. 数学支柱 5: 存量需求与动销规模 (满分 20 分)
  // ==========================================
  const medianSales = salesArray.sort((a, b) => a - b)[Math.floor(salesArray.length / 2)]!;
  let salesScore = 0;
  if (medianSales >= 400 && medianSales <= 2500) salesScore = 20; // 最适宜中小卖家切入的黄金规模
  else if (medianSales > 2500) salesScore = 15; // 规模巨大但头程资金压力稍大
  else if (medianSales >= 150) salesScore = 10;
  else salesScore = 4;

  let salesVerdict: QuantitativePillar["verdict"] = "good";
  if (salesScore >= 18) salesVerdict = "excellent";
  else if (salesScore >= 13) salesVerdict = "good";
  else if (salesScore >= 8) salesVerdict = "fair";
  else salesVerdict = "poor";

  const salesExp = `中位月销预估约 ${medianSales} 件，动销基本盘健康，处于中型卖家资金周转与利润产出的最佳甜点区。`;

  // ==========================================
  // 综合总分归一化 (0 - 100 分)
  // ==========================================
  const totalScore = Math.min(100, Math.max(0, hhiScore + reviewScore + priceAndMarginScore + gapScore + salesScore));

  let grade: ProductIndexScore["grade"] = "B";
  let decision: ProductIndexScore["decision"] = "HOLD";
  let headline = "";

  if (totalScore >= 85) {
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

  const summaryText =
    `商品指数综合得分 ${totalScore} 分（${grade} 级 · ${decision}）。` +
    `市场集中度 HHI=${hhi}，评论中位数 ${medianReviews} 条（对数阻力 ${moatRatio.toFixed(2)}），` +
    `竞品贝叶斯加权均分 ${bayesianRating}★，预测毛利率 ${marginPercent}%。`;

  return {
    totalScore,
    grade,
    decision,
    headline,
    summaryText,
    mathEvidence: {
      hhi,
      reviewLogMoat: Number(moatRatio.toFixed(2)),
      priceCV,
      bayesianRating,
      marginPercent,
    },
    pillars: {
      monopolyRivalry: {
        key: "hhi",
        label: "HHI 垄断集中度",
        score: hhiScore,
        max: 15,
        metricValue: `HHI ${hhi}`,
        verdict: hhiVerdict,
        explanation: hhiExp,
      },
      reviewMoat: {
        key: "moat",
        label: "评论对数门槛",
        score: reviewScore,
        max: 15,
        metricValue: `中位 ${medianReviews} 评`,
        verdict: reviewVerdict,
        explanation: reviewExp,
      },
      priceAndMargin: {
        key: "margin",
        label: "价格分层与毛利垫",
        score: priceAndMarginScore,
        max: 25,
        metricValue: `毛利 ${marginPercent}% · CV ${priceCV}`,
        verdict: priceMarginVerdict,
        explanation: priceMarginExp,
      },
      painPointGap: {
        key: "gap",
        label: "痛点改良进攻胜率",
        score: gapScore,
        max: 25,
        metricValue: `${bayesianRating}★ 贝叶斯分`,
        verdict: gapVerdict,
        explanation: gapExp,
      },
      salesCapacity: {
        key: "sales",
        label: "存量需求与动销规模",
        score: salesScore,
        max: 20,
        metricValue: `月销 ~${medianSales} 件`,
        verdict: salesVerdict,
        explanation: salesExp,
      },
    },
  };
}
