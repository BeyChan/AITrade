import type { CompetitorInputItem } from "./types.ts";

/** 常见出现在 Amazon URL slug 首位的通用英文修饰词，不能误判为品牌名 */
const NON_BRAND_PREFIXES = new Set([
  "automatic", "auto", "portable", "compact", "windproof", "waterproof", "lightweight",
  "upgraded", "new", "mini", "wireless", "electric", "rechargeable", "heavy", "folding",
  "foldable", "travel", "stainless", "silicone", "smart", "pro", "ultra", "premium",
  "luxury", "best", "original", "universal", "adjustable", "magnetic", "cordless",
  "outdoor", "indoor", "ergonomic", "multifunctional", "professional", "small", "large",
  "extra", "super", "double", "triple", "single", "pack", "set", "pcs", "piece", "the",
]);

export function extractAsinFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const directAsin = trimmed.match(/^([B0-9][A-Z0-9]{9})$/i);
  if (directAsin) return directAsin[1]!.toUpperCase();

  const amazonMatch = trimmed.match(/(?:\/dp\/|\/gp\/product\/|\/ASIN\/|\/d\/)([B0-9][A-Z0-9]{9})/i);
  if (amazonMatch) return amazonMatch[1]!.toUpperCase();

  const genericMatch = trimmed.match(/\b(B0[A-Z0-9]{8})\b/i);
  if (genericMatch) return genericMatch[1]!.toUpperCase();

  return null;
}

export function normalizeAmazonProductUrl(urlStr: string, asin: string | null): string {
  if (!asin) return urlStr;
  try {
    const parsed = new URL(urlStr);
    if (/amazon\./i.test(parsed.hostname)) {
      return `${parsed.protocol}//${parsed.hostname}/dp/${asin}`;
    }
  } catch {
    // 非标准 URL 保持原样
  }
  return urlStr;
}

export function inferBrandFromTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const cleaned = title.replace(/^https?:\/\/\S+/i, "").trim();
  if (!cleaned) return undefined;
  const words = cleaned.split(/\s+/).filter(Boolean);
  const firstWord = words[0]?.replace(/^[^A-Za-z0-9\u4e00-\u9fa5]+|[^A-Za-z0-9\u4e00-\u9fa5]+$/g, "");
  if (
    firstWord &&
    firstWord.length >= 2 &&
    !/^\d/.test(firstWord) &&
    !NON_BRAND_PREFIXES.has(firstWord.toLowerCase())
  ) {
    return firstWord;
  }
  return undefined;
}

export function extractTitleFromUrl(urlStr: string): { title?: string; brand?: string } {
  try {
    const parsed = new URL(urlStr);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const dpIndex = pathSegments.findIndex((p) => p.toLowerCase() === "dp" || p.toLowerCase() === "product");
    let slug = "";
    if (dpIndex > 0 && pathSegments[dpIndex - 1]) {
      slug = pathSegments[dpIndex - 1]!;
    } else if (pathSegments.length > 0 && !pathSegments[0]!.toLowerCase().startsWith("dp")) {
      slug = pathSegments[0]!;
    }

    if (slug) {
      const decoded = decodeURIComponent(slug).replace(/[-_+]+/g, " ").trim();
      return {
        title: decoded,
        brand: inferBrandFromTitle(decoded),
      };
    }
  } catch {
    // not a valid URL
  }
  return {};
}

export function parseCompetitorInputs(text: string): CompetitorInputItem[] {
  if (!text || !text.trim()) return [];

  const rawLines = text
    .split(/[\r\n;,]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const seenKeys = new Set<string>();
  const items: CompetitorInputItem[] = [];

  for (const line of rawLines) {
    const isUrl = /^https?:\/\//i.test(line);
    const asin = extractAsinFromUrl(line);
    const cleanUrl = isUrl ? normalizeAmazonProductUrl(line, asin) : undefined;
    // 优先按 ASIN 去重，避免同一商品因跟踪参数（如 &th=1 / &dib=...）被拆成两条重复竞品
    const dedupeKey = asin ? `asin:${asin}` : `raw:${(cleanUrl ?? line).toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    let title: string | undefined;

    if (isUrl) {
      const meta = extractTitleFromUrl(line);
      title = meta.title;
    } else if (!asin) {
      title = line;
    }

    items.push({
      raw: line,
      asin: asin ?? undefined,
      url: cleanUrl,
      title: title && title.length > 2 ? title : undefined,
    });
  }

  return items;
}
