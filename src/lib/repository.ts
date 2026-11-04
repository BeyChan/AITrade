import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { calculateEconomics, opportunityScore, recommendationFor, type EconomicsAssumptions } from "./economics";
import { analyzeSupplierQuotes } from "./sourcing";
import { normalizeListingContent, preflightListing, type ListingDraftContent, type ListingPreflightResult } from "./listing";
import { getChannelProfile, mapChannelPayload, preflightChannelContent, type ChannelContext } from "./channels";
import { evaluateLaunchReadiness } from "./launch-readiness";
import type {
  ApprovalRow,
  AuditRow,
  AssetRow,
  CaseDetail,
  ChannelAccountRow,
  ChannelListingRow,
  ChannelLaunchReviewRow,
  ChannelListingVersionRow,
  ChannelMatrix,
  ChannelMatrixItem,
  ChannelTargetDetail,
  ContentDetail,
  ContentProfileRow,
  CostModelRow,
  Decision,
  EnrichedCase,
  EvidenceRow,
  MarketRow,
  ListingReviewRow,
  ListingRow,
  PlatformRow,
  ProductMarketVariantRow,
  ProductCaseRow,
  ProductRow,
  QuoteRow,
  RfqRow,
  SourcingCaseSummary,
  SourcingDetail,
  SourcingQuote,
  SupplierRow,
  SupplierSelectionRow,
} from "./types";
import type { CandidateImportRow } from "./csv";

export async function listCases(): Promise<EnrichedCase[]> {
  const db = await getDb();
  const cases = await db.query<ProductCaseRow>("SELECT * FROM product_cases ORDER BY created_at DESC");
  const costs = await db.query<CostModelRow>(
    "SELECT DISTINCT ON (case_id) * FROM cost_models ORDER BY case_id, version DESC",
  );
  const pending = await db.query<{ case_id: string; id: string }>(
    "SELECT id, case_id FROM approvals WHERE status = 'pending' ORDER BY created_at DESC",
  );
  const costByCase = new Map(costs.rows.map((cost) => [cost.case_id, cost]));
  const approvalByCase = new Map(pending.rows.map((approval) => [approval.case_id, approval.id]));

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
        pendingApprovalId: approvalByCase.get(productCase.id) ?? null,
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

export async function getDashboardStats() {
  const db = await getDb();
  const result = await db.query<{
    total: string;
    pending: string;
    approved: string;
    rejected: string;
    demo: string;
  }>(`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE status = 'review_pending')::text AS pending,
      COUNT(*) FILTER (WHERE status = 'approved')::text AS approved,
      COUNT(*) FILTER (WHERE status = 'rejected')::text AS rejected,
      COUNT(*) FILTER (WHERE is_demo = TRUE)::text AS demo
    FROM product_cases
  `);
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    approved: Number(row?.approved ?? 0),
    rejected: Number(row?.rejected ?? 0),
    demo: Number(row?.demo ?? 0),
  };
}

