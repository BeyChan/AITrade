import fs from "node:fs/promises";
import path from "node:path";
import {
  COMPETITOR_NUMERIC_FIELDS,
  MAX_COMPARISON_REPORTS,
  type CompetitorComparisonReport,
  type CompetitorProfile,
  type CompetitorProvenance,
  type CompetitorReviewStatus,
} from "./types.ts";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORAGE_FILE = path.join(DATA_DIR, "competitor-comparisons.json");

export { MAX_COMPARISON_REPORTS };

const PROVENANCES: CompetitorProvenance[] = [
  "captured", "manual", "ai_generated", "template", "demo", "unknown",
];

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

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

/** 同一进程内串行化所有读-改-写，避免并发请求互相覆盖 */
let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.catch(() => undefined);
  return result;
}

async function writeReports(reports: CompetitorComparisonReport[]): Promise<void> {
  await ensureDataDir();
  const tmp = `${STORAGE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(reports, null, 2), "utf-8");
  await fs.rename(tmp, STORAGE_FILE);
}

export async function getComparisonReports(): Promise<CompetitorComparisonReport[]> {
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeReport).filter((r): r is CompetitorComparisonReport => r !== null);
  } catch {
    return [];
  }
}

export async function getComparisonReportById(id: string): Promise<CompetitorComparisonReport | null> {
  const reports = await getComparisonReports();
  return reports.find((r) => r.id === id) || null;
}

export async function saveComparisonReport(report: CompetitorComparisonReport): Promise<void> {
  return serialized(async () => {
    const reports = await getComparisonReports();
    const filtered = reports.filter((r) => r.id !== report.id);
    await writeReports([report, ...filtered].slice(0, MAX_COMPARISON_REPORTS));
  });
}

export async function deleteComparisonReport(id: string): Promise<void> {
  return serialized(async () => {
    const reports = await getComparisonReports();
    await writeReports(reports.filter((r) => r.id !== id));
  });
}

/** 人工确认后才允许把研报内容写入商品草稿或转入选品池 */
export async function confirmComparisonReport(id: string): Promise<CompetitorComparisonReport | null> {
  return serialized(async () => {
    const reports = await getComparisonReports();
    const target = reports.find((r) => r.id === id);
    if (!target) return null;
    const updated: CompetitorComparisonReport = { ...target, reviewStatus: "confirmed" };
    await writeReports(reports.map((r) => (r.id === id ? updated : r)));
    return updated;
  });
}
