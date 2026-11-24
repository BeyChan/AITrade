import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { calculateEconomics, type EconomicsAssumptions, type EconomicsResults } from "./economics.ts";

export type CostSheetStatus = "draft" | "confirmed";

export type CostSheetAssumptions = EconomicsAssumptions & {
  productTitle: string;
  marketCode: string;
  platformCode: string;
  purchasePriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
};

export type CostSheet = {
  id: string;
  groupId: string;
  version: number;
  title: string;
  marketCode: string;
  platformCode: string;
  currency: string;
  status: CostSheetStatus;
  assumptions: CostSheetAssumptions;
  results: EconomicsResults;
  hypothesisId: string | null;
  caseId: string | null;
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateCostSheetInput = {
  title: string;
  marketCode: string;
  platformCode: string;
  currency: string;
  assumptions: CostSheetAssumptions;
  actor: string;
};

export type ConfirmCostSheetInput = {
  actor: string;
};

type CostSheetRow = {
  id: string;
  group_id: string;
  version: number;
  title: string;
  market_code: string;
  platform_code: string;
  currency: string;
  status: CostSheetStatus;
  assumptions: CostSheetAssumptions | string;
  results: EconomicsResults | string;
  hypothesis_id: string | null;
  case_id: string | null;
  created_by: string;
  confirmed_by: string | null;
  confirmed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function parseJson<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapCostSheet(row: CostSheetRow): CostSheet {
  return {
    id: row.id,
    groupId: row.group_id,
    version: Number(row.version),
    title: row.title,
    marketCode: row.market_code,
    platformCode: row.platform_code,
    currency: row.currency,
    status: row.status,
    assumptions: parseJson(row.assumptions),
    results: parseJson(row.results),
    hypothesisId: row.hypothesis_id,
    caseId: row.case_id,
    createdBy: row.created_by,
    confirmedBy: row.confirmed_by,
    confirmedAt: toIso(row.confirmed_at),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function actorOrThrow(value: string) {
  const actor = value.trim();
  if (!actor) throw new Error("请填写操作人");
  return actor;
}

function normaliseAssumptions(input: CostSheetAssumptions): CostSheetAssumptions {
  const salePriceCents = Math.max(1, Math.round(input.salePriceCents));
  const purchasePriceCents = Math.max(0, Math.round(input.purchasePriceCents));
  const freightPerUnitCents = Math.max(0, Math.round(input.freightPerUnitCents));
  const dutyRate = Math.min(1, Math.max(0, Number(input.dutyRate) || 0));
  const taxable = purchasePriceCents + freightPerUnitCents;
  const landedCostCents = taxable + Math.round(taxable * dutyRate);
  if (purchasePriceCents <= 0) throw new Error("采购价必须大于 0");
  if (landedCostCents <= 0) throw new Error("到岸成本必须大于 0");
  return {
    ...input,
    productTitle: input.productTitle.trim().slice(0, 180) || "未命名商品",
    marketCode: input.marketCode.trim().toUpperCase() || "US",
    platformCode: input.platformCode.trim().toLowerCase() || "amazon",
    currency: (input.currency || "USD").trim().toUpperCase(),
    salePriceCents,
    purchasePriceCents,
    freightPerUnitCents,
    dutyRate,
    landedCostCents,
    fbaFeeCents: Math.max(0, Math.round(input.fbaFeeCents)),
    referralRate: Math.min(0.5, Math.max(0, Number(input.referralRate) || 0)),
    adRate: Math.min(0.8, Math.max(0, Number(input.adRate) || 0)),
    returnRate: Math.min(0.95, Math.max(0, Number(input.returnRate) || 0)),
    returnProcessingCents: Math.max(0, Math.round(input.returnProcessingCents)),
    returnRecoveryRate: Math.min(1, Math.max(0, Number(input.returnRecoveryRate) || 0)),
    couponCents: Math.max(0, Math.round(input.couponCents)),
    storageCents: Math.max(0, Math.round(input.storageCents)),
    otherCostCents: Math.max(0, Math.round(input.otherCostCents)),
    oneTimeFixedCostCents: Math.max(0, Math.round(input.oneTimeFixedCostCents ?? 0)),
    initialOrderUnits: Math.max(0, Math.round(input.initialOrderUnits ?? 0)),
  };
}

function economicsFromAssumptions(assumptions: CostSheetAssumptions) {
  return calculateEconomics(assumptions);
}

export async function listCostSheets(): Promise<CostSheet[]> {
  const db = await getDb();
  const result = await db.query<CostSheetRow>(
    "SELECT * FROM cost_sheets ORDER BY updated_at DESC, version DESC",
  );
  return result.rows.map(mapCostSheet);
}

/** 只返回每个核算组的最新已确认版本，避免旧版被误绑到候选。 */
export async function listConfirmedCostSheets(): Promise<CostSheet[]> {
  const db = await getDb();
  const result = await db.query<CostSheetRow>(
    `SELECT cs.*
     FROM cost_sheets cs
     WHERE cs.status = 'confirmed'
       AND NOT EXISTS (
         SELECT 1 FROM cost_sheets newer
         WHERE newer.group_id = cs.group_id AND newer.version > cs.version
       )
     ORDER BY cs.updated_at DESC`,
  );
  return result.rows.map(mapCostSheet);
}

export async function getCostSheet(id: string): Promise<CostSheet | null> {
  if (!id) return null;
  const db = await getDb();
  const result = await db.query<CostSheetRow>("SELECT * FROM cost_sheets WHERE id = $1", [id]);
  return result.rows[0] ? mapCostSheet(result.rows[0]) : null;
}

export async function getCostSheetGroup(groupId: string): Promise<CostSheet[]> {
  if (!groupId) return [];
  const db = await getDb();
  const result = await db.query<CostSheetRow>(
    "SELECT * FROM cost_sheets WHERE group_id = $1 ORDER BY version DESC",
    [groupId],
  );
  return result.rows.map(mapCostSheet);
}

export async function createCostSheet(input: CreateCostSheetInput): Promise<CostSheet> {
  const db = await getDb();
  const actor = actorOrThrow(input.actor);
  const assumptions = normaliseAssumptions(input.assumptions);
  const results = economicsFromAssumptions(assumptions);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO cost_sheets
        (id, group_id, version, title, market_code, platform_code, currency, status,
         assumptions, results, created_by)
       VALUES ($1, $1, 1, $2, $3, $4, $5, 'draft', $6::jsonb, $7::jsonb, $8)`,
      [
        id,
        input.title.trim().slice(0, 180) || assumptions.productTitle,
        assumptions.marketCode,
        assumptions.platformCode,
        assumptions.currency,
        JSON.stringify(assumptions),
        JSON.stringify(results),
        actor,
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'cost_sheet.saved', 'cost_sheet', $3, $4::jsonb)`,
      [randomUUID(), actor, id, JSON.stringify({ version: 1, marginRate: results.marginRate })],
    );
  });
  return (await getCostSheet(id))!;
}

export async function updateCostSheetDraft(
  id: string,
  input: CreateCostSheetInput,
): Promise<CostSheet> {
  const db = await getDb();
  const actor = actorOrThrow(input.actor);
  const existing = await getCostSheet(id);
  if (!existing) throw new Error("成本核算单不存在");
  if (existing.status === "confirmed") throw new Error("已确认核算单不可覆盖，请生成新版本");
  const assumptions = normaliseAssumptions(input.assumptions);
  const results = economicsFromAssumptions(assumptions);
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE cost_sheets
       SET title = $2, market_code = $3, platform_code = $4, currency = $5,
           assumptions = $6::jsonb, results = $7::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        input.title.trim().slice(0, 180) || assumptions.productTitle,
        assumptions.marketCode,
        assumptions.platformCode,
        assumptions.currency,
        JSON.stringify(assumptions),
        JSON.stringify(results),
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'cost_sheet.saved', 'cost_sheet', $3, $4::jsonb)`,
      [randomUUID(), actor, id, JSON.stringify({ version: existing.version, marginRate: results.marginRate })] ,
    );
  });
  return (await getCostSheet(id))!;
}

export async function createCostSheetVersion(
  idOrGroupId: string,
  input: CreateCostSheetInput,
): Promise<CostSheet> {
  const db = await getDb();
  const actor = actorOrThrow(input.actor);
  const sourceResult = await db.query<CostSheetRow>(
    `SELECT * FROM cost_sheets
     WHERE id = $1 OR group_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [idOrGroupId],
  );
  const source = sourceResult.rows[0];
  if (!source) throw new Error("原成本核算单不存在");
  const assumptions = normaliseAssumptions(input.assumptions);
  const results = economicsFromAssumptions(assumptions);
  const id = randomUUID();
  await db.transaction(async (tx) => {
    const nextVersion = await tx.query<{ next_version: number }>(
      "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM cost_sheets WHERE group_id = $1",
      [source.group_id],
    );
    const version = Number(nextVersion.rows[0]?.next_version ?? Number(source.version) + 1);
    await tx.query(
      `INSERT INTO cost_sheets
        (id, group_id, version, title, market_code, platform_code, currency, status,
         assumptions, results, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8::jsonb, $9::jsonb, $10)`,
      [
        id,
        source.group_id,
        version,
        input.title.trim().slice(0, 180) || assumptions.productTitle,
        assumptions.marketCode,
        assumptions.platformCode,
        assumptions.currency,
        JSON.stringify(assumptions),
        JSON.stringify(results),
        actor,
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'cost_sheet.version_created', 'cost_sheet', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        id,
        JSON.stringify({ groupId: source.group_id, previousVersion: Number(source.version), version, marginRate: results.marginRate }),
      ],
    );
  });
  return (await getCostSheet(id))!;
}

