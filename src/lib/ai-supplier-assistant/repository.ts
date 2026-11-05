import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { generateSupplierDraft } from "./draft.ts";
import {
  SUPPLIER_DRAFT_PROMPT_VERSION,
  SUPPLIER_DRAFT_SCHEMA_VERSION,
  type SupplierDraftFactSnapshot,
  type SupplierDraftGenerationMode,
  type SupplierDraftQuestion,
  type SupplierDraftStatus,
  type SupplierDraftType,
} from "./schema.ts";

export type SupplierDraft = {
  id: string;
  hypothesisId: string;
  supplierShortlistId: string | null;
  draftType: SupplierDraftType;
  status: SupplierDraftStatus;
  subject: string;
  body: string;
  missingFields: SupplierDraftQuestion[];
  questions: SupplierDraftQuestion[];
  factsSnapshot: SupplierDraftFactSnapshot;
  generationMode: SupplierDraftGenerationMode;
  generationNote: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  createdBy: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type DraftRow = {
  id: string;
  hypothesis_id: string;
  supplier_shortlist_id: string | null;
  draft_type: SupplierDraftType;
  status: SupplierDraftStatus;
  subject: string;
  body: string;
  missing_fields: SupplierDraftQuestion[];
  questions: SupplierDraftQuestion[];
  facts_snapshot: SupplierDraftFactSnapshot;
  generation_mode: SupplierDraftGenerationMode;
  generation_note: string;
  provider: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  created_by: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

type HypothesisContextRow = {
  id: string;
  concept: string;
  target_user: string;
  pain_point: string;
  differentiator: string;
  main_risks: string[];
  selected_for_validation: boolean;
  category: string;
  market_code: string;
  platform_code: string;
  currency: string;
};

type SupplierRow = {
  id: string;
  supplier_name: string;
  platform: string;
  supplier_url: string;
  country: string | null;
  product_match: string;
};

type QuoteRow = {
  id: string;
  currency: string;
  unit_price_cents: number;
  freight_per_unit_cents: number;
  landed_cost_cents: number;
  moq: number;
  lead_time_days: number;
  sample_fee_cents: number;
  certifications: string;
  payment_terms: string;
  incoterm: string;
  observed_at: string;
};

export async function createSupplierDraft(input: {
  hypothesisId: string;
  draftType: SupplierDraftType;
  supplierShortlistId?: string | null;
  quoteValidUntil?: string | null;
  actor: string;
}) {
  const db = await getDb();
  const context = await loadContext(input.hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  if (!context.selected_for_validation) throw new Error("请先把机会加入验证");

  const supplierShortlistId = input.supplierShortlistId?.trim() || null;
  if (["followup", "expiry_reminder"].includes(input.draftType) && !supplierShortlistId) {
    throw new Error("生成追问或到期提醒前，请选择已录入的供应商");
  }

  const supplier = supplierShortlistId
    ? await loadSupplier(input.hypothesisId, supplierShortlistId)
    : null;
  if (supplierShortlistId && !supplier) throw new Error("供应商不在当前机会下");
  const quote = supplier ? await loadLatestQuote(input.hypothesisId, supplier.id) : null;
  if (input.draftType === "expiry_reminder" && !quote) {
    throw new Error("生成报价到期提醒前，请先录入该供应商的真实报价");
  }
  const quoteValidUntil = input.draftType === "expiry_reminder"
    ? validateQuoteValidUntil(input.quoteValidUntil)
    : null;

  const facts: SupplierDraftFactSnapshot = {
    hypothesis: {
      id: context.id,
      concept: context.concept,
      category: context.category,
      targetUser: context.target_user,
      painPoint: context.pain_point,
      differentiator: context.differentiator,
      mainRisks: Array.isArray(context.main_risks) ? context.main_risks : [],
      marketCode: context.market_code,
      platformCode: context.platform_code,
      currency: context.currency,
    },
    supplier: supplier
      ? {
          id: supplier.id,
          name: supplier.supplier_name,
          platform: supplier.platform,
          url: supplier.supplier_url,
          country: supplier.country,
          productMatch: supplier.product_match,
        }
      : null,
    quote: quote
      ? {
          id: quote.id,
          currency: quote.currency,
          unitPriceCents: Number(quote.unit_price_cents),
          freightPerUnitCents: Number(quote.freight_per_unit_cents),
          landedCostCents: Number(quote.landed_cost_cents),
          moq: Number(quote.moq),
          leadTimeDays: Number(quote.lead_time_days),
          sampleFeeCents: Number(quote.sample_fee_cents),
          certifications: quote.certifications,
          paymentTerms: quote.payment_terms,
          incoterm: quote.incoterm,
          observedAt: quote.observed_at,
        }
      : null,
    quoteValidUntil,
  };
  const idempotencyKey = draftIdempotencyKey(input.draftType, facts);
  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) return { draft: existing, reused: true };

  const generated = await generateSupplierDraft({ draftType: input.draftType, facts });
  const actor = input.actor.trim().slice(0, 80) || "采购人员";
  const id = randomUUID();
  let inserted: DraftRow | null = null;

  await db.transaction(async (tx) => {
    const result = await tx.query<DraftRow>(
      `INSERT INTO ai_supplier_drafts
        (id, hypothesis_id, supplier_shortlist_id, draft_type, subject, body,
         missing_fields, questions, facts_snapshot, generation_mode, generation_note,
         provider, model, prompt_version, schema_version, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11,
               $12, $13, $14, $15, $16, $17)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        id,
        input.hypothesisId,
        supplier?.id ?? null,
        input.draftType,
        generated.content.subject,
        generated.content.body,
        JSON.stringify(generated.content.missingFields),
        JSON.stringify(generated.content.questions),
        JSON.stringify(facts),
        generated.mode,
        generated.note,
        generated.provider,
        generated.model,
        SUPPLIER_DRAFT_PROMPT_VERSION,
        SUPPLIER_DRAFT_SCHEMA_VERSION,
        idempotencyKey,
        actor,
      ],
    );
    inserted = result.rows[0] ?? null;
    if (!inserted) return;

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_supplier.draft_generated', 'ai_supplier_draft', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        inserted.id,
        JSON.stringify({
          hypothesisId: input.hypothesisId,
          supplierShortlistId: supplier?.id ?? null,
          draftType: input.draftType,
          generationMode: generated.mode,
          provider: generated.provider,
          model: generated.model,
          missingFieldCount: generated.content.missingFields.length,
          externalActions: "none",
          sent: false,
        }),
      ],
    );
  });

  if (!inserted) {
    const concurrent = await findByIdempotencyKey(idempotencyKey);
    if (!concurrent) throw new Error("供应商草稿保存失败");
    return { draft: concurrent, reused: true };
  }
  return { draft: mapDraft(inserted), reused: false };
}

export async function reviewSupplierDraft(input: { draftId: string; actor: string }) {
  const db = await getDb();
  const actor = input.actor.trim().slice(0, 80) || "采购人员";
  let reviewed: DraftRow | null = null;
  let changed = false;

  await db.transaction(async (tx) => {
    const result = await tx.query<DraftRow>(
      `UPDATE ai_supplier_drafts
       SET status = 'reviewed', reviewed_at = NOW(), reviewed_by = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [input.draftId, actor],
    );
    reviewed = result.rows[0] ?? null;
    if (!reviewed) return;
    changed = true;
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_supplier.draft_reviewed', 'ai_supplier_draft', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.draftId,
        JSON.stringify({ status: "reviewed", externalActions: "none", sent: false }),
      ],
    );
  });

  if (reviewed) return { draft: mapDraft(reviewed), changed };
  const existing = await db.query<DraftRow>("SELECT * FROM ai_supplier_drafts WHERE id = $1", [input.draftId]);
  const row = existing.rows[0];
  if (!row) throw new Error("供应商草稿不存在");
  if (row.status !== "reviewed") throw new Error("草稿状态已变化，请刷新后重试");
  return { draft: mapDraft(row), changed: false };
}

