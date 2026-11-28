import fs from "node:fs/promises";
import { getAppMode, isDemoMode, type AppMode } from "../app-mode.ts";
import { getDb } from "../db.ts";
import {
  COMPETITOR_NUMERIC_FIELDS,
  isVerifiedCompetitorField,
  MAX_COMPARISON_REPORTS,
  type CompetitorComparisonReport,
  type CompetitorProfile,
  type CompetitorProvenance,
  type CompetitorReviewStatus,
  type SnapshotDiff,
} from "./types.ts";

import { getRuntimeDataPath } from "../runtime-paths.ts";

const LEGACY_STORAGE_FILE = getRuntimeDataPath("competitor-comparisons.json");

export { MAX_COMPARISON_REPORTS };

const PROVENANCES: CompetitorProvenance[] = [
  "captured", "manual", "ai_generated", "template", "demo", "unknown",
];

let competitorTableReadyPromise: Promise<void> | null = null;

/** 兼容改造前落盘的历史研报：缺失来源信息一律按「来源未知 · 待核实」处理 */
function normalizeReport(raw: unknown): CompetitorComparisonReport | null {
  if (!raw || typeof raw !== "object") return null;
  const report = raw as Partial<CompetitorComparisonReport>;
  if (typeof report.id !== "string" || !Array.isArray(report.competitors)) return null;

  const provenance = typeof report.provenance === "string" && PROVENANCES.includes(report.provenance as CompetitorProvenance)
    ? report.provenance as CompetitorProvenance
    : "unknown";
  const reviewStatus: CompetitorReviewStatus = report.reviewStatus === "confirmed" ? "confirmed" : "pending";

  const competitors: CompetitorProfile[] = report.competitors.map((item) => {
    const profile = item as CompetitorProfile;
    if (profile.fieldProvenance) return profile;
    const fieldProvenance: NonNullable<CompetitorProfile["fieldProvenance"]> = {};
    for (const field of COMPETITOR_NUMERIC_FIELDS) fieldProvenance[field] = "unknown";
    return { ...profile, fieldProvenance };
  });

  const stats = report.priceStats;
  return {
    ...(report as CompetitorComparisonReport),
    provenance,
    reviewStatus,
    competitors,
    priceStats: stats
      ? { ...stats, verifiedSampleCount: Number.isFinite(stats.verifiedSampleCount) ? stats.verifiedSampleCount : 0 }
      : { min: 0, p25: 0, p50: 0, p75: 0, p90: 0, max: 0, currency: report.currency || "USD", verifiedSampleCount: 0 },
  };
}

async function migrateLegacyJsonIfNeeded(): Promise<void> {
  if (!competitorTableReadyPromise) {
    competitorTableReadyPromise = (async () => {
      const db = await getDb();
      try {
        const raw = await fs.readFile(LEGACY_STORAGE_FILE, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const normalized = normalizeReport(item);
            if (!normalized) continue;
            await db.query(
              `INSERT INTO competitor_comparison_reports (id, market_code, platform_code, provenance, review_status, payload, created_at, updated_at, is_demo)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, NOW()), NOW(), $8)
               ON CONFLICT (id) DO NOTHING`,
              [
                normalized.id,
                (normalized.marketCode || "US").toUpperCase(),
                (normalized.platformCode || "amazon").toLowerCase(),
                normalized.provenance,
                normalized.reviewStatus,
                JSON.stringify(normalized),
                normalized.createdAt || null,
                normalized.provenance === "demo",
              ],
            );
          }
        }
      } catch {
        // 无历史文件时静默忽略
      }
    })().catch((err) => {
      competitorTableReadyPromise = null;
      throw err;
    });
  }
  await competitorTableReadyPromise;
}

function reportFingerprint(report: CompetitorComparisonReport): string {
  const asins = (report.competitors || [])
    .map((c) => (c.asin || "").trim().toUpperCase())
    .filter(Boolean)
    .sort();
  const market = (report.marketCode || "US").toUpperCase();
  const platform = (report.platformCode || "amazon").toLowerCase();
  if (asins.length > 0) {
    return `${market}:${platform}:${asins.join(",")}`;
  }
  return `${market}:${platform}:title:${(report.title || "").trim().toLowerCase()}`;
}

async function readAllReports(demo: boolean): Promise<CompetitorComparisonReport[]> {
  await migrateLegacyJsonIfNeeded();
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload
     FROM competitor_comparison_reports
     WHERE is_demo = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [demo, MAX_COMPARISON_REPORTS],
  );
  const seenFingerprints = new Set<string>();
  const deduped: CompetitorComparisonReport[] = [];
  for (const row of res.rows) {
    const normalized = normalizeReport(row.payload);
    if (!normalized) continue;
    const fp = reportFingerprint(normalized);
    if (seenFingerprints.has(fp)) continue;
    seenFingerprints.add(fp);
    deduped.push(normalized);
  }
  return deduped;
}

