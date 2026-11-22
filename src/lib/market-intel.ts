import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";

export type MarketIntelCategory = "policy" | "logistics" | "tariff" | "market";

export type MarketIntelItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  category: MarketIntelCategory;
  categoryLabel: string;
  publishedAt: string | null;
};

export type MarketIntelSnapshot = {
  items: MarketIntelItem[];
  updatedAt: string | null;
  isStale: boolean;
  sourcesChecked: number;
  sourcesSucceeded: number;
};

type StoredIntelCache = {
  updatedAt: string;
  sourcesChecked: number;
  sourcesSucceeded: number;
  items: MarketIntelItem[];
};

const CACHE_KEY = "market_intel_cache_json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

const RSS_FEEDS: Array<{ name: string; url: string; defaultCategory: MarketIntelCategory }> = [
  { name: "EcommerceBytes", url: "https://www.ecommercebytes.com/feed/", defaultCategory: "policy" },
  { name: "Supply Chain Dive", url: "https://www.supplychaindive.com/feeds/news/", defaultCategory: "logistics" },
  { name: "FreightWaves", url: "https://www.freightwaves.com/feed", defaultCategory: "logistics" },
  { name: "Retail Dive", url: "https://www.retaildive.com/feeds/news/", defaultCategory: "market" },
];

const CATEGORY_LABELS: Record<MarketIntelCategory, string> = {
  policy: "平台政策",
  logistics: "物流船期",
  tariff: "关税合规",
  market: "市场趋势",
};

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tagName: string): string {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(re);
  return match ? decodeXmlEntities(match[1]) : "";
}

function extractAtomLink(block: string): string {
  const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (hrefMatch?.[1]) return hrefMatch[1].trim();
  return extractTag(block, "link");
}

function classifyIntel(title: string, fallback: MarketIntelCategory): MarketIntelCategory {
  const text = title.toLowerCase();
  if (/(tariff|customs|duty|de minimis|compliance|recall|fda|fcc|ce\b|ul\b|tax|vat|gst)/i.test(text)) {
    return "tariff";
  }
  if (/(amazon|fba|seller|marketplace|walmart|ebay|shopify|temu|shein|tiktok shop|fee|policy|listing)/i.test(text)) {
    return "policy";
  }
  if (/(freight|port|container|shipping|ocean|air cargo|carrier|vessel|supply chain|warehouse|logistics|ups|fedex|usps)/i.test(text)) {
    return "logistics";
  }
  return fallback;
}

export function parseRssXml(
  xml: string,
  sourceName: string,
  defaultCategory: MarketIntelCategory,
  maxItems = 5,
): MarketIntelItem[] {
  const items: MarketIntelItem[] = [];
  const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];

  for (const block of itemMatches.slice(0, maxItems)) {
    const title = extractTag(block, "title");
    const link = extractAtomLink(block);
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    const rawDate =
      extractTag(block, "pubDate") ||
      extractTag(block, "updated") ||
      extractTag(block, "published") ||
      extractTag(block, "dc:date");
    const parsedTs = rawDate ? Date.parse(rawDate) : Number.NaN;
    const publishedAt = Number.isFinite(parsedTs) ? new Date(parsedTs).toISOString() : null;
    const category = classifyIntel(title, defaultCategory);

    items.push({
      id: `${sourceName}:${link}`,
      title,
      link,
      source: sourceName,
      category,
      categoryLabel: CATEGORY_LABELS[category],
      publishedAt,
    });
  }
  return items;
}

async function fetchSingleFeed(feed: { name: string; url: string; defaultCategory: MarketIntelCategory }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "User-Agent": "AITrade-IntelBot/1.0 (+http://localhost:1688)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return parseRssXml(xml, feed.name, feed.defaultCategory, 4);
  } finally {
    clearTimeout(timer);
  }
}

export async function getMarketIntelSnapshot(): Promise<MarketIntelSnapshot> {
  const db = await getDb();
  const result = await db.query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
    [CACHE_KEY],
  );
  const raw = result.rows[0]?.value;
  if (!raw) {
    return {
      items: [],
      updatedAt: null,
      isStale: true,
      sourcesChecked: RSS_FEEDS.length,
      sourcesSucceeded: 0,
    };
  }
  try {
    const parsed = JSON.parse(raw) as StoredIntelCache;
    const ts = parsed.updatedAt ? Date.parse(parsed.updatedAt) : Number.NaN;
    const isStale = !Number.isFinite(ts) || Date.now() - ts > CACHE_TTL_MS;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      updatedAt: parsed.updatedAt ?? null,
      isStale,
      sourcesChecked: parsed.sourcesChecked ?? RSS_FEEDS.length,
      sourcesSucceeded: parsed.sourcesSucceeded ?? 0,
    };
  } catch {
    return {
      items: [],
      updatedAt: null,
      isStale: true,
      sourcesChecked: RSS_FEEDS.length,
      sourcesSucceeded: 0,
    };
  }
}

export async function refreshMarketIntel(
  actorInput = "本机管理员",
  recordAudit = true,
): Promise<{
  snapshot: MarketIntelSnapshot;
  refreshed: boolean;
  error?: string;
}> {
  const actor = actorInput.trim().slice(0, 80) || "本机管理员";
  const settled = await Promise.allSettled(RSS_FEEDS.map((feed) => fetchSingleFeed(feed)));

  const merged: MarketIntelItem[] = [];
  const seenLinks = new Set<string>();
  let succeeded = 0;

  for (const res of settled) {
    if (res.status === "fulfilled" && res.value.length > 0) {
      succeeded += 1;
      for (const item of res.value) {
        if (!seenLinks.has(item.link)) {
          seenLinks.add(item.link);
          merged.push(item);
        }
      }
    }
  }

  if (merged.length === 0) {
    const current = await getMarketIntelSnapshot();
    return {
      snapshot: current,
      refreshed: false,
      error: "外部情报源暂时不可达，已保留上次缓存内容",
    };
  }

  merged.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  const trimmed = merged.slice(0, 12);
  const nowIso = new Date().toISOString();
  const payload: StoredIntelCache = {
    updatedAt: nowIso,
    sourcesChecked: RSS_FEEDS.length,
    sourcesSucceeded: succeeded,
    items: trimmed,
  };

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [CACHE_KEY, JSON.stringify(payload), actor],
    );
    if (recordAudit) {
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'intel.feed_refreshed', 'market_intel', 'GLOBAL', $3::jsonb)`,
        [
          randomUUID(),
          actor,
          JSON.stringify({
            count: trimmed.length,
            sourcesSucceeded: succeeded,
            sourcesChecked: RSS_FEEDS.length,
          }),
        ],
      );
    }
  });

  return {
    snapshot: {
      items: trimmed,
      updatedAt: nowIso,
      isStale: false,
      sourcesChecked: RSS_FEEDS.length,
      sourcesSucceeded: succeeded,
    },
    refreshed: true,
  };
}
