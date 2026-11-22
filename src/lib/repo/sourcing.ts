import { randomUUID } from "node:crypto";
import type { AppMode } from "../app-mode.ts";
import { getDb } from "../db.ts";
import { calculateEconomics, opportunityScore, recommendationFor, type EconomicsAssumptions } from "../economics.ts";
import { analyzeSupplierQuotes } from "../sourcing.ts";
import { getCaseDetail, listCases, resolveCurrentMode } from "./cases.ts";
import type {
  AuditRow,
  CostModelRow,
  ProductCaseRow,
  ProductRow,
  QuoteRow,
  RfqRow,
  SourcingCaseSummary,
  SourcingDetail,
  SourcingQuote,
  SupplierDirectoryItem,
  SupplierRow,
  SupplierSelectionRow,
} from "../types.ts";

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

export async function listSourcingCases(options?: { mode?: AppMode }): Promise<SourcingCaseSummary[]> {
  const db = await getDb();
  const mode = await resolveCurrentMode(options?.mode);
  const casesQuery = mode === "live"
    ? "SELECT * FROM product_cases WHERE status = 'approved' AND is_demo = FALSE ORDER BY updated_at DESC"
    : "SELECT * FROM product_cases WHERE status = 'approved' ORDER BY updated_at DESC";

  const [cases, costs, quoteRows, selections] = await Promise.all([
    db.query<ProductCaseRow>(casesQuery),
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
    quoteObservedAt: new Date().toISOString(),
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
       VALUES ($1, $2, $3, 'quote_received', $4::jsonb, NULL)`,
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
      ["rfq.created", { rfqId, supplierId, status: "quote_received", sentAt: null, externalActions: "none" }],
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


export async function listSupplierDirectory(): Promise<{
  suppliers: SupplierDirectoryItem[];
  stats: {
    totalSuppliers: number;
    platform1688Count: number;
    totalQuotesCount: number;
    selectedCount: number;
  };
}> {
  const db = await getDb();
  await db.exec(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;`);

  // 1. 如果供应商库为空，自动初始化 4 家 1688 核心产业带示范工厂
  const countRes = await db.query<{ count: string }>("SELECT COUNT(*) FROM suppliers");
  if (parseInt(countRes.rows[0]?.count ?? "0", 10) === 0) {
    const seeds = [
      {
        id: "sup-1688-001",
        name: "宁波倍洁日用品制造有限公司",
        platform: "1688",
        url: "https://detail.1688.com/offer/712398451001.html",
        contact: "陈经理 · 138-5740-8891 (微信同号)",
        country: "CN",
        rating: 4.9,
        notes: "1688实力商家 / 12年源头老厂。主营跨境热销免手洗平板拖把、自滤水拖桶与微纤维替换布，支持亚马逊定制彩盒与条码代贴，验厂通过 BSCI / ISO9001。",
      },
      {
        id: "sup-1688-002",
        name: "深圳市华诺智能电器实业有限公司",
        platform: "1688",
        url: "https://detail.1688.com/offer/684210954321.html",
        contact: "张总工 · 139-2651-7782",
        country: "CN",
        rating: 4.8,
        notes: "1688超级工厂 / 专注智能宠物循环饮水机、静音无刷水泵与四重活性炭滤芯研发。支持美规/欧规/澳规适配器认证，全套出口 CE / FCC / RoHS 资质齐全。",
      },
      {
        id: "sup-1688-003",
        name: "义乌市爱宠塑胶五金源头厂",
        platform: "1688",
        url: "https://detail.1688.com/offer/742189012345.html",
        contact: "王主管 · 186-5792-3340",
        country: "CN",
        rating: 4.7,
        notes: "1688 8年诚信通 / 专注宠物梳理用具、一键退毛清洁刷、指甲剪。日产能 1.5 万件，开模周期快，擅长配合做独立吸塑包装与 FBA 专线发货。",
      },
      {
        id: "sup-1688-004",
        name: "东莞市宏盛塑胶模具有限公司",
        platform: "1688",
        url: "https://detail.1688.com/offer/699012348765.html",
        contact: "林经理 · 135-0921-6650",
        country: "CN",
        rating: 4.9,
        notes: "1688实力商家 / 专注大号防带砂全封闭猫砂盆、活性炭除臭隔舱与环保食品级 PP 塑胶制品。拥有 12 台大型注塑机，交期准、支持小单快反 MOQ 300 件起订。",
      },
    ];

    for (const seed of seeds) {
      await db.query(
        `INSERT INTO suppliers (id, name, platform, url, contact, country, rating, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [seed.id, seed.name, seed.platform, seed.url, seed.contact, seed.country, seed.rating, seed.notes]
      );
    }
  }

  // 2. 查出全部供应商与关联统计
  const [suppliersRes, quotesRes, selectionsRes] = await Promise.all([
    db.query<SupplierRow>("SELECT * FROM suppliers ORDER BY created_at DESC"),
    db.query<{
      supplier_id: string;
      case_id: string;
      case_title: string;
      marketplace: string;
      case_status: string;
    }>(`
      SELECT
        s.id AS supplier_id,
        pc.id AS case_id,
        pc.title AS case_title,
        pc.marketplace,
        pc.status AS case_status
      FROM quotes q
      JOIN rfqs r ON r.id = q.rfq_id
      JOIN suppliers s ON s.id = r.supplier_id
      JOIN product_cases pc ON pc.id = r.case_id
    `),
    db.query<{ supplier_id: string }>("SELECT supplier_id FROM supplier_selections"),
  ]);

  const quotesBySupplier = new Map<string, Array<{ id: string; title: string; marketplace: string; status: string }>>();
  for (const row of quotesRes.rows) {
    const list = quotesBySupplier.get(row.supplier_id) ?? [];
    if (!list.some((item) => item.id === row.case_id)) {
      list.push({
        id: row.case_id,
        title: row.case_title,
        marketplace: row.marketplace,
        status: row.case_status,
      });
    }
    quotesBySupplier.set(row.supplier_id, list);
  }

  const selectionCounts = new Map<string, number>();
  for (const row of selectionsRes.rows) {
    selectionCounts.set(row.supplier_id, (selectionCounts.get(row.supplier_id) ?? 0) + 1);
  }

  const directory: SupplierDirectoryItem[] = suppliersRes.rows.map((supplier) => {
    const cases = quotesBySupplier.get(supplier.id) ?? [];
    return {
      ...supplier,
      quoteCount: cases.length,
      selectionCount: selectionCounts.get(supplier.id) ?? 0,
      cases,
    };
  });

  const totalSuppliers = directory.length;
  const platform1688Count = directory.filter((s) => (s.platform || "").toLowerCase().includes("1688")).length;
  const totalQuotesCount = quotesRes.rows.length;
  const selectedCount = Array.from(selectionCounts.values()).reduce((sum, count) => sum + count, 0);

  return {
    suppliers: directory,
    stats: {
      totalSuppliers,
      platform1688Count,
      totalQuotesCount,
      selectedCount,
    },
  };
}

export async function createSupplierDirectoryEntry(input: {
  name: string;
  platform?: string;
  url?: string;
  contact?: string;
  country?: string;
  rating?: number;
  notes?: string;
}) {
  if (!input.name.trim()) throw new Error("供应商名称必填");
  const db = await getDb();
  const id = `sup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await db.query(
    `INSERT INTO suppliers (id, name, platform, url, contact, country, rating, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.name.trim(),
      input.platform?.trim() || "1688",
      input.url?.trim() || null,
      input.contact?.trim() || null,
      input.country?.trim() || "CN",
      input.rating ?? 4.8,
      input.notes?.trim() || "",
    ]
  );
  return { id };
}