export async function listSupplierDraftsByRun(runId: string) {
  const db = await getDb();
  const result = await db.query<DraftRow>(
    `SELECT d.* FROM ai_supplier_drafts d
     JOIN opportunity_hypotheses h ON h.id = d.hypothesis_id
     WHERE h.run_id = $1
     ORDER BY d.created_at DESC`,
    [runId],
  );
  return result.rows.map(mapDraft);
}

async function loadContext(hypothesisId: string) {
  const db = await getDb();
  const result = await db.query<HypothesisContextRow>(
    `SELECT h.id, h.concept, h.target_user, h.pain_point, h.differentiator,
            h.main_risks, h.selected_for_validation,
            b.category, b.market_code, b.platform_code, b.currency
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     WHERE h.id = $1`,
    [hypothesisId],
  );
  return result.rows[0] ?? null;
}

async function loadSupplier(hypothesisId: string, supplierId: string) {
  const db = await getDb();
  const result = await db.query<SupplierRow>(
    `SELECT id, supplier_name, platform, supplier_url, country, product_match
     FROM supplier_shortlists
     WHERE id = $1 AND hypothesis_id = $2`,
    [supplierId, hypothesisId],
  );
  return result.rows[0] ?? null;
}

async function loadLatestQuote(hypothesisId: string, supplierId: string) {
  const db = await getDb();
  const result = await db.query<QuoteRow>(
    `SELECT id, currency, unit_price_cents, freight_per_unit_cents, landed_cost_cents,
            moq, lead_time_days, sample_fee_cents, certifications, payment_terms,
            incoterm, observed_at
     FROM sourcing_supplier_quotes
     WHERE hypothesis_id = $1 AND supplier_shortlist_id = $2
     ORDER BY observed_at DESC, created_at DESC
     LIMIT 1`,
    [hypothesisId, supplierId],
  );
  return result.rows[0] ?? null;
}

async function findByIdempotencyKey(key: string) {
  const db = await getDb();
  const result = await db.query<DraftRow>(
    "SELECT * FROM ai_supplier_drafts WHERE idempotency_key = $1",
    [key],
  );
  return result.rows[0] ? mapDraft(result.rows[0]) : null;
}

function draftIdempotencyKey(draftType: SupplierDraftType, facts: SupplierDraftFactSnapshot) {
  return createHash("sha256")
    .update(stableStringify({ draftType, facts }))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateQuoteValidUntil(value: string | null | undefined) {
  const normalized = value?.trim() || "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) {
    throw new Error("生成到期提醒时，请填写报价失效或提醒日期");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error("提醒日期无效，请填写真实存在的日期");
  }
  const today = new Date();
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() < todayStart) {
    throw new Error("提醒日期必须是今天或未来日期");
  }
  return normalized;
}

function mapDraft(row: DraftRow): SupplierDraft {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    supplierShortlistId: row.supplier_shortlist_id,
    draftType: row.draft_type,
    status: row.status,
    subject: row.subject,
    body: row.body,
    missingFields: Array.isArray(row.missing_fields) ? row.missing_fields : [],
    questions: Array.isArray(row.questions) ? row.questions : [],
    factsSnapshot: row.facts_snapshot,
    generationMode: row.generation_mode,
    generationNote: row.generation_note,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    schemaVersion: row.schema_version,
    createdBy: row.created_by,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
