import { generateStructuredJSON } from "../ai-provider.ts";
import { loadAIProviderConfig } from "../app-settings.ts";
import type { CompetitorComparisonReport } from "./types.ts";

export type AntiListingBullet = {
  headline: string; // 大写强调词
  content: string; // 五点文案（含待核实占位）
  counterTarget: string; // 针对性反制的竞品差评痛点
};

export type AntiListingResult = {
  antiTitle: string;
  bullets: AntiListingBullet[];
  aplusModules: Array<{
    title: string;
    description: string;
    visualSuggestion: string;
  }>;
};

/** 待核实占位符：所有需实测/需凭证支撑的表述统一用它，写入前必须替换 */
export const VERIFY_PLACEHOLDER = "[VERIFY:";

/** 统计一份文案里还有多少处未核实的占位，供 UI 与写入前置检查使用 */
export function countVerifyPlaceholders(result: AntiListingResult): number {
  const parts = [
    result.antiTitle,
    ...result.bullets.flatMap((b) => [b.headline, b.content, b.counterTarget]),
    ...result.aplusModules.flatMap((m) => [m.title, m.description, m.visualSuggestion]),
  ];
  return parts.reduce((sum, text) => sum + (text.split(VERIFY_PLACEHOLDER).length - 1), 0);
}

/**
 * AI 输出的后置净化：prompt 是软约束，模型仍可能写出认证、测试次数、倍数、
 * 保修年限等无法核实的事实。命中的一律换成占位，不静默放行。
 */
