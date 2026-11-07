import { generateStructuredJSON } from "../ai-provider.ts";
import { loadAIProviderConfig } from "../app-settings.ts";
import type { CompetitorComparisonReport } from "./types.ts";

export type SupplierRfqDraft = {
  productName: string; // 询价品名
  targetPriceRmb: number; // 目标采购单价 (元)
  suggestedMoq: string; // 首单建议 MOQ
  specificationRequirements: string[];
  criticalImprovements: Array<{
    component: string;
    painPointTargeted: string;
    manufacturingStandard: string;
  }>;
  qualityStandard: string[];
  formattedText: string;
  /** 目标价是否来自已核实的真实竞品售价 */
  priceBasisVerified: boolean;
};

export async function generateSupplierRfqFromCompetitors(
  report: CompetitorComparisonReport,
): Promise<SupplierRfqDraft> {
  const category = report.hypothesisBridge?.category || report.title;
  const weaknesses = report.summary.commonWeaknesses;
  const attackVector = report.summary.attackVector;
  const targetCostRmb = Number(((report.sourcingAction.suggestedCostCents || 2800) / 100).toFixed(2));
  const conceptName = report.hypothesisBridge?.concept || `${category} (跨境改良款)`;
  const priceBasisVerified = (report.priceStats.verifiedSampleCount ?? 0) > 0;
  const priceCaveat = priceBasisVerified
    ? `目标价基于 ${report.priceStats.verifiedSampleCount} 条已采集的真实竞品售价推导。`
    : "目标价基于示意价格分位推导（竞品售价未经核实），仅供议价起点参考，须按真实售价重算。";

  const config = await loadAIProviderConfig();

  if (config.provider !== "template") {
    try {
      const systemPrompt = `你是一位资深跨境电商供应链采购工程师。
请基于【竞品差评痛点】与给定的【目标采购成本】，生成一份向工厂发起的定制改良询价单 (RFQ) 草案。
核心原则：
1. 把买家对竞品的感性吐槽，转化为材质、模具、公差、表面工艺与验收标准等可沟通的工程要求。
2. 所有具体数值、认证、测试次数、MOQ 与交期都写成「我方要求/待工厂确认」，不得表述为已验证事实。
3. 生成格式整洁、可复制到 1688 旺旺的沟通话术。

【合规红线】不得编造本产品已通过的认证、检测报告编号、测试次数或性能倍数；不得声称样品已检验合格；不得把给定目标成本写成市场行情或真实竞品售价。所有需要工厂回填的信息用「[待工厂确认: ...]」标注。${priceCaveat}

只输出合法 JSON，格式如下：
{
  "productName": "专业采购品名",
  "targetPriceRmb": ${targetCostRmb},
  "suggestedMoq": "首批试单 [待工厂确认: 数量]，后续按销量滚动返单",
  "specificationRequirements": ["[待工厂确认: 包装与配件清单]", "..."],
  "criticalImprovements": [
    {
      "component": "改良部件名称",
      "painPointTargeted": "对应的海外买家高频差评痛点",
      "manufacturingStandard": "给工厂的工程要求，具体参数标注 [待工厂确认: ...]"
    }
  ],
  "qualityStandard": ["[待工厂确认: 打样与验货标准]"],
  "formattedText": "可发给工厂的完整问询话术，开头注明本单为待确认草案"
}`;

      const aiResponse = await generateStructuredJSON({
        systemPrompt,
        userPrompt: JSON.stringify({
          category,
          conceptName,
          weaknessesToAddress: weaknesses,
          attackVector,
          targetPriceRmb: targetCostRmb,
          priceCaveat,
          marketCode: report.marketCode,
        }),
        timeoutMs: 30_000,
        maxTokens: 3_000,
      });

      const parsed = JSON.parse(aiResponse.content) as SupplierRfqDraft;
      if (parsed.productName && Array.isArray(parsed.criticalImprovements) && parsed.criticalImprovements.length > 0) {
        return { ...parsed, priceBasisVerified };
      }
    } catch (err) {
      console.warn("AI 生成 RFQ 失败，回退到通用待确认草案:", err);
    }
  }

  // 免 Key / 回退模式：品类无关的待确认骨架，不写死任何参数或既成事实
  const improvements: SupplierRfqDraft["criticalImprovements"] = weaknesses.map((w, idx) => ({
    component: `[待确认] 与「${w.slice(0, 18)}」相关的功能部件 ${idx + 1}`,
    painPointTargeted: w,
    manufacturingStandard:
      "请工厂针对该差评给出具体改良方案，并回填 [待工厂确认: 材质牌号 / 结构改动 / 公差范围 / 验收方法]。本项为询价要求，不代表已验证。",
  }));

  if (improvements.length === 0) {
    improvements.push({
      component: "[待确认] 关键受力 / 易损部件",
      painPointTargeted: "待补充真实差评证据",
      manufacturingStandard: "请工厂提供现有公模方案与改良建议，具体参数 [待工厂确认]。",
    });
  }

  const specs = [
    "[待工厂确认: 包装形式、跌落/运输测试标准与报告要求]",
    "[待工厂确认: 配件清单、说明书语种与标签合规要求]",
    `[待工厂确认: ${report.marketCode} 站点所需认证与检测报告清单]`,
  ];

  const qualityStandards = [
    "[待工厂确认: 首样检验项目与判定标准，样品实测后方可放行]",
    "[待工厂确认: 关键配合公差与外观验收标准]",
    "[待工厂确认: 大货抽检方案（AQL 等级、抽检比例）]",
  ];

  const formattedLines = [
    `【RFQ 草案 · 参数待确认】请先与工厂核对以下占位项，确认后再正式发送`,
    `老板您好！我们在评估 ${report.marketCode} 站点的改良款定制合作，想先了解贵厂的方案与报价梯队。`,
    ``,
    `【询价品类】：${conceptName}`,
    `【目标采购单价】：¥${targetCostRmb.toFixed(2)} / 套（我方目标，含税出厂价口径待确认）`,
    `【成本依据】：${priceCaveat}`,
    `【首单试单量】：[待工厂确认: MOQ 与阶梯报价]`,
    ``,
    `【需改良的买家痛点（源自竞品差评，非本厂产品问题）】：`,
    ...improvements.map((imp, i) => `${i + 1}. 【${imp.component}】：${imp.manufacturingStandard}`),
    ``,
    `【包装、认证与品控要求】：`,
    ...specs.map((s) => `• ${s}`),
    ...qualityStandards.map((s) => `• ${s}`),
    ``,
    `请提供：类似产品画册、可支持的改良项、模具与打样周期、阶梯报价、以及可提供的检测报告清单。谢谢！`,
  ];

  return {
    productName: conceptName,
    targetPriceRmb: targetCostRmb,
    suggestedMoq: "[待工厂确认: MOQ 与阶梯报价]",
    specificationRequirements: specs,
    criticalImprovements: improvements,
    qualityStandard: qualityStandards,
    formattedText: formattedLines.join("\n"),
    priceBasisVerified,
  };
}
