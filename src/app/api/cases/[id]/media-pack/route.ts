import { NextResponse } from "next/server";
import { getContentDetail } from "@/lib/repository";
import { emptyListingContent, normalizeListingContent } from "@/lib/listing";
import { listStandaloneStudioAssets } from "@/lib/standalone-image-studio";
import { listStandaloneVideoAssets } from "@/lib/standalone-video-studio";
import { readStoredImage } from "@/lib/storage";
import { buildZipBuffer, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSlug(input: string): string {
  return (input || "product")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "product";
}

function buildFlatFileTsv(asin: string, title: string, brand: string, priceUsd: string, bullets: string[], desc: string, keywords: string) {
  const headers = [
    "item_sku",
    "external_product_id",
    "item_name",
    "brand_name",
    "standard_price",
    "bullet_point1",
    "bullet_point2",
    "bullet_point3",
    "bullet_point4",
    "bullet_point5",
    "product_description",
    "generic_keywords",
  ];
  const sanitize = (v: string) => (v || "").replace(/[\t\r\n]+/g, " ").trim();
  const row = [
    `SKU-${asin}`,
    asin,
    title,
    brand || "Generic",
    priceUsd,
    bullets[0] || "",
    bullets[1] || "",
    bullets[2] || "",
    bullets[3] || "",
    bullets[4] || "",
    desc,
    keywords,
  ].map(sanitize);
  return `${headers.join("\t")}\n${row.join("\t")}\n`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const detail = await getContentDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "未找到对应商品案卷" }, { status: 404 });
    }

    const { productCase, costModel, profile, assets, listing } = detail;
    const content = listing ? normalizeListingContent(listing.content) : emptyListingContent();
    const salePriceUsd = costModel
      ? (costModel.assumptions.salePriceCents / 100).toFixed(2)
      : (productCase.competitor_price_cents / 100).toFixed(2);

    const entries: ZipEntry[] = [];

    // 1. Listing 文案文本
    const copyLines = [
      `商品标题 (Title): ${content.title || productCase.title}`,
      `品牌 (Brand): ${content.brand || ""}`,
      `ASIN: ${productCase.asin}`,
      `站点: ${productCase.marketplace} | 类目: ${productCase.category}`,
      `预计售价: $${salePriceUsd}`,
      "",
      "=== 五点卖点 (Bullet Points) ===",
      ...content.bullets.map((b, i) => `${i + 1}. ${b || "（待补充）"}`),
      "",
      "=== 商品描述 (Description) ===",
      content.description || "（待补充）",
      "",
      "=== 后台搜索词 (Search Terms) ===",
      content.searchTerms || "（待补充）",
      "",
      ...(profile
        ? [
            "=== 商品核心定义 ===",
            `目标人群: ${profile.target_customer}`,
            `核心差异化: ${profile.core_differentiator}`,
            `核心规格: ${profile.specifications}`,
            `包装清单: ${profile.package_contents}`,
            `禁用声明: ${profile.claims_to_avoid || "无"}`,
          ]
        : []),
    ];
    entries.push({ name: "01-listing-copy.txt", data: copyLines.join("\n") });

    // 2. Amazon Flat File TSV
    entries.push({
      name: "02-amazon-flat-file.tsv",
      data: buildFlatFileTsv(
        productCase.asin,
        content.title || productCase.title,
        content.brand,
        salePriceUsd,
        content.bullets,
        content.description,
        content.searchTerms,
      ),
    });

    // 3. 案卷内联资产 + 视觉工坊已绑定资产
    const addedKeys = new Set<string>();
    let imgIdx = 1;
    let vidIdx = 1;

    for (const asset of assets) {
      const storageKey = typeof asset.metadata?.storageKey === "string" ? asset.metadata.storageKey : "";
      if (!storageKey || addedKeys.has(storageKey)) continue;
      const loaded = await readStoredImage(storageKey).catch(() => null);
      if (!loaded) continue;
      addedKeys.add(storageKey);
      const ext = (asset.metadata?.originalName && String(asset.metadata.originalName).split(".").pop()) || "png";
      const isVideo = asset.asset_type.includes("video");
      const folder = isVideo ? "videos" : "images";
      const seq = isVideo ? String(vidIdx++).padStart(2, "0") : String(imgIdx++).padStart(2, "0");
      entries.push({
        name: `${folder}/${seq}-${asset.asset_type}.${ext}`,
        data: loaded,
      });
    }

    const [studioImages, studioVideos] = await Promise.all([
      listStandaloneStudioAssets().catch(() => []),
      listStandaloneVideoAssets().catch(() => []),
    ]);

    for (const img of studioImages) {
      const isBound = img.boundCases?.some((c) => c.caseId === productCase.id);
      if (!isBound || addedKeys.has(img.storageKey)) continue;
      const loaded = await readStoredImage(img.storageKey).catch(() => null);
      if (!loaded) continue;
      addedKeys.add(img.storageKey);
      const ext = img.originalName.split(".").pop() || "png";
      entries.push({
        name: `images/${String(imgIdx++).padStart(2, "0")}-${img.slot}.${ext}`,
        data: loaded,
      });
    }

    for (const vid of studioVideos) {
      const isBound = vid.boundCases?.some((c) => c.caseId === productCase.id);
      if (!isBound || addedKeys.has(vid.storageKey)) continue;
      const loaded = await readStoredImage(vid.storageKey).catch(() => null);
      if (!loaded) continue;
      addedKeys.add(vid.storageKey);
      const ext = vid.originalName.split(".").pop() || "mp4";
      entries.push({
        name: `videos/${String(vidIdx++).padStart(2, "0")}-${vid.templateId}.${ext}`,
        data: loaded,
      });
    }

    // 4. 元数据摘要
    entries.push({
      name: "manifest.json",
      data: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          caseId: productCase.id,
          asin: productCase.asin,
          title: productCase.title,
          marketplace: productCase.marketplace,
          category: productCase.category,
          salePriceUsd: Number(salePriceUsd),
          imageCount: imgIdx - 1,
          videoCount: vidIdx - 1,
        },
        null,
        2,
      ),
    });

    const zipBuffer = buildZipBuffer(entries);
    const filename = `AITrade-${productCase.asin}-${safeSlug(productCase.category)}-pack.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "打包素材失败" },
      { status: 500 },
    );
  }
}