export async function getCaseDetail(caseId: string): Promise<CaseDetail | null> {
  const db = await getDb();
  const productCases = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  const productCase = productCases.rows[0];
  if (!productCase) return null;

  const [costs, evidence, approvals, selections, audits] = await Promise.all([
    db.query<CostModelRow>("SELECT * FROM cost_models WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId]),
    db.query<EvidenceRow>("SELECT * FROM case_evidence WHERE case_id = $1 ORDER BY captured_at DESC", [caseId]),
    db.query<ApprovalRow>("SELECT * FROM approvals WHERE case_id = $1 AND gate = 'case_selection' ORDER BY created_at DESC LIMIT 1", [caseId]),
    db.query<{ id: string }>("SELECT id FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]),
    db.query<AuditRow>("SELECT * FROM audit_logs WHERE entity_type = 'product_case' AND entity_id = $1 ORDER BY created_at DESC LIMIT 12", [
      caseId,
    ]),
  ]);

  return {
    productCase,
    costModel: costs.rows[0] ?? null,
    hasSupplierSelection: Boolean(selections.rows[0]),
    evidence: evidence.rows,
    approval: approvals.rows[0] ?? null,
    auditLogs: audits.rows,
  };
}

export async function importCandidates(rows: CandidateImportRow[], actor = "运营人员") {
  const db = await getDb();
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
         VALUES ($1, $2, $3, $4, $5, $6, 'review_pending', $7, $8, $9, $10, $11, $12, 0, FALSE)
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
        `INSERT INTO approvals (id, case_id, gate, status)
         VALUES ($1, $2, 'case_selection', 'pending')`,
        [randomUUID(), caseId],
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

export async function decideCase(caseId: string, decision: Decision, reviewer: string, notes: string) {
  if (!reviewer.trim()) throw new Error("请输入审批人");
  const db = await getDb();
  const product = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  if (!product.rows[0]) throw new Error("商品机会不存在");
  if (!["review_pending", "approved", "rejected"].includes(product.rows[0].status)) {
    throw new Error("当前状态不能审批");
  }

  await db.transaction(async (tx) => {
    await tx.query("UPDATE product_cases SET status = $1, updated_at = NOW() WHERE id = $2", [decision, caseId]);
    const latest = await tx.query<ApprovalRow>(
      "SELECT * FROM approvals WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1",
      [caseId],
    );
    if (latest.rows[0]) {
      await tx.query(
        `UPDATE approvals
         SET status = $1, decision = $1, reviewer = $2, notes = $3, decided_at = NOW()
         WHERE id = $4`,
        [decision, reviewer.trim(), notes.trim(), latest.rows[0].id],
      );
    } else {
      await tx.query(
        `INSERT INTO approvals
          (id, case_id, gate, status, decision, reviewer, notes, decided_at)
         VALUES ($1, $2, 'case_selection', $3, $3, $4, $5, NOW())`,
        [randomUUID(), caseId, decision, reviewer.trim(), notes.trim()],
      );
    }
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
      [
        randomUUID(),
        reviewer.trim(),
        decision === "approved" ? "case.approved" : "case.rejected",
        caseId,
        JSON.stringify({ notes: notes.trim(), previousStatus: product.rows[0].status }),
      ],
    );
  });
}

export type SupplierQuoteInput = {
  supplierName: string;
  supplierPlatform: string;
  supplierUrl: string;
  contact: string;
  country: string;
  supplierNotes: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
  qualityScore: number;
  moq: number;
  leadTimeDays: number;
  paymentTerms: string;
  incoterm: string;
  certifications: string;
  sampleFeeCents: number;
};

type SourcingQuoteJoinRow = QuoteRow & {
  rfq_case_id: string;
  rfq_status: string;
  rfq_requirements: Record<string, unknown>;
  rfq_sent_at: string | null;
  rfq_selected_at: string | null;
  rfq_created_at: string;
  supplier_id: string;
  supplier_name: string;
  supplier_platform: string;
  supplier_url: string | null;
  supplier_contact: string | null;
  supplier_country: string | null;
  supplier_rating: string | number | null;
  supplier_notes: string;
  supplier_created_at: string;
};

const sourcingQuoteSelect = `
  SELECT
    q.id,
    q.rfq_id,
    q.unit_price_cents,
    q.freight_per_unit_cents,
    q.duty_rate,
    q.quality_score,
    q.moq,
    q.lead_time_days,
    q.payment_terms,
    q.incoterm,
    q.certifications,
    q.sample_fee_cents,
    q.raw_payload,
    q.selected_at,
    q.created_at,
    r.case_id AS rfq_case_id,
    r.status AS rfq_status,
    r.requirements AS rfq_requirements,
    r.sent_at AS rfq_sent_at,
    r.selected_at AS rfq_selected_at,
    r.created_at AS rfq_created_at,
    s.id AS supplier_id,
    s.name AS supplier_name,
    s.platform AS supplier_platform,
    s.url AS supplier_url,
    s.contact AS supplier_contact,
    s.country AS supplier_country,
    s.rating AS supplier_rating,
    s.notes AS supplier_notes,
    s.created_at AS supplier_created_at
  FROM quotes q
  JOIN rfqs r ON r.id = q.rfq_id
  JOIN suppliers s ON s.id = r.supplier_id
`;

function mapSourcingQuote(row: SourcingQuoteJoinRow): SourcingQuote {
  const supplier: SupplierRow = {
    id: row.supplier_id,
    name: row.supplier_name,
    platform: row.supplier_platform,
    url: row.supplier_url,
    contact: row.supplier_contact,
    country: row.supplier_country,
    rating: row.supplier_rating,
    notes: row.supplier_notes,
    created_at: row.supplier_created_at,
  };
  const rfq: RfqRow = {
    id: row.rfq_id,
    case_id: row.rfq_case_id,
    supplier_id: row.supplier_id,
    status: row.rfq_status,
    requirements: row.rfq_requirements ?? {},
    sent_at: row.rfq_sent_at,
    selected_at: row.rfq_selected_at,
    created_at: row.rfq_created_at,
  };
  return {
    id: row.id,
    rfq_id: row.rfq_id,
    unit_price_cents: Number(row.unit_price_cents),
    freight_per_unit_cents: Number(row.freight_per_unit_cents),
    duty_rate: Number(row.duty_rate),
    quality_score: Number(row.quality_score),
    moq: Number(row.moq),
    lead_time_days: row.lead_time_days === null ? null : Number(row.lead_time_days),
    payment_terms: row.payment_terms,
    incoterm: row.incoterm,
    certifications: row.certifications,
    sample_fee_cents: row.sample_fee_cents === null ? null : Number(row.sample_fee_cents),
    raw_payload: row.raw_payload ?? {},
    selected_at: row.selected_at,
    created_at: row.created_at,
    rfq,
    supplier,
  };
}

function buildSourcingSummary(
  productCase: ProductCaseRow,
  costModel: CostModelRow | null,
  quotes: SourcingQuote[],
  selection: SupplierSelectionRow | null,
): SourcingCaseSummary {
  const scoredQuotes = costModel
    ? analyzeSupplierQuotes(
        quotes.map((quote) => ({
          id: quote.id,
          unitPriceCents: quote.unit_price_cents,
          freightPerUnitCents: quote.freight_per_unit_cents,
          dutyRate: Number(quote.duty_rate),
          moq: quote.moq,
          leadTimeDays: quote.lead_time_days,
          qualityScore: quote.quality_score,
          sampleFeeCents: quote.sample_fee_cents ?? 0,
          certifications: quote.certifications ?? "",
        })),
        costModel.assumptions,
      )
    : [];
  const preferred = scoredQuotes.find((quote) => quote.isPreferred);
  const preferredQuote = quotes.find((quote) => quote.id === preferred?.id);
  const selectedQuote = quotes.find((quote) => quote.id === selection?.quote_id);

  return {
    productCase,
    costModel,
    quotes,
    scoredQuotes,
    selection,
    quoteCount: quotes.length,
    eligibleCount: scoredQuotes.filter((quote) => quote.isEligible).length,
    preferredSupplierName: preferredQuote?.supplier.name ?? null,
    selectedSupplierName: selectedQuote?.supplier.name ?? null,
  };
}

export async function listSourcingCases(): Promise<SourcingCaseSummary[]> {
  const db = await getDb();
  const [cases, costs, quoteRows, selections] = await Promise.all([
    db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE status = 'approved' ORDER BY updated_at DESC"),
    db.query<CostModelRow>("SELECT DISTINCT ON (case_id) * FROM cost_models ORDER BY case_id, version DESC"),
    db.query<SourcingQuoteJoinRow>(`${sourcingQuoteSelect} ORDER BY q.created_at DESC`),
    db.query<SupplierSelectionRow>("SELECT * FROM supplier_selections"),
  ]);
  const costByCase = new Map(costs.rows.map((cost) => [cost.case_id, cost]));
  const quotesByCase = new Map<string, SourcingQuote[]>();
  for (const row of quoteRows.rows) {
    const quote = mapSourcingQuote(row);
    const group = quotesByCase.get(quote.rfq.case_id) ?? [];
    group.push(quote);
    quotesByCase.set(quote.rfq.case_id, group);
  }
  const selectionByCase = new Map(selections.rows.map((selection) => [selection.case_id, selection]));

  return cases.rows.map((productCase) =>
    buildSourcingSummary(
      productCase,
      costByCase.get(productCase.id) ?? null,
      quotesByCase.get(productCase.id) ?? [],
      selectionByCase.get(productCase.id) ?? null,
    ),
  );
}

export async function getSourcingDetail(caseId: string): Promise<SourcingDetail | null> {
  const db = await getDb();
  const product = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  const productCase = product.rows[0];
  if (!productCase) return null;

  const [costs, quoteRows, selections, audits] = await Promise.all([
    db.query<CostModelRow>("SELECT * FROM cost_models WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId]),
    db.query<SourcingQuoteJoinRow>(`${sourcingQuoteSelect} WHERE r.case_id = $1 ORDER BY q.created_at DESC`, [caseId]),
    db.query<SupplierSelectionRow>("SELECT * FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]),
    db.query<AuditRow>("SELECT * FROM audit_logs WHERE entity_type = 'product_case' AND entity_id = $1 ORDER BY created_at DESC LIMIT 30", [
      caseId,
    ]),
  ]);
  const summary = buildSourcingSummary(
    productCase,
    costs.rows[0] ?? null,
    quoteRows.rows.map(mapSourcingQuote),
    selections.rows[0] ?? null,
  );

  return { ...summary, auditLogs: audits.rows };
}

export async function createSupplierAndQuote(caseId: string, input: SupplierQuoteInput, actor = "采购人员") {
  if (!input.supplierName.trim()) throw new Error("请输入供应商名称");
  if (input.unitPriceCents <= 0) throw new Error("采购单价必须大于 0");
  if (input.moq < 1) throw new Error("MOQ 必须大于 0");
  if (input.leadTimeDays < 1) throw new Error("交期必须大于 0");
  if (input.qualityScore < 0 || input.qualityScore > 100) throw new Error("质量评分必须在 0–100 之间");
  if (input.dutyRate < 0 || input.dutyRate > 1) throw new Error("关税率必须在 0–100% 之间");

  const db = await getDb();
  const product = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  if (!product.rows[0]) throw new Error("商品机会不存在");
  if (product.rows[0].status !== "approved") throw new Error("只有已立项商品可以录入供应商报价");
  const selection = await db.query<{ id: string }>("SELECT id FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]);
  if (selection.rows[0]) throw new Error("该商品已经完成供应商定标，不能继续新增报价");

  const supplierId = randomUUID();
  const rfqId = randomUUID();
  const quoteId = randomUUID();
  const requirements = {
    source: "manual_quote_entry",
    incoterm: input.incoterm.trim() || null,
    paymentTerms: input.paymentTerms.trim() || null,
    requestedCertifications: input.certifications.trim() || null,
    note: "报价由人工录入；系统未自动联系供应商或下单。",
  };

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO suppliers (id, name, platform, url, contact, country, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        supplierId,
        input.supplierName.trim(),
        input.supplierPlatform.trim() || "manual",
        input.supplierUrl.trim() || null,
        input.contact.trim() || null,
        input.country.trim() || null,
        input.supplierNotes.trim(),
      ],
    );
    await tx.query(
      `INSERT INTO rfqs (id, case_id, supplier_id, status, requirements, sent_at)
       VALUES ($1, $2, $3, 'quoted', $4::jsonb, NOW())`,
      [rfqId, caseId, supplierId, JSON.stringify(requirements)],
    );
    await tx.query(
      `INSERT INTO quotes
        (id, rfq_id, unit_price_cents, freight_per_unit_cents, duty_rate, quality_score,
         moq, lead_time_days, payment_terms, incoterm, certifications, sample_fee_cents, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [
        quoteId,
        rfqId,
        Math.round(input.unitPriceCents),
        Math.max(0, Math.round(input.freightPerUnitCents)),
        input.dutyRate,
        Math.round(input.qualityScore),
        Math.round(input.moq),
        Math.round(input.leadTimeDays),
        input.paymentTerms.trim() || null,
        input.incoterm.trim() || null,
        input.certifications.trim() || null,
        Math.max(0, Math.round(input.sampleFeeCents)),
        JSON.stringify({ entryMode: "manual", enteredBy: actor, demo: product.rows[0]?.is_demo ?? false }),
      ],
    );
    const auditRows = [
      ["supplier.created", { supplierId, supplierName: input.supplierName.trim(), platform: input.supplierPlatform.trim() }],
      ["rfq.created", { rfqId, supplierId, status: "quoted" }],
      ["quote.created", { quoteId, rfqId, unitPriceCents: input.unitPriceCents, freightPerUnitCents: input.freightPerUnitCents, dutyRate: input.dutyRate }],
    ] as const;
    for (const [action, details] of auditRows) {
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
        [randomUUID(), actor.trim() || "采购人员", action, caseId, JSON.stringify(details)],
      );
    }
  });

  return { supplierId, rfqId, quoteId };
}

export async function selectSupplierQuote(
  caseId: string,
  quoteId: string,
  reviewer: string,
  exceptionReason: string,
) {
  if (!quoteId) throw new Error("请选择报价");
  if (!reviewer.trim()) throw new Error("请输入定标人");

  const db = await getDb();
  const [product, costs, quoteRows, existingSelections] = await Promise.all([
    db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]),
    db.query<CostModelRow>("SELECT * FROM cost_models WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId]),
    db.query<SourcingQuoteJoinRow>(`${sourcingQuoteSelect} WHERE r.case_id = $1 ORDER BY q.created_at DESC`, [caseId]),
    db.query<SupplierSelectionRow>("SELECT * FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]),
  ]);
  if (!product.rows[0]) throw new Error("商品机会不存在");
  if (product.rows[0].status !== "approved") throw new Error("只有已立项商品可以完成供应商定标");
  if (!costs.rows[0]) throw new Error("缺少成本模型，不能回写报价");
  if (existingSelections.rows[0]) throw new Error("该商品已经完成供应商定标");

  const quotes = quoteRows.rows.map(mapSourcingQuote);
  const scoredQuotes = analyzeSupplierQuotes(
    quotes.map((quote) => ({
      id: quote.id,
      unitPriceCents: quote.unit_price_cents,
      freightPerUnitCents: quote.freight_per_unit_cents,
      dutyRate: Number(quote.duty_rate),
      moq: quote.moq,
      leadTimeDays: quote.lead_time_days,
      qualityScore: quote.quality_score,
      sampleFeeCents: quote.sample_fee_cents ?? 0,
      certifications: quote.certifications ?? "",
    })),
    costs.rows[0].assumptions,
  );
  const target = scoredQuotes.find((quote) => quote.id === quoteId);
  if (!target) throw new Error("报价不属于当前商品");
  if (!target.isEligible) throw new Error("该报价未通过压力盈利或质量门槛，不能定标");
  const eligibleCount = scoredQuotes.filter((quote) => quote.isEligible).length;
  if (eligibleCount < 3 && !exceptionReason.trim()) {
    throw new Error(`当前只有 ${eligibleCount} 家有效报价，少于 3 家时必须填写例外原因`);
  }

  const targetQuote = quotes.find((quote) => quote.id === quoteId);
  if (!targetQuote) throw new Error("报价不存在");
  const currentCost = costs.rows[0];
  const nextAssumptions: EconomicsAssumptions = {
    ...currentCost.assumptions,
    landedCostCents: target.landedCostCents,
  };
  const nextResults = calculateEconomics(nextAssumptions);
  const modelId = randomUUID();
  let nextVersion = 0;

  await db.transaction(async (tx) => {
    const guard = await tx.query<{ id: string }>("SELECT id FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]);
    if (guard.rows[0]) throw new Error("该商品已经完成供应商定标");
    const versionResult = await tx.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM cost_models WHERE case_id = $1",
      [caseId],
    );
    nextVersion = Number(versionResult.rows[0]?.version ?? 1);
    await tx.query(
      `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
      [modelId, caseId, nextVersion, JSON.stringify(nextAssumptions), JSON.stringify(nextResults), reviewer.trim()],
    );
    await tx.query(
      "UPDATE product_cases SET updated_at = NOW() WHERE id = $1",
      [caseId],
    );
    await tx.query(
      "UPDATE rfqs SET status = CASE WHEN id = $1 THEN 'selected' ELSE 'not_selected' END, selected_at = CASE WHEN id = $1 THEN NOW() ELSE selected_at END WHERE case_id = $2",
      [targetQuote.rfq_id, caseId],
    );
    await tx.query(
      "UPDATE quotes SET selected_at = CASE WHEN id = $1 THEN NOW() ELSE selected_at END WHERE rfq_id IN (SELECT id FROM rfqs WHERE case_id = $2)",
      [quoteId, caseId],
    );
    await tx.query(
      `INSERT INTO supplier_selections
        (id, case_id, supplier_id, quote_id, cost_model_id, selected_by, exception_reason, score_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(),
        caseId,
        targetQuote.supplier.id,
        quoteId,
        modelId,
        reviewer.trim(),
        exceptionReason.trim(),
        JSON.stringify({
          score: target.score,
          scoreBreakdown: target.scoreBreakdown,
          risks: target.risks,
          landedCostCents: target.landedCostCents,
          eligibleQuoteCount: eligibleCount,
        }),
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'supplier.selected', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        reviewer.trim(),
        caseId,
        JSON.stringify({
          quoteId,
          supplierId: targetQuote.supplier.id,
          supplierName: targetQuote.supplier.name,
          score: target.score,
          landedCostCents: target.landedCostCents,
          previousLandedCostCents: currentCost.assumptions.landedCostCents,
          costModelVersion: nextVersion,
          eligibleQuoteCount: eligibleCount,
          exceptionReason: exceptionReason.trim(),
          humanDecision: true,
          externalActions: "none",
        }),
      ],
    );
  });

  return { modelId, version: nextVersion, results: nextResults };
}

export type ProductDefinitionInput = {
  productName: string;
  targetCustomer: string;
  coreDifferentiator: string;
  specifications: string;
  packageContents: string;
  claimsToAvoid: string;
};

export type AssetUploadInput = {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export type MainImageReviewChecks = {
  whiteBackground: boolean;
  productComplete: boolean;
  noTextWatermark: boolean;
  resolutionConfirmed: boolean;
};

async function assertContentUnlocked(caseId: string) {
  const db = await getDb();
  const [product, selection] = await Promise.all([
    db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]),
    db.query<SupplierSelectionRow>("SELECT * FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]),
  ]);
  if (!product.rows[0]) throw new Error("商品机会不存在");
  if (product.rows[0].status !== "approved") throw new Error("只有已立项商品可以进入内容制作");
  if (!selection.rows[0]) throw new Error("请先完成供应商人工定标，再制作商品内容");
  return { product: product.rows[0], selection: selection.rows[0] };
}

type SqlExecutor = {
  query<T>(query: string, params?: any[]): Promise<{ rows: T[] }>;
};

type ChannelTargetBaseRow = ChannelListingRow & {
  product: ProductRow;
  variant: ProductMarketVariantRow;
  account: ChannelAccountRow;
  market: MarketRow;
  platform: PlatformRow;
};

type ChannelFoundation = {
  product: ProductRow;
  variant: ProductMarketVariantRow;
  account: ChannelAccountRow;
  channelListing: ChannelListingRow;
  market: MarketRow;
  platform: PlatformRow;
};

function channelContext(market: MarketRow): ChannelContext {
  return { marketCode: market.code, locale: market.locale, currency: market.currency };
}

async function ensureChannelFoundation(
  tx: SqlExecutor,
  productCase: ProductCaseRow,
  platformCode: string,
  marketCode: string,
): Promise<ChannelFoundation> {
  const [platformResult, marketResult] = await Promise.all([
    tx.query<PlatformRow>("SELECT * FROM platforms WHERE code = $1 AND status <> 'disabled' LIMIT 1", [platformCode]),
    tx.query<MarketRow>("SELECT * FROM markets WHERE code = $1 AND status = 'active' LIMIT 1", [marketCode]),
  ]);
  const platform = platformResult.rows[0];
  const market = marketResult.rows[0];
  if (!platform) throw new Error("目标平台不存在或已停用");
  if (!market) throw new Error("目标市场不存在或已停用");

  let productResult = await tx.query<ProductRow>("SELECT * FROM products WHERE case_id = $1 LIMIT 1", [productCase.id]);
  let product = productResult.rows[0];
  if (!product) {
    const sku = `SKU-${productCase.id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    await tx.query(
      `INSERT INTO products (id, case_id, sku, category, brand, status)
       VALUES ($1, $2, $3, $4, NULL, 'active')
       ON CONFLICT (case_id) DO NOTHING`,
      [`product-${productCase.id}`, productCase.id, sku, productCase.category],
    );
    productResult = await tx.query<ProductRow>("SELECT * FROM products WHERE case_id = $1 LIMIT 1", [productCase.id]);
    product = productResult.rows[0];
  }
  if (!product) throw new Error("无法创建商品主记录");

  let variantResult = await tx.query<ProductMarketVariantRow>(
    `SELECT * FROM product_market_variants
     WHERE product_id = $1 AND country_code = $2 AND locale = $3
     LIMIT 1`,
    [product.id, market.code, market.locale],
  );
  let variant = variantResult.rows[0];
  if (!variant) {
    variantResult = await tx.query<ProductMarketVariantRow>(
      `INSERT INTO product_market_variants
        (id, product_id, country_code, locale, currency, title, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (product_id, country_code, locale) DO NOTHING
       RETURNING *`,
      [
        `pmv-${productCase.id}-${market.code.toLowerCase()}`,
        product.id,
        market.code,
        market.locale,
        market.currency,
        productCase.title,
      ],
    );
    variant = variantResult.rows[0] ??
      (await tx.query<ProductMarketVariantRow>(
        `SELECT * FROM product_market_variants
         WHERE product_id = $1 AND country_code = $2 AND locale = $3
         LIMIT 1`,
        [product.id, market.code, market.locale],
      )).rows[0];
  }
  if (!variant) throw new Error("无法创建市场版本");

  const accountName = `${platform.name} ${market.name} · ${productCase.asin} 测试店铺`;
  let accountResult = await tx.query<ChannelAccountRow>(
    `SELECT * FROM channel_accounts
     WHERE platform_code = $1 AND market_code = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    [platform.code, market.code],
  );
  let account = accountResult.rows[0];
  if (!account) {
    accountResult = await tx.query<ChannelAccountRow>(
      `INSERT INTO channel_accounts
        (id, platform_code, market_code, name, currency, locale, status, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, 'unconfigured', TRUE)
       ON CONFLICT (platform_code, market_code, name) DO NOTHING
       RETURNING *`,
      [
        `account-${productCase.id}-${platform.code}-${market.code.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        platform.code,
        market.code,
        accountName,
        market.currency,
        market.locale,
      ],
    );
    account = accountResult.rows[0] ??
      (await tx.query<ChannelAccountRow>(
        `SELECT * FROM channel_accounts
         WHERE platform_code = $1 AND market_code = $2 AND name = $3
         LIMIT 1`,
        [platform.code, market.code, accountName],
      )).rows[0];
  }
  if (!account) throw new Error("无法创建渠道店铺");

  let listingResult = await tx.query<ChannelListingRow>(
    `SELECT * FROM channel_listings
     WHERE product_market_variant_id = $1 AND channel_account_id = $2
     LIMIT 1`,
    [variant.id, account.id],
  );
  let channelListing = listingResult.rows[0];
  if (!channelListing) {
    listingResult = await tx.query<ChannelListingRow>(
      `INSERT INTO channel_listings
        (id, product_market_variant_id, channel_account_id, status, adapter_version, metadata)
       VALUES ($1, $2, $3, 'draft', 'p1.1', $4::jsonb)
       ON CONFLICT (product_market_variant_id, channel_account_id) DO NOTHING
       RETURNING *`,
      [
        `channel-${productCase.id}-${platform.code}-${market.code.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        variant.id,
        account.id,
        JSON.stringify({ createdFrom: "content-workflow", externalActions: "none" }),
      ],
    );
    channelListing = listingResult.rows[0] ??
      (await tx.query<ChannelListingRow>(
        `SELECT * FROM channel_listings
         WHERE product_market_variant_id = $1 AND channel_account_id = $2
         LIMIT 1`,
        [variant.id, account.id],
      )).rows[0];
  }
  if (!channelListing) throw new Error("无法创建渠道 Listing");

  return { product, variant, account, channelListing, market, platform };
}

async function listChannelTargets(
  executor: SqlExecutor,
  caseId: string,
  channelListingId?: string,
): Promise<ChannelTargetBaseRow[]> {
  const result = await executor.query<ChannelTargetBaseRow>(
    `SELECT
       cl.*,
       row_to_json(p) AS product,
       row_to_json(pmv) AS variant,
       row_to_json(ca) AS account,
       row_to_json(m) AS market,
       row_to_json(pl) AS platform
     FROM channel_listings cl
     JOIN product_market_variants pmv ON pmv.id = cl.product_market_variant_id
     JOIN products p ON p.id = pmv.product_id
     JOIN channel_accounts ca ON ca.id = cl.channel_account_id
     JOIN markets m ON m.code = pmv.country_code
     JOIN platforms pl ON pl.code = ca.platform_code
     WHERE p.case_id = $1
       AND ($2::text IS NULL OR cl.id = $2)
     ORDER BY m.code ASC, pl.name ASC, cl.created_at ASC`,
    [caseId, channelListingId ?? null],
  );
  return result.rows;
}

async function listChannelVersions(
  executor: SqlExecutor,
  caseId: string,
  channelListingId?: string,
): Promise<ChannelListingVersionRow[]> {
  const result = await executor.query<ChannelListingVersionRow>(
    `SELECT clv.*
     FROM channel_listing_versions clv
     JOIN channel_listings cl ON cl.id = clv.channel_listing_id
     JOIN product_market_variants pmv ON pmv.id = cl.product_market_variant_id
     JOIN products p ON p.id = pmv.product_id
     WHERE p.case_id = $1
       AND ($2::text IS NULL OR clv.channel_listing_id = $2)
     ORDER BY clv.channel_listing_id ASC, clv.version DESC`,
    [caseId, channelListingId ?? null],
  );
  return result.rows;
}

function hydrateChannelTargets(
  rows: ChannelTargetBaseRow[],
  versions: ChannelListingVersionRow[],
): ChannelMatrixItem[] {
  const versionsByListing = new Map<string, ChannelListingVersionRow[]>();
  for (const version of versions) {
    const current = versionsByListing.get(version.channel_listing_id) ?? [];
    current.push(version);
    versionsByListing.set(version.channel_listing_id, current);
  }
  return rows.map((row) => {
    const targetVersions = versionsByListing.get(row.id) ?? [];
    return {
      product: row.product,
      variant: row.variant,
      account: row.account,
      market: row.market,
      platform: row.platform,
      channelListing: {
        id: row.id,
        product_market_variant_id: row.product_market_variant_id,
        channel_account_id: row.channel_account_id,
        external_id: row.external_id,
        status: row.status,
        adapter_version: row.adapter_version,
        metadata: row.metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      latestVersion: targetVersions[0] ?? null,
      versionCount: targetVersions.length,
    };
  });
}

export async function getChannelMatrix(caseId: string): Promise<ChannelMatrix | null> {
  const db = await getDb();
  const caseResult = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  const productCase = caseResult.rows[0];
  if (!productCase) return null;

  const [productResult, targets, versions, markets, platforms, audits] = await Promise.all([
    db.query<ProductRow>("SELECT * FROM products WHERE case_id = $1 LIMIT 1", [caseId]),
    listChannelTargets(db, caseId),
    listChannelVersions(db, caseId),
    db.query<MarketRow>("SELECT * FROM markets WHERE status = 'active' ORDER BY region, name"),
    db.query<PlatformRow>("SELECT * FROM platforms WHERE status <> 'disabled' ORDER BY name"),
    db.query<AuditRow>(
      "SELECT * FROM audit_logs WHERE entity_type = 'product_case' AND entity_id = $1 ORDER BY created_at DESC LIMIT 80",
      [caseId],
    ),
  ]);

  return {
    productCase,
    product: productResult.rows[0] ?? null,
    targets: hydrateChannelTargets(targets, versions),
    markets: markets.rows,
    platforms: platforms.rows,
    auditLogs: audits.rows,
  };
}

export async function getChannelTargetDetail(
  caseId: string,
  channelListingId: string,
): Promise<ChannelTargetDetail | null> {
  const db = await getDb();
  const [caseResult, targets, versions, audits, launchReviews, approvedImages] = await Promise.all([
    db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]),
    listChannelTargets(db, caseId, channelListingId),
    listChannelVersions(db, caseId, channelListingId),
    db.query<AuditRow>(
      "SELECT * FROM audit_logs WHERE entity_type = 'product_case' AND entity_id = $1 ORDER BY created_at DESC LIMIT 100",
      [caseId],
    ),
    db.query<ChannelLaunchReviewRow>(
      "SELECT * FROM channel_launch_reviews WHERE channel_listing_id = $1 ORDER BY created_at DESC",
      [channelListingId],
    ),
    db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM assets WHERE case_id = $1 AND asset_type = 'main_image' AND status = 'approved'",
      [caseId],
    ),
  ]);
  const productCase = caseResult.rows[0];
  if (!productCase || !targets[0]) return null;
  const item = hydrateChannelTargets(targets, versions)[0];
  if (!item) return null;
  const profile = getChannelProfile(item.platform.code);
  const approvedLaunchReview = launchReviews.rows.find((review) => review.decision === "approved") ?? null;
  const launchReadiness = evaluateLaunchReadiness({
    latestVersion: item.latestVersion
      ? {
          id: item.latestVersion.id,
          version: item.latestVersion.version,
          status: item.latestVersion.status,
          preflightPassed: Boolean((item.latestVersion.preflight_result as Partial<ListingPreflightResult>).passed),
        }
      : null,
    approvedMainImageCount: Number(approvedImages.rows[0]?.count ?? 0),
    account: { status: item.account.status, isDemo: item.account.is_demo },
    writeAdapterAvailable: profile.publishingSupported,
    dryRunSupported: profile.dryRunSupported,
    approvedLaunchReview: approvedLaunchReview
      ? { channelVersionId: approvedLaunchReview.channel_version_id, decision: approvedLaunchReview.decision }
      : null,
  });
  return {
    ...item,
    versions,
    auditLogs: audits.rows.filter((entry) => entry.details.channelListingId === channelListingId),
    launchReviews: launchReviews.rows,
    launchReadiness,
  };
}

function channelTargetFoundation(row: ChannelTargetBaseRow): ChannelFoundation {
  return {
    product: row.product,
    variant: row.variant,
    account: row.account,
    market: row.market,
    platform: row.platform,
    channelListing: {
      id: row.id,
      product_market_variant_id: row.product_market_variant_id,
      channel_account_id: row.channel_account_id,
      external_id: row.external_id,
      status: row.status,
      adapter_version: row.adapter_version,
      metadata: row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  };
}

async function getChannelTargetFoundation(
  executor: SqlExecutor,
  caseId: string,
  channelListingId: string,
): Promise<{ productCase: ProductCaseRow; target: ChannelFoundation }> {
  const [productResult, targets] = await Promise.all([
    executor.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]),
    listChannelTargets(executor, caseId, channelListingId),
  ]);
  const productCase = productResult.rows[0];
  if (!productCase) throw new Error("商品机会不存在");
  if (!targets[0]) throw new Error("渠道目标不存在或不属于当前商品");
  return { productCase, target: channelTargetFoundation(targets[0]) };
}

async function saveChannelVersionWithExecutor(
  tx: SqlExecutor,
  productCase: ProductCaseRow,
  target: ChannelFoundation,
  input: Partial<ListingDraftContent>,
  actor: string,
) {
  const content = normalizeListingContent(input);
  const context = channelContext(target.market);
  const mappedPayload = mapChannelPayload(target.platform.code, content, context);
  const preflight = preflightChannelContent(target.platform.code, content, context);
  const versionResult = await tx.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM channel_listing_versions WHERE channel_listing_id = $1",
    [target.channelListing.id],
  );
  const version = Number(versionResult.rows[0]?.version ?? 1);
  const versionId = randomUUID();
  const mirrorLegacy = target.platform.code === "amazon" && target.market.code === productCase.marketplace;

  await tx.query(
    `INSERT INTO channel_listing_versions
      (id, channel_listing_id, version, canonical_snapshot, mapped_payload, preflight_result, status)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, 'draft')`,
    [
      versionId,
      target.channelListing.id,
      version,
      JSON.stringify(content),
      JSON.stringify(mappedPayload),
      JSON.stringify(preflight),
    ],
  );
  await tx.query(
    `UPDATE channel_listings
     SET status = 'draft', updated_at = NOW(), metadata = metadata || $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify({
        lastPreflightPassed: preflight.passed,
        lastPreflightScore: preflight.score,
        lastSavedVersion: version,
        lastSavedBy: actor,
        externalActions: "none",
      }),
      target.channelListing.id,
    ],
  );

  let legacyListingId: string | null = null;
  if (mirrorLegacy) {
    legacyListingId = randomUUID();
    await tx.query(
      `INSERT INTO listings
        (id, case_id, marketplace, status, content, version, created_by,
         channel_listing_id, platform_code, country_code, locale, currency)
       VALUES ($1, $2, $3, 'draft', $4::jsonb, $5, $6, $7, $8, $9, $10, $11)`,
      [
        legacyListingId,
        productCase.id,
        target.market.code,
        JSON.stringify(content),
        version,
        actor,
        target.channelListing.id,
        target.platform.code,
        target.market.code,
        target.market.locale,
        target.market.currency,
      ],
    );
    await tx.query(
      `INSERT INTO listing_reviews (id, listing_id, review_type, status, findings, reviewer)
       VALUES ($1, $2, 'automated_preflight', $3, $4::jsonb, 'system')`,
      [
        randomUUID(),
        legacyListingId,
        preflight.passed ? "passed" : "failed",
        JSON.stringify({ preflight, content, channelListingId: target.channelListing.id }),
      ],
    );
  }

  await tx.query("UPDATE product_cases SET updated_at = NOW() WHERE id = $1", [productCase.id]);
  await tx.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
    [
      randomUUID(),
      actor,
      mirrorLegacy ? "listing.draft_saved" : "channel.listing_version_saved",
      productCase.id,
      JSON.stringify({
        channelListingId: target.channelListing.id,
        channelVersionId: versionId,
        legacyListingId,
        platformCode: target.platform.code,
        marketCode: target.market.code,
        locale: target.market.locale,
        currency: target.market.currency,
        version,
        preflightPassed: preflight.passed,
        preflightScore: preflight.score,
        errorCount: preflight.errorCount,
        warningCount: preflight.warningCount,
        externalActions: "none",
      }),
    ],
  );

  return { channelListingId: target.channelListing.id, channelVersionId: versionId, listingId: legacyListingId, version, preflight };
}

export async function createChannelTarget(
  caseId: string,
  platformCode: string,
  marketCode: string,
  actor: string,
) {
  if (!actor.trim()) throw new Error("请输入创建人");
  const { product } = await assertContentUnlocked(caseId);
  const db = await getDb();

  return db.transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>(
      `SELECT cl.id
       FROM channel_listings cl
       JOIN product_market_variants pmv ON pmv.id = cl.product_market_variant_id
       JOIN products p ON p.id = pmv.product_id
       JOIN channel_accounts ca ON ca.id = cl.channel_account_id
       WHERE p.case_id = $1 AND pmv.country_code = $2 AND ca.platform_code = $3
       LIMIT 1`,
      [caseId, marketCode, platformCode],
    );
    if (existing.rows[0]) {
      return { channelListingId: existing.rows[0].id, created: false };
    }

    const target = await ensureChannelFoundation(tx, product, platformCode, marketCode);
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'channel.target_created', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor.trim(),
        caseId,
        JSON.stringify({
          channelListingId: target.channelListing.id,
          platformCode: target.platform.code,
          platformName: target.platform.name,
          marketCode: target.market.code,
          marketName: target.market.name,
          locale: target.market.locale,
          currency: target.market.currency,
          accountStatus: target.account.status,
          externalActions: "none",
        }),
      ],
    );
    return { channelListingId: target.channelListing.id, created: true };
  });
}

