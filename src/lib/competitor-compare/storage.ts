import fs from "node:fs/promises";
import path from "node:path";
import type { CompetitorComparisonReport } from "./types.ts";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORAGE_FILE = path.join(DATA_DIR, "competitor-comparisons.json");

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // directory exists
  }
}

export async function getComparisonReports(): Promise<CompetitorComparisonReport[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getComparisonReportById(id: string): Promise<CompetitorComparisonReport | null> {
  const reports = await getComparisonReports();
  return reports.find((r) => r.id === id) || null;
}

export async function saveComparisonReport(report: CompetitorComparisonReport): Promise<void> {
  await ensureDataDir();
  const reports = await getComparisonReports();
  // Filter out existing one with same ID
  const filtered = reports.filter((r) => r.id !== report.id);
  // Keep newest first, max 30 items
  const updated = [report, ...filtered].slice(0, 30);
  await fs.writeFile(STORAGE_FILE, JSON.stringify(updated, null, 2), "utf-8");
}

export async function deleteComparisonReport(id: string): Promise<void> {
  await ensureDataDir();
  const reports = await getComparisonReports();
  const filtered = reports.filter((r) => r.id !== id);
  await fs.writeFile(STORAGE_FILE, JSON.stringify(filtered, null, 2), "utf-8");
}
