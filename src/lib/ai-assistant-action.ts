"use server";

import {
  ANTHROPIC_API_VERSION,
  anthropicMessagesEndpoint,
  extractAnthropicText,
} from "./ai-provider.ts";
import { loadAIProviderConfig, validateBaseUrl } from "./app-settings.ts";
import { recordAuditLog } from "./audit-logs.ts";
import { loadCopilotContext, type CopilotContext } from "./copilot-context.ts";
import { moneyIn, percent } from "./format.ts";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  source?: "ai" | "local";
  modelLabel?: string;
};

export type AiAssistantReply = {
  content: string;
  source: "ai" | "local";
  provider: string;
  modelLabel: string;
  contextLabel: string;
};

export type CopilotContextPreview = {
  scope: CopilotContext["scope"];
  label: string;
  badge: string;
  quickPrompts: CopilotContext["quickPrompts"];
};

export async function getCopilotContextPreview(
  pathname: string,
  search = "",
): Promise<CopilotContextPreview> {
  const ctx = await loadCopilotContext(pathname, search);
  return {
    scope: ctx.scope,
    label: ctx.label,
    badge: ctx.badge,
    quickPrompts: ctx.quickPrompts,
  };
}

const SYSTEM_PROMPT = `你是 AITrade 跨境电商超级智能业务助手（AI Copilot）。
你的职责是协助跨境卖家和操盘手进行高确定性的选品决策、成本测算、1688 源头寻源与多平台 Listing 打造。

你的专业知识体系：
1. 确定性门禁（Deterministic Gate）：系统默认净利率门禁线为 18% (minMarginRate = 0.18)，任何预测都不能替代真实采购成本、头程运费与平台佣金。
2. 1688 寻源与议价：初次询价避免直接砍大价，应先核实是否源头工厂、公模现货起订量（MOQ）、打样周期与定制包装成本，利用多厂比价报告掌握成本底牌。
3. 竞品差评反向改良：从 1-3 星差评提取真实结构、材质或散热痛点，做微改良差异化，而不是盲目做全新品类。
4. 市场与平台差异：US 站重体量与广告 ROAS，JP 站重细节做工与紧凑收纳，TikTok 重视觉痛点展示，Amazon 重 Review 沉淀与确定性合规。
5. 原型边界：本系统为单机数据原型，不接平台直接写入发布，所有最终上架均通过下载 Flat File 批量文件在后台上传。

回答风格：
- 专业、严谨、条理清晰，使用精炼的 Markdown 格式（可使用列表、加粗、小标题）；
- 拒绝空洞套话，直接给出可执行的业务建议与核对清单；
- 回答限制在 300 字以内，快速响应操盘手。`;

