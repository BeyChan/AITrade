import { randomUUID } from "node:crypto";
import { getAppMode, type AppMode } from "../app-mode.ts";
import { getDb } from "../db.ts";
import { calculateEconomics, opportunityScore, recommendationFor, type EconomicsAssumptions } from "../economics.ts";
import { createListingDraft } from "./content.ts";
import type { CandidateImportRow } from "../csv.ts";
import type {
  AuditRow,
  CaseDetail,
  CaseStatus,
  CostModelRow,
  EnrichedCase,
  EvidenceRow,
  MarketRow,
  PlatformRow,
  ProductCaseRow,
  ProductRow,
} from "../types.ts";

/**
 * 商品生命周期：终止是软状态变更，不删任何证据、报价、成本模型与内容草稿。
 * 归档后首页 / 内容工作台因只取 status='approved' 自动移出，可随时恢复。
 */
export async function setCaseLifecycle(input: {
  caseId: string;
  action: "archive" | "restore";
  actor: string;
  reason?: string;
}): Promise<void> {
  const db = await getDb();
  const actor = input.actor.trim() || "运营人员";
  const reason = (input.reason ?? "").trim().slice(0, 300);
  if (input.action === "archive" && !reason) {
    throw new Error("请填写终止原因，便于后续复盘");
  }

  await db.transaction(async (tx) => {
    const current = await tx.query<{ id: string; status: string }>(
      "SELECT id, status FROM product_cases WHERE id = $1 LIMIT 1",
      [input.caseId],
    );
    const row = current.rows[0];
    if (!row) throw new Error("商品不存在");
    const terminated = row.status === "archived" || row.status === "rejected";
    if (input.action === "archive" && terminated) throw new Error("该商品已终止，无需重复操作");
    if (input.action === "restore" && !terminated) throw new Error("只有已终止的商品可以恢复");

    await tx.query(
      "UPDATE product_cases SET status = $1, updated_at = NOW() WHERE id = $2",
      [input.action === "archive" ? "archived" : "approved", input.caseId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
      [
        randomUUID(),
        actor,
        input.action === "archive" ? "product_case.archived" : "product_case.restored",
        input.caseId,
        JSON.stringify(
          input.action === "archive"
            ? { reason, previousStatus: row.status }
            : { previousStatus: row.status, restoredTo: "approved" },
        ),
      ],
    );
  });
}

export type TerminatedCase = {
  caseItem: EnrichedCase;
  reason: string;
  archivedAt: string | null;
  archivedBy: string | null;
};

/** 已终止商品 + 最近一次终止原因，供首页「已终止」面板展示与恢复 */
export async function listTerminatedCases(): Promise<TerminatedCase[]> {
  const db = await getDb();
  const cases = await listCases();
  const terminated = cases.filter((item) => item.status === "archived" || item.status === "rejected");
  if (terminated.length === 0) return [];

  const logs = await db.query<{
    entity_id: string;
    actor: string;
    details: { reason?: string } | null;
    created_at: string;
  }>(
    `SELECT DISTINCT ON (entity_id) entity_id, actor, details, created_at
     FROM audit_logs
     WHERE entity_type = 'product_case' AND action = 'product_case.archived'
     ORDER BY entity_id, created_at DESC`,
  );
  const byCase = new Map(logs.rows.map((row) => [row.entity_id, row]));
  return terminated.map((caseItem) => {
    const log = byCase.get(caseItem.id);
    return {
      caseItem,
      reason: log?.details?.reason || "（未记录原因）",
      archivedAt: log?.created_at ?? null,
      archivedBy: log?.actor ?? null,
    };
  });
}

export async function resolveCurrentMode(explicitMode?: AppMode): Promise<AppMode> {
  if (explicitMode) return explicitMode;
  try {
    return await getAppMode();
  } catch {
    return "sandbox";
  }
}

export async function listCases(options?: { mode?: AppMode }): Promise<EnrichedCase[]> {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const casesQuery = mode === "live"
    ? "SELECT * FROM product_cases WHERE is_demo = FALSE ORDER BY created_at DESC"
    : "SELECT * FROM product_cases ORDER BY created_at DESC";

  const [cases, costs, approvedListings] = await Promise.all([
    db.query<ProductCaseRow>(casesQuery),
    db.query<CostModelRow>("SELECT DISTINCT ON (case_id) * FROM cost_models ORDER BY case_id, version DESC"),
    db.query<{ case_id: string }>(
      "SELECT DISTINCT case_id FROM listings WHERE status = 'content_approved' OR status = 'published'",
    ),
  ]);
  const costByCase = new Map(costs.rows.map((cost) => [cost.case_id, cost]));
  const approvedContentCaseIds = new Set(approvedListings.rows.map((r) => r.case_id));

  return cases.rows
    .map((productCase) => {
      const costModel = costByCase.get(productCase.id) ?? null;
      const results = costModel?.results;
      const score = results
        ? opportunityScore(results, productCase.monthly_sales_estimate, productCase.review_count, productCase.evidence_score)
        : 0;
      return {
        ...productCase,
        costModel,
        opportunityScore: score,
        recommendation: results ? recommendationFor(results, score) : ("HOLD" as const),
        hasApprovedContent: approvedContentCaseIds.has(productCase.id),
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

export async function getSiteOptions() {
  const db = await getDb();
  const [markets, platforms] = await Promise.all([
    db.query<MarketRow>("SELECT * FROM markets WHERE status = 'active' ORDER BY region, name"),
    db.query<PlatformRow>("SELECT * FROM platforms WHERE status <> 'disabled' ORDER BY name"),
  ]);
  return { markets: markets.rows, platforms: platforms.rows };
}

export async function listCasesForSite(
  marketCode: string,
  platformCode: string,
  options?: { mode?: AppMode },
): Promise<EnrichedCase[]> {
  const db = await getDb();
  const [cases, discovered, targeted] = await Promise.all([
    listCases(options),
    db.query<{ case_id: string }>(
      `SELECT case_id
       FROM product_case_sites
       WHERE market_code = $1 AND platform_code = $2`,
      [marketCode, platformCode],
    ),
    db.query<{ case_id: string }>(
      `SELECT DISTINCT p.case_id
       FROM channel_listings cl
       JOIN product_market_variants pmv ON pmv.id = cl.product_market_variant_id
       JOIN products p ON p.id = pmv.product_id
       JOIN channel_accounts ca ON ca.id = cl.channel_account_id
       WHERE pmv.country_code = $1 AND ca.platform_code = $2`,
      [marketCode, platformCode],
    ),
  ]);
  const scopedCaseIds = new Set([
    ...discovered.rows.map((row) => row.case_id),
    ...targeted.rows.map((row) => row.case_id),
  ]);

  return cases.filter((item) => scopedCaseIds.has(item.id));
}

export async function getCaseDetail(caseId: string): Promise<CaseDetail | null> {
  const db = await getDb();
  const productCases = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  const productCase = productCases.rows[0];
  if (!productCase) return null;

  const [costs, evidence, selections, audits, quotes, approvedListings] = await Promise.all([
    db.query<CostModelRow>("SELECT * FROM cost_models WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId]),
    db.query<EvidenceRow>("SELECT * FROM case_evidence WHERE case_id = $1 ORDER BY captured_at DESC", [caseId]),
    db.query<{ id: string }>("SELECT id FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]),
    db.query<AuditRow>("SELECT * FROM audit_logs WHERE entity_type = 'product_case' AND entity_id = $1 ORDER BY created_at DESC LIMIT 12", [
      caseId,
    ]),
    db.query<{ count: string }>(
      "SELECT COUNT(*)::text as count FROM quotes q JOIN rfqs r ON r.id = q.rfq_id WHERE r.case_id = $1",
      [caseId],
    ),
    db.query<{ id: string }>(
      "SELECT id FROM listings WHERE case_id = $1 AND (status = 'content_approved' OR status = 'published') LIMIT 1",
      [caseId],
    ),
  ]);

  return {
    productCase,
    costModel: costs.rows[0] ?? null,
    hasSupplierSelection: Boolean(selections.rows[0]),
    quoteCount: Number(quotes.rows[0]?.count ?? 0),
    hasApprovedContent: Boolean(approvedListings.rows[0]),
    evidence: evidence.rows,
    auditLogs: audits.rows,
  };
}

export async function importCandidates(
  rows: CandidateImportRow[],
  actor = "运营人员",
  options?: { isDemo?: boolean },
) {
  const db = await getDb();
  const isDemo = options?.isDemo ?? ((await resolveCurrentMode()) === "sandbox");
  let imported = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const caseId = randomUUID();
      const results = calculateEconomics(row.assumptions);
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO product_cases
          (id, asin, marketplace, category, title, url, status, competitor_price_cents,
           monthly_sales_estimate, review_count, rating, notes, owner, evidence_score, is_demo)
         VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, $8, $9, $10, $11, $12, 0, $13)
         ON CONFLICT (asin, marketplace) DO NOTHING
         RETURNING id`,
        [
          caseId,
          row.asin,
          row.marketplace,
          row.category,
          row.title,
          row.url || null,
          row.competitorPriceCents,
          row.monthlySalesEstimate,
          row.reviewCount,
          row.rating,
          row.notes,
          actor,
          isDemo,
        ],
      );
      if (!inserted.rows[0]) {
        skipped += 1;
        continue;
      }

      await tx.query(
        `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
         VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5)`,
        [randomUUID(), caseId, JSON.stringify(row.assumptions), JSON.stringify(results), actor],
      );
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'case.imported', 'product_case', $3, $4::jsonb)`,
        [randomUUID(), actor, caseId, JSON.stringify({ asin: row.asin, marketplace: row.marketplace })],
      );
      imported += 1;
    }
  });

  return { imported, skipped, total: rows.length };
}

export type CreateCaseFromCompetitorInput = {
  title: string;
  category: string;
  marketplace: string;
  platform: string;
  currency: string;
  competitorPriceCents: number;
  monthlySalesEstimate: number;
  reviewCount: number;
  rating: number;
  notes: string;
  assumptions: EconomicsAssumptions;
  antiListing?: {
    antiTitle: string;
    bullets: Array<{ headline: string; content: string }>;
    aplusModules?: Array<{ title: string; description: string; visualSuggestion: string }>;
  } | null;
  rfqDraft?: {
    productName: string;
    targetPriceRmb: number;
    suggestedMoq: string;
    criticalImprovements: Array<{ component: string; painPointTargeted: string; manufacturingStandard: string }>;
    formattedText: string;
  } | null;
  competitorAsins?: string[];
  reportId?: string;
};

export async function createProductCaseFromCompetitors(
  input: CreateCaseFromCompetitorInput,
  actor = "竞品操盘手",
  options?: { isDemo?: boolean },
) {
  const db = await getDb();
  const caseId = randomUUID();
  const asin = `AI-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const results = calculateEconomics(input.assumptions);
  const isDemo = options?.isDemo ?? ((await resolveCurrentMode()) === "sandbox");

  // 严格遵循客观证据原则：AI 生成的反制文案与 RFQ 均为卖点假设，绝不计入客观证据完整度！
  // 证据完整度只按实际抓取并人工复核的竞品样本量客观计算
  const verifiedCount = input.competitorAsins?.length ?? 0;
  const realEvidenceScore = Math.min(50, Math.max(15, verifiedCount * 12));

  const score = opportunityScore(
    results,
    input.monthlySalesEstimate,
    input.reviewCount,
    realEvidenceScore,
  );

  // 严谨立项原则：从竞品初筛转入案卷，初始状态为待人工立项评审 (review_pending)，
  // 防止未经人工打样核实的 AI 研报直接绕过立项门禁
  const status: CaseStatus = "review_pending";

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO product_cases
        (id, asin, marketplace, category, title, url, status, competitor_price_cents,
         monthly_sales_estimate, review_count, rating, notes, owner, evidence_score, is_demo, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        caseId,
        asin,
        input.marketplace,
        input.category,
        input.title,
        input.reportId ? `/competitors?reportId=${input.reportId}` : null,
        status,
        input.competitorPriceCents,
        input.monthlySalesEstimate,
        input.reviewCount,
        input.rating,
        input.notes,
        actor,
        realEvidenceScore,
        isDemo,
        input.currency,
      ],
    );

    // 核心接缝修复：必须插入 product_case_sites，确保首页看板 listCasesForSite 能够实时查到新立项案卷
    await tx.query(
      `INSERT INTO product_case_sites (case_id, market_code, platform_code, discovery_source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (case_id, market_code, platform_code) DO NOTHING`,
      [caseId, input.marketplace, input.platform || "amazon", "competitor_compare"],
    );

    await tx.query(
      `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
       VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5)`,
      [randomUUID(), caseId, JSON.stringify(input.assumptions), JSON.stringify(results), actor],
    );

    if (input.rfqDraft) {
      await tx.query(
        `INSERT INTO case_evidence
          (id, case_id, evidence_type, source_type, source_url, title, summary, payload, confidence, captured_at)
         VALUES ($1, $2, 'supplier_rfq', '1688_rfq', $3, $4, $5, $6::jsonb, 0.9, NOW())`,
        [
          randomUUID(),
          caseId,
          "https://s.1688.com",
          `1688 工艺改良询价单: ${input.rfqDraft.productName}`,
          `目标采购价: ¥${input.rfqDraft.targetPriceRmb}，建议 MOQ: ${input.rfqDraft.suggestedMoq}`,
          JSON.stringify(input.rfqDraft),
        ],
      );
    }

    if (input.competitorAsins && input.competitorAsins.length > 0) {
      await tx.query(
        `INSERT INTO case_evidence
          (id, case_id, evidence_type, source_type, source_url, title, summary, payload, confidence, captured_at)
         VALUES ($1, $2, 'competitor_benchmark', 'amazon_benchmark', $3, $4, $5, $6::jsonb, 0.85, NOW())`,
        [
          randomUUID(),
          caseId,
          input.reportId ? `/competitors?reportId=${input.reportId}` : null,
          `标杆竞品 ASIN 对标矩阵 (${input.competitorAsins.length} 款)`,
          input.competitorAsins.join(", "),
          JSON.stringify({ asins: input.competitorAsins }),
        ],
      );
    }

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'case.promoted_from_competitors', 'product_case', $3, $4::jsonb)`,
      [randomUUID(), actor, caseId, JSON.stringify({ asin, status, score })],
    );
  });

  if (input.antiListing) {
    try {
      const bullets = input.antiListing.bullets.map((b) => `${b.headline} ${b.content}`);
      const description = input.antiListing.aplusModules && input.antiListing.aplusModules.length > 0
        ? input.antiListing.aplusModules.map((m) => `### ${m.title}\n${m.description}`).join("\n\n")
        : input.antiListing.antiTitle;
      await createListingDraft(
        caseId,
        {
          brand: "Brand",
          title: input.antiListing.antiTitle,
          bullets,
          description,
          searchTerms: "",
        },
        actor,
      );
    } catch (e) {
      console.warn("createListingDraft from competitor error:", e);
    }
  }

  return { caseId, asin, status, score };
}

export async function createCostModelVersion(caseId: string, assumptions: EconomicsAssumptions, actor = "运营人员") {
  const db = await getDb();
  const product = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  if (!product.rows[0]) throw new Error("商品机会不存在");

  const versionResult = await db.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM cost_models WHERE case_id = $1",
    [caseId],
  );
  const version = Number(versionResult.rows[0]?.version ?? 1);
  const results = calculateEconomics(assumptions);
  const modelId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
      [modelId, caseId, version, JSON.stringify(assumptions), JSON.stringify(results), actor],
    );
    await tx.query(
      "UPDATE product_cases SET competitor_price_cents = $1, updated_at = NOW() WHERE id = $2",
      [assumptions.salePriceCents, caseId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'cost_model.created', 'product_case', $3, $4::jsonb)`,
      [randomUUID(), actor, caseId, JSON.stringify({ version, assumptions, results })],
    );
  });

  return { modelId, version, results };
}

