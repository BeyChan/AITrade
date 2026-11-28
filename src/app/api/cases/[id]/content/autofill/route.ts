import { NextResponse } from "next/server";
import { generateStructuredJSON } from "@/lib/ai-provider";
import { recordAuditLog } from "@/lib/audit-logs";
import { getCaseDetail, getContentDetail } from "@/lib/repository";
import { getAppMode } from "@/lib/app-mode";


type AutofillTarget = "definition" | "listing";

type DefinitionFields = {
  productName: string;
  targetCustomer: string;
  coreDifferentiator: string;
  specifications: string;
  packageContents: string;
  claimsToAvoid: string;
};

type ListingFields = {
  brand: string;
  title: string;
  bullets: string[];
  description: string;
  searchTerms: string;
};

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = stripCodeFences(raw);
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asCleanString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clampUtf8Bytes(input: string, maxBytes: number): string {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  let out = "";
  for (const token of tokens) {
    const next = out ? `${out} ${token}` : token;
    if (Buffer.byteLength(next, "utf8") > maxBytes) break;
    out = next;
  }
  return out;
}

function buildTemplateDefinition(params: {
  title: string;
  category: string;
  marketplace: string;
  notes: string;
  evidenceLines: string[];
}): DefinitionFields {
  const { title, category, marketplace, notes, evidenceLines } = params;
  const evidenceSummary =
    evidenceLines.length > 0
      ? evidenceLines.slice(0, 2).join("；")
      : "基于竞品差评痛点优化耐用性、清洁便利性与使用体验";

  return {
    productName: title || `${category} 核心款`,
    targetCustomer: `目标 ${marketplace} 站购买「${category}」的家庭/日常实用型买家，重视可靠性、易清洁与长期性价比`,
    coreDifferentiator: `${evidenceSummary}。${notes ? `（立项备注：${notes}）` : ""}所有核心卖点须与样品实测及供应商工艺单一致。`,
    specifications: `品类：${category}；主体材质：【待核实，按工厂大货材质填写】；产品尺寸与净重：【待核实，以实测包装为准】；供电/配件规格：【待核实】`,
    packageContents: `主商品 × 1、核心配件/耗材 × 1【待核实数量】、多语种说明书 × 1、彩盒包装 × 1`,
    claimsToAvoid:
      "未经官方认证不得宣称 FDA/UL/CE/RoHS 认证；不得使用 100% 静音、绝对防水、医疗级/抗菌杀菌、Best/No.1 等绝对化或违禁词；不得提及竞品品牌名。",
  };
}

