import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import {
  DEFAULT_SOURCING_THRESHOLDS,
  evaluateSourcingDecision,
} from "../ai-sourcing.ts";
import { loadCalibratedDefaultsForScope } from "../calibration-repository.ts";
import { calculateEconomics } from "../economics.ts";
import {
  loadHypothesisContext,
  mapDecision,
  mapDecisionQuote,
  mapEvidence,
  riskLevel,
} from "./mappers.ts";
import {
  SYNTHETIC_SOURCE_SQL,
  type AISelectionDecision,
  type DecisionRow,
  type EvidenceRow,
  type PromotableQuoteRow,
  type QuoteRow,
} from "./types.ts";

export async function refreshAISelectionDecision(hypothesisId: string): Promise<AISelectionDecision> {
  const db = await getDb();
  const context = await loadHypothesisContext(hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  const [counts, reviews, quotes, patent, logistics] = await Promise.all([
    db.query<{ competitors: string | number; synthetic_competitors: string | number; suppliers: string | number; quotes: string | number }>(
      `SELECT
        (SELECT COUNT(*) FROM competitor_snapshots c
          LEFT JOIN opportunity_evidence e ON e.id = c.evidence_id
          WHERE c.hypothesis_id = $1
            AND COALESCE(e.source_type, '') NOT IN (${SYNTHETIC_SOURCE_SQL})) AS competitors,
        (SELECT COUNT(*) FROM competitor_snapshots c
          JOIN opportunity_evidence e ON e.id = c.evidence_id
          WHERE c.hypothesis_id = $1
            AND e.source_type IN (${SYNTHETIC_SOURCE_SQL})) AS synthetic_competitors,
        (SELECT COUNT(*) FROM supplier_shortlists WHERE hypothesis_id = $1) AS suppliers,
        (SELECT COUNT(*) FROM sourcing_supplier_quotes WHERE hypothesis_id = $1) AS quotes`,
      [hypothesisId],
    ),
    db.query<{ sample_count: string | number }>(
      `SELECT COALESCE(SUM(ri.sample_size), 0) AS sample_count
       FROM review_insights ri
       LEFT JOIN opportunity_evidence e ON e.id = ri.evidence_id
       WHERE ri.hypothesis_id = $1
         AND COALESCE(e.source_type, '') NOT IN (${SYNTHETIC_SOURCE_SQL})`,
      [hypothesisId],
    ),
    db.query<QuoteRow>(
      "SELECT * FROM sourcing_supplier_quotes WHERE hypothesis_id = $1 ORDER BY landed_cost_cents ASC",
      [hypothesisId],
    ),
    db.query<{ risk_level: string | null }>(
      `SELECT raw_snapshot->>'riskLevel' AS risk_level
       FROM opportunity_evidence
       WHERE hypothesis_id = $1 AND evidence_type = 'patent_check'
       ORDER BY observed_at DESC LIMIT 1`,
      [hypothesisId],
    ),
    db.query<{ risk_level: string | null }>(
      `SELECT raw_snapshot->>'riskLevel' AS risk_level
       FROM opportunity_evidence
       WHERE hypothesis_id = $1 AND evidence_type = 'logistics_check'
       ORDER BY observed_at DESC LIMIT 1`,
      [hypothesisId],
    ),
  ]);

  const count = counts.rows[0];
  const calibratedBundle = context.hypothesis.confirmedPriceCents
    ? await loadCalibratedDefaultsForScope({
        marketplace: context.batch.marketCode,
        currency: context.batch.currency,
        category: context.batch.category,
        platformCode: context.batch.platformCode,
        salePriceCents: context.hypothesis.confirmedPriceCents,
      })
    : null;
  const decision = evaluateSourcingDecision({
    opportunityScore: context.hypothesis.priorityScore,
    confirmedPriceCents: context.hypothesis.confirmedPriceCents,
    context: context.batch,
    competitorCount: Number(count?.competitors ?? 0),
    reviewSampleCount: Number(reviews.rows[0]?.sample_count ?? 0),
    supplierCount: Number(count?.suppliers ?? 0),
    quotes: quotes.rows.map(mapDecisionQuote),
    latestPatentRisk: riskLevel(patent.rows[0]?.risk_level, "missing"),
    latestLogisticsRisk: riskLevel(logistics.rows[0]?.risk_level, "missing"),
    calibratedDefaults: calibratedBundle?.calibratedDefaults,
  });

  const decisionId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO selection_decisions
        (id, hypothesis_id, decision, decision_score, opportunity_score, evidence_completeness,
         landed_cost_cents, landed_cost_usd_cents, margin_rate, stress_margin_rate, best_quote_id,
         gates, blockers, metrics, evaluated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, NOW())
       ON CONFLICT (hypothesis_id) DO UPDATE SET
         decision = EXCLUDED.decision,
         decision_score = EXCLUDED.decision_score,
         opportunity_score = EXCLUDED.opportunity_score,
         evidence_completeness = EXCLUDED.evidence_completeness,
         landed_cost_cents = EXCLUDED.landed_cost_cents,
         landed_cost_usd_cents = EXCLUDED.landed_cost_usd_cents,
         margin_rate = EXCLUDED.margin_rate,
         stress_margin_rate = EXCLUDED.stress_margin_rate,
         best_quote_id = EXCLUDED.best_quote_id,
         gates = EXCLUDED.gates,
         blockers = EXCLUDED.blockers,
         metrics = EXCLUDED.metrics,
         evaluated_at = NOW()`,
      [
        decisionId,
        hypothesisId,
        decision.decision,
        decision.decisionScore,
        decision.opportunityScore,
        decision.evidenceCompleteness,
        decision.landedCostCents,
        decision.landedCostUsdCents,
        decision.marginRate,
        decision.stressMarginRate,
        decision.bestQuoteId,
        JSON.stringify(decision.gates),
        JSON.stringify(decision.blockers),
        JSON.stringify(decision.metrics),
      ],
    );
    await tx.query(
      `UPDATE validation_tasks SET status = 'done', updated_at = NOW()
       WHERE hypothesis_id = $1 AND (
         (task_type = 'competitor_scan' AND $2 >= target_count) OR
         (task_type = 'review_research' AND $3 >= target_count) OR
         (task_type = 'supplier_shortlist' AND $4 >= target_count) OR
         (task_type = 'quote_collection' AND $5 >= target_count)
       )`,
      [
        hypothesisId,
        Number(count?.competitors ?? 0),
        Number(reviews.rows[0]?.sample_count ?? 0),
        Number(count?.suppliers ?? 0),
        Number(count?.quotes ?? 0),
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, 'system', 'ai_sourcing.decision_evaluated', 'opportunity_hypothesis', $2, $3::jsonb)`,
      [randomUUID(), hypothesisId, JSON.stringify({
        decision: decision.decision,
        evidenceCompleteness: decision.evidenceCompleteness,
        verifiedCompetitors: Number(count?.competitors ?? 0),
        syntheticCompetitorsExcluded: Number(count?.synthetic_competitors ?? 0),
      })],
    );
  });

  return {
    ...decision,
    id: decisionId,
    hypothesisId,
    evaluatedAt: new Date().toISOString(),
  };
}

