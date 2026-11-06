import type { ProposalGeneration } from "./contract.ts";

/** 生成方式的可读描述。所有 AI 产出卡片共用，避免各处文案不一致。 */
export function generationLabel(generation: ProposalGeneration): string {
  if (generation.source === "manual") return "人工触发采集 · 确定性规则评分";
  if (generation.source === "template") {
    return generation.fallback ? "模板兜底 · 模型调用失败" : "确定性模板生成";
  }
  return `模型生成 · ${generation.model || generation.provider || "未记录模型"}`;
}
