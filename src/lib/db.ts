import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { calculateEconomics, type EconomicsAssumptions } from "./economics.ts";

declare global {
  // eslint-disable-next-line no-var
  var __aitradeDbPromise: Promise<PGlite> | undefined;
}

export function getDb() {
  if (!globalThis.__aitradeDbPromise) {
    globalThis.__aitradeDbPromise = initializeDb();
  }
  return globalThis.__aitradeDbPromise;
}

async function initializeDb() {
  const configuredDir = process.env.PGLITE_DATA_DIR || ".data/aitrade";
  // PGlite opens this path at runtime; it must not be traced into the server bundle.
  const dataDir = path.isAbsolute(configuredDir) ? configuredDir : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredDir);
  const db = new PGlite(dataDir);
  await db.waitReady;
  const schema = readFileSync(path.resolve(process.cwd(), "db/schema.sql"), "utf8");
  await db.exec(schema);
  await seedDemoData(db);
  return db;
}

type DemoCase = {
  asin: string;
  title: string;
  category: string;
  salePrice: number;
  landedCost: number;
  fbaFee: number;
  adRate: number;
  returnRate: number;
  monthlySales: number;
  reviewCount: number;
  rating: number;
  evidenceScore: number;
  notes: string;
  evidence: Array<{ type: string; title: string; summary: string; confidence: number }>;
};

const demoCases: DemoCase[] = [
  {
    asin: "B0DEMO0001",
    title: "Stainless Steel Pet Water Fountain with Quiet Pump",
    category: "宠物饮水器",
    salePrice: 39.99,
    landedCost: 12.4,
    fbaFee: 5.72,
    adRate: 0.12,
    returnRate: 0.06,
    monthlySales: 1800,
    reviewCount: 860,
    rating: 4.3,
    evidenceScore: 78,
    notes: "演示数据：用于验证“高客单 + 可解决噪音/清洁痛点”的候选品。",
    evidence: [
      {
        type: "review_theme",
        title: "差评主题：泵噪音与清洗死角",
        summary: "竞品评论中出现频率最高的负向主题是夜间噪音、泵体堵塞和滤芯更换提醒不清晰。",
        confidence: 0.84,
      },
      {
        type: "market_signal",
        title: "价格带观察",
        summary: "主要竞品集中在 $29.99–$49.99，可通过静音泵、可拆洗结构和可视化滤芯提醒做差异化。",
        confidence: 0.71,
      },
    ],
  },
  {
    asin: "B0DEMO0002",
    title: "Self-Cleaning Pet Grooming Brush for Long Hair",
    category: "宠物清洁",
    salePrice: 24.99,
    landedCost: 5.2,
    fbaFee: 4.95,
    adRate: 0.15,
    returnRate: 0.04,
    monthlySales: 2400,
    reviewCount: 2180,
    rating: 4.5,
    evidenceScore: 65,
    notes: "演示数据：验证高需求、低客单商品的广告敏感性。",
    evidence: [
      {
        type: "review_theme",
        title: "用户诉求：少飞毛、易清理",
        summary: "用户愿意为按压退毛、防拉扯和长毛适配支付溢价，但担心塑料卡扣断裂。",
        confidence: 0.79,
      },
      {
        type: "competition",
        title: "竞争强度提示",
        summary: "头部 Listing 评论数较高，需通过组合装或明确的长毛场景切入。",
        confidence: 0.67,
      },
    ],
  },
  {
    asin: "B0DEMO0003",
    title: "Extra Large Covered Cat Litter Box with Odor Control",
    category: "猫砂盆",
    salePrice: 59.99,
    landedCost: 23,
    fbaFee: 9.35,
    adRate: 0.11,
    returnRate: 0.07,
    monthlySales: 900,
    reviewCount: 430,
    rating: 4.2,
    evidenceScore: 58,
    notes: "演示数据：高客单、高物流成本，需要重点验证包装体积和退货率。",
    evidence: [
      {
        type: "review_theme",
        title: "差评主题：尺寸描述与除味效果",
        summary: "用户对内部实际尺寸和盖子密封性敏感，退货原因集中在猫体型不适配。",
        confidence: 0.82,
      },
      {
        type: "logistics_risk",
        title: "体积重风险",
        summary: "商品体积较大，必须将包装优化与 FBA 费用纳入立项门槛。",
        confidence: 0.9,
      },
    ],
  },
  {
    asin: "B0DEMO0004",
    title: "Portable Dog Water Bottle with Leak-Proof Lock",
    category: "户外宠物",
    salePrice: 19.99,
    landedCost: 4.8,
    fbaFee: 4.65,
    adRate: 0.16,
    returnRate: 0.05,
    monthlySales: 3200,
    reviewCount: 5600,
    rating: 4.4,
    evidenceScore: 52,
    notes: "演示数据：需求强但竞争密集，适合作为流量款而非首推利润款。",
    evidence: [
      {
        type: "review_theme",
        title: "核心卖点：单手操作与防漏",
        summary: "用户最关注携带时是否漏水、能否单手喂水以及剩余水回收。",
        confidence: 0.76,
      },
      {
        type: "competition",
        title: "红海信号",
        summary: "评论数量高、价格竞争激烈，广告位和差异化成本需要保守估计。",
        confidence: 0.8,
      },
    ],
  },
];

