import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { isDemoMode, resolveAppMode, type ModeOptions } from "../app-mode.ts";
import { normalizeObservedAt, validateEvidenceUrl } from "../ai-sourcing.ts";
import {
  parseSupplierCandidatePayload,
} from "../supplier-candidates.ts";
import {
  clamp,
  loadHypothesisContext,
} from "./mappers.ts";
import { refreshAISelectionDecision } from "./decisions.ts";
import type {
  SupplierCandidateRow,
} from "./types.ts";

export async function recordSupplierCandidates(input: {
  hypothesisId: string;
  query: string;
  payload: string;
  actor: string;
  observedAt?: string;
}, options?: ModeOptions) {
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);
  const context = await loadHypothesisContext(input.hypothesisId, { mode });
  if (!context) throw new Error("机会假设不存在");
  if (!context.hypothesis.selectedForValidation) throw new Error("请先把机会加入验证，再采集供应商候选");

  const query = input.query.trim().slice(0, 500)
    || context.hypothesis.supplierKeywords[0]
    || context.hypothesis.concept;
  const parsed = parseSupplierCandidatePayload(input.payload, {
    query,
    observedAt: input.observedAt,
    platform: "1688",
  });
  const capturedAt = normalizeObservedAt(parsed.capturedAt);
  const actor = input.actor.trim().slice(0, 80) || "采购人员";
  const db = await getDb();

  return db.transaction(async (tx) => {
    const selected = await tx.query<{ selected_for_validation: boolean }>(
      `SELECT h.selected_for_validation
       FROM opportunity_hypotheses h
       JOIN ai_sourcing_runs r ON r.id = h.run_id
       WHERE h.id = $1 AND r.is_demo = $2
       FOR UPDATE OF h`,
      [input.hypothesisId, demo],
    );
    if (!selected.rows[0]) throw new Error("机会假设不存在");
    if (!selected.rows[0].selected_for_validation) throw new Error("请先把机会加入验证，再采集供应商候选");

    const runId = randomUUID();
    await tx.query(
      `INSERT INTO supplier_discovery_runs
        (id, hypothesis_id, source, trigger_mode, query, page_url, payload_text, captured_at,
         received_count, parsed_count, duplicate_count, top_count, warnings, actor)
       VALUES ($1, $2, $3, 'user_triggered', $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
      [
        runId,
        input.hypothesisId,
        parsed.source.trim().slice(0, 80) || "visible_page_capture",
        query,
        parsed.pageUrl,
        input.payload.slice(0, 200_000),
        capturedAt,
        parsed.receivedCount,
        parsed.candidates.length,
        parsed.duplicateCount,
        parsed.candidates.length,
        JSON.stringify(parsed.warnings),
        actor,
      ],
    );

    let newCount = 0;
    for (const candidate of parsed.candidates) {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO supplier_candidates
          (id, discovery_run_id, hypothesis_id, title, supplier_name, platform, offer_url, supplier_url,
           offer_id, price_cents, currency, moq, location, badges, lead_time_days, source_text,
           fingerprint, score, score_parts, reasons, risk_notes, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16,
                 $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22)
         ON CONFLICT (hypothesis_id, fingerprint) DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          runId,
          input.hypothesisId,
          candidate.title,
          candidate.supplierName,
          candidate.platform,
          candidate.offerUrl,
          candidate.supplierUrl,
          candidate.offerId,
          candidate.priceCents,
          candidate.currency,
          candidate.moq,
          candidate.location,
          JSON.stringify(candidate.badges),
          candidate.leadTimeDays,
          candidate.sourceText,
          candidate.fingerprint,
          candidate.score,
          JSON.stringify(candidate.scoreParts),
          JSON.stringify(candidate.reasons),
          JSON.stringify(candidate.riskNotes),
          normalizeObservedAt(candidate.observedAt),
        ],
      );
      if (inserted.rows.length > 0) newCount += 1;
    }

    const skippedExistingCount = parsed.candidates.length - newCount;
    const duplicateCount = parsed.duplicateCount + skippedExistingCount;
    const warnings = skippedExistingCount > 0
      ? [...parsed.warnings, `另有 ${skippedExistingCount} 个候选已在候选池中，本次未重复写入。`]
      : parsed.warnings;
    await tx.query(
      `UPDATE supplier_discovery_runs
       SET duplicate_count = $1, warnings = $2::jsonb
       WHERE id = $3`,
      [duplicateCount, JSON.stringify(warnings), runId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
       VALUES ($1, $2, 'ai_sourcing.supplier_candidates_recorded', 'opportunity_hypothesis', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({
          discoveryRunId: runId,
          query,
          receivedCount: parsed.receivedCount,
          parsedCount: parsed.candidates.length,
          newCount,
          duplicateCount,
          triggerMode: "user_triggered",
          externalActions: "none",
        }),
        demo,
      ],
    );

    return {
      runId,
      receivedCount: parsed.receivedCount,
      parsedCount: parsed.candidates.length,
      newCount,
      duplicateCount,
      skippedExistingCount,
      topCount: parsed.candidates.length,
      warnings,
      capturedAt,
    };
  });
}

export async function shortlistSupplierCandidate(input: {
  candidateId: string;
  supplierName: string;
  productMatch: string;
  actor: string;
  verified: boolean;
}, options?: ModeOptions) {
  if (!input.verified) throw new Error("请先确认已经人工核验供应商和产品，再加入短名单");
  const candidateId = input.candidateId.trim();
  if (!candidateId) throw new Error("缺少候选 ID");
  const supplierName = input.supplierName.trim().slice(0, 180);
  if (!supplierName) throw new Error("请填写核验后的供应商名称");
  const productMatch = input.productMatch.trim().slice(0, 500);
  if (!productMatch) throw new Error("请填写人工核验后的产品匹配说明");
  const actor = input.actor.trim().slice(0, 80) || "采购人员";
  const db = await getDb();
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);

  const outcome = await db.transaction(async (tx) => {
    const candidateResult = await tx.query<SupplierCandidateRow & { selected_for_validation: boolean }>(
      `SELECT c.*, h.selected_for_validation
       FROM supplier_candidates c
       JOIN opportunity_hypotheses h ON h.id = c.hypothesis_id
       JOIN ai_sourcing_runs r ON r.id = h.run_id
       WHERE c.id = $1 AND r.is_demo = $2
       FOR UPDATE OF c`,
      [candidateId, demo],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) throw new Error("供应商候选不存在");
    if (!candidate.selected_for_validation) throw new Error("请先把机会加入验证，再加入供应商短名单");
    if (candidate.status === "shortlisted") throw new Error("该候选已加入短名单，不能重复加入");
    if (candidate.status === "rejected") throw new Error("该候选已被拒绝，不能加入短名单");

    const supplierUrl = validateEvidenceUrl((candidate.supplier_url || candidate.offer_url).trim());
    const observedAt = normalizeObservedAt(candidate.observed_at);
    const shortlistId = randomUUID();
    await tx.query(
      `INSERT INTO supplier_shortlists
        (id, hypothesis_id, supplier_name, platform, supplier_url, contact, country, product_match,
         source_type, observed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'visible_page_manual_verification', $9, $10)`,
      [
        shortlistId,
        candidate.hypothesis_id,
        supplierName,
        candidate.platform.slice(0, 60) || "1688",
        supplierUrl,
        null,
        candidate.location.trim().slice(0, 60) || null,
        productMatch,
        observedAt,
        actor,
      ],
    );
    const updated = await tx.query<{ id: string }>(
      `UPDATE supplier_candidates
       SET status = 'shortlisted', shortlist_id = $1, verified_by = $2, verified_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status = 'candidate'
       RETURNING id`,
      [shortlistId, actor, candidateId],
    );
    if (updated.rows.length === 0) throw new Error("候选状态已变化，请刷新后重试");

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
       VALUES ($1, $2, 'ai_sourcing.supplier_candidate_shortlisted', 'supplier_candidate', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        actor,
        candidateId,
        JSON.stringify({
          hypothesisId: candidate.hypothesis_id,
          shortlistId,
          supplierName,
          sourceUrl: supplierUrl,
          sourceType: "visible_page_manual_verification",
          manuallyVerified: true,
          externalActions: "none",
        }),
        demo,
      ],
    );

    return { candidateId, shortlistId, supplierName, hypothesisId: candidate.hypothesis_id };
  });
  await refreshAISelectionDecision(outcome.hypothesisId, { mode });
  return outcome;
}

export async function rejectSupplierCandidate(input: {
  candidateId: string;
  actor: string;
  reason: string;
}, options?: ModeOptions) {
  const candidateId = input.candidateId.trim();
  if (!candidateId) throw new Error("缺少候选 ID");
  const actor = input.actor.trim().slice(0, 80) || "采购人员";
  const reason = input.reason.trim().slice(0, 300) || "人工排除";
  const db = await getDb();
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);

  return db.transaction(async (tx) => {
    const candidateResult = await tx.query<SupplierCandidateRow>(
      `SELECT c.*
       FROM supplier_candidates c
       JOIN opportunity_hypotheses h ON h.id = c.hypothesis_id
       JOIN ai_sourcing_runs r ON r.id = h.run_id
       WHERE c.id = $1 AND r.is_demo = $2
       FOR UPDATE OF c`,
      [candidateId, demo],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) throw new Error("供应商候选不存在");
    if (candidate.status === "rejected") throw new Error("该候选已经排除");
    if (candidate.status === "shortlisted") throw new Error("已加入短名单的候选不能直接排除");

    await tx.query(
      `UPDATE supplier_candidates
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND status = 'candidate'`,
      [candidateId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
       VALUES ($1, $2, 'ai_sourcing.supplier_candidate_rejected', 'supplier_candidate', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        actor,
        candidateId,
        JSON.stringify({
          hypothesisId: candidate.hypothesis_id,
          reason,
          externalActions: "none",
        }),
        demo,
      ],
    );

    return {
      candidateId,
      hypothesisId: candidate.hypothesis_id,
      reason,
    };
  });
}

export async function recordAISupplierQuote(input: {
  hypothesisId: string;
  supplierName: string;
  supplierPlatform: string;
  supplierUrl: string;
  contact?: string;
  country?: string;
  productMatch: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
  moq: number;
  leadTimeDays: number;
  sampleScore?: number | null;
  sampleFeeCents: number;
  certifications: string;
  paymentTerms: string;
  incoterm: string;
  quoteUrl: string;
  observedAt: string;
  actor: string;
}, options?: ModeOptions) {
  const db = await getDb();
  const mode = await resolveAppMode(options?.mode);
  const context = await loadHypothesisContext(input.hypothesisId, { mode });
  if (!context) throw new Error("机会假设不存在");
  if (!context.hypothesis.selectedForValidation) throw new Error("请先把机会加入验证");
  const supplierUrl = validateEvidenceUrl(input.supplierUrl.trim());
  const quoteUrl = validateEvidenceUrl(input.quoteUrl.trim());
  const observedAt = normalizeObservedAt(input.observedAt);
  const unitPriceCents = Math.round(input.unitPriceCents);
  const freightPerUnitCents = Math.round(input.freightPerUnitCents);
  const dutyRate = clamp(input.dutyRate, 0, 1);
  const landedCostCents = unitPriceCents + freightPerUnitCents + Math.round((unitPriceCents + freightPerUnitCents) * dutyRate);
  if (unitPriceCents <= 0) throw new Error("采购单价必须大于 0");
  if (input.moq <= 0 || input.leadTimeDays <= 0) throw new Error("MOQ 和交期必须大于 0");
  if (!input.supplierName.trim()) throw new Error("请填写供应商名称");

  await db.transaction(async (tx) => {
    const shortlistId = randomUUID();
    const quoteId = randomUUID();
    await tx.query(
      `INSERT INTO supplier_shortlists
        (id, hypothesis_id, supplier_name, platform, supplier_url, contact, country, product_match, observed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        shortlistId,
        input.hypothesisId,
        input.supplierName.trim().slice(0, 180),
        input.supplierPlatform.trim().slice(0, 60) || "1688",
        supplierUrl,
        input.contact?.trim().slice(0, 180) || null,
        input.country?.trim().slice(0, 60) || null,
        input.productMatch.trim().slice(0, 500),
        observedAt,
        input.actor.trim() || "采购人员",
      ],
    );
    await tx.query(
      `INSERT INTO sourcing_supplier_quotes
        (id, hypothesis_id, supplier_shortlist_id, unit_price_cents, freight_per_unit_cents,
         duty_rate, landed_cost_cents, currency, moq, lead_time_days, sample_score, sample_fee_cents,
         certifications, payment_terms, incoterm, quote_url, observed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        quoteId,
        input.hypothesisId,
        shortlistId,
        unitPriceCents,
        freightPerUnitCents,
        dutyRate,
        landedCostCents,
        context.batch.currency,
        Math.round(input.moq),
        Math.round(input.leadTimeDays),
        input.sampleScore == null ? null : clamp(Math.round(input.sampleScore), 0, 100),
        Math.max(0, Math.round(input.sampleFeeCents)),
        input.certifications.trim().slice(0, 500),
        input.paymentTerms.trim().slice(0, 200),
        input.incoterm.trim().slice(0, 80),
        quoteUrl,
        observedAt,
        input.actor.trim() || "采购人员",
      ],
    );
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
       VALUES ($1, $2, 'supplier_quote', 'supplier', $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        randomUUID(),
        input.hypothesisId,
        quoteUrl,
        `${input.supplierName.trim()} 真实报价`,
        `含税到岸 ${(landedCostCents / 100).toFixed(2)} ${context.batch.currency}；MOQ ${input.moq}；交期 ${input.leadTimeDays} 天`,
        observedAt,
        JSON.stringify({ quoteId, supplierShortlistId: shortlistId, landedCostCents, dutyRate }),
        input.actor.trim() || "采购人员",
      ],
    );
  });
  return refreshAISelectionDecision(input.hypothesisId, { mode });
}