export async function saveChannelListingVersion(
  caseId: string,
  channelListingId: string,
  input: Partial<ListingDraftContent>,
  actor: string,
) {
  if (!actor.trim()) throw new Error("请输入内容编辑人");
  await assertContentUnlocked(caseId);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { productCase, target } = await getChannelTargetFoundation(tx, caseId, channelListingId);
    return saveChannelVersionWithExecutor(tx, productCase, target, input, actor.trim());
  });
}

export async function runChannelPreflight(
  caseId: string,
  channelListingId: string,
  input: Partial<ListingDraftContent>,
) {
  const db = await getDb();
  const { target } = await getChannelTargetFoundation(db, caseId, channelListingId);
  const content = normalizeListingContent(input);
  const context = channelContext(target.market);
  return {
    content,
    mappedPayload: mapChannelPayload(target.platform.code, content, context),
    preflight: preflightChannelContent(target.platform.code, content, context),
  };
}

async function approveChannelVersionWithExecutor(
  tx: SqlExecutor,
  productCase: ProductCaseRow,
  target: ChannelFoundation,
  reviewer: string,
  notes: string,
) {
  const latestResult = await tx.query<ChannelListingVersionRow>(
    `SELECT * FROM channel_listing_versions
     WHERE channel_listing_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [target.channelListing.id],
  );
  const latest = latestResult.rows[0];
  if (!latest) throw new Error("请先保存该渠道的 Listing 草稿");
  if (latest.status === "content_approved") throw new Error("当前渠道 Listing 版本已经通过内容审核");
  const preflight = latest.preflight_result as Partial<ListingPreflightResult>;
  if (!preflight.passed) throw new Error("渠道预检未通过，不能进行人工内容批准");

  const approvedAsset = await tx.query<{ id: string }>(
    `SELECT id FROM assets
     WHERE case_id = $1 AND asset_type = 'main_image' AND status = 'approved'
     ORDER BY created_at DESC LIMIT 1`,
    [productCase.id],
  );
  if (!approvedAsset.rows[0]) throw new Error("请先上传并通过人工主图审核");

  const approvedAt = new Date().toISOString();
  await tx.query(
    `UPDATE channel_listing_versions
     SET status = 'content_approved', approved_by = $1, approved_at = $2
     WHERE id = $3`,
    [reviewer, approvedAt, latest.id],
  );
  await tx.query(
    `UPDATE channel_listings
     SET status = 'content_approved', updated_at = NOW(), metadata = metadata || $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify({ approvedBy: reviewer, approvedAt, externalActions: "none" }),
      target.channelListing.id,
    ],
  );

  const mirrorLegacy = target.platform.code === "amazon" && target.market.code === productCase.marketplace;
  let legacyListingId: string | null = null;
  if (mirrorLegacy) {
    const legacy = await tx.query<{ id: string }>(
      `SELECT id FROM listings
       WHERE channel_listing_id = $1 AND version = $2
       LIMIT 1`,
      [target.channelListing.id, latest.version],
    );
    legacyListingId = legacy.rows[0]?.id ?? null;
    if (legacyListingId) {
      await tx.query(
        "UPDATE listings SET status = 'content_approved', updated_at = NOW() WHERE id = $1",
        [legacyListingId],
      );
      await tx.query(
        `INSERT INTO listing_reviews
          (id, listing_id, review_type, status, findings, reviewer, reviewed_at)
         VALUES ($1, $2, 'human_content_review', 'approved', $3::jsonb, $4, $5)`,
        [
          randomUUID(),
          legacyListingId,
          JSON.stringify({
            preflight,
            notes,
            approvedAssetId: approvedAsset.rows[0].id,
            channelListingId: target.channelListing.id,
            boundary: "content approval only; no marketplace publish or external action",
          }),
          reviewer,
          approvedAt,
        ],
      );
    }
  }

  await tx.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
    [
      randomUUID(),
      reviewer,
      mirrorLegacy ? "listing.content_approved" : "channel.content_approved",
      productCase.id,
      JSON.stringify({
        channelListingId: target.channelListing.id,
        channelVersionId: latest.id,
        legacyListingId,
        platformCode: target.platform.code,
        marketCode: target.market.code,
        version: latest.version,
        preflightScore: preflight.score,
        warningCount: preflight.warningCount,
        approvedAssetId: approvedAsset.rows[0].id,
        notes,
        humanDecision: true,
        externalActions: "none",
      }),
    ],
  );

  return { channelListingId: target.channelListing.id, channelVersionId: latest.id, version: latest.version, preflight };
}

