import type { ListingDraftContent } from "./listing";

export type ComplianceRiskLevel = "critical" | "warning" | "advisory";

export type ComplianceFinding = {
  id: string;
  word: string;
  category: "trademark" | "medical_fda" | "absolute_claim" | "policy_restricted";
  riskLevel: ComplianceRiskLevel;
  field: "title" | "bullets" | "description" | "searchTerms";
  fieldIndex?: number;
  reason: string;
  suggestedReplacement?: string;
};

export type ComplianceRadarResult = {
  passed: boolean;
  score: number; // 0 - 100
  criticalCount: number;
  warningCount: number;
  advisoryCount: number;
  findings: ComplianceFinding[];
  summary: string;
};

// 预置高危竞品品牌词库 (与动态竞品名合并)
const DEFAULT_BRAND_TRADEMARKS = [
  "dyson", "apple", "nike", "sony", "bose", "anker", "shark", "ninja", "roomba",
  "irobot", "philips", "braun", "oral-b", "theragun", "fitbit", "gopro", "baseus",
  "fanttik", "roborock", "ecovacs", "levoit", "cosori", "oxo", "crockpot", "instant pot"
];

// 医疗宣称与未经认证的杀菌词汇 (亚马逊下架重灾区)
const MEDICAL_FDA_RULES: Array<{ term: string; reason: string; replacement: string }> = [
  { term: "fda approved", reason: "普通跨境商品严禁声称 FDA 认证或批准，极易触发机器人下架封店", replacement: "tested to meet industry quality standards" },
  { term: "fda certified", reason: "FDA 不向普通日用品颁发认证，属虚假合规宣称", replacement: "manufactured in certified facilities" },
  { term: "cure", reason: "医疗疗效绝对化用词，触发农药/医疗器械监管审查", replacement: "designed to relieve / support" },
  { term: "treat", reason: "医疗治疗宣称，非药品不得使用", replacement: "helps address / care for" },
  { term: "antibacterial", reason: "抗菌/杀菌词汇极易被亚马逊判定为 FIFRA 农药杀虫剂类产品而误杀", replacement: "easy to clean and hygienic" },
  { term: "antimicrobial", reason: "抗微生物宣称受严格化学品农药监管", replacement: "odor-resistant material" },
  { term: "disinfect", reason: "消毒宣称需提供 EPA 农药登记号", replacement: "deep cleaning" },
  { term: "sanitize", reason: "杀菌宣称需提供专业合规报告", replacement: "washable and clean" },
  { term: "medical grade", reason: "医疗级别宣称必须具备二类医疗器械证明", replacement: "professional-grade / heavy-duty" },
  { term: "virus", reason: "病毒相关词汇直接触发高危合规下架", replacement: "dirt and dust" },
  { term: "covid", reason: "疫情相关词汇属全球禁发限制词", replacement: "daily protection" },
];

// 绝对化与违规承诺用语 (违反广告法与平台规范)
const ABSOLUTE_CLAIM_RULES: Array<{ term: string; reason: string; replacement: string }> = [
  { term: "100% guaranteed", reason: "绝对化保证用词，违反消费者权益法和广告法", replacement: "backed by our satisfaction commitment" },
  { term: "money back guarantee", reason: "退款保证属于亚马逊明令禁止在五点中出现的交易承诺", replacement: "hassle-free customer service" },
  { term: "lifetime warranty", reason: "终身保修需官方授权，且亚马逊禁止主图与标题过度宣传", replacement: "multi-year extended warranty" },
  { term: "best quality", reason: "主观最高级词汇，无权威评测依据可能导致虚假宣传争议", replacement: "premium quality construction" },
  { term: "cheapest", reason: "廉价词汇损害品牌溢价，且易引来价格争议", replacement: "exceptional value" },
  { term: "number 1", reason: "声称第一需提供尼尔森/权威三方销量证明", replacement: "highly popular / trusted by customers" },
  { term: "#1", reason: "声称排名第一属违规宣传", replacement: "top choice" },
  { term: "miracle", reason: "神迹/奇迹夸大其词，属虚假营销用语", replacement: "highly effective" },
];

// 亚马逊禁止的站外引流与交易限制词
const POLICY_RESTRICTED_RULES: Array<{ term: string; reason: string; replacement: string }> = [
  { term: "free shipping", reason: "运费由买家配送方式决定，卖家 Listing 中不得包含包邮宣称", replacement: "fulfilled by Amazon" },
  { term: "whatsapp", reason: "严禁在 Listing 中提及站外通讯工具引流", replacement: "Amazon messaging system" },
  { term: "email us", reason: "站外邮箱引流直接导致封店", replacement: "contact our support team" },
  { term: "visit our website", reason: "禁止引导买家离开亚马逊平台", replacement: "explore our store" },
];

