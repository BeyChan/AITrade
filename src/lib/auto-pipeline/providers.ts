import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseCandidateCsv } from "../csv.ts";
import type { NormalizedCandidateSeed } from "./types.ts";

/**
 * Provider 1: 从卖家精灵 / Helium 10 / 通用候选 CSV 归一化为平台无关种子。
 */
export function seedsFromCsv(input: {
  csv: string;
  platformCode: string;
  marketCode: string;
  defaultCurrency: string;
}): NormalizedCandidateSeed[] {
  const rows = parseCandidateCsv(input.csv, { marketplace: input.marketCode });
  return rows
    .filter((row) => row.asin && row.asin.trim().length > 0)
    .map((row) => ({
      platformCode: input.platformCode.trim().toLowerCase(),
      marketCode: (row.marketplace || input.marketCode).trim().toUpperCase(),
      externalId: row.asin.trim().toUpperCase(),
      title: row.title || row.asin,
      brand: (row.rawPayload?.brand || row.rawPayload?.品牌 || "").trim(),
      category: row.category || "",
      url: row.url || "",
      currency: (row.currency || input.defaultCurrency || "USD").trim().toUpperCase(),
      priceCents: row.competitorPriceCents,
      monthlySalesEstimate: row.monthlySalesEstimate,
      reviewCount: row.reviewCount,
      rating: row.rating,
      isSponsored: false,
      evidenceSource: "real",
      observedAt: row.observedAt,
    }));
}

export type RawExtensionSeed = {
  externalId?: string;
  asin?: string;
  title?: string;
  brand?: string;
  category?: string;
  url?: string;
  currency?: string;
  priceCents?: number | null;
  monthlySalesEstimate?: number | null;
  boughtPastMonth?: number | null;
  reviewCount?: number | null;
  rating?: number | null;
  isSponsored?: boolean;
  observedAt?: string;
};

/**
 * Provider 2: 从 Chrome 扩展采集的搜索页 / 榜单页数据归一化为标准种子。
 */
export function seedsFromExtensionItems(input: {
  items: RawExtensionSeed[];
  platformCode: string;
  marketCode: string;
  defaultCurrency: string;
}): NormalizedCandidateSeed[] {
  const out: NormalizedCandidateSeed[] = [];
  const seen = new Set<string>();
  const platform = input.platformCode.trim().toLowerCase() || "amazon";
  const market = input.marketCode.trim().toUpperCase() || "US";
  const defaultCur = (input.defaultCurrency || "USD").trim().toUpperCase();

  for (const raw of input.items) {
    const extId = String(raw.externalId || raw.asin || "").trim().toUpperCase();
    if (!extId || seen.has(extId)) continue;
    seen.add(extId);

    const priceCents = Number.isFinite(Number(raw.priceCents)) ? Math.max(0, Math.round(Number(raw.priceCents))) : 0;
    const reviewCount = Number.isFinite(Number(raw.reviewCount)) ? Math.max(0, Math.round(Number(raw.reviewCount))) : 0;
    const ratingVal = Number(raw.rating);
    const rating = Number.isFinite(ratingVal) && ratingVal > 0 && ratingVal <= 5 ? ratingVal : null;
    const salesRaw = raw.monthlySalesEstimate ?? raw.boughtPastMonth ?? 0;
    const monthlySalesEstimate = Number.isFinite(Number(salesRaw)) && Number(salesRaw) > 0
      ? Math.round(Number(salesRaw))
      : 300;

    out.push({
      platformCode: platform,
      marketCode: market,
      externalId: extId,
      title: String(raw.title || extId).trim(),
      brand: String(raw.brand || "").trim(),
      category: String(raw.category || "").trim(),
      url: String(raw.url || "").trim(),
      currency: String(raw.currency || defaultCur).trim().toUpperCase() || defaultCur,
      priceCents,
      monthlySalesEstimate,
      reviewCount,
      rating,
      isSponsored: Boolean(raw.isSponsored),
      evidenceSource: "real",
      observedAt: raw.observedAt || new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Provider 3: 扫描本地安全收件箱目录（仅限 .data/inbox-csv/ 内部）中的 CSV 文件。
 * 避开 PGlite 单进程锁，供 Next.js 同进程按需一键扫描摄入。
 */
export async function seedsFromInboxDirectory(input: {
  inboxDir: string;
  platformCode: string;
  marketCode: string;
  defaultCurrency: string;
}): Promise<{ seeds: NormalizedCandidateSeed[]; filesRead: string[] }> {
  const allowedRoot = path.resolve(process.cwd(), ".data", "inbox-csv");
  const resolved = path.resolve(process.cwd(), input.inboxDir);
  if (!resolved.startsWith(allowedRoot)) {
    throw new Error("收件箱目录必须位于 .data/inbox-csv/ 下");
  }

  let entries: string[];
  try {
    entries = await readdir(resolved);
  } catch {
    return { seeds: [], filesRead: [] };
  }

  const csvFiles = entries.filter((name) => name.toLowerCase().endsWith(".csv")).sort();
  const seeds: NormalizedCandidateSeed[] = [];
  const seen = new Set<string>();
  const filesRead: string[] = [];

  for (const fileName of csvFiles) {
    const content = await readFile(path.join(resolved, fileName), "utf8");
    const parsed = seedsFromCsv({
      csv: content,
      platformCode: input.platformCode,
      marketCode: input.marketCode,
      defaultCurrency: input.defaultCurrency,
    });
    filesRead.push(fileName);
    for (const seed of parsed) {
      if (seen.has(seed.externalId)) continue;
      seen.add(seed.externalId);
      seeds.push(seed);
    }
  }

  return { seeds, filesRead };
}
