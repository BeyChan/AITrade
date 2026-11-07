"use server";

import { getDb } from "./db.ts";

export type SearchResultItem = {
  id: string;
  type: "case" | "batch" | "supplier";
  typeLabel: string;
  title: string;
  subtitle: string;
  href: string;
};

export async function searchGlobal(rawQuery: string): Promise<SearchResultItem[]> {
  const query = rawQuery.trim();
  if (!query) return [];

  const db = await getDb();
  const pattern = `%${query}%`;

  try {
    const [casesRes, batchesRes, suppliersRes] = await Promise.all([
      db.query<{ id: string; title: string; asin: string; category: string; marketplace: string }>(
        `SELECT id, title, asin, category, marketplace
         FROM product_cases
         WHERE title ILIKE $1 OR asin ILIKE $1 OR category ILIKE $1
         ORDER BY updated_at DESC
         LIMIT 6`,
        [pattern]
      ),
      db.query<{ id: string; category: string; brief: string; market_code: string; platform_code: string }>(
        `SELECT id, category, brief, market_code, platform_code
         FROM ai_sourcing_batches
         WHERE category ILIKE $1 OR brief ILIKE $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [pattern]
      ),
      db.query<{ id: string; name: string; category: string; contact: string }>(
        `SELECT id, name, category, contact
         FROM suppliers
         WHERE name ILIKE $1 OR category ILIKE $1 OR contact ILIKE $1
         ORDER BY name ASC
         LIMIT 5`,
        [pattern]
      ).catch(() => ({ rows: [] })),
    ]);

    const results: SearchResultItem[] = [];

    for (const c of casesRes.rows) {
      results.push({
        id: c.id,
        type: "case",
        typeLabel: "商品",
        title: c.title,
        subtitle: `${c.marketplace} · ASIN: ${c.asin} · ${c.category}`,
        href: `/cases/${c.id}`,
      });
    }

    for (const b of batchesRes.rows) {
      results.push({
        id: b.id,
        type: "batch",
        typeLabel: "研报",
        title: `${b.category} · 选品研究`,
        subtitle: `${b.market_code} / ${b.platform_code.toUpperCase()} · ${b.brief}`,
        href: `/ai-sourcing/${b.id}`,
      });
    }

    for (const s of suppliersRes.rows) {
      results.push({
        id: s.id,
        type: "supplier",
        typeLabel: "供应商",
        title: s.name,
        subtitle: `${s.category || "未分类"} · ${s.contact || "工厂库"}`,
        href: `/suppliers`,
      });
    }

    return results;
  } catch (err) {
    console.error("searchGlobal error:", err);
    return [];
  }
}