async function seedDemoData(db: PGlite) {
  const countResult = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM product_cases");
  if (Number(countResult.rows[0]?.count ?? 0) > 0) return;

  await db.transaction(async (tx) => {
    for (const demo of demoCases) {
      const id = randomUUID();
      const assumptions: EconomicsAssumptions = {
        salePriceCents: Math.round(demo.salePrice * 100),
        landedCostCents: Math.round(demo.landedCost * 100),
        fbaFeeCents: Math.round(demo.fbaFee * 100),
        referralRate: 0.15,
        adRate: demo.adRate,
        returnRate: demo.returnRate,
        returnProcessingCents: 300,
        returnRecoveryRate: 0.3,
        couponCents: 100,
        storageCents: 45,
        otherCostCents: 50,
      };
      const results = calculateEconomics(assumptions);
      await tx.query(
        `INSERT INTO product_cases
          (id, asin, marketplace, category, title, status, competitor_price_cents,
           monthly_sales_estimate, review_count, rating, notes, owner, evidence_score, is_demo)
         VALUES ($1, $2, 'US', $3, $4, 'review_pending', $5, $6, $7, $8, $9, 'AI 运营组', $10, TRUE)`,
        [
          id,
          demo.asin,
          demo.category,
          demo.title,
          assumptions.salePriceCents,
          demo.monthlySales,
          demo.reviewCount,
          demo.rating,
          demo.notes,
          demo.evidenceScore,
        ],
      );
      await tx.query(
        `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
         VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, 'seed')`,
        [randomUUID(), id, JSON.stringify(assumptions), JSON.stringify(results)],
      );
      for (const evidence of demo.evidence) {
        await tx.query(
          `INSERT INTO case_evidence
            (id, case_id, evidence_type, source_type, title, summary, confidence, payload)
           VALUES ($1, $2, $3, 'demo', $4, $5, $6, $7::jsonb)`,
          [
            randomUUID(),
            id,
            evidence.type,
            evidence.title,
            evidence.summary,
            evidence.confidence,
            JSON.stringify({ demo: true, note: "示例数据，不代表真实市场结论" }),
          ],
        );
      }
      await tx.query(
        `INSERT INTO product_case_sites
          (case_id, market_code, platform_code, discovery_source)
         VALUES ($1, 'US', 'amazon', 'demo_seed')
         ON CONFLICT (case_id, market_code, platform_code) DO NOTHING`,
        [id],
      );
      await tx.query(
        `INSERT INTO approvals (id, case_id, gate, status)
         VALUES ($1, $2, 'case_selection', 'pending')`,
        [randomUUID(), id],
      );
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, 'system', 'case.seeded', 'product_case', $2, $3::jsonb)`,
        [randomUUID(), id, JSON.stringify({ isDemo: true, version: 1 })],
      );
    }
  });
}