export async function getComparisonReports(options?: { mode?: AppMode }): Promise<CompetitorComparisonReport[]> {
  const mode = options?.mode ?? await getAppMode();
  return readAllReports(isDemoMode(mode));
}

export async function getComparisonReportById(id: string, options?: { mode?: AppMode }): Promise<CompetitorComparisonReport | null> {
  await migrateLegacyJsonIfNeeded();
  const db = await getDb();
  const mode = options?.mode ?? await getAppMode();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload
     FROM competitor_comparison_reports
     WHERE id = $1 AND is_demo = $2
     LIMIT 1`,
    [id, isDemoMode(mode)],
  );
  const report = res.rows[0] ? normalizeReport(res.rows[0].payload) : null;
  return report;
}

function computeSnapshotDiff(
  prev: CompetitorComparisonReport,
  next: CompetitorComparisonReport,
): SnapshotDiff | null {
  const prevByAsin = new Map(prev.competitors.map((c) => [c.asin.toUpperCase(), c]));
  const nextByAsin = new Map(next.competitors.map((c) => [c.asin.toUpperCase(), c]));

  const newAsins: string[] = [];
  const droppedAsins: string[] = [];
  const reviewSurges: SnapshotDiff["reviewSurges"] = [];

  for (const [asin, curr] of nextByAsin) {
    const old = prevByAsin.get(asin);
    if (!old) {
      newAsins.push(asin);
      continue;
    }
    if (
      isVerifiedCompetitorField(old, "reviewCount")
      && isVerifiedCompetitorField(curr, "reviewCount")
      && curr.reviewCount > old.reviewCount
    ) {
      const delta = curr.reviewCount - old.reviewCount;
      if (delta >= 20) {
        reviewSurges.push({ asin, title: curr.title.slice(0, 48), deltaReviews: delta });
      }
    }
  }
  for (const asin of prevByAsin.keys()) {
    if (!nextByAsin.has(asin)) droppedAsins.push(asin);
  }
  reviewSurges.sort((a, b) => b.deltaReviews - a.deltaReviews);

  const avgVerifiedPrice = (r: CompetitorComparisonReport): number | null => {
    const vals = r.competitors
      .filter((c) => isVerifiedCompetitorField(c, "priceCents"))
      .map((c) => (c.effectivePriceCents && c.effectivePriceCents > 0 ? c.effectivePriceCents : c.priceCents))
      .filter((n) => n > 0);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const prevAvg = avgVerifiedPrice(prev);
  const nextAvg = avgVerifiedPrice(next);
  const avgPriceDeltaPercent = prevAvg && nextAvg
    ? Number((((nextAvg - prevAvg) / prevAvg) * 100).toFixed(1))
    : null;
  const p50PriceDeltaCents = prev.priceStats?.p50 > 0 && next.priceStats?.p50 > 0
    ? next.priceStats.p50 - prev.priceStats.p50
    : null;

  const alerts: string[] = [];
  if (avgPriceDeltaPercent !== null && avgPriceDeltaPercent <= -8) {
    alerts.push(`均价较上次快照下跌 ${Math.abs(avgPriceDeltaPercent)}%，警惕进入价格战！`);
  } else if (avgPriceDeltaPercent !== null && avgPriceDeltaPercent >= 8) {
    alerts.push(`均价较上次快照上涨 +${avgPriceDeltaPercent}%，品类存在提价空间。`);
  }
  if (newAsins.length > 0) {
    alerts.push(`首页新进场 ${newAsins.length} 款竞品（${newAsins.slice(0, 3).join(", ")}）`);
  }
  if (reviewSurges.length > 0) {
    const top = reviewSurges[0]!;
    alerts.push(`评论增速最快：${top.asin} (+${top.deltaReviews} 评)`);
  }

  // 如果没有任何可观测变化，返回 null 避免噪音
  if (
    alerts.length === 0
    && newAsins.length === 0
    && droppedAsins.length === 0
    && reviewSurges.length === 0
    && (avgPriceDeltaPercent === null || avgPriceDeltaPercent === 0)
  ) {
    return null;
  }

  return {
    previousReportId: prev.id,
    previousCapturedAt: prev.createdAt,
    avgPriceDeltaPercent,
    p50PriceDeltaCents,
    newAsins,
    droppedAsins,
    reviewSurges: reviewSurges.slice(0, 5),
    alerts,
  };
}

function asinOverlapRatio(a: CompetitorComparisonReport, b: CompetitorComparisonReport): number {
  const setA = new Set(a.competitors.map((c) => c.asin.toUpperCase()).filter(Boolean));
  const setB = new Set(b.competitors.map((c) => c.asin.toUpperCase()).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const x of setA) {
    if (setB.has(x)) shared += 1;
  }
  return shared / Math.min(setA.size, setB.size);
}

export async function saveComparisonReport(
  report: CompetitorComparisonReport,
  options?: { mode?: AppMode },
): Promise<void> {
  await migrateLegacyJsonIfNeeded();
  const db = await getDb();
  const mode = options?.mode ?? await getAppMode();
  const demo = isDemoMode(mode);
  // 自动清理同站点 + 相同 ASIN 集合的历史重复研报，并在覆盖前计算 Snapshot Diff 预警
  const targetFp = reportFingerprint(report);
  const existing = await db.query<{ id: string; payload: unknown }>(
    `SELECT id, payload
     FROM competitor_comparison_reports
     WHERE market_code = $1 AND platform_code = $2 AND is_demo = $3
     ORDER BY created_at DESC`,
    [(report.marketCode || "US").toUpperCase(), (report.platformCode || "amazon").toLowerCase(), demo],
  );
  let matchedPrevForDiff: CompetitorComparisonReport | null = null;
  for (const row of existing.rows) {
    if (row.id === report.id) continue;
    const prev = normalizeReport(row.payload);
    if (!prev) continue;
    const sameFp = reportFingerprint(prev) === targetFp;
    if (!matchedPrevForDiff && (sameFp || asinOverlapRatio(prev, report) >= 0.4)) {
      matchedPrevForDiff = prev;
    }
    if (!prev.promotedCaseId && sameFp) {
      await db.query(
        `DELETE FROM competitor_comparison_reports WHERE id = $1 AND is_demo = $2`,
        [row.id, demo],
      );
    }
  }
  const reportToSave: CompetitorComparisonReport = !report.snapshotDiff && matchedPrevForDiff
    ? { ...report, snapshotDiff: computeSnapshotDiff(matchedPrevForDiff, report) }
    : report;

  const saved = await db.query<{ id: string }>(
    `INSERT INTO competitor_comparison_reports (id, market_code, platform_code, provenance, review_status, payload, created_at, updated_at, is_demo)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, NOW()), NOW(), $8)
     ON CONFLICT (id) DO UPDATE SET
       market_code = EXCLUDED.market_code,
       platform_code = EXCLUDED.platform_code,
       provenance = EXCLUDED.provenance,
       review_status = EXCLUDED.review_status,
       payload = EXCLUDED.payload,
       updated_at = NOW()
     WHERE competitor_comparison_reports.is_demo = EXCLUDED.is_demo
     RETURNING id`,
    [
      reportToSave.id,
      (reportToSave.marketCode || "US").toUpperCase(),
      (reportToSave.platformCode || "amazon").toLowerCase(),
      reportToSave.provenance || "unknown",
      reportToSave.reviewStatus || "pending",
      JSON.stringify(reportToSave),
      reportToSave.createdAt || null,
      demo,
    ],
  );
  if (!saved.rows[0]) throw new Error("研报 ID 已被另一模式占用，请重新生成研报");
}

export async function deleteComparisonReport(id: string, options?: { mode?: AppMode }): Promise<void> {
  await migrateLegacyJsonIfNeeded();
  const db = await getDb();
  const mode = options?.mode ?? await getAppMode();
  await db.query(
    `DELETE FROM competitor_comparison_reports WHERE id = $1 AND is_demo = $2`,
    [id, isDemoMode(mode)],
  );
}

/** 人工确认后才允许把研报内容写入商品草稿或转入选品池；演示模式可显式放宽样本门禁。 */
export async function confirmComparisonReport(
  id: string,
  options?: { allowUnverified?: boolean; mode?: AppMode },
): Promise<CompetitorComparisonReport | null> {
  const mode = options?.mode ?? await getAppMode();
  const target = await getComparisonReportById(id, { mode });
  if (!target) return null;

  const verifiedCount = target.priceStats?.verifiedSampleCount ?? 0;
  const hasManualField = target.competitors?.some((c) =>
    Object.values(c.fieldProvenance || {}).some((p) => p === "captured" || p === "manual"),
  );
  if (!options?.allowUnverified && verifiedCount === 0 && !hasManualField && target.provenance === "ai_generated") {
    throw new Error("研报缺少至少 1 条真实抓取/人工校验的价格样本，无法确认！请先输入真实价格数据。");
  }

  const updated: CompetitorComparisonReport = { ...target, reviewStatus: "confirmed" };
  await saveComparisonReport(updated, { mode });
  return updated;
}
