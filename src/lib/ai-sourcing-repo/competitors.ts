import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { normalizeObservedAt, validateEvidenceUrl } from "../ai-sourcing.ts";
import {
  buildCompetitorBenchmark,
  evaluateConfirmedPriceAdvisory,
  isSyntheticCompetitorSource,
  type CompetitorBenchmark,
} from "../competitor-insights.ts";
import { getComparisonReportById } from "../competitor-compare/storage.ts";
import { isVerifiedCompetitorField } from "../competitor-compare/types.ts";
import {
  generateSiteCompetitorPack,
  parseBulkCompetitorText,
} from "../competitor-auto-import.ts";
import {
  assertSelected,
  loadHypothesisContext,
  mapCompetitor,
  mapHypothesis,
  mapQuote,
  mapReviewInsight,
  metricNumber,
  riskLevel,
} from "./mappers.ts";
import { selectHypothesisForValidation } from "./batches.ts";
import { refreshAISelectionDecision } from "./decisions.ts";
import {
  SYNTHETIC_SOURCE_SQL,
  type CompetitorRow,
  type HypothesisRow,
  type QuoteRow,
  type ReviewInsightRow,
} from "./types.ts";

export async function confirmHypothesisPrice(input: {
  hypothesisId: string;
  priceCents: number;
  sourceUrl: string;
  actor: string;
}) {
  const db = await getDb();
  await assertSelected(input.hypothesisId);
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) throw new Error("已确认售价必须大于 0");
  const sourceUrl = validateEvidenceUrl(input.sourceUrl.trim());
  const actor = input.actor.trim() || "运营人员";
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE opportunity_hypotheses
       SET confirmed_price_cents = $2, confirmed_price_source_url = $3, confirmed_price_at = NOW()
       WHERE id = $1`,
      [input.hypothesisId, input.priceCents, sourceUrl],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.price_confirmed', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [randomUUID(), actor, input.hypothesisId, JSON.stringify({ priceCents: input.priceCents, sourceUrl, externalActions: "none" })],
    );
  });
  const decision = await refreshAISelectionDecision(input.hypothesisId);
  const [context, competitorRows] = await Promise.all([
    loadHypothesisContext(input.hypothesisId),
    db.query<CompetitorRow>(
      `SELECT c.*, e.source_type FROM competitor_snapshots c
       LEFT JOIN opportunity_evidence e ON e.id = c.evidence_id
       WHERE c.hypothesis_id = $1 ORDER BY c.observed_at DESC`,
      [input.hypothesisId],
    ),
  ]);
  let priceAdvisory: string | null = null;
  if (context && competitorRows.rows.length > 0) {
    const benchmark = buildCompetitorBenchmark({
      snapshots: competitorRows.rows.map(mapCompetitor),
      insights: [],
      scope: {
        runId: context.hypothesis.runId,
        hypothesisId: input.hypothesisId,
        marketCode: context.batch.marketCode,
        platformCode: context.batch.platformCode,
        currency: context.batch.currency,
      },
      hypothesis: {
        concept: context.hypothesis.concept,
        targetUser: context.hypothesis.targetUser,
        painPoint: context.hypothesis.painPoint,
        differentiator: context.hypothesis.differentiator,
        recommendedPriceCents: context.hypothesis.recommendedPriceCents,
        confirmedPriceCents: input.priceCents,
        expectedMarginRate: context.hypothesis.expectedMarginRate,
      },
    });
    priceAdvisory = evaluateConfirmedPriceAdvisory(input.priceCents, benchmark.price, context.batch.currency);
  }
  return { ...decision, priceAdvisory };
}

export async function recordOpportunityEvidence(input: {
  hypothesisId: string;
  evidenceType: "review_insight" | "patent_check" | "logistics_check" | "supplier_discovery" | "other";
  sourceType: string;
  sourceUrl: string;
  title: string;
  summary: string;
  observedAt: string;
  reviewSampleSize?: number;
  representativeQuote?: string;
  sentiment?: "negative" | "neutral" | "positive";
  riskLevel?: "clear" | "review" | "found";
  actor: string;
}) {
  const db = await getDb();
  await assertSelected(input.hypothesisId);
  const evidenceId = randomUUID();
  const observedAt = normalizeObservedAt(input.observedAt || new Date().toISOString());
  const rawUrl = input.sourceUrl.trim();
  const fallbackUrl =
    input.evidenceType === "patent_check"
      ? "https://patents.google.com/"
      : input.evidenceType === "logistics_check"
        ? "https://sellercentral.amazon.com/hz/fba/profitabilitycalculator"
        : "https://www.amazon.com/";
  const sourceUrl = validateEvidenceUrl(rawUrl || fallbackUrl);
  const sampleSize = Math.max(1, Math.round(input.reviewSampleSize || 1));
  const riskLevel = input.riskLevel ?? (input.evidenceType === "patent_check" || input.evidenceType === "logistics_check" ? "review" : undefined);

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        evidenceId,
        input.hypothesisId,
        input.evidenceType,
        input.sourceType.trim().slice(0, 60) || "manual",
        sourceUrl,
        input.title.trim().slice(0, 240),
        input.summary.trim().slice(0, 1500),
        observedAt,
        JSON.stringify({
          reviewSampleSize: input.evidenceType === "review_insight" ? sampleSize : undefined,
          representativeQuote: input.representativeQuote?.trim().slice(0, 500) || undefined,
          riskLevel,
        }),
        input.actor.trim() || "运营人员",
      ],
    );
    if (input.evidenceType === "review_insight") {
      await tx.query(
        `INSERT INTO review_insights
          (id, hypothesis_id, evidence_id, theme, sentiment, sample_size, representative_quote)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          input.hypothesisId,
          evidenceId,
          input.title.trim().slice(0, 180),
          input.sentiment ?? "negative",
          sampleSize,
          input.representativeQuote?.trim().slice(0, 500) || "",
        ],
      );
    }
  });
  return refreshAISelectionDecision(input.hypothesisId);
}