export function scanListingCompliance(
  content: ListingDraftContent,
  dynamicCompetitorBrands: string[] = [],
): ComplianceRadarResult {
  const findings: ComplianceFinding[] = [];

  // 1. 合并所有竞品商标词
  const brandList = Array.from(
    new Set(
      [...DEFAULT_BRAND_TRADEMARKS, ...dynamicCompetitorBrands.map((b) => b.trim().toLowerCase())]
        .filter((b) => b.length >= 3 && b !== content.brand.trim().toLowerCase()),
    ),
  );

  const fieldsToCheck: Array<{ name: ComplianceFinding["field"]; text: string; index?: number }> = [
    { name: "title", text: content.title },
    ...content.bullets.map((b, i) => ({ name: "bullets" as const, text: b, index: i + 1 })),
    { name: "description", text: content.description },
    { name: "searchTerms", text: content.searchTerms },
  ];

  fieldsToCheck.forEach(({ name, text, index }) => {
    if (!text) return;
    const lower = ` ${text.toLowerCase()} `;

    // 检查竞品商标词
    brandList.forEach((brand) => {
      // 避免误伤常见通用词，使用词边界
      const regex = new RegExp(`\\b${escapeRegExp(brand)}\\b`, "i");
      if (regex.test(text)) {
        findings.push({
          id: `trademark-${brand}-${name}-${index || 0}`,
          word: brand,
          category: "trademark",
          riskLevel: "critical",
          field: name,
          fieldIndex: index,
          reason: `疑似侵犯已知品牌或竞品注册商标 [${brand}]，极易触发侵权投诉与封号`,
          suggestedReplacement: "请移除该品牌词，或使用通用功能描述",
        });
      }
    });

    // 检查医疗与 FDA 违规词
    MEDICAL_FDA_RULES.forEach((rule) => {
      const regex = new RegExp(`\\b${escapeRegExp(rule.term)}\\b`, "i");
      if (regex.test(text)) {
        findings.push({
          id: `medical-${rule.term}-${name}-${index || 0}`,
          word: rule.term,
          category: "medical_fda",
          riskLevel: "critical",
          field: name,
          fieldIndex: index,
          reason: rule.reason,
          suggestedReplacement: rule.replacement,
        });
      }
    });

    // 检查绝对化承诺词
    ABSOLUTE_CLAIM_RULES.forEach((rule) => {
      const regex = new RegExp(`\\b${escapeRegExp(rule.term)}\\b`, "i");
      if (regex.test(text)) {
        findings.push({
          id: `claim-${rule.term}-${name}-${index || 0}`,
          word: rule.term,
          category: "absolute_claim",
          riskLevel: "warning",
          field: name,
          fieldIndex: index,
          reason: rule.reason,
          suggestedReplacement: rule.replacement,
        });
      }
    });

    // 检查站外引流与政策违禁词
    POLICY_RESTRICTED_RULES.forEach((rule) => {
      const regex = new RegExp(`\\b${escapeRegExp(rule.term)}\\b`, "i");
      if (regex.test(text)) {
        findings.push({
          id: `policy-${rule.term}-${name}-${index || 0}`,
          word: rule.term,
          category: "policy_restricted",
          riskLevel: "critical",
          field: name,
          fieldIndex: index,
          reason: rule.reason,
          suggestedReplacement: rule.replacement,
        });
      }
    });
  });

  const criticalCount = findings.filter((f) => f.riskLevel === "critical").length;
  const warningCount = findings.filter((f) => f.riskLevel === "warning").length;
  const advisoryCount = findings.filter((f) => f.riskLevel === "advisory").length;

  const passed = criticalCount === 0;
  const score = Math.max(0, 100 - criticalCount * 30 - warningCount * 10 - advisoryCount * 5);

  let summary = "合规排查全绿，未发现明显侵权与违规风险词。";
  if (criticalCount > 0) {
    summary = `检测到 ${criticalCount} 处高危阻断风险（包含疑似竞品商标或违规医疗/引流宣称），上架前必须修正！`;
  } else if (warningCount > 0) {
    summary = `检测到 ${warningCount} 处合规预警（主要为绝对化承诺或营销用语），建议微调替换。`;
  }

  return {
    passed,
    score,
    criticalCount,
    warningCount,
    advisoryCount,
    findings,
    summary,
  };
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
