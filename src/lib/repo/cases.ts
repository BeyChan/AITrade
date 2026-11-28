import { randomUUID } from "node:crypto";
import { getAppMode, isDemoMode, type AppMode } from "../app-mode.ts";
import { getDb } from "../db.ts";
import { calculateEconomics, opportunityScore, recommendationFor, type EconomicsAssumptions } from "../economics.ts";
import type { CandidateImportRow } from "../csv.ts";
import type {
  AuditRow,
  CaseDetail,
  CostModelRow,
  EnrichedCase,
  EvidenceRow,
  MarketRow,
  NoGoExceptionRecord,
  PlatformRow,
  ProductCaseRow,
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
}, options?: { mode?: AppMode }): Promise<void> {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const demo = isDemoMode(mode);
  const actor = input.actor.trim() || "运营人员";
  const reason = (input.reason ?? "").trim().slice(0, 300);
  if (input.action === "archive" && !reason) {
    throw new Error("请填写终止原因，便于后续复盘");
  }

  await db.transaction(async (tx) => {
    const current = await tx.query<{ id: string; status: string }>(
      "SELECT id, status FROM product_cases WHERE id = $1 AND is_demo = $2 LIMIT 1",
      [input.caseId, demo],
    );
    const row = current.rows[0];
    if (!row) throw new Error("商品不存在");
    const terminated = row.status === "archived" || row.status === "rejected";
    if (input.action === "archive" && terminated) throw new Error("该商品已终止，无需重复操作");
    if (input.action === "restore" && !terminated) throw new Error("只有已终止的商品可以恢复");

    await tx.query(
      "UPDATE product_cases SET status = $1, updated_at = NOW() WHERE id = $2 AND is_demo = $3",
      [input.action === "archive" ? "archived" : "approved", input.caseId, demo],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
       VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb, $6)`,
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
        demo,
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
export async function listTerminatedCases(options?: { mode?: AppMode }): Promise<TerminatedCase[]> {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const demo = isDemoMode(mode);
  const cases = await listCases(options);
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
     WHERE entity_type = 'product_case' AND action = 'product_case.archived' AND is_demo = $1
     ORDER BY entity_id, created_at DESC`,
    [demo],
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

/** 所有按 ID 进入案卷的仓储操作都必须通过此入口做模式校验。 */
export async function getCaseForMode(
  caseId: string,
  options?: { mode?: AppMode },
): Promise<ProductCaseRow | null> {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const result = await db.query<ProductCaseRow>(
    "SELECT * FROM product_cases WHERE id = $1 AND is_demo = $2 LIMIT 1",
    [caseId, isDemoMode(mode)],
  );
  return result.rows[0] ?? null;
}

function parseNoGoException(row: { details: Record<string, unknown> | null; actor: string; created_at: string } | undefined): NoGoExceptionRecord | null {
  if (!row) return null;
  const details = row.details ?? {};
  return {
    reason: String(details.reason ?? "").trim() || "已记录例外原因",
    riskNote: String(details.riskNote ?? details.risk_note ?? "").trim() || "已确认风险",
    approver: String(details.approver ?? row.actor ?? "").trim() || "审批人",
    createdAt: row.created_at,
  };
}

export async function recordCaseNoGoException(input: {
  caseId: string;
  reason: string;
  riskNote: string;
  approver: string;
}, options?: { mode?: AppMode }): Promise<NoGoExceptionRecord> {
  const reason = input.reason.trim();
  const riskNote = input.riskNote.trim();
  const approver = input.approver.trim();
  if (!reason) throw new Error("申请 NO-GO 例外必须填写例外原因");
  if (!riskNote) throw new Error("申请 NO-GO 例外必须填写风险说明");
  if (!approver) throw new Error("申请 NO-GO 例外必须填写审批人");

  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const productCase = await getCaseForMode(input.caseId, { mode });
  if (!productCase) throw new Error("商品案卷不存在");
  if (productCase.status === "archived" || productCase.status === "rejected") {
    throw new Error("已归档或已否决的商品不能申请例外，请先恢复状态");
  }

  const createdAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
       VALUES ($1, $2, 'case.exception_created', 'product_case', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        approver,
        input.caseId,
        JSON.stringify({
          reason,
          riskNote,
          approver,
          gateRecommendation: "NO-GO",
          previousStatus: productCase.status,
        }),
        isDemoMode(mode),
      ],
    );
    await tx.query(
      "UPDATE product_cases SET updated_at = NOW() WHERE id = $1 AND is_demo = $2",
      [input.caseId, isDemoMode(mode)],
    );
  });

  return { reason, riskNote, approver, createdAt };
}

