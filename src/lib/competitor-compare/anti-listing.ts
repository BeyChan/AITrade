import { generateStructuredJSON } from "../ai-provider.ts";
import { loadAIProviderConfig } from "../app-settings.ts";
import type { CompetitorComparisonReport } from "./types.ts";

export type AntiListingBullet = {
  headline: string; // 大写强调词，如 【HEAVY-DUTY LOCKING MECHANISM】
  content: string; // 详细五点文案
  counterTarget: string; // 针对性反制的竞品差评痛点
};

export type AntiListingResult = {
  antiTitle: string; // 爆款反制差异化标题
  bullets: AntiListingBullet[]; // 5 条核心反制五点
  aplusModules: Array<{
    title: string;
    description: string;
    visualSuggestion: string; // A+ 差异化对比图建议
  }>;
};

export async function generateAntiListingContent(
  report: CompetitorComparisonReport,
): Promise<AntiListingResult> {
  const brand = report.competitors[0]?.brand || "MyBrand";
  const category = report.hypothesisBridge?.category || report.title;
  const weaknesses = report.summary.commonWeaknesses;
  const attackVector = report.summary.attackVector;
  const commonStrengths = report.summary.commonStrengths;

  const config = await loadAIProviderConfig();

  if (config.provider !== "template") {
    try {
      const systemPrompt = `你是一位顶级亚马逊爆款 Listing 操盘手与文案专家。
请根据竞品对比中提炼出的【竞品致命差评通病】与【进攻破局策略】，创作一套极具杀伤力的“反制 Listing 文案”。
核心原则：
1. 每一条五点描述（Bullet Point）都要有明确的【反制靶心】，针对买家对竞品吐槽最多的痛点进行定心丸式的防御与超越。
2. 语言必须是符合目标市场（${report.marketCode} 站点，地道海外英文）的高转化文案。
3. 提供 3 个适合 A+ 页面的“我优敌劣”差异化对比模块构想。

只输出合法 JSON，格式如下：
{
  "antiTitle": "包含核心关键词与差异化改良点的英文商品标题 (150-180字符)",
  "bullets": [
    {
      "headline": "[UPGRADED REINFORCED JOINT]",
      "content": "地道英文五点描述，详细说明材质结构与测试数据，消除买家对断裂的顾虑...",
      "counterTarget": "反制竞品【折叠关节反复受力易断裂】的通病"
    }
  ],
  "aplusModules": [
    {
      "title": "A+ 模块标题 (如 Our Upgraded Mechanism vs Common Flimsy Joint)",
      "description": "模块文案说明",
      "visualSuggestion": "建议采用左右分栏对比图，左侧高亮特写加厚金属轴承，右侧标红竞品塑料公模"
    }
  ]
}`;

      const aiResponse = await generateStructuredJSON({
        systemPrompt,
        userPrompt: JSON.stringify({
          category,
          weaknessesToExploit: weaknesses,
          attackVector,
          benchmarkStrengthsToRetain: commonStrengths,
          competitorTitles: report.competitors.map((c) => c.title),
          marketCode: report.marketCode,
        }),
        timeoutMs: 30_000,
        maxTokens: 3_000,
      });

      const parsed = JSON.parse(aiResponse.content) as AntiListingResult;
      if (parsed.antiTitle && Array.isArray(parsed.bullets) && parsed.bullets.length > 0) {
        return parsed;
      }
    } catch (err) {
      console.warn("AI 反制文案生成失败，启用确定性专业模板:", err);
    }
  }

  // 确定性高质量反制文案模板（免 Key / 回退模式）
  const mainConcept = report.hypothesisBridge?.concept || report.title.slice(0, 25);
  return {
    antiTitle: `Upgraded Heavy-Duty ${mainConcept} with Reinforced Construction & Dual-Action Efficiency, Designed for ${report.marketCode} Standards`,
    bullets: [
      {
        headline: "[REINFORCED STRUCTURAL DURABILITY]",
        content: `Engineered with thickened premium alloy and industrial-grade polymer to completely eliminate joint breakage and fatigue failures commonly reported in traditional models. Built to withstand daily rigorous use without wobbling.`,
        counterTarget: weaknesses[0] || "解决竞品受力部件强度不足、长期使用易断裂的致命通病",
      },
      {
        headline: "[HASSLE-FREE ERGONOMIC OPERATION]",
        content: `Features an effortless self-cleaning and quick-release mechanism that protects your hands and minimizes physical strain during extended tasks. Smooth gliding action ensures flawless coverage across all surfaces.`,
        counterTarget: weaknesses[1] || "解决竞品拆装费力、操作机构卡滞生涩的差评缺陷",
      },
      {
        headline: "[PROFESSIONAL-GRADE SURFACE CONTACT]",
        content: `Custom multi-layer micro-weave composite materials provide 2.5x superior absorption and particle retention compared to basic generic pads. Captures ultra-fine dust and hair effortlessly on both wet and dry passes.`,
        counterTarget: "吸水与毛发附着力不足、洗后粘扣脱落问题",
      },
      {
        headline: "[COMPACT SPACE-SAVING STAND DESIGN]",
        content: `Integrated self-standing base allows fast air drying and tidy vertical storage in narrow gaps between appliances or bathroom corners. Keeps your living space clean and clutter-free.`,
        counterTarget: "解决传统竞品收纳占地、倒放发霉发臭的痛点",
      },
      {
        headline: "[SATISFACTION GUARANTEED & EXTENDED CARE]",
        content: `Backed by our 12-month hassle-free manufacturer warranty and 24/7 dedicated customer service. Comes complete with extra washable replacement parts for long-term peace of mind.`,
        counterTarget: "买家对海外新品牌售后无保障与配件缺失的担忧",
      },
    ],
    aplusModules: [
      {
        title: "Heavy-Duty Upgraded Joint vs. Conventional Fragile Plastic",
        description: "Highlighting our precision-molded reinforcement structure that passed 50,000 cycle durability stress tests.",
        visualSuggestion: "采用左右对比图（Split-Screen Comparison）：左边绿色对勾展示加厚金属轴芯内部解剖结构，右边红色叉号展示竞品单薄塑料卡扣断裂示意图。",
      },
      {
        title: "Advanced Dual-Action Cleaning Efficiency",
        description: "Demonstrating 360-degree corner navigation and one-stroke fluid containment.",
        visualSuggestion: "大图特写：展示贴合踢脚线与低矮沙发死角的超薄转轴顺滑度，配合毛发水渍一次性吸净的动效示意。",
      },
      {
        title: "Effortless Self-Standing Air-Dry Footprint",
        description: "Vertical self-standing mechanism prevents moisture buildup and saves 80% storage footprint.",
        visualSuggestion: "生活方式实景图（Lifestyle Photo）：展示立于洗衣机旁 10cm 缝隙中的整洁收纳效果，凸显小户型空间友好度。",
      },
    ],
  };
}