function buildTemplateListing(params: {
  title: string;
  category: string;
  marketplace: string;
  definition: Partial<DefinitionFields>;
  evidenceLines: string[];
}): ListingFields {
  const { title, category, marketplace, definition, evidenceLines } = params;
  const baseName = (definition.productName || title || category || "Home Essential").trim();
  const isEnglishMarket = ["US", "UK", "CA", "AU"].includes(marketplace.toUpperCase());

  if (!isEnglishMarket) {
    return {
      brand: "YOURBRAND",
      title: `YOURBRAND ${baseName} - 实用耐用易清洁设计（${category}）`,
      bullets: [
        `核心体验升级：围绕「${definition.coreDifferentiator || "稳定耐用与日常便捷体验"}」打造，解决常见使用痛点。`,
        `适配人群明确：专为「${definition.targetCustomer || "重视实用性与品质的日常家庭用户"}」设计，开箱即用。`,
        `规格清晰透明：${definition.specifications || "关键材质与尺寸以实测大货为准，兼顾稳固结构与便携收纳。"}`,
        `完整包装清单：${definition.packageContents || "含主机、常用配件与使用说明，满足日常直接上手需求。"}`,
        `安心售后支持：使用前请核对说明书与保养建议；如有配件或使用问题可随时联系客服处理。`,
      ],
      description: `${baseName} 聚焦高频日常使用场景，结合市场反馈优化结构与维护便利性。${
        evidenceLines.length > 0 ? `重点回应用户关切：${evidenceLines.slice(0, 2).join("；")}。` : ""
      }包装清单：${definition.packageContents || "以实际出货清单为准"}。`,
      searchTerms: clampUtf8Bytes(`${category} ${baseName} 耐用 易清洁 家用 升级款`, 240),
    };
  }

  return {
    brand: "YOURBRAND",
    title: `YOURBRAND ${baseName} - Easy-Clean Durable Design for Daily Use (${category})`,
    bullets: [
      `THOUGHTFUL DAILY UPGRADE: Engineered around real buyer feedback for ${baseName}, focusing on smoother daily operation, reliable build quality, and simpler upkeep.`,
      `BUILT FOR EVERYDAY USERS: Ideal for households looking for a practical, low-maintenance ${category} solution without complicated setup or fragile parts.`,
      `EASY TO CLEAN & MAINTAIN: Streamlined removable structure helps reduce buildup and makes routine rinsing and maintenance fast and hassle-free.`,
      `CLEAR SPECS & WHAT'S INCLUDED: Designed with durable food-safe/everyday materials (verify exact specs before launch). Includes main unit, essential accessories, and quick-start guide.`,
      `HONEST QUALITY & SUPPORT: Checked for fit, finish, and packaging durability prior to shipment. Reach out anytime for setup tips or replacement part guidance.`,
    ],
    description: `Meet the YOURBRAND ${baseName}, crafted to simplify everyday routines with a durable, easy-to-maintain design. ${
      definition.coreDifferentiator
        ? `Key focus: ${definition.coreDifferentiator}. `
        : ""
    }Before publishing, verify final product dimensions, material grades, and included accessories against your approved supplier sample.`,
    searchTerms: clampUtf8Bytes(
      `${baseName} ${category} easy clean durable quiet daily home essential gift replacement`,
      240,
    ),
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const mode = await getAppMode();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      target?: AutofillTarget;
      currentDefinition?: Partial<DefinitionFields>;
    };
    const target: AutofillTarget = body.target === "listing" ? "listing" : "definition";

    const [caseDetail, contentDetail] = await Promise.all([
      getCaseDetail(id, { mode }),
      getContentDetail(id, { mode }),
    ]);
    if (!caseDetail || !contentDetail) {
      return NextResponse.json({ error: "商品案卷不存在" }, { status: 404 });
    }

    const { productCase, evidence } = caseDetail;
    const { profile } = contentDetail;
    const evidenceLines = evidence
      .slice(0, 6)
      .map((item) => `${item.title}：${item.summary}`);

    const mergedDefinition: Partial<DefinitionFields> = {
      productName: body.currentDefinition?.productName || profile?.product_name || productCase.title,
      targetCustomer: body.currentDefinition?.targetCustomer || profile?.target_customer || "",
      coreDifferentiator: body.currentDefinition?.coreDifferentiator || profile?.core_differentiator || "",
      specifications: body.currentDefinition?.specifications || profile?.specifications || "",
      packageContents: body.currentDefinition?.packageContents || profile?.package_contents || "",
      claimsToAvoid: body.currentDefinition?.claimsToAvoid || profile?.claims_to_avoid || "",
    };

    if (target === "definition") {
      const fallback = buildTemplateDefinition({
        title: productCase.title,
        category: productCase.category,
        marketplace: productCase.marketplace,
        notes: productCase.notes,
        evidenceLines,
      });

      let fields: DefinitionFields = fallback;
      let source: "ai" | "template" = "template";
      let provider = "local-template";
      let model = "deterministic-template";

      try {
        const aiResult = await generateStructuredJSON({
          systemPrompt: `你是跨境电商资深产品经理。请根据已有商品案卷信息，用简洁、严谨的中文填写「商品定义」草稿。
硬性规则：
1. 只输出 JSON，不要 Markdown 代码块。
2. 严禁编造认证（FDA/UL/CE）、专利、虚假尺寸或夸大功效；缺失的物理参数请用【待核实】占位。
3. claimsToAvoid 必须结合该类目在目标站点的常见合规风险给出明确禁用词提醒。
输出格式：
{"productName":"...","targetCustomer":"...","coreDifferentiator":"...","specifications":"...","packageContents":"...","claimsToAvoid":"..."}`,
          userPrompt: JSON.stringify(
            {
              asin: productCase.asin,
              title: productCase.title,
              category: productCase.category,
              marketplace: productCase.marketplace,
              notes: productCase.notes,
              evidence: evidenceLines,
            },
            null,
            2,
          ),
          timeoutMs: 25_000,
          maxTokens: 1000,
        }, fetch, undefined, { mode });
        const parsed = parseJsonObject(aiResult.content);
        if (parsed) {
          fields = {
            productName: asCleanString(parsed.productName, fallback.productName),
            targetCustomer: asCleanString(parsed.targetCustomer, fallback.targetCustomer),
            coreDifferentiator: asCleanString(parsed.coreDifferentiator, fallback.coreDifferentiator),
            specifications: asCleanString(parsed.specifications, fallback.specifications),
            packageContents: asCleanString(parsed.packageContents, fallback.packageContents),
            claimsToAvoid: asCleanString(parsed.claimsToAvoid, fallback.claimsToAvoid),
          };
          source = "ai";
          provider = aiResult.provider;
          model = aiResult.model;
        }
      } catch {
        // 未配置 API Key 或模型超时，优雅降级到本地模板
      }

      await recordAuditLog({
        mode,
        actor: "本机用户",
        action: "content.ai_autofill_generated",
        entityType: "product_case",
        entityId: id,
        details: { target, source, provider, model, mode },
      }).catch(() => {});

      return NextResponse.json({ ok: true, target, source, provider, model, fields });
    }

    // target === "listing"
    const fallback = buildTemplateListing({
      title: productCase.title,
      category: productCase.category,
      marketplace: productCase.marketplace,
      definition: mergedDefinition,
      evidenceLines,
    });

    let fields: ListingFields = fallback;
    let source: "ai" | "template" = "template";
    let provider = "local-template";
    let model = "deterministic-template";

    try {
      const targetLang = ["US", "UK", "CA", "AU"].includes(productCase.marketplace.toUpperCase())
        ? "地道、克制、符合 Amazon 规范的英文"
        : `符合 ${productCase.marketplace} 站 Amazon 规范的目标站点语言`;

      const aiResult = await generateStructuredJSON({
        systemPrompt: `你是 Amazon 资深 Listing 文案专家。请根据商品定义和市场证据，使用${targetLang}生成一份可审核的 Amazon Listing 草稿。
硬性规则：
1. 只输出 JSON，不要 Markdown 代码块。
2. 严格遵守 claimsToAvoid 中的禁用声明，绝不写未认证资质、绝对化用词（100%、Best、No.1、Cure）或竞品品牌名。
3. title 控制在 80–170 字符；bullets 必须恰好 5 条，每条聚焦一个购买理由，全大写短前缀 + 具体价值说明，每条不超过 420 字符；searchTerms 使用空格分隔，UTF-8 字节数不超过 240 字节，不重复标题高频词。
输出格式：
{"brand":"YOURBRAND","title":"...","bullets":["...","...","...","...","..."],"description":"...","searchTerms":"..."}`,
        userPrompt: JSON.stringify(
          {
            marketplace: productCase.marketplace,
            category: productCase.category,
            caseTitle: productCase.title,
            definition: mergedDefinition,
            evidence: evidenceLines,
          },
          null,
          2,
        ),
        timeoutMs: 30_000,
        maxTokens: 1600,
      }, fetch, undefined, { mode });
      const parsed = parseJsonObject(aiResult.content);
      if (parsed) {
        const rawBullets = Array.isArray(parsed.bullets)
          ? parsed.bullets.map((b) => (typeof b === "string" ? b.trim() : "")).filter(Boolean)
          : [];
        const normalizedBullets = Array.from({ length: 5 }, (_, idx) => rawBullets[idx] || fallback.bullets[idx]);
        fields = {
          brand: asCleanString(parsed.brand, fallback.brand),
          title: asCleanString(parsed.title, fallback.title),
          bullets: normalizedBullets,
          description: asCleanString(parsed.description, fallback.description),
          searchTerms: clampUtf8Bytes(asCleanString(parsed.searchTerms, fallback.searchTerms), 240),
        };
        source = "ai";
        provider = aiResult.provider;
        model = aiResult.model;
      }
    } catch {
      // 未配置 API Key 或模型超时，优雅降级到本地模板
    }

    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "content.ai_autofill_generated",
      entityType: "product_case",
      entityId: id,
      details: { target, source, provider, model },
    }).catch(() => {});

    return NextResponse.json({ ok: true, target, source, provider, model, fields });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI 一键填写失败" },
      { status: 500 },
    );
  }
}