export async function confirmCostSheet(
  id: string,
  actorInput: string,
  options?: { demoBypass?: boolean },
): Promise<CostSheet> {
  const db = await getDb();
  const actor = actorOrThrow(actorInput);
  const sheet = await getCostSheet(id);
  if (!sheet) throw new Error("成本核算单不存在");
  if (sheet.status === "confirmed") return sheet;
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE cost_sheets
       SET status = 'confirmed', confirmed_by = $2, confirmed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, actor],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'cost_sheet.confirmed', 'cost_sheet', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        id,
        JSON.stringify({
          version: sheet.version,
          marginRate: sheet.results.marginRate,
          netProfitCents: sheet.results.netProfitCents,
          demoBypass: Boolean(options?.demoBypass),
        }),
      ],
    );
  });
  return (await getCostSheet(id))!;
}

export async function attachCostSheetToHypothesis(input: {
  hypothesisId: string;
  costSheetId: string;
  actor: string;
}) {
  const db = await getDb();
  const actor = actorOrThrow(input.actor);
  const sheet = await getCostSheet(input.costSheetId);
  if (!sheet) throw new Error("成本核算单不存在");
  if (sheet.status !== "confirmed") throw new Error("只有已人工确认的核算单可以绑定候选");
  if (!(await isLatestCostSheetVersion(sheet.id))) throw new Error("该核算单已有新版本，不能绑定旧版本");
  if (sheet.hypothesisId && sheet.hypothesisId !== input.hypothesisId) {
    throw new Error("该核算单已绑定其他候选，请先生成新版本或解绑");
  }
  const hypothesis = await db.query<{ id: string; market_code: string; platform_code: string; currency: string }>(
    `SELECT h.id, b.market_code, b.platform_code, b.currency
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     WHERE h.id = $1`,
    [input.hypothesisId],
  );
  const candidate = hypothesis.rows[0];
  if (!candidate) throw new Error("候选方向不存在");
  if (
    sheet.marketCode.toUpperCase() !== candidate.market_code.toUpperCase() ||
    sheet.platformCode.toLowerCase() !== candidate.platform_code.toLowerCase() ||
    sheet.currency.toUpperCase() !== candidate.currency.toUpperCase()
  ) {
    throw new Error("核算单站点、平台或币种与候选不一致，不能绑定");
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE cost_sheets SET hypothesis_id = NULL, updated_at = NOW()
       WHERE hypothesis_id = $1 AND id <> $2`,
      [input.hypothesisId, input.costSheetId],
    );
    await tx.query(
      "UPDATE opportunity_hypotheses SET cost_sheet_id = $2 WHERE id = $1",
      [input.hypothesisId, input.costSheetId],
    );
    await tx.query(
      "UPDATE cost_sheets SET hypothesis_id = $2, updated_at = NOW() WHERE id = $1",
      [input.costSheetId, input.hypothesisId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'cost_sheet.attached', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({ costSheetId: input.costSheetId, version: sheet.version, status: sheet.status }),
      ],
    );
  });
  return sheet;
}

export async function createHypothesisFromCostSheet(input: {
  costSheetId: string;
  actor: string;
  concept?: string;
  category?: string;
}) {
  const sheet = await getCostSheet(input.costSheetId);
  if (!sheet) throw new Error("成本核算单不存在");
  if (sheet.status !== "confirmed") throw new Error("只有已确认的成本核算单才能建立候选");
  if (!(await isLatestCostSheetVersion(sheet.id))) throw new Error("该核算单已有新版本，请使用最新版本建立候选");

  // 延迟加载，避免仓储层之间形成静态循环依赖。
  const { createQuickCandidateBatch } = await import("./ai-sourcing-repo/batches.ts");
  const created = await createQuickCandidateBatch({
    marketCode: sheet.marketCode,
    platformCode: sheet.platformCode,
    category: input.category?.trim() || "成本核算候选",
    concept: input.concept?.trim() || sheet.title,
    sourceKind: "quick_calc",
    searchKeyword: input.concept?.trim() || sheet.title,
    costSheetId: sheet.id,
    actor: input.actor,
  });
  await attachCostSheetToHypothesis({
    hypothesisId: created.hypothesisId,
    costSheetId: sheet.id,
    actor: input.actor,
  });
  const db = await getDb();
  await db.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'cost_sheet.hypothesis_created', 'cost_sheet', $3, $4::jsonb)`,
    [
      randomUUID(),
      input.actor.trim() || "选品负责人",
      sheet.id,
      JSON.stringify({ hypothesisId: created.hypothesisId, runId: created.runId }),
    ],
  );
  return { ...created, costSheetId: sheet.id };
}

export async function isLatestCostSheetVersion(id: string): Promise<boolean> {
  if (!id) return false;
  const db = await getDb();
  const result = await db.query<{ is_latest: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM cost_sheets newer
       JOIN cost_sheets current ON current.group_id = newer.group_id
       WHERE current.id = $1 AND newer.version > current.version
     ) AS is_latest`,
    [id],
  );
  return Boolean(result.rows[0]?.is_latest);
}