export async function recordCompetitorEvidence(input: {
  hypothesisId: string;
  asin?: string;
  title: string;
  sourceUrl: string;
  priceCents: number;
  rating?: number | null;
  reviewCount: number;
  bsr?: number | null;
  monthlySalesMin?: number | null;
  monthlySalesMax?: number | null;
  sellerCount?: number | null;
  variationCount?: number | null;
  observedAt: string;
  actor: string;
}) {
  const db = await getDb();
  await assertSelected(input.hypothesisId);
  const evidenceId = randomUUID();
  const sourceUrl = validateEvidenceUrl(input.sourceUrl.trim());
  const observedAt = normalizeObservedAt(input.observedAt);
  if (!input.title.trim()) throw new Error("请填写竞品标题");
  if (input.priceCents <= 0) throw new Error("竞品价格必须大于 0");

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
       VALUES ($1, $2, 'competitor_snapshot', 'marketplace', $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        evidenceId,
        input.hypothesisId,
        sourceUrl,
        input.title.trim().slice(0, 240),
        `竞品快照：${input.title.trim()}`.slice(0, 1500),
        observedAt,
        JSON.stringify({
          asin: input.asin?.trim() || null,
          priceCents: input.priceCents,
          rating: input.rating ?? null,
          reviewCount: input.reviewCount,
          bsr: input.bsr ?? null,
        }),
        input.actor.trim() || "运营人员",
      ],
    );
    await tx.query(
      `INSERT INTO competitor_snapshots
        (id, hypothesis_id, evidence_id, asin, title, source_url, price_cents, rating, review_count,
         bsr, monthly_sales_min, monthly_sales_max, seller_count, variation_count, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        randomUUID(),
        input.hypothesisId,
        evidenceId,
        input.asin?.trim() || null,
        input.title.trim().slice(0, 240),
        sourceUrl,
        input.priceCents,
        input.rating ?? null,
        input.reviewCount,
        input.bsr ?? null,
        input.monthlySalesMin ?? null,
        input.monthlySalesMax ?? null,
        input.sellerCount ?? null,
        input.variationCount ?? null,
        observedAt,
      ],
    );
  });
  return refreshAISelectionDecision(input.hypothesisId);
}

export async function autoImportSiteCompetitors(input: {
  hypothesisId: string;
  query?: string;
  targetCount?: number;
  includeReviews?: boolean;
  rawPayload?: string;
  actor: string;
}) {
  const actor = input.actor.trim().slice(0, 80) || "运营人员";
  let context = await loadHypothesisContext(input.hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  if (!context.hypothesis.selectedForValidation) {
    await selectHypothesisForValidation(input.hypothesisId, actor);
    context = await loadHypothesisContext(input.hypothesisId);
    if (!context) throw new Error("机会假设不存在");
  }

  const db = await getDb();
  const observedAt = new Date().toISOString();
  const rawPayload = input.rawPayload?.trim() ?? "";
  const defaultQuery = input.query?.trim() || context.hypothesis.competitorQueries[0] || context.hypothesis.concept;

  const pack = rawPayload
    ? {
        mode: "bulk_text" as const,
        provider: "manual_bulk",
        model: "bulk-parser-v1",
        fallback: false,
        providerError: undefined,
        queryUsed: defaultQuery,
        competitors: parseBulkCompetitorText(rawPayload, {
          marketCode: context.batch.marketCode,
          platformCode: context.batch.platformCode,
          currency: context.batch.currency,
          defaultQuery,
          basePriceCents: context.hypothesis.recommendedPriceCents,
          observedAt,
        }),
        reviewInsights: [],
      }
    : await generateSiteCompetitorPack({
        scope: {
          marketCode: context.batch.marketCode,
          marketName: context.batch.marketName,
          platformCode: context.batch.platformCode,
          platformName: context.batch.platformName,
          currency: context.batch.currency,
        },
        category: context.batch.category,
        concept: context.hypothesis.concept,
        targetUser: context.hypothesis.targetUser,
        painPoint: context.hypothesis.painPoint,
        differentiator: context.hypothesis.differentiator,
        recommendedPriceCents: context.hypothesis.recommendedPriceCents,
        competitorQueries: context.hypothesis.competitorQueries,
        reviewQueries: context.hypothesis.reviewQueries,
        query: defaultQuery,
        targetCount: input.targetCount ?? 20,
        observedAt,
      });

  if (pack.competitors.length === 0) {
    throw new Error("未能从输入内容中识别出有效竞品记录，请核对格式或使用 AI 一键导入");
  }

  const existingCompetitors = await db.query<{ asin: string | null; source_url: string }>(
    "SELECT asin, source_url FROM competitor_snapshots WHERE hypothesis_id = $1",
    [input.hypothesisId],
  );
  const existingAsins = new Set(
    existingCompetitors.rows
      .map((r) => r.asin?.trim().toUpperCase())
      .filter((v): v is string => Boolean(v)),
  );
  const existingUrls = new Set(
    existingCompetitors.rows.map((r) => r.source_url.trim().toLowerCase()),
  );

  const existingThemesResult = await db.query<{ theme: string }>(
    "SELECT theme FROM review_insights WHERE hypothesis_id = $1",
    [input.hypothesisId],
  );
  const existingThemes = new Set(
    existingThemesResult.rows.map((r) => r.theme.trim().toLowerCase()),
  );

  let insertedCompetitors = 0;
  let skippedDuplicateCompetitors = 0;
  let insertedReviews = 0;
  const sourceType = pack.mode === "model"
    ? "ai_model_site_import"
    : pack.mode === "bulk_text"
      ? "bulk_text_import"
      : "ai_site_auto_import";

  await db.transaction(async (tx) => {
    for (const item of pack.competitors) {
      const asinKey = item.asin?.trim().toUpperCase() || null;
      const urlKey = item.sourceUrl.trim().toLowerCase();
      if ((asinKey && existingAsins.has(asinKey)) || existingUrls.has(urlKey)) {
        skippedDuplicateCompetitors += 1;
        continue;
      }
      if (asinKey) existingAsins.add(asinKey);
      existingUrls.add(urlKey);

      const evidenceId = randomUUID();
      const sourceUrl = validateEvidenceUrl(item.sourceUrl);
      const itemObservedAt = normalizeObservedAt(item.observedAt);
      await tx.query(
        `INSERT INTO opportunity_evidence
          (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
         VALUES ($1, $2, 'competitor_snapshot', $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [
          evidenceId,
          input.hypothesisId,
          sourceType,
          sourceUrl,
          item.title.slice(0, 240),
          `[${context.batch.marketCode} · ${context.batch.platformName}] 竞品快照：${item.title}`.slice(0, 1500),
          itemObservedAt,
          JSON.stringify({
            asin: asinKey,
            priceCents: item.priceCents,
            rating: item.rating,
            reviewCount: item.reviewCount,
            bsr: item.bsr,
            marketCode: context.batch.marketCode,
            platformCode: context.batch.platformCode,
            currency: context.batch.currency,
            importMode: pack.mode,
            queryUsed: pack.queryUsed,
          }),
          actor,
        ],
      );
      await tx.query(
        `INSERT INTO competitor_snapshots
          (id, hypothesis_id, evidence_id, asin, title, source_url, price_cents, rating, review_count,
           bsr, monthly_sales_min, monthly_sales_max, seller_count, variation_count, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          randomUUID(),
          input.hypothesisId,
          evidenceId,
          asinKey,
          item.title.slice(0, 240),
          sourceUrl,
          item.priceCents,
          item.rating,
          item.reviewCount,
          item.bsr,
          item.monthlySalesMin,
          item.monthlySalesMax,
          item.sellerCount,
          item.variationCount,
          itemObservedAt,
        ],
      );
      insertedCompetitors += 1;
    }

    if (input.includeReviews !== false && pack.reviewInsights.length > 0) {
      for (const review of pack.reviewInsights) {
        const themeKey = review.theme.trim().toLowerCase();
        if (existingThemes.has(themeKey)) continue;
        existingThemes.add(themeKey);

        const evidenceId = randomUUID();
        const sourceUrl = validateEvidenceUrl(review.sourceUrl);
        const revObservedAt = normalizeObservedAt(review.observedAt);
        await tx.query(
          `INSERT INTO opportunity_evidence
            (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
           VALUES ($1, $2, 'review_insight', $3, $4, $5, $6, $7, $8::jsonb, $9)`,
          [
            evidenceId,
            input.hypothesisId,
            sourceType,
            sourceUrl,
            review.theme.slice(0, 240),
            review.summary.slice(0, 1500),
            revObservedAt,
            JSON.stringify({
              reviewSampleSize: review.sampleSize,
              representativeQuote: review.representativeQuote,
              marketCode: context.batch.marketCode,
              platformCode: context.batch.platformCode,
              importMode: pack.mode,
            }),
            actor,
          ],
        );
        await tx.query(
          `INSERT INTO review_insights
            (id, hypothesis_id, evidence_id, theme, sentiment, sample_size, representative_quote)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            input.hypothesisId,
            evidenceId,
            review.theme.slice(0, 180),
            review.sentiment,
            review.sampleSize,
            review.representativeQuote.slice(0, 500),
          ],
        );
        insertedReviews += 1;
      }
    }

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.competitors_auto_imported', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({
          marketCode: context.batch.marketCode,
          platformCode: context.batch.platformCode,
          currency: context.batch.currency,
          queryUsed: pack.queryUsed,
          mode: pack.mode,
          provider: pack.provider,
          model: pack.model,
          insertedCompetitors,
          skippedDuplicateCompetitors,
          insertedReviews,
          externalActions: "none",
        }),
      ],
    );
  });

  const decision = await refreshAISelectionDecision(input.hypothesisId);
  return {
    insertedCompetitors,
    skippedDuplicateCompetitors,
    insertedReviews,
    marketCode: context.batch.marketCode,
    marketName: context.batch.marketName,
    platformName: context.batch.platformName,
    currency: context.batch.currency,
    mode: pack.mode,
    queryUsed: pack.queryUsed,
    decision,
  };
}