export async function promoteHypothesisToProductCase(hypothesisId: string, actor: string) {
  const db = await getDb();
  const context = await loadHypothesisContext(hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  if (!context.hypothesis.selectedForValidation) throw new Error("请先把机会加入验证");
  if (context.hypothesis.productCaseId) return { caseId: context.hypothesis.productCaseId, created: false };

  const decision = await refreshAISelectionDecision(hypothesisId);
  if (decision.decision !== "GO") throw new Error("确定性门禁尚未给出 GO，不能转入商品立项");

  const quotes = await db.query<PromotableQuoteRow>(
    `SELECT q.*, s.supplier_name, s.platform AS supplier_platform, s.supplier_url,
            s.contact AS supplier_contact, s.country AS supplier_country, s.product_match
     FROM sourcing_supplier_quotes q
     JOIN supplier_shortlists s ON s.id = q.supplier_shortlist_id
     WHERE q.hypothesis_id = $1
     ORDER BY q.landed_cost_cents ASC, q.moq ASC`,
    [hypothesisId],
  );
  const bestQuote = quotes.rows[0];
  if (!bestQuote) throw new Error("缺少真实报价");
  const caseId = randomUUID();
  const asin = `AI-${hypothesisId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const confirmedPrice = context.hypothesis.confirmedPriceCents;
  if (!confirmedPrice) throw new Error("请先录入已确认售价，再转商品立项");
  const calibratedBundle = await loadCalibratedDefaultsForScope({
    marketplace: context.batch.marketCode,
    currency: context.batch.currency,
    category: context.batch.category,
    platformCode: context.batch.platformCode,
    salePriceCents: confirmedPrice,
  });
  const assumptions = {
    currency: context.batch.currency,
    salePriceCents: confirmedPrice,
    landedCostCents: bestQuote.landed_cost_cents,
    ...calibratedBundle.defaults,
    ...(calibratedBundle.calibrationMeta ? { calibrationMeta: calibratedBundle.calibrationMeta } : {}),
  };
  const economics = calculateEconomics(assumptions);
  const owner = actor.trim() || "运营人员";

  await db.transaction(async (tx) => {
    const guard = await tx.query<{ product_case_id: string | null }>(
      "SELECT product_case_id FROM opportunity_hypotheses WHERE id = $1 FOR UPDATE",
      [hypothesisId],
    );
    if (guard.rows[0]?.product_case_id) return;

    let isDemo = false;
    try {
      const { getAppMode } = await import("@/lib/app-mode");
      const mode = await getAppMode();
      isDemo = mode === "sandbox";
    } catch {
      isDemo = false;
    }

    await tx.query(
      `INSERT INTO product_cases
        (id, asin, marketplace, category, title, status, competitor_price_cents, monthly_sales_estimate,
         review_count, rating, notes, owner, evidence_score, is_demo, source_code, source_record_id,
         source_observed_at, currency)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, 0, 0, NULL, $7, $8, $9, $12,
               'ai_sourcing', $10, NOW(), $11)`,
      [
        caseId,
        asin,
        context.batch.marketCode,
        context.batch.category,
        context.hypothesis.concept,
        confirmedPrice,
        `由 AI 选品验证批次转入；已核实竞品 ${context.counts.competitors} 个${(context.counts.syntheticCompetitors ?? 0) > 0 ? `（另有 ${context.counts.syntheticCompetitors} 条 AI/模板合成素材，不计入证据与门禁）` : ""}，差评样本 ${context.counts.reviewSamples} 条，供应商 ${context.counts.suppliers} 家，报价 ${context.counts.quotes} 份。决策证据完整度 ${decision.evidenceCompleteness}%。`,
        owner,
        decision.evidenceCompleteness,
        hypothesisId,
        context.batch.currency,
        isDemo,
      ],
    );
    await tx.query(
      `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
       VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5)`,
      [randomUUID(), caseId, JSON.stringify(assumptions), JSON.stringify(economics), owner],
    );
    await tx.query(
      `INSERT INTO product_case_sites (case_id, market_code, platform_code, discovery_source)
       VALUES ($1, $2, $3, 'ai_sourcing')
       ON CONFLICT (case_id, market_code, platform_code) DO NOTHING`,
      [caseId, context.batch.marketCode, context.batch.platformCode],
    );
    for (const quote of quotes.rows) {
      const supplierId = randomUUID();
      const rfqId = randomUUID();
      const quoteId = randomUUID();
      const requirements = {
        source: "ai_sourcing_quote",
        hypothesisId,
        productMatch: quote.product_match,
        incoterm: quote.incoterm || null,
        paymentTerms: quote.payment_terms || null,
        requestedCertifications: quote.certifications || null,
        quoteObservedAt: quote.observed_at,
        note: "由 AI 选品验证阶段录入的真实报价转入；系统未自动联系供应商、未发送 RFQ、未下单。",
      };
      await tx.query(
        `INSERT INTO suppliers
          (id, name, platform, url, contact, country, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          supplierId,
          quote.supplier_name,
          quote.supplier_platform,
          quote.supplier_url,
          quote.supplier_contact,
          quote.supplier_country,
          `AI 选品转立项；产品匹配：${quote.product_match}`,
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
           moq, lead_time_days, payment_terms, incoterm, certifications, sample_fee_cents,
           raw_payload, currency, observed_at, source_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, 'ai_sourcing')`,
        [
          quoteId,
          rfqId,
          quote.unit_price_cents,
          quote.freight_per_unit_cents,
          quote.duty_rate,
          quote.sample_score ?? 60,
          quote.moq,
          quote.lead_time_days,
          quote.payment_terms || null,
          quote.incoterm || null,
          quote.certifications || null,
          quote.sample_fee_cents,
          JSON.stringify({
            sourceQuoteId: quote.id,
            sourceHypothesisId: hypothesisId,
            sourceShortlistId: quote.supplier_shortlist_id,
            landedCostCents: quote.landed_cost_cents,
            quoteUrl: quote.quote_url,
            observedAt: quote.observed_at,
            enteredBy: quote.created_by,
            importedByPromotion: true,
          }),
          quote.currency,
          quote.observed_at,
        ],
      );
    }
    const evidence = await tx.query<EvidenceRow>(
      "SELECT * FROM opportunity_evidence WHERE hypothesis_id = $1 ORDER BY observed_at DESC",
      [hypothesisId],
    );
    for (const item of evidence.rows) {
      await tx.query(
        `INSERT INTO case_evidence
          (id, case_id, evidence_type, source_type, source_url, title, summary, payload, confidence, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          randomUUID(),
          caseId,
          item.evidence_type,
          item.source_type,
          item.source_url,
          item.title,
          item.summary,
          JSON.stringify(item.raw_snapshot),
          item.confidence,
          item.observed_at,
        ],
      );
    }
    await tx.query(
      "UPDATE opportunity_hypotheses SET product_case_id = $1 WHERE id = $2",
      [caseId, hypothesisId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.promoted_to_case', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        owner,
        caseId,
        JSON.stringify({
          hypothesisId,
          decision: decision.decision,
          evidenceCompleteness: decision.evidenceCompleteness,
          landedCostCents: decision.landedCostCents,
          marginRate: decision.marginRate,
          externalActions: "none",
        }),
      ],
    );
  });

  return { caseId, created: true };
}