export async function getCaseWorkflowFacts(caseId: string, options?: { mode?: AppMode }): Promise<{
  quoteCount: number;
  validQuoteCount: number;
  hasApprovedContent: boolean;
  approvedMainImageCount: number;
  hasFlatFileExported: boolean;
  hasMediaPackExported: boolean;
  hasNoGoException: boolean;
  noGoException: NoGoExceptionRecord | null;
}> {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const demo = isDemoMode(mode);
  const productCase = await getCaseForMode(caseId, { mode });
  if (!productCase) {
    return {
      quoteCount: 0,
      validQuoteCount: 0,
      hasApprovedContent: false,
      approvedMainImageCount: 0,
      hasFlatFileExported: false,
      hasMediaPackExported: false,
      hasNoGoException: false,
      noGoException: null,
    };
  }
  const [quotes, approvedListings, mainImages, exportLogs, exceptionLogs] = await Promise.all([
    db.query<{ total: string; valid: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE q.unit_price_cents > 0)::text AS valid
       FROM quotes q
       JOIN rfqs r ON r.id = q.rfq_id
       WHERE r.case_id = $1`,
      [caseId],
    ),
    db.query<{ id: string }>(
      "SELECT id FROM listings WHERE case_id = $1 AND (status = 'content_approved' OR status = 'published') LIMIT 1",
      [caseId],
    ),
    db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM assets WHERE case_id = $1 AND asset_type = 'main_image' AND status = 'approved'",
      [caseId],
    ),
    db.query<{ action: string }>(
      `SELECT DISTINCT action
       FROM audit_logs
       WHERE entity_type = 'product_case'
         AND entity_id = $1
         AND is_demo = $2
         AND action IN ('case.flat_file_exported', 'case.flatfile_exported', 'case.media_pack_exported')`,
      [caseId, demo],
    ),
    db.query<{ actor: string; details: Record<string, unknown> | null; created_at: string }>(
      `SELECT actor, details, created_at
       FROM audit_logs
       WHERE entity_type = 'product_case'
         AND entity_id = $1
         AND is_demo = $2
         AND action = 'case.exception_created'
       ORDER BY created_at DESC
       LIMIT 1`,
      [caseId, demo],
    ),
  ]);

  const exportedActions = new Set(exportLogs.rows.map((r) => r.action));
  const noGoException = parseNoGoException(exceptionLogs.rows[0]);

  return {
    quoteCount: Number(quotes.rows[0]?.total ?? 0),
    validQuoteCount: Number(quotes.rows[0]?.valid ?? 0),
    hasApprovedContent: Boolean(approvedListings.rows[0]),
    approvedMainImageCount: Number(mainImages.rows[0]?.count ?? 0),
    hasFlatFileExported: exportedActions.has("case.flat_file_exported") || exportedActions.has("case.flatfile_exported"),
    hasMediaPackExported: exportedActions.has("case.media_pack_exported"),
    hasNoGoException: Boolean(noGoException),
    noGoException,
  };
}

export async function listCases(options?: { mode?: AppMode }): Promise<EnrichedCase[]> {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const demo = isDemoMode(mode);
  const casesQuery = "SELECT * FROM product_cases WHERE is_demo = $1 ORDER BY created_at DESC";

  const [cases, costs, approvedListings, quoteCounts, selections, mainImages, exportLogs, exceptionLogs] = await Promise.all([
    db.query<ProductCaseRow>(casesQuery, [demo]),
    db.query<CostModelRow>(
      `SELECT DISTINCT ON (cm.case_id) cm.*
       FROM cost_models cm
       JOIN product_cases pc ON pc.id = cm.case_id
       WHERE pc.is_demo = $1
       ORDER BY cm.case_id, cm.version DESC`,
      [demo],
    ),
    db.query<{ case_id: string }>(
      `SELECT DISTINCT l.case_id
       FROM listings l
       JOIN product_cases pc ON pc.id = l.case_id
       WHERE pc.is_demo = $1 AND (l.status = 'content_approved' OR l.status = 'published')`,
      [demo],
    ),
    db.query<{ case_id: string; count: string }>(
      `SELECT r.case_id, COUNT(q.id)::text AS count
       FROM quotes q
       JOIN rfqs r ON r.id = q.rfq_id
       JOIN product_cases pc ON pc.id = r.case_id
       WHERE pc.is_demo = $1
       GROUP BY r.case_id`,
      [demo],
    ),
    db.query<{ case_id: string }>(
      `SELECT DISTINCT ss.case_id
       FROM supplier_selections ss
       JOIN product_cases pc ON pc.id = ss.case_id
       WHERE pc.is_demo = $1`,
      [demo],
    ),
    db.query<{ case_id: string; count: string }>(
      `SELECT a.case_id, COUNT(*)::text AS count
       FROM assets a
       JOIN product_cases pc ON pc.id = a.case_id
       WHERE pc.is_demo = $1 AND a.asset_type = 'main_image' AND a.status = 'approved'
       GROUP BY a.case_id`,
      [demo],
    ),
    db.query<{ entity_id: string; action: string }>(
      `SELECT DISTINCT entity_id, action
       FROM audit_logs
       WHERE entity_type = 'product_case'
         AND entity_id IN (SELECT id FROM product_cases WHERE is_demo = $1)
         AND action IN ('case.flat_file_exported', 'case.flatfile_exported', 'case.media_pack_exported')`,
      [demo],
    ),
    db.query<{ entity_id: string }>(
      `SELECT DISTINCT entity_id
       FROM audit_logs
       WHERE entity_type = 'product_case'
         AND entity_id IN (SELECT id FROM product_cases WHERE is_demo = $1)
         AND action = 'case.exception_created'`,
      [demo],
    ),
  ]);
  const costByCase = new Map(costs.rows.map((cost) => [cost.case_id, cost]));
  const approvedContentCaseIds = new Set(approvedListings.rows.map((r) => r.case_id));
  const quoteCountByCase = new Map(quoteCounts.rows.map((r) => [r.case_id, Number(r.count ?? 0)]));
  const selectedCaseIds = new Set(selections.rows.map((r) => r.case_id));
  const mainImageCountByCase = new Map(mainImages.rows.map((r) => [r.case_id, Number(r.count ?? 0)]));
  const flatFileExportedIds = new Set<string>();
  const mediaPackExportedIds = new Set<string>();
  for (const row of exportLogs.rows) {
    if (row.action === "case.flat_file_exported" || row.action === "case.flatfile_exported") {
      flatFileExportedIds.add(row.entity_id);
    } else if (row.action === "case.media_pack_exported") {
      mediaPackExportedIds.add(row.entity_id);
    }
  }
  const exceptionCaseIds = new Set(exceptionLogs.rows.map((r) => r.entity_id));

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
        quoteCount: quoteCountByCase.get(productCase.id) ?? 0,
        hasSupplierSelection: selectedCaseIds.has(productCase.id),
        hasApprovedContent: approvedContentCaseIds.has(productCase.id),
        approvedMainImageCount: mainImageCountByCase.get(productCase.id) ?? 0,
        hasFlatFileExported: flatFileExportedIds.has(productCase.id),
        hasMediaPackExported: mediaPackExportedIds.has(productCase.id),
        hasNoGoException: exceptionCaseIds.has(productCase.id),
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

export async function getCaseDetail(caseId: string, options?: { mode?: AppMode }): Promise<CaseDetail | null> {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const productCase = await getCaseForMode(caseId, { mode });
  if (!productCase) return null;

  const [costs, evidence, selections, audits, workflowFacts] = await Promise.all([
    db.query<CostModelRow>("SELECT * FROM cost_models WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId]),
    db.query<EvidenceRow>("SELECT * FROM case_evidence WHERE case_id = $1 ORDER BY captured_at DESC", [caseId]),
    db.query<{ id: string }>("SELECT id FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]),
    db.query<AuditRow>(
      `SELECT * FROM audit_logs
       WHERE entity_type = 'product_case' AND entity_id = $1 AND is_demo = $2
       ORDER BY created_at DESC LIMIT 12`,
      [caseId, isDemoMode(mode)],
    ),
    getCaseWorkflowFacts(caseId, { mode }),
  ]);

  return {
    productCase,
    costModel: costs.rows[0] ?? null,
    hasSupplierSelection: Boolean(selections.rows[0]),
    quoteCount: workflowFacts.quoteCount,
    validQuoteCount: workflowFacts.validQuoteCount,
    hasApprovedContent: workflowFacts.hasApprovedContent,
    approvedMainImageCount: workflowFacts.approvedMainImageCount,
    hasFlatFileExported: workflowFacts.hasFlatFileExported,
    hasMediaPackExported: workflowFacts.hasMediaPackExported,
    hasNoGoException: workflowFacts.hasNoGoException,
    noGoException: workflowFacts.noGoException,
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
         ON CONFLICT (asin, marketplace, is_demo) DO NOTHING
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
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
         VALUES ($1, $2, 'case.imported', 'product_case', $3, $4::jsonb, $5)`,
        [randomUUID(), actor, caseId, JSON.stringify({ asin: row.asin, marketplace: row.marketplace }), isDemo],
      );
      imported += 1;
    }
  });

  return { imported, skipped, total: rows.length };
}

export async function createCostModelVersion(
  caseId: string,
  assumptions: EconomicsAssumptions,
  actor = "运营人员",
  options?: { mode?: AppMode },
) {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const product = await getCaseForMode(caseId, { mode });
  if (!product) throw new Error("商品机会不存在");

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
      "UPDATE product_cases SET competitor_price_cents = $1, updated_at = NOW() WHERE id = $2 AND is_demo = $3",
      [assumptions.salePriceCents, caseId, isDemoMode(mode)],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
       VALUES ($1, $2, 'cost_model.created', 'product_case', $3, $4::jsonb, $5)`,
      [randomUUID(), actor, caseId, JSON.stringify({ version, assumptions, results }), isDemoMode(mode)],
    );
  });

  return { modelId, version, results };
}