function scrubUnverifiedClaims(text: string): string {
  let out = text;
  const rules: Array<[RegExp, string]> = [
    [/\b\d+(?:\.\d+)?\s*x\s+(?:superior|better|more|faster|stronger|absorption|performance)/gi, "[VERIFY: 实测倍数与测试方法]"],
    [/\b\d[\d,]*\s*(?:-\s*)?(?:cycle|cycles|times|tests?|hours?)\b/gi, "[VERIFY: 实测次数与测试条件]"],
    [/\b\d+\s*[- ]?(?:month|months|year|years)\s+(?:hassle-free\s+)?(?:manufacturer\s+)?(?:warranty|guarantee)\b/gi, "[VERIFY: 实际保修政策]"],
    [/\b(?:CE|FCC|RoHS|FDA|UL|ISO\s?\d+|certified|certification)\b/gi, "[VERIFY: 有效认证与证书编号]"],
    [/\b24\/7\b|\blifetime\s+(?:warranty|guarantee|support)\b/gi, "[VERIFY: 实际服务承诺]"],
    [/\b(?:completely eliminate|flawless|guaranteed|satisfaction guaranteed|100%\s)/gi, "[VERIFY: 请改写为可验证的客观描述] "],
    [/\b(?:passed|certified by|tested to)\s+[^.,;]{0,60}/gi, "[VERIFY: 检测机构与报告编号]"],
    [/\bsaves?\s+\d+\s*%/gi, "[VERIFY: 实测节省比例]"],
  ];
  for (const [pattern, replacement] of rules) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function scrubResult(result: AntiListingResult): AntiListingResult {
  return {
    antiTitle: scrubUnverifiedClaims(result.antiTitle),
    bullets: result.bullets.map((b) => ({
      headline: scrubUnverifiedClaims(b.headline),
      content: scrubUnverifiedClaims(b.content),
      counterTarget: scrubUnverifiedClaims(b.counterTarget),
    })),
    aplusModules: result.aplusModules.map((m) => ({
      title: scrubUnverifiedClaims(m.title),
      description: scrubUnverifiedClaims(m.description),
      visualSuggestion: scrubUnverifiedClaims(m.visualSuggestion),
    })),
  };
}

/** 品类无关的确定性草稿骨架：只给结构与占位，不生成任何具体事实 */
function buildPlaceholderDraft(report: CompetitorComparisonReport): AntiListingResult {
  const concept = report.hypothesisBridge?.concept || report.title.slice(0, 25);
  const weaknesses = report.summary.commonWeaknesses;
  const attackVector = report.summary.attackVector;

  const makeBullet = (headline: string, weakness: string | undefined, index: number): AntiListingBullet => ({
    headline,
    content:
      `针对买家反馈「${weakness?.trim() || `竞品差评 ${index + 1}`}」，本品拟采用 ` +
      `[VERIFY: 具体的结构/材质/工艺改动]。相关性能参数为 ` +
      `[VERIFY: 实测数值 + 检测方法 + 报告编号]。占位未替换前不得对外发布。`,
    counterTarget: weakness?.trim() || `${attackVector || "待补充对标痛点"}`,
  });

  return {
    antiTitle: `[DRAFT] ${concept} — [VERIFY: 品类关键词与核心差异化卖点] for ${report.marketCode}`,
    bullets: [
      makeBullet("[DESIGN CHANGE 1]", weaknesses[0], 0),
      makeBullet("[DESIGN CHANGE 2]", weaknesses[1], 1),
      makeBullet("[DESIGN CHANGE 3]", weaknesses[2], 2),
      makeBullet("[PACKAGING & INSTRUCTIONS]", weaknesses[3], 3),
      makeBullet("[AFTER-SALES POLICY]", weaknesses[4], 4),
    ],
    aplusModules: [
      {
        title: "[VERIFY: A+ 模块 1 标题 — 只描述本品设计]",
        description: "[VERIFY: 本品结构/材质的可验证说明；如需参数请附检测报告编号]",
        visualSuggestion: "建议采用产品结构特写与使用场景实拍；图中所有参数需与实测一致。",
      },
      {
        title: "[VERIFY: A+ 模块 2 标题 — 使用方式]",
        description: "[VERIFY: 真实使用步骤与适用范围，不得写未实测的效率或倍数]",
        visualSuggestion: "建议使用实拍步骤图，避免出现竞品名称或贬损对比。",
      },
      {
        title: "[VERIFY: A+ 模块 3 标题 — 规格与清单]",
        description: "[VERIFY: 实际规格、配件清单与保修政策；以工厂与平台确认为准]",
        visualSuggestion: "建议使用规格表格与配件平铺图，数据须与包装一致。",
      },
    ],
  };
}

export async function generateAntiListingContent(
  report: CompetitorComparisonReport,
): Promise<AntiListingResult> {
  const category = report.hypothesisBridge?.category || report.title;
  const weaknesses = report.summary.commonWeaknesses;
  const attackVector = report.summary.attackVector;
  const commonStrengths = report.summary.commonStrengths;

  const config = await loadAIProviderConfig();

  if (config.provider !== "template") {
    try {
      const systemPrompt = `你是一位资深跨境电商 Listing 文案编辑。
请根据竞品对比中提炼出的【买家差评痛点】与【改良方向】，产出一套「待核实」的反制 Listing 草稿骨架。
核心原则：
1. 每一条五点描述都要有明确的改良靶心，只写设计方向，不写既成事实。
2. 语言为符合目标市场（${report.marketCode} 站点）的地道海外英文，但凡需实测数据支撑的表述一律写成 "[VERIFY: 具体参数]" 占位。
3. 提供 3 个 A+ 模块构想，只描述本品设计，不贬损或指名比较竞品。

【合规红线】禁止编造任何未经核实的认证、实验室测试次数、循环寿命、倍数性能对比、保修年限、客服承诺、绝对化用语（best / flawless / completely eliminate / guaranteed）以及具体销量或评分。所有数值、认证、性能、售后承诺都必须以 [VERIFY: ...] 占位，交由运营在打样与检测后据实填写。不得输出平台禁止的主观对比词或医疗/安全功效声明。

只输出合法 JSON，格式如下：
{
  "antiTitle": "含 [VERIFY: ...] 占位的英文商品标题草稿",
  "bullets": [
    {
      "headline": "[DESIGN CHANGE 1]",
      "content": "英文五点草稿；只写可验证的设计方向与 [VERIFY: 具体参数] 占位...",
      "counterTarget": "针对的竞品差评痛点，说明改良方向"
    }
  ],
  "aplusModules": [
    {
      "title": "[VERIFY: A+ 模块标题，只描述本品设计]",
      "description": "模块说明，参数用 [VERIFY: 实测参数] 占位",
      "visualSuggestion": "建议采用产品结构特写图与使用场景实拍图"
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
        return scrubResult(parsed);
      }
    } catch (err) {
      console.warn("AI 反制文案生成失败，启用待核实占位草稿:", err);
    }
  }

  // 免 Key / 回退模式：只产出结构与占位，不生成任何品类专属或未经核实的事实
  return buildPlaceholderDraft(report);
}