export async function approveChannelListing(
  caseId: string,
  channelListingId: string,
  reviewer: string,
  notes: string,
) {
  if (!reviewer.trim()) throw new Error("请输入内容审核人");
  if (!notes.trim()) throw new Error("请填写内容审核说明，记录声明核验依据");
  await assertContentUnlocked(caseId);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { productCase, target } = await getChannelTargetFoundation(tx, caseId, channelListingId);
    return approveChannelVersionWithExecutor(tx, productCase, target, reviewer.trim(), notes.trim());
  });
}

async function readChannelLaunchReadiness(
  executor: SqlExecutor,
  productCase: ProductCaseRow,
  target: ChannelFoundation,
) {
  const [latestResult, approvedImageResult, launchReviewResult] = await Promise.all([
    executor.query<ChannelListingVersionRow>(
      `SELECT * FROM channel_listing_versions
       WHERE channel_listing_id = $1
       ORDER BY version DESC
       LIMIT 1`,
      [target.channelListing.id],
    ),
    executor.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM assets
       WHERE case_id = $1 AND asset_type = 'main_image' AND status = 'approved'`,
      [productCase.id],
    ),
    executor.query<ChannelLaunchReviewRow>(
      `SELECT * FROM channel_launch_reviews
       WHERE channel_listing_id = $1 AND decision = 'approved'
       ORDER BY created_at DESC
       LIMIT 1`,
      [target.channelListing.id],
    ),
  ]);
  const latest = latestResult.rows[0] ?? null;
  const profile = getChannelProfile(target.platform.code);
  const approvedReview = launchReviewResult.rows[0] ?? null;
  const readiness = evaluateLaunchReadiness({
    latestVersion: latest
      ? {
          id: latest.id,
          version: latest.version,
          status: latest.status,
          preflightPassed: Boolean((latest.preflight_result as Partial<ListingPreflightResult>).passed),
        }
      : null,
    approvedMainImageCount: Number(approvedImageResult.rows[0]?.count ?? 0),
    account: { status: target.account.status, isDemo: target.account.is_demo },
    writeAdapterAvailable: profile.publishingSupported,
    dryRunSupported: profile.dryRunSupported,
    approvedLaunchReview: approvedReview
      ? { channelVersionId: approvedReview.channel_version_id, decision: approvedReview.decision }
      : null,
  });
  return { latest, approvedReview, readiness };
}

export async function recordChannelLaunchReadinessCheck(
  caseId: string,
  channelListingId: string,
  actor: string,
) {
  if (!actor.trim()) throw new Error("请输入检查人");
  await assertContentUnlocked(caseId);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { productCase, target } = await getChannelTargetFoundation(tx, caseId, channelListingId);
    const { latest, readiness } = await readChannelLaunchReadiness(tx, productCase, target);
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'channel.launch_readiness_checked', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor.trim(),
        productCase.id,
        JSON.stringify({
          channelListingId: target.channelListing.id,
          channelVersionId: latest?.id ?? null,
          version: latest?.version ?? null,
          platformCode: target.platform.code,
          marketCode: target.market.code,
          readinessStatus: readiness.status,
          blockerCount: readiness.blockers.length,
          blockers: readiness.blockers,
          externalActions: "none",
          externalWriteAttempted: false,
          published: false,
        }),
      ],
    );
    return { channelListingId: target.channelListing.id, readiness };
  });
}

export async function approveChannelLaunchQueue(
  caseId: string,
  channelListingId: string,
  reviewer: string,
  notes: string,
) {
  if (!reviewer.trim()) throw new Error("请输入发布队列审批人");
  if (!notes.trim()) throw new Error("请填写发布队列审批说明");
  await assertContentUnlocked(caseId);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { productCase, target } = await getChannelTargetFoundation(tx, caseId, channelListingId);
    const { latest, readiness } = await readChannelLaunchReadiness(tx, productCase, target);
    if (!latest) throw new Error("没有可审批的渠道 Listing 版本");
    if (readiness.status !== "approval_pending") {
      throw new Error(`当前发布准备状态为 ${readiness.status}，只有 approval_pending 才能记录发布队列审批`);
    }
    if (readiness.blockers.length > 0) throw new Error("发布准备仍有阻断项，不能记录发布队列审批");

    const reviewId = randomUUID();
    await tx.query(
      `INSERT INTO channel_launch_reviews
        (id, channel_listing_id, channel_version_id, readiness_status, readiness_snapshot,
         blocker_count, reviewer, decision, notes, external_actions, published)
       VALUES ($1, $2, $3, 'approval_pending', $4::jsonb, 0, $5, 'approved', $6, 'none', FALSE)`,
      [
        reviewId,
        target.channelListing.id,
        latest.id,
        JSON.stringify(readiness),
        reviewer.trim(),
        notes.trim(),
      ],
    );
    await tx.query(
      `UPDATE channel_listings
       SET status = 'approved_for_publish', updated_at = NOW(), metadata = metadata || $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          launchQueueStatus: "approved",
          launchQueueApprovedBy: reviewer.trim(),
          launchQueueApprovedAt: new Date().toISOString(),
          externalActions: "none",
          published: false,
        }),
        target.channelListing.id,
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'channel.launch_queue_approved', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        reviewer.trim(),
        productCase.id,
        JSON.stringify({
          channelListingId: target.channelListing.id,
          channelVersionId: latest.id,
          launchReviewId: reviewId,
          platformCode: target.platform.code,
          marketCode: target.market.code,
          version: latest.version,
          readinessStatus: readiness.status,
          notes: notes.trim(),
          externalActions: "none",
          externalWriteAttempted: false,
          published: false,
        }),
      ],
    );
    return {
      channelListingId: target.channelListing.id,
      channelVersionId: latest.id,
      launchReviewId: reviewId,
      status: "approved_for_publish" as const,
      published: false as const,
    };
  });
}

