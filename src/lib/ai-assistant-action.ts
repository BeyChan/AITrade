"use server";

import { loadAIProviderConfig } from "./app-settings.ts";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

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

export async function chatWithAiAssistant(history: ChatMessage[]): Promise<string> {
  const lastUserMessage = history.filter((m) => m.role === "user").pop()?.content ?? "";
  if (!lastUserMessage.trim()) {
    return "请问有什么选品、1688 寻源或成本门禁相关的问题我可以帮您解答？";
  }

  const config = await loadAIProviderConfig();

  // 如果配置了真实的大模型（OpenAI-compatible 或 Ollama）
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
            { role: "system", content: SYSTEM_PROMPT },
            ...history.slice(-6),
          ],
          temperature: 0.7,
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const json = await res.json();
        const reply = json.choices?.[0]?.message?.content?.trim();
        if (reply) return reply;
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
            { role: "system", content: SYSTEM_PROMPT },
            ...history.slice(-6),
          ],
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const json = await res.json();
        const reply = json.message?.content?.trim();
        if (reply) return reply;
      }
    } catch {
      // 降级使用内置确定性专家知识库
    }
  }

  // 内置跨境操盘手智能应答引擎（免配置开箱即用）
  return generateDeterministicKnowledgeResponse(lastUserMessage);
}

function generateDeterministicKnowledgeResponse(question: string): string {
  const q = question.toLowerCase();

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