export async function chatWithAiAssistant(
  history: ChatMessage[],
  options?: { pathname?: string; search?: string },
): Promise<AiAssistantReply> {
  const lastUserMessage = history.filter((m) => m.role === "user").pop()?.content ?? "";
  const pathname = options?.pathname ?? "/";
  const search = options?.search ?? "";

  if (!lastUserMessage.trim()) {
    return {
      content: "请问有什么选品、1688 寻源或成本门禁相关的问题我可以帮您解答？",
      source: "local",
      provider: "local-knowledge",
      modelLabel: "本地专家规则",
      contextLabel: "全局视图",
    };
  }

  const [config, context] = await Promise.all([
    loadAIProviderConfig(),
    loadCopilotContext(pathname, search),
  ]);

  const contextualSystemPrompt = `${SYSTEM_PROMPT}

【当前在场业务上下文（仅可引用以下已核实数据，严禁编造额外数字或 ASIN）】
${context.summaryText}`;

  const logAndReturn = async (reply: AiAssistantReply): Promise<AiAssistantReply> => {
    await recordAuditLog({
      actor: "本机用户",
      action: "ai_assistant.chatted",
      entityType: context.caseSnapshot ? "product_case" : "ai_task",
      entityId: context.caseSnapshot?.caseId ?? context.scope,
      details: {
        pathname,
        scope: context.scope,
        contextLabel: context.label,
        source: reply.source,
        provider: reply.provider,
        model: reply.modelLabel,
        promptPreview: lastUserMessage.slice(0, 80),
      },
    }).catch(() => {});
    return reply;
  };

  // 如果配置了真实的大模型（OpenAI-compatible、Anthropic-compatible 或 Ollama）
  if (config.provider === "anthropic-compatible" && config.apiKey && config.baseUrl && config.model) {
    try {
      validateBaseUrl(config.baseUrl);
      const messages = normalizeAnthropicMessages(history.slice(-6), lastUserMessage);
      const res = await fetch(anthropicMessagesEndpoint(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({
          model: config.model,
          system: contextualSystemPrompt,
          messages,
          temperature: 0.7,
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const json = await res.json();
        const reply = extractAnthropicText(json);
        if (reply) {
          return logAndReturn({
            content: reply,
            source: "ai",
            provider: config.provider,
            modelLabel: config.model,
            contextLabel: context.label,
          });
        }
      }
    } catch {
      // 降级使用内置确定性专家知识库
    }
  }

  if (config.provider === "openai-compatible" && config.apiKey && config.baseUrl && config.model) {
    try {
      const endpoint = config.baseUrl.replace(/\/+$/, "").endsWith("/v1")
        ? `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`
        : `${config.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: contextualSystemPrompt },
            ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          ],
          temperature: 0.7,
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const json = await res.json();
        const reply = json.choices?.[0]?.message?.content?.trim();
        if (reply) {
          return logAndReturn({
            content: reply,
            source: "ai",
            provider: config.provider,
            modelLabel: config.model,
            contextLabel: context.label,
          });
        }
      }
    } catch {
      // 降级使用内置确定性专家知识库
    }
  }

  if (config.provider === "ollama" && config.baseUrl && config.model) {
    try {
      const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/api/chat`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          messages: [
            { role: "system", content: contextualSystemPrompt },
            ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const json = await res.json();
        const reply = json.message?.content?.trim();
        if (reply) {
          return logAndReturn({
            content: reply,
            source: "ai",
            provider: config.provider,
            modelLabel: config.model,
            contextLabel: context.label,
          });
        }
      }
    } catch {
      // 降级使用内置确定性专家知识库
    }
  }

  // 内置跨境操盘手智能应答引擎（结合在场上下文，免配置开箱即用）
  return logAndReturn({
    content: generateDeterministicKnowledgeResponse(lastUserMessage, context),
    source: "local",
    provider: "local-knowledge",
    modelLabel: "本地专家规则",
    contextLabel: context.label,
  });
}

function normalizeAnthropicMessages(history: ChatMessage[], fallbackUserMessage: string): ChatMessage[] {
  const merged: ChatMessage[] = [];
  for (const item of history) {
    const content = item.content.trim();
    if (!content) continue;
    if (merged.length === 0 && item.role !== "user") continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.role === item.role) {
      prev.content = `${prev.content}\n\n${content}`;
    } else {
      merged.push({ role: item.role, content });
    }
  }
  if (merged.length === 0) {
    return [{ role: "user", content: fallbackUserMessage.trim() }];
  }
  return merged;
}

function generateDeterministicKnowledgeResponse(question: string, context?: CopilotContext): string {
  const q = question.toLowerCase();
  const snap = context?.caseSnapshot;

  // 若用户在具体案卷页，优先输出基于当前案卷真实数据的确定性诊断
  if (snap && (q.includes("门禁") || q.includes("利润") || q.includes("成本") || q.includes("18%") || q.includes("破局") || q.includes("诊断"))) {
    const gapText = snap.landedGapCents > 0
      ? `超出 18% 门禁上限 **${moneyIn(snap.currency, snap.landedGapCents)}（约 ¥${snap.landedGapRmb}）**`
      : `低于上限，尚有 **${moneyIn(snap.currency, Math.abs(snap.landedGapCents))}** 安全缓冲`;
    return `### 当前案卷 18% 门禁诊断（${snap.asin}）

当前判定 **${snap.recommendation}（${snap.score} 分）**：售价 ${moneyIn(snap.currency, snap.salePriceCents)}，单件净利 ${moneyIn(snap.currency, snap.netProfitCents)}（净利率 **${percent(snap.marginRate)}**），压力情景净利 **${moneyIn(snap.currency, snap.stressProfitCents)}**。

1. **到岸成本底线**：要满足 18% 净利率，最高允许到岸成本为 **${moneyIn(snap.currency, snap.maxLandedFor18Cents)}**；当前录入 ${moneyIn(snap.currency, snap.landedCostCents)}，${gapText}。
2. **广告安全线**：当前 ACoS 设为 ${percent(snap.adRate)}，广告盈亏平衡点为 **${percent(snap.breakEvenAdRate)}**（超过此线即单件亏损）。
3. **立即可试的破局动作**：直接拖动本页「交互式财务沙盘」滑杆，验证：① 1688 压价 ¥${snap.landedGapRmb > 0 ? snap.landedGapRmb : 3} 降本；② 压缩彩盒体积降头程/FBA 费；③ 借竞品差评做配件组合提价测试。`;
  }

  if (snap && (q.includes("1688") || q.includes("压价") || q.includes("话术") || q.includes("工厂") || q.includes("询价"))) {
    return `### 针对「${snap.category} · ${snap.asin}」的 1688 压价底牌与话术

本品按售价 ${moneyIn(snap.currency, snap.salePriceCents)} 倒推，含头程与关税的**最高允许到岸价为 ${moneyIn(snap.currency, snap.maxLandedFor18Cents)}**${snap.landedGapCents > 0 ? `（当前需再压降约 ¥${snap.landedGapRmb}/件）` : "（当前已达标，仍可谈阶梯让利）"}。

1. **可直接复制的询价/压价话术**：
   「你好，我们在做 ${snap.marketplace} 站 ${snap.category} 精品线，首单预计 300–500 套，稳定后月返单 1500+。目前对比了 3 家源头厂，贵司品质很匹配，但核算亚马逊 FBA 与头程后，含税出厂价需要再降 ¥${snap.landedGapRmb > 0 ? Math.ceil(snap.landedGapRmb) : 3} 左右才能立项。如果首单 500 套且简化非核心配件/改中性牛皮纸内盒，能否给到这个底价？」
2. **必问三项防坑**：核对单箱尺寸与毛重（防抛货体积重）、打样费是否大货可退、交期与质检不良率承诺。`;
  }

  if (snap && (q.includes("广告") || q.includes("退货") || q.includes("风险") || q.includes("止损"))) {
    const headroom = snap.breakEvenAdRate - snap.adRate;
    return `### 案卷风险与止损线评估（${snap.asin}）

- **广告容错空间**：当前设定 ACoS ${percent(snap.adRate)}，盈亏平衡点 **${percent(snap.breakEvenAdRate)}**（余量 **${percent(headroom)}**）。冷启动期建议将单品广告止损线设为 ${percent(Math.max(0.15, snap.breakEvenAdRate))}。
- **退货与压测**：当前假设退货率 ${percent(snap.returnRate)}；压力情景（售价 −10%、成本 +20%、广告 +20%、退货 +2%）下净利为 **${moneyIn(snap.currency, snap.stressProfitCents)}**${snap.stressProfitCents <= 0 ? "（已亏损，务必先压低采购价或提高客单价）" : "（仍保持盈利，抗风险合格）"}。
- **当前卡点**：${snap.riskReasons.length ? snap.riskReasons.join("；") : "基础财务与门禁均已通过，可推进下一步。"}`;
  }

  if (q.includes("门禁") || q.includes("利润") || q.includes("成本") || q.includes("18%")) {
    return `### 📊 18% 净利润硬门禁倒推指引

系统设定 **18% 净利率 (minMarginRate = 0.18)** 为通过 GO 门禁的标准线：
1. **最高采购倒推公式**：
   \`最高含税到岸价 ≤ 售价 × (1 - 平台佣金率 15% - FBA费率 - 广告预留 12% - 退货损耗 6% - 目标净利 18%)\`
2. **通常标准**：对于客单价 $30~$40 的商品，工厂出厂价必须控制在售价的 **15% ~ 22%** 以内（约 ¥30~¥55 RMB）。
3. **操盘手行动**：若当前报价净利低于 18%，切勿盲目立项，应优先在 1688 寻找 2~3 家同款工厂对比开模/微改报价，或缩减冗余配件。`;
  }

  if (q.includes("1688") || q.includes("供应商") || q.includes("工厂") || q.includes("询价") || q.includes("moq")) {
    return `### 🏭 1688 源头工厂高效询价 4 步法

1. **破冰定调**：
   - 「你好，我们专注北美 Amazon/TikTok 精品运营，月销预估 1500+ 件，主看【公模现货+定制包装】。」
2. **摸清核心参数**：
   - 白牌/公模现货起订量（MOQ）；
   - 首批定制 Logo / 换彩盒的起订门槛；
   - 现货打样费用及大货是否全额退还。
3. **压价策略**：
   - 绝不一上来砍死价格，先要阶梯报价（100件 / 500件 / 2000件）；
   - 拿同款在办商品的最低报价作为谈判底牌（如已有 3 家工厂入围）。`;
  }

  if (q.includes("日本") || q.includes("jp") || q.includes("美国") || q.includes("站点") || q.includes("差异")) {
    return `### ⚖️ 美国站 (US) vs 日本站 (JP) 选品核心差异

- **美国站 (US)**：
  - **特点**：大容量、强吸力/动力、耐用性要求高，广告竞价激烈；
  - **关键**：供应链成本必须极致，首单备货需能承载 FBA 补货周期（45~60天）。
- **日本站 (JP)**：
  - **特点**：偏好紧凑轻便、低噪音（夜间清洁）、包装精致、说明书严谨；
  - **关键**：对退货瑕疵容忍度极低，PSE/认证必须齐全，单品毛利率通常可比美站高出 3~5 个点。`;
  }

  if (q.includes("侵权") || q.includes("专利") || q.includes("listing") || q.includes("标题")) {
    return `### 🛡️ Listing 标题与外观防侵权核验清单

1. **品牌词避坑**：绝不可将竞品品牌（如 Dyson、Bissell、Shark）直接写入 Title、Bullets 或 Search Terms，可用「Compatible with...」且仅限于通用配件。
2. **外观专利雷区**：1688 工厂宣传的“爆款同款”，需索要真实专利检索截图，重点核验手柄卡扣、风道结构是否踩雷。
3. **后台搜索词规范**：严禁包含任何标点符号（如逗号、分号），全部以空格隔开，字符控制在保守上限（250 字节以内）。`;
  }

  // 通用智能问答
  return `### 💡 AITrade 操盘手建议

针对您关注的问题「**${question.slice(0, 30)}**」：

1. **数据先行**：先检查该类目在当前站点的真实竞品中位价与近 30 天评论负向痛点。
2. **锁定确定性**：
   - 选品验证阶段：先在选品研报中补充至少 3 条真实证据（竞品对比 + 差评抽样）；
   - 成本核准阶段：在 1688 录入至少 2 家工厂真实报价，确保净利率达到 18% 硬门禁。
3. **快捷直达**：您可直接使用当前浮窗切换至「🔍 全域秒搜」检索具体商品 ASIN、研报品类或 1688 工厂资产库。`;
}
