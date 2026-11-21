import { apiError, readJsonObject, stringField } from "@/app/api/ai-inbox/http";
import { generateStructuredJSON, getAIProviderStatus } from "@/lib/ai-provider";
import { getImageSkillById, normalizeAspectRatio } from "@/lib/image-skills";
import {
  composeVideoPrompt,
  getVideoProviderStatus,
  normalizeVideoAspectRatio,
  normalizeVideoDuration,
} from "@/lib/video-provider";
import { getVideoSkillById } from "@/lib/video-skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const kind = stringField(body, "kind", { required: true, maxLength: 16 });
    const productName = stringField(body, "productName", { maxLength: 160 }) || "跨境电商品牌主推单品";
    const idea = stringField(body, "idea", { maxLength: 1200 });
    const coreDifferentiator = stringField(body, "coreDifferentiator", { maxLength: 600 });
    const marketplace = stringField(body, "marketplace", { maxLength: 20 }) || "US";
    const claimsToAvoid = stringField(body, "claimsToAvoid", { maxLength: 500 });
    const topPainPoints = Array.isArray(body.topPainPoints)
      ? body.topPainPoints.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 3)
      : [];

    const aiStatus = await getAIProviderStatus();

    if (kind === "video") {
      const skillId = stringField(body, "skillId", { maxLength: 80 });
      const skill = await getVideoSkillById(skillId);
      const aspectRatio = normalizeVideoAspectRatio(stringField(body, "aspectRatio", { maxLength: 10 }), skill.aspectRatio);
      const durationSec = normalizeVideoDuration(body.durationSec, skill.durationSec);
      const videoStatus = await getVideoProviderStatus();

      // 默认模板兜底结果（结合所选 Video Skill）
      const fallback = composeVideoPrompt(
        {
          productName,
          targetCustomer: "",
          coreDifferentiator,
          specifications: "",
          claimsToAvoid,
          marketplace,
          topPainPoints,
          templateId: "hero_orbit_5s",
          aspectRatio,
          durationSec,
          customInstruction: [skill.motionDirectives, skill.lightingDirectives, idea].filter(Boolean).join(" "),
        },
        videoStatus.provider,
      );
      const fallbackPrompt = [
        `Commercial e-commerce I2V product video (${durationSec}s, ${aspectRatio}) anchored strictly to the approved first-frame reference photo of ${productName}.`,
        "Preserve exact product silhouette, color, proportions, and materials from frame 1.",
        skill.motionDirectives,
        skill.lightingDirectives,
        coreDifferentiator ? `Highlight product advantage: ${coreDifferentiator}.` : "",
        topPainPoints.length > 0 ? `Visually solve buyer pain points: ${topPainPoints.join("; ")}.` : "",
        idea ? `Director's creative note: ${idea}.` : "",
        "No on-screen text, no watermarks, no price tags, no deformed geometry.",
      ]
        .filter(Boolean)
        .join(" ");
      const fallbackNegative = [skill.negativeDirectives, claimsToAvoid ? `avoid: ${claimsToAvoid}` : ""]
        .filter(Boolean)
        .join(", ");

      if (!aiStatus.configured || aiStatus.provider === "template") {
        return Response.json({
          mode: "template",
          model: aiStatus.model,
          prompt: fallbackPrompt,
          negativePrompt: fallbackNegative,
          motionDirectives: skill.motionDirectives,
          lightingDirectives: skill.lightingDirectives,
          storyboard: fallback.storyboard,
          note: "当前未配置外部文本大模型，已按所选视频 Skill 生成高稳定度英文 I2V 提示词；接入文本大模型后可进行深度创意扩写。",
        });
      }

      try {
        const res = await generateStructuredJSON({
          systemPrompt: [
            "You are a senior cross-border e-commerce commercial film director specializing in Image-to-Video (Kling, Seedance, Veo, Runway) prompts for Amazon, Shopify, and TikTok Shop.",
            "Return STRICT valid JSON only, no markdown fences, with keys:",
            '- "prompt": string (concise, high-impact English I2V prompt under 130 words: anchor first frame geometry + physical motion + camera path + lighting + no text/watermarks)',
            '- "negativePrompt": string (comma-separated English negative constraints)',
            '- "motionDirectives": string (reusable English camera & motion rule for saving as a custom skill)',
            '- "lightingDirectives": string (reusable English lighting & color grade rule)',
            '- "storyboard": array of 3 objects { "shot": number, "durationSec": 5, "role": string (Chinese), "visualPrompt": string (English), "captionEn": string, "captionZh": string }',
          ].join("\n"),
          userPrompt: JSON.stringify({
            productName,
            marketplace,
            aspectRatio,
            durationSec,
            coreDifferentiator,
            topPainPoints,
            claimsToAvoid,
            selectedSkill: {
              name: skill.name,
              motionDirectives: skill.motionDirectives,
              lightingDirectives: skill.lightingDirectives,
              negativeDirectives: skill.negativeDirectives,
            },
            userCreativeIdea: idea || "突出商品质感、核心卖点与自然真实使用场景，画面稳定高级。",
          }),
          maxTokens: 900,
          timeoutMs: 35_000,
        });

        const parsed = extractJsonObject(res.content);
        if (parsed && typeof parsed.prompt === "string" && parsed.prompt.trim()) {
          return Response.json({
            mode: "model",
            model: res.model,
            latencyMs: res.latencyMs,
            prompt: parsed.prompt.trim(),
            negativePrompt:
              typeof parsed.negativePrompt === "string" && parsed.negativePrompt.trim()
                ? parsed.negativePrompt.trim()
                : fallbackNegative,
            motionDirectives:
              typeof parsed.motionDirectives === "string" && parsed.motionDirectives.trim()
                ? parsed.motionDirectives.trim()
                : skill.motionDirectives,
            lightingDirectives:
              typeof parsed.lightingDirectives === "string" && parsed.lightingDirectives.trim()
                ? parsed.lightingDirectives.trim()
                : skill.lightingDirectives,
            storyboard:
              Array.isArray(parsed.storyboard) && parsed.storyboard.length > 0
                ? parsed.storyboard
                : fallback.storyboard,
            note: `已由文本模型 ${res.model}（${res.latencyMs} ms）扩写专业英文 I2V 提示词与 3 镜分镜脚本。`,
          });
        }
      } catch {
        // 降级为高质量内置模板，绝不阻断创作流
      }

      return Response.json({
        mode: "template",
        model: aiStatus.model,
        prompt: fallbackPrompt,
        negativePrompt: fallbackNegative,
        motionDirectives: skill.motionDirectives,
        lightingDirectives: skill.lightingDirectives,
        storyboard: fallback.storyboard,
        note: "外部文本模型暂不可用，已自动回退为内置电商视频 Skill 专业提示词。",
      });
    }

    // kind === "image"
    const skillId = stringField(body, "skillId", { maxLength: 80 });
    const slot = stringField(body, "slot", { maxLength: 40 }) || "lifestyle_image";
    const aspectRatio = normalizeAspectRatio(stringField(body, "aspectRatio", { maxLength: 10 }), "1:1");
    const skill = skillId && skillId !== "custom" ? await getImageSkillById(skillId) : null;

    const fallbackStyle = [
      skill?.styleDirectives || "Commercial e-commerce product photography, sharp focus, studio-grade natural lighting, accurate material texture and proportions.",
      idea ? `Creative direction: ${idea}.` : "",
      coreDifferentiator ? `Highlight differentiator: ${coreDifferentiator}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const fallbackPrompt = [
      `High-converting ${marketplace} e-commerce ${slot} (${aspectRatio}) for ${productName}.`,
      fallbackStyle,
      "Photorealistic, crisp details, zero watermarks, zero gibberish text.",
    ].join(" ");

    const fallbackNegative = [
      skill?.negativeDirectives || "blurry, distorted geometry, watermarks, price badges, gibberish text, low resolution, extra limbs",
      claimsToAvoid ? `forbidden claims: ${claimsToAvoid}` : "",
    ]
      .filter(Boolean)
      .join(", ");

    if (!aiStatus.configured || aiStatus.provider === "template") {
      return Response.json({
        mode: "template",
        model: aiStatus.model,
        prompt: fallbackPrompt,
        styleDirectives: fallbackStyle,
        negativePrompt: fallbackNegative,
        note: "当前未配置外部文本大模型，已生成结构化商业摄影英文提示词；在「大模型设置」接入文本模型后可自动做 AI 创意扩写。",
      });
    }

    try {
      const res = await generateStructuredJSON({
        systemPrompt: [
          "You are an elite Amazon & Shopify commercial product photography art director.",
          "Convert the user's product info and Chinese creative idea into a crisp, photorealistic English prompt and reusable custom image skill directives.",
          "Return STRICT valid JSON only, no markdown fences, with keys:",
          '- "prompt": string (complete English image generation prompt under 130 words)',
          '- "styleDirectives": string (reusable English visual style, composition, lighting & background directives for custom image skill)',
          '- "negativePrompt": string (comma-separated English negative constraints, always forbidding watermarks/gibberish text/warped proportions)',
        ].join("\n"),
        userPrompt: JSON.stringify({
          productName,
          marketplace,
          slot,
          aspectRatio,
          coreDifferentiator,
          topPainPoints,
          claimsToAvoid,
          baseSkill: skill ? { name: skill.name, styleDirectives: skill.styleDirectives } : null,
          userCreativeIdea: idea || "高级商业棚拍质感，主体突出，真实材质纹理，适配亚马逊与独立站高转化展示。",
        }),
        maxTokens: 700,
        timeoutMs: 35_000,
      });

      const parsed = extractJsonObject(res.content);
      if (parsed && typeof parsed.prompt === "string" && parsed.prompt.trim()) {
        return Response.json({
          mode: "model",
          model: res.model,
          latencyMs: res.latencyMs,
          prompt: parsed.prompt.trim(),
          styleDirectives:
            typeof parsed.styleDirectives === "string" && parsed.styleDirectives.trim()
              ? parsed.styleDirectives.trim()
              : parsed.prompt.trim(),
          negativePrompt:
            typeof parsed.negativePrompt === "string" && parsed.negativePrompt.trim()
              ? parsed.negativePrompt.trim()
              : fallbackNegative,
          note: `已由文本模型 ${res.model}（${res.latencyMs} ms）生成专业商业生图英文提示词与规范。`,
        });
      }
    } catch {
      // fallback cleanly
    }

    return Response.json({
      mode: "template",
      model: aiStatus.model,
      prompt: fallbackPrompt,
      styleDirectives: fallbackStyle,
      negativePrompt: fallbackNegative,
      note: "外部文本模型暂不可用，已自动回退为结构化商业摄影提示词。",
    });
  } catch (error) {
    return apiError(error);
  }
}
