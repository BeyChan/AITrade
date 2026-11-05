import { generateStructuredJSON, getAIProviderStatus } from "../ai-provider.ts";
import {
  applySupplierPolish,
  buildDeterministicSupplierDraft,
  parseSupplierPolish,
  validateSupplierPolish,
  type SupplierDraftContent,
  type SupplierDraftFactSnapshot,
  type SupplierDraftGenerationMode,
  type SupplierDraftType,
} from "./schema.ts";

const SYSTEM_PROMPT = `你是跨境采购流程中的供应商沟通助理。你只能改写主题和开场文字，不能替供应商回答事实，不能新增价格、MOQ、交期、认证、销量、利润或承诺。

硬性规则：
1. 只输出 JSON，不输出 Markdown。
2. 必须保留给定的商品方向原文。
3. 不得新增输入事实之外的数字、日期、认证或结论。
4. 不得声称已经联系、发送、下单、付款或获得认证。
5. 缺失信息会由确定性程序追加为问题，你不要自行补值。

输出结构：{"subject":"邮件或消息主题","introduction":"仅供供应商查看的开场文字"}`;

export type SupplierDraftGenerationResult = {
  content: SupplierDraftContent;
  mode: SupplierDraftGenerationMode;
  provider: string;
  model: string;
  note: string;
};

export async function generateSupplierDraft(input: {
  draftType: SupplierDraftType;
  facts: SupplierDraftFactSnapshot;
}): Promise<SupplierDraftGenerationResult> {
  const deterministic = buildDeterministicSupplierDraft(input);
  const status = await getAIProviderStatus();

  if (!status.configured || status.provider === "template") {
    return {
      content: deterministic,
      mode: "deterministic",
      provider: status.provider,
      model: status.model,
      note: "未配置可用模型，使用确定性模板生成。",
    };
  }

  try {
    const generated = await generateStructuredJSON({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: JSON.stringify({
        draftType: input.draftType,
        facts: input.facts,
        deterministicSubject: deterministic.subject,
        deterministicIntroduction: deterministic.introduction,
        questionsThatWillBeAppended: deterministic.questions,
      }),
      timeoutMs: 35_000,
      maxTokens: 1_000,
    });
    const raw = parseSupplierPolish(generated.content);
    const validation = validateSupplierPolish(raw, deterministic, input.facts);
    if (!validation.ok) throw new Error(validation.error);
    return {
      content: applySupplierPolish(deterministic, validation.value),
      mode: "model_polished",
      provider: generated.provider,
      model: generated.model,
      note: "开场与主题由模型润色；缺失项问题由确定性代码追加。",
    };
  } catch (error) {
    return {
      content: deterministic,
      mode: "deterministic",
      provider: status.provider,
      model: status.model,
      note: `模型润色失败，已回退确定性模板：${safeError(error)}`,
    };
  }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .slice(0, 220);
}