export async function getContentDetail(caseId: string): Promise<ContentDetail | null> {
  const db = await getDb();
  const product = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  const productCase = product.rows[0];
  if (!productCase) return null;

  const [costs, selections, profiles, assets, listings, audits] = await Promise.all([
    db.query<CostModelRow>("SELECT * FROM cost_models WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId]),
    db.query<SupplierSelectionRow & { supplier_name: string }>(
      `SELECT ss.*, s.name AS supplier_name
       FROM supplier_selections ss
       JOIN suppliers s ON s.id = ss.supplier_id
       WHERE ss.case_id = $1
       LIMIT 1`,
      [caseId],
    ),
    db.query<ContentProfileRow>("SELECT * FROM case_content_profiles WHERE case_id = $1 LIMIT 1", [caseId]),
    db.query<AssetRow>("SELECT * FROM assets WHERE case_id = $1 ORDER BY created_at DESC", [caseId]),
    db.query<ListingRow>(
      `SELECT l.*
       FROM listings l
       JOIN channel_listings cl ON cl.id = l.channel_listing_id
       JOIN channel_accounts ca ON ca.id = cl.channel_account_id
       JOIN product_market_variants pmv ON pmv.id = cl.product_market_variant_id
       WHERE l.case_id = $1
         AND ca.platform_code = 'amazon'
         AND pmv.country_code = $2
       ORDER BY l.version DESC
       LIMIT 1`,
      [caseId, productCase.marketplace || "US"],
    ),
    db.query<AuditRow>(
      "SELECT * FROM audit_logs WHERE entity_type = 'product_case' AND entity_id = $1 ORDER BY created_at DESC LIMIT 40",
      [caseId],
    ),
  ]);
  const listing = listings.rows[0] ?? null;
  const reviews = listing
    ? await db.query<ListingReviewRow>("SELECT * FROM listing_reviews WHERE listing_id = $1 ORDER BY created_at DESC", [listing.id])
    : { rows: [] as ListingReviewRow[] };

  return {
    productCase,
    costModel: costs.rows[0] ?? null,
    selection: selections.rows[0] ?? null,
    selectedSupplierName: selections.rows[0]?.supplier_name ?? null,
    profile: profiles.rows[0] ?? null,
    assets: assets.rows,
    listing,
    listingReviews: reviews.rows,
    auditLogs: audits.rows,
  };
}

export async function upsertProductDefinition(caseId: string, input: ProductDefinitionInput, actor: string) {
  if (!actor.trim()) throw new Error("请输入编辑人");
  const definition = {
    productName: input.productName.trim(),
    targetCustomer: input.targetCustomer.trim(),
    coreDifferentiator: input.coreDifferentiator.trim(),
    specifications: input.specifications.trim(),
    packageContents: input.packageContents.trim(),
    claimsToAvoid: input.claimsToAvoid.trim(),
  };
  if (!definition.productName) throw new Error("请输入商品名称");
  if (!definition.targetCustomer) throw new Error("请输入目标用户");
  if (!definition.coreDifferentiator) throw new Error("请输入核心差异点");
  if (!definition.specifications) throw new Error("请输入规格与材质");
  if (!definition.packageContents) throw new Error("请输入包装清单");

  await assertContentUnlocked(caseId);
  const db = await getDb();
  const existing = await db.query<{ id: string }>("SELECT id FROM case_content_profiles WHERE case_id = $1 LIMIT 1", [caseId]);
  const id = existing.rows[0]?.id ?? randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO case_content_profiles
        (id, case_id, product_name, target_customer, core_differentiator, specifications,
         package_contents, claims_to_avoid, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (case_id) DO UPDATE SET
         product_name = EXCLUDED.product_name,
         target_customer = EXCLUDED.target_customer,
         core_differentiator = EXCLUDED.core_differentiator,
         specifications = EXCLUDED.specifications,
         package_contents = EXCLUDED.package_contents,
         claims_to_avoid = EXCLUDED.claims_to_avoid,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        id,
        caseId,
        definition.productName,
        definition.targetCustomer,
        definition.coreDifferentiator,
        definition.specifications,
        definition.packageContents,
        definition.claimsToAvoid,
        actor.trim(),
      ],
    );
    await tx.query(
      "UPDATE product_cases SET updated_at = NOW() WHERE id = $1",
      [caseId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'content_profile.updated', 'product_case', $3, $4::jsonb)`,
      [randomUUID(), actor.trim(), caseId, JSON.stringify({ definition, humanDecision: false })],
    );
  });
  return { id };
}

export async function createAssetRecord(caseId: string, input: AssetUploadInput, actor: string) {
  if (!actor.trim()) throw new Error("请输入上传人");
  await assertContentUnlocked(caseId);
  const db = await getDb();
  const assetId = randomUUID();
  const metadata = {
    role: "main_image",
    storageKey: input.storageKey,
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    uploadedBy: actor.trim(),
    reviewed: false,
  };
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO assets (id, case_id, asset_type, file_url, status, metadata)
       VALUES ($1, $2, 'main_image', $3, 'draft', $4::jsonb)`,
      [assetId, caseId, `/api/assets/${assetId}`, JSON.stringify(metadata)],
    );
    await tx.query(
      "UPDATE product_cases SET updated_at = NOW() WHERE id = $1",
      [caseId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'asset.main_image_uploaded', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor.trim(),
        caseId,
        JSON.stringify({ assetId, originalName: input.originalName, mimeType: input.mimeType, size: input.size }),
      ],
    );
  });
  return { assetId };
}

