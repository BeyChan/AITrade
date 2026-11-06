import type { CompetitorInputItem } from "./types.ts";

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
      const words = decoded.split(/\s+/).filter(Boolean);
      return {
        title: decoded,
        brand: words[0],
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

  const seen = new Set<string>();
  const items: CompetitorInputItem[] = [];

  for (const line of rawLines) {
    if (seen.has(line)) continue;
    seen.add(line);

    const isUrl = /^https?:\/\//i.test(line);
    const asin = extractAsinFromUrl(line);
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
      url: isUrl ? line : undefined,
      title: title && title.length > 2 ? title : undefined,
    });
  }

  return items;
}