export type CaseBenchmarkLookupResult = {
  status: "ok" | "none" | "ambiguous";
  benchmark: CompetitorBenchmark | null;
  candidates: Array<{
    hypothesisId: string;
    runId: string;
    concept: string;
    marketCode: string;
    platformCode: string;
    currency: string;
  }>;
};

/**
 * 内容页反查入口：product_cases.id -> opportunity_hypotheses -> snapshots + insights。
 * 不复制、不快照；若一个 case 关联多个假设且未显式指定 hypothesisId，返回 ambiguous 由人工选择。
 */
export async function loadCaseCompetitorBenchmark(
  caseId: string,
  selectedHypothesisId?: string | null,
): Promise<CaseBenchmarkLookupResult> {
  const db = await getDb();
  const hypRows = await db.query<
    HypothesisRow & {
      market_code: string;
      platform_code: string;
      currency: string;
    }
  >(
    `SELECT h.*, b.market_code, b.platform_code, b.currency
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     WHERE h.product_case_id = $1
        OR h.id = (
          SELECT source_record_id FROM product_cases
          WHERE id = $1 AND source_code = 'ai_sourcing'
        )
     ORDER BY h.created_at DESC`,
    [caseId],
  );

  const candidates = hypRows.rows.map((row) => ({
    hypothesisId: row.id,
    runId: row.run_id,
    concept: row.concept,
    marketCode: row.market_code,
    platformCode: row.platform_code,
    currency: row.currency,
  }));

  if (hypRows.rows.length === 0) {
    return { status: "none", benchmark: null, candidates: [] };
  }

  const chosenRow = selectedHypothesisId
    ? hypRows.rows.find((row) => row.id === selectedHypothesisId) ?? null
    : hypRows.rows.length === 1
      ? hypRows.rows[0]!
      : null;

  if (!chosenRow) {
    return { status: "ambiguous", benchmark: null, candidates };
  }

  const [competitorRows, reviewInsightRows, quoteRows] = await Promise.all([
    db.query<CompetitorRow>(
      `SELECT c.*, e.source_type FROM competitor_snapshots c
       LEFT JOIN opportunity_evidence e ON e.id = c.evidence_id
       WHERE c.hypothesis_id = $1 ORDER BY c.observed_at DESC`,
      [chosenRow.id],
    ),
    db.query<ReviewInsightRow>(
      `SELECT ri.*, e.source_url, e.observed_at, e.source_type
       FROM review_insights ri
       LEFT JOIN opportunity_evidence e ON e.id = ri.evidence_id
       WHERE ri.hypothesis_id = $1
       ORDER BY ri.sample_size DESC, ri.created_at DESC`,
      [chosenRow.id],
    ),
    db.query<QuoteRow>(
      "SELECT * FROM sourcing_supplier_quotes WHERE hypothesis_id = $1 ORDER BY landed_cost_cents ASC LIMIT 1",
      [chosenRow.id],
    ),
  ]);

  const mappedHyp = mapHypothesis(chosenRow);
  const bestQuote = quoteRows.rows[0] ? mapQuote(quoteRows.rows[0]) : null;
  const benchmark = buildCompetitorBenchmark({
    snapshots: competitorRows.rows.map(mapCompetitor),
    insights: reviewInsightRows.rows.map(mapReviewInsight),
    scope: {
      runId: chosenRow.run_id,
      hypothesisId: chosenRow.id,
      caseId,
      marketCode: chosenRow.market_code,
      platformCode: chosenRow.platform_code,
      currency: chosenRow.currency,
    },
    hypothesis: {
      concept: mappedHyp.concept,
      targetUser: mappedHyp.targetUser,
      painPoint: mappedHyp.painPoint,
      differentiator: mappedHyp.differentiator,
      recommendedPriceCents: mappedHyp.recommendedPriceCents,
      confirmedPriceCents: mappedHyp.confirmedPriceCents,
      expectedMarginRate: mappedHyp.expectedMarginRate,
      bestQuoteLandedCostCents: bestQuote?.landedCostCents ?? null,
      bestQuoteId: bestQuote?.id ?? null,
    },
  });

  return { status: "ok", benchmark, candidates };
}