export async function getAssetRecord(assetId: string): Promise<AssetRow | null> {
  const db = await getDb();
  const result = await db.query<AssetRow>("SELECT * FROM assets WHERE id = $1", [assetId]);
  return result.rows[0] ?? null;
}

export async function reviewMainImageAsset(
  caseId: string,
  assetId: string,
  reviewer: string,
  notes: string,
  checks: MainImageReviewChecks,
) {
  if (!reviewer.trim()) throw new Error("请输入图片审核人");
  if (!notes.trim()) throw new Error("请填写主图审核说明");
  if (!Object.values(checks).every(Boolean)) throw new Error("请逐项确认主图检查项");
  await assertContentUnlocked(caseId);

  const db = await getDb();
  const asset = await db.query<AssetRow>("SELECT * FROM assets WHERE id = $1 AND case_id = $2", [assetId, caseId]);
  if (!asset.rows[0]) throw new Error("主图不存在");
  if (asset.rows[0].asset_type !== "main_image") throw new Error("该资源不是主图");

  const review = { reviewer: reviewer.trim(), notes: notes.trim(), checks, reviewedAt: new Date().toISOString() };
  const metadata = { ...asset.rows[0].metadata, reviewed: true, review };
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE assets SET status = 'approved', metadata = $1::jsonb WHERE id = $2 AND case_id = $3",
      [JSON.stringify(metadata), assetId, caseId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'asset.main_image_reviewed', 'product_case', $3, $4::jsonb)`,
      [randomUUID(), reviewer.trim(), caseId, JSON.stringify({ assetId, review })],
    );
  });
  return { assetId };
}

export async function createListingDraft(caseId: string, input: Partial<ListingDraftContent>, actor: string) {
  if (!actor.trim()) throw new Error("请输入内容编辑人");
  const { product } = await assertContentUnlocked(caseId);
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const target = await ensureChannelFoundation(tx, product, "amazon", product.marketplace || "US");
    return saveChannelVersionWithExecutor(tx, product, target, input, actor.trim());
  });

  return {
    listingId: result.listingId,
    channelListingId: result.channelListingId,
    channelVersionId: result.channelVersionId,
    version: result.version,
    preflight: result.preflight,
  };
}

export async function approveListingContent(caseId: string, reviewer: string, notes: string) {
  if (!reviewer.trim()) throw new Error("请输入内容审核人");
  if (!notes.trim()) throw new Error("请填写内容审核说明，记录声明核验依据");
  const { product } = await assertContentUnlocked(caseId);
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const target = await ensureChannelFoundation(tx, product, "amazon", product.marketplace || "US");
    return approveChannelVersionWithExecutor(tx, product, target, reviewer.trim(), notes.trim());
  });

  return {
    listingId: result.channelVersionId,
    channelListingId: result.channelListingId,
    channelVersionId: result.channelVersionId,
    version: result.version,
    preflight: result.preflight,
  };
}
