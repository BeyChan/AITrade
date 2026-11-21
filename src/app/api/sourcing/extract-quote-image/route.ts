import { loadAIProviderConfig, validateBaseUrl } from "@/lib/app-settings";
import { ANTHROPIC_API_VERSION, anthropicMessagesEndpoint, extractAnthropicText } from "@/lib/ai-provider";
import { recordAuditLog } from "@/lib/audit-logs";
import { detectImageType } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

const SYSTEM_PROMPT = `你是跨境电商采购报价单结构化提取助手。请从用户上传的 1688 / 工厂报价单截图或聊天记录截图中，准确提取真实存在的字段。
硬性规则：
1. 只输出纯 JSON 对象，不要 Markdown 代码块。
2. 严禁编造或猜测图片中未明确出现的数字或文字；没有就省略该字段。
3. 可提取字段键名：supplierName, supplierPlatform, contact, unitPrice, freightPerUnit, dutyRate, moq, leadTimeDays, sampleFee, incoterm, paymentTerms, certifications, supplierNotes。
4. unitPrice / freightPerUnit / sampleFee 请输出纯数字字符串（例如 "12.50"），moq / leadTimeDays 输出整数字符串。`;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return Response.json({ error: "请上传工厂报价单截图（PNG / JPG / WebP）" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: "图片大小不能超过 8 MB" }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const detected = detectImageType(bytes);
    if (!detected) {
      return Response.json({ error: "仅支持真实 PNG、JPG 或 WebP 图片文件" }, { status: 400 });
    }

    const config = await loadAIProviderConfig();
    if (config.provider === "template" || (!config.apiKey && config.provider !== "ollama")) {
      return Response.json(
        {
          error: "当前未配置多模态大模型（请在「大模型设置」配置支持视觉的 OpenAI / Anthropic 兼容接口），可先直接粘贴文字报价。",
          code: "vision_not_configured",
        },
        { status: 409 },
      );
    }

    validateBaseUrl(config.baseUrl);
    const base64 = bytes.toString("base64");
    const dataUrl = `data:${detected.mimeType};base64,${base64}`;
    let rawOutput = "";

    if (config.provider === "anthropic-compatible") {
      const res = await fetch(anthropicMessagesEndpoint(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({
          model: config.model,
          system: SYSTEM_PROMPT,
          max_tokens: 900,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: detected.mimeType, data: base64 },
                },
                { type: "text", text: "请提取这张工厂报价单中的全部可见报价字段，只返回 JSON。" },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`视觉模型接口返回 ${res.status}`);
      rawOutput = extractAnthropicText(await res.json()) ?? "";
    } else if (config.provider === "openai-compatible") {
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
          max_tokens: 900,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "请提取这张工厂报价单中的全部可见报价字段，只返回 JSON。" },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`视觉模型接口返回 ${res.status}`);
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      rawOutput = json.choices?.[0]?.message?.content?.trim() ?? "";
    } else {
      const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/api/chat`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: "请提取这张工厂报价单中的全部可见报价字段，只返回 JSON。",
              images: [base64],
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Ollama 视觉接口返回 ${res.status}`);
      const json = (await res.json()) as { message?: { content?: string } };
      rawOutput = json.message?.content?.trim() ?? "";
    }

    const parsed = parseLooseJsonObject(rawOutput);
    if (!parsed) {
      return Response.json(
        { error: "未能从截图中解析出结构化报价字段，请确认图片清晰度或改用文本粘贴。" },
        { status: 422 },
      );
    }

    const allowedKeys = [
      "supplierName",
      "supplierPlatform",
      "contact",
      "unitPrice",
      "freightPerUnit",
      "dutyRate",
      "moq",
      "leadTimeDays",
      "sampleFee",
      "incoterm",
      "paymentTerms",
      "certifications",
      "supplierNotes",
    ] as const;

    const fields: Record<string, string> = {};
    for (const key of allowedKeys) {
      const v = parsed[key];
      if (typeof v === "string" && v.trim()) fields[key] = v.trim();
      else if (typeof v === "number" && Number.isFinite(v)) fields[key] = String(v);
    }

    await recordAuditLog({
      actor: "采购人员",
      action: "sourcing.quote_image_extracted",
      entityType: "supplier",
      entityId: fields.supplierName || "quote_image",
      details: {
        supplierName: fields.supplierName || undefined,
        unitPrice: fields.unitPrice || undefined,
        count: Object.keys(fields).length,
        provider: config.provider,
        model: config.model,
      },
    }).catch(() => {});

    return Response.json({
      success: true,
      fields,
      count: Object.keys(fields).length,
      requiresReview: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "报价单图片识别失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

function parseLooseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