/**
 * 将入口 B（浏览器扩展 / 竞品对比研报）的真实扫描结果一键写入候选批次：
 * - 自动写入去重后的真实竞品快照（补齐 brand / is_sponsored / bought_past_month）
 * - 若包含真实采集差评，同步写入 review_insights
 * - 若尚未确认售价且研报有真实 P50，自动带入 confirmed_price_cents
 */
export async function attachComparisonReportToHypothesis(input: {
  hypothesisId: string;
  reportId: string;
  actor?: string;
}) {
  const db = await getDb();
  const context = await loadHypothesisContext(input.hypothesisId);
  if (!context) throw new Error("候选方向不存在");

  const report = await getComparisonReportById(input.reportId);
  if (!report) throw new Error("未找到对应的竞品扫描研报");

  const actor = (input.actor ?? "").trim() || "运营人员";
  if (!context.hypothesis.selectedForValidation) {
    await selectHypothesisForValidation(input.hypothesisId, actor);
  }

  const existingRows = await db.query<{ asin: string | null; source_url: string }>(
    "SELECT asin, source_url FROM competitor_snapshots WHERE hypothesis_id = $1",
    [input.hypothesisId],
  );
  const existingAsins = new Set(
    existingRows.rows.map((r) => (r.asin || "").trim().toUpperCase()).filter(Boolean),
  );
  const existingUrls = new Set(existingRows.rows.map((r) => r.source_url.trim().toLowerCase()));

  const observedAt = normalizeObservedAt(report.createdAt || new Date().toISOString());
  const sourceType = report.provenance === "captured" ? "browser_extension" : "manual_verified";

  let addedCompetitors = 0;
  let addedReviewSamples = 0;

  await db.transaction(async (tx) => {
    for (const item of report.competitors) {
      const effectivePrice =
        typeof item.effectivePriceCents === "number" && item.effectivePriceCents > 0
          ? item.effectivePriceCents
          : item.priceCents;
      if (!effectivePrice || effectivePrice <= 0) continue;

      const asin = (item.asin || "").trim().toUpperCase();
      const sourceUrl =
        item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl)
          ? item.sourceUrl
          : asin
            ? `https://www.amazon.com/dp/${asin}`
            : "https://www.amazon.com/";

      const isDup = (asin && existingAsins.has(asin)) || existingUrls.has(sourceUrl.toLowerCase());
      if (!isDup) {
        const evidenceId = randomUUID();
        const title = (item.title || asin || "未命名竞品").trim().slice(0, 240);
        const rating =
          isVerifiedCompetitorField(item, "rating") && item.rating > 0 ? item.rating : null;
        const reviewCount =
          isVerifiedCompetitorField(item, "reviewCount") && item.reviewCount >= 0
            ? Math.round(item.reviewCount)
            : Math.max(0, Math.round(item.reviewCount || 0));
        const bsr = isVerifiedCompetitorField(item, "bsr") && item.bsr > 0 ? Math.round(item.bsr) : null;
        const bought =
          typeof item.boughtPastMonth === "number" && item.boughtPastMonth > 0
            ? Math.round(item.boughtPastMonth)
            : null;

        await tx.query(
          `INSERT INTO opportunity_evidence
            (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
           VALUES ($1, $2, 'competitor_snapshot', $3, $4, $5, $6, $7, $8::jsonb, $9)`,
          [
            evidenceId,
            input.hypothesisId,
            sourceType,
            sourceUrl,
            title,
            `扫描导入竞品（${report.title}）：${title}`.slice(0, 1500),
            observedAt,
            JSON.stringify({
              reportId: report.id,
              asin: asin || null,
              brand: item.brand || null,
              priceCents: effectivePrice,
              isSponsored: Boolean(item.isSponsored),
              boughtPastMonth: bought,
            }),
            actor,
          ],
        );
        await tx.query(
          `INSERT INTO competitor_snapshots
            (id, hypothesis_id, evidence_id, asin, title, source_url, price_cents, rating, review_count, bsr,
             monthly_sales_min, brand, is_sponsored, bought_past_month, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            randomUUID(),
            input.hypothesisId,
            evidenceId,
            asin || null,
            title,
            sourceUrl,
            Math.round(effectivePrice),
            rating,
            reviewCount,
            bsr,
            bought,
            item.brand?.trim().slice(0, 120) || null,
            Boolean(item.isSponsored),
            bought,
            observedAt,
          ],
        );
        if (asin) existingAsins.add(asin);
        existingUrls.add(sourceUrl.toLowerCase());
        addedCompetitors += 1;
      }

      // 若该竞品含真实采集到的差评文本，同步落入 review_insights
      const reviews = Array.isArray(item.capturedReviews)
        ? item.capturedReviews.map((s) => s.trim()).filter((s) => s.length >= 10)
        : [];
      if (reviews.length > 0) {
        const revEvidenceId = randomUUID();
        const theme = `${asin || item.brand || "竞品"} 买家差评实采`.slice(0, 180);
        await tx.query(
          `INSERT INTO opportunity_evidence
            (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
           VALUES ($1, $2, 'review_insight', $3, $4, $5, $6, $7, $8::jsonb, $9)`,
          [
            revEvidenceId,
            input.hypothesisId,
            sourceType,
            sourceUrl,
            theme,
            reviews.slice(0, 3).join(" | ").slice(0, 1500),
            observedAt,
            JSON.stringify({ reportId: report.id, reviewSampleSize: reviews.length }),
            actor,
          ],
        );
        await tx.query(
          `INSERT INTO review_insights
            (id, hypothesis_id, evidence_id, theme, sentiment, sample_size, representative_quote)
           VALUES ($1, $2, $3, $4, 'negative', $5, $6)`,
          [randomUUID(), input.hypothesisId, revEvidenceId, theme, reviews.length, reviews[0]!.slice(0, 500)],
        );
        addedReviewSamples += reviews.length;
      }
    }

    // 绑定研报，并在未确认售价时自动用真实 P50 预填确认售价
    const autoPriceCents =
      !context.hypothesis.confirmedPriceCents && report.priceStats.p50 > 0
        ? Math.round(report.priceStats.p50)
        : null;
    const priceSourceUrl =
      report.competitors[0]?.sourceUrl && /^https?:\/\//i.test(report.competitors[0].sourceUrl)
        ? report.competitors[0].sourceUrl
        : "https://www.amazon.com/";

    if (autoPriceCents) {
      await tx.query(
        `UPDATE opportunity_hypotheses
         SET comparison_report_id = $2,
             confirmed_price_cents = $3,
             confirmed_price_source_url = $4,
             confirmed_price_at = NOW()
         WHERE id = $1`,
        [input.hypothesisId, report.id, autoPriceCents, priceSourceUrl],
      );
    } else {
      await tx.query(
        "UPDATE opportunity_hypotheses SET comparison_report_id = $2 WHERE id = $1",
        [input.hypothesisId, report.id],
      );
    }

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.scan_report_attached', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({
          reportId: report.id,
          reportTitle: report.title,
          addedCompetitors,
          addedReviewSamples,
          autoPriceCents,
        }),
      ],
    );
  });

  const decision = await refreshAISelectionDecision(input.hypothesisId);
  return {
    runId: context.hypothesis.runId,
    addedCompetitors,
    addedReviewSamples,
    p50PriceCents: report.priceStats.p50 || null,
    decision,
  };
}


