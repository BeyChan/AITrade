import type { CompetitorInputItem } from "./types.ts";

export function extractAsinFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  // Direct ASIN format: B0xxxxxxxx
  const directAsin = trimmed.match(/^([B0-9][A-Z0-9]{9})$/i);
  if (directAsin) return directAsin[1]!.toUpperCase();

  // Amazon URL patterns
  const amazonMatch = trimmed.match(/(?:\/dp\/|\/gp\/product\/|\/ASIN\/|\/d\/)([B0-9][A-Z0-9]{9})/i);
  if (amazonMatch) return amazonMatch[1]!.toUpperCase();

  // General 10-char alphanumeric often used as ASIN
  const genericMatch = trimmed.match(/\b(B0[A-Z0-9]{8})\b/i);
  if (genericMatch) return genericMatch[1]!.toUpperCase();

  return null;
}

export function parseCompetitorInputs(text: string): CompetitorInputItem[] {
  if (!text || !text.trim()) return [];

  // Split by newline, comma or semicolon
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
      try {
        const parsedUrl = new URL(line);
        // Try extracting product slug from path, e.g. amazon.com/Product-Name-Here/dp/B000000000
        const parts = parsedUrl.pathname.split("/").filter(Boolean);
        const dpIndex = parts.findIndex((p) => p.toLowerCase() === "dp" || p.toLowerCase() === "product");
        if (dpIndex > 0 && parts[dpIndex - 1]) {
          title = decodeURIComponent(parts[dpIndex - 1]!).replace(/[-_+]/g, " ");
        }
      } catch {
        // ignore url parsing error
      }
    } else if (!asin) {
      // It's a plain product name or search term
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
