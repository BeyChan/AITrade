import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "../db.ts";
import {
  COMPETITOR_NUMERIC_FIELDS,
  MAX_COMPARISON_REPORTS,
  type CompetitorComparisonReport,
  type CompetitorProfile,
  type CompetitorProvenance,
  type CompetitorReviewStatus,
} from "./types.ts";

const DATA_DIR = path.join(process.cwd(), ".data");
const LEGACY_STORAGE_FILE = path.join(DATA_DIR, "competitor-comparisons.json");

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
      await db.exec(`
        CREATE TABLE IF NOT EXISTS competitor_comparison_reports (
          id TEXT PRIMARY KEY,
          market_code TEXT NOT NULL DEFAULT 'US',
          platform_code TEXT NOT NULL DEFAULT 'amazon',
          provenance TEXT NOT NULL DEFAULT 'unknown',
          review_status TEXT NOT NULL DEFAULT 'pending',
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_competitor_comparison_reports_site
          ON competitor_comparison_reports(market_code, platform_code, created_at DESC);
      `);
      try {
        const raw = await fs.readFile(LEGACY_STORAGE_FILE, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const normalized = normalizeReport(item);
            if (!normalized) continue;
            await db.query(
              `INSERT INTO competitor_comparison_reports (id, market_code, platform_code, provenance, review_status, payload, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, NOW()), NOW())
               ON CONFLICT (id) DO NOTHING`,
              [
                normalized.id,
                (normalized.marketCode || "US").toUpperCase(),
                (normalized.platformCode || "amazon").toLowerCase(),
                normalized.provenance,
                normalized.reviewStatus,
                JSON.stringify(normalized),
                normalized.createdAt || null,
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

async function readAllReports(): Promise<CompetitorComparisonReport[]> {
  await migrateLegacyJsonIfNeeded();
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM competitor_comparison_reports ORDER BY created_at DESC LIMIT $1`,
    [MAX_COMPARISON_REPORTS],
  );
  return res.rows
    .map((row) => normalizeReport(row.payload))
    .filter((r): r is CompetitorComparisonReport => r !== null);
}

export async function getComparisonReports(options?: { mode?: "sandbox" | "live" }): Promise<CompetitorComparisonReport[]> {
  const all = await readAllReports();
  let mode = options?.mode;
  if (!mode) {
    try {
      const { getAppMode } = await import("@/lib/app-mode");
      mode = await getAppMode();
    } catch {
      mode = "sandbox";
    }
  }
  if (mode === "live") {
    return all.filter((r) => r.provenance !== "demo");
  }
  return all;
}

export async function getComparisonReportById(id: string, options?: { mode?: "sandbox" | "live" }): Promise<CompetitorComparisonReport | null> {
  await migrateLegacyJsonIfNeeded();
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM competitor_comparison_reports WHERE id = $1 LIMIT 1`,
    [id],
  );
  const report = res.rows[0] ? normalizeReport(res.rows[0].payload) : null;
  if (!report) return null;
  let mode = options?.mode;
  if (!mode) {
    try {
      const { getAppMode } = await import("@/lib/app-mode");
      mode = await getAppMode();
    } catch {
      mode = "sandbox";
    }
  }
  if (mode === "live" && report.provenance === "demo") return null;
  return report;
}

export async function saveComparisonReport(report: CompetitorComparisonReport): Promise<void> {
  await migrateLegacyJsonIfNeeded();
  const db = await getDb();
  await db.query(
    `INSERT INTO competitor_comparison_reports (id, market_code, platform_code, provenance, review_status, payload, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, NOW()), NOW())
     ON CONFLICT (id) DO UPDATE SET
       market_code = EXCLUDED.market_code,
       platform_code = EXCLUDED.platform_code,
       provenance = EXCLUDED.provenance,
       review_status = EXCLUDED.review_status,
       payload = EXCLUDED.payload,
       updated_at = NOW()`,
    [
      report.id,
      (report.marketCode || "US").toUpperCase(),
      (report.platformCode || "amazon").toLowerCase(),
      report.provenance || "unknown",
      report.reviewStatus || "pending",
      JSON.stringify(report),
      report.createdAt || null,
    ],
  );
}

export async function deleteComparisonReport(id: string): Promise<void> {
  await migrateLegacyJsonIfNeeded();
  const db = await getDb();
  await db.query(`DELETE FROM competitor_comparison_reports WHERE id = $1`, [id]);
}

/** 人工确认后才允许把研报内容写入商品草稿或转入选品池 */
export async function confirmComparisonReport(id: string): Promise<CompetitorComparisonReport | null> {
  const target = await getComparisonReportById(id, { mode: "sandbox" });
  if (!target) return null;

  const verifiedCount = target.priceStats?.verifiedSampleCount ?? 0;
  const hasManualField = target.competitors?.some((c) =>
    Object.values(c.fieldProvenance || {}).some((p) => p === "captured" || p === "manual"),
  );
  if (verifiedCount === 0 && !hasManualField && target.provenance === "ai_generated") {
    throw new Error("研报缺少至少 1 条真实抓取/人工校验的价格样本，无法确认！请先输入真实价格数据。");
  }

  const updated: CompetitorComparisonReport = { ...target, reviewStatus: "confirmed" };
  await saveComparisonReport(updated);
  return updated;
}

/** 标记竞品研报已正式立项，防止重复创建案卷并实现业务流转闭环 */
export async function markComparisonReportPromoted(id: string, caseId: string): Promise<void> {
  const target = await getComparisonReportById(id, { mode: "sandbox" });
  if (!target) return;
  await saveComparisonReport({
    ...target,
    promotedCaseId: caseId,
    promotedAt: new Date().toISOString(),
  });
}
