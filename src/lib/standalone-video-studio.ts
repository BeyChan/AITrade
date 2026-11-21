import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.ts";
import type { StudioBoundCaseRef } from "./standalone-image-studio.ts";
import type { VideoAspectRatio, VideoDurationSec, VideoTemplateId } from "./video-provider.ts";

const MAX_STANDALONE_VIDEOS = 500;
const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data");
const LEGACY_MANIFEST_PATH = path.join(DATA_DIR, "standalone-video-studio.json");

export type StandaloneVideoAsset = {
  id: string;
  storageKey: string;
  fileUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  aspectRatio: VideoAspectRatio;
  durationSec: VideoDurationSec | number;
  templateId: VideoTemplateId | "stitched";
  provider: string;
  model: string;
  prompt: string;
  productName: string;
  actor: string;
  estimatedCostUsd: number;
  boundCases?: StudioBoundCaseRef[];
  createdAt: string;
};

let studioVideoReadyPromise: Promise<void> | null = null;

async function ensureStudioVideoReady(): Promise<void> {
  if (!studioVideoReadyPromise) {
    studioVideoReadyPromise = (async () => {
      const db = await getDb();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS studio_media_assets (
          id TEXT PRIMARY KEY,
          media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video')),
          case_id TEXT REFERENCES product_cases(id) ON DELETE SET NULL,
          product_name TEXT NOT NULL DEFAULT '',
          marketplace TEXT NOT NULL DEFAULT 'US',
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_studio_media_assets_kind_created
          ON studio_media_assets(media_kind, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_studio_media_assets_case
          ON studio_media_assets(case_id, created_at DESC);
      `);

      try {
        const raw = await readFile(LEGACY_MANIFEST_PATH, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (!item || typeof item !== "object" || typeof (item as StandaloneVideoAsset).id !== "string") continue;
            const rec = item as StandaloneVideoAsset;
            const firstCaseId = rec.boundCases?.[0]?.caseId ?? null;
            await db.query(
              `INSERT INTO studio_media_assets (id, media_kind, case_id, product_name, marketplace, payload, created_at)
               VALUES ($1, 'video', (SELECT id FROM product_cases WHERE id = $2 LIMIT 1), $3, 'US', $4::jsonb, COALESCE($5::timestamptz, NOW()))
               ON CONFLICT (id) DO NOTHING`,
              [
                rec.id,
                firstCaseId,
                rec.productName || "",
                JSON.stringify(rec),
                rec.createdAt || null,
              ],
            );
          }
        }
      } catch {
        // 无历史 JSON 文件时忽略
      }
    })().catch((err) => {
      studioVideoReadyPromise = null;
      throw err;
    });
  }
  await studioVideoReadyPromise;
}

export async function listStandaloneVideoAssets(): Promise<StandaloneVideoAsset[]> {
  await ensureStudioVideoReady();
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM studio_media_assets WHERE media_kind = 'video' ORDER BY created_at DESC LIMIT $1`,
    [MAX_STANDALONE_VIDEOS],
  );
  return res.rows
    .map((r) => r.payload as StandaloneVideoAsset)
    .filter((item): item is StandaloneVideoAsset => Boolean(item && typeof item.id === "string"));
}

export async function getStandaloneVideoAsset(id: string): Promise<StandaloneVideoAsset | null> {
  await ensureStudioVideoReady();
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM studio_media_assets WHERE id = $1 AND media_kind = 'video' LIMIT 1`,
    [id],
  );
  return (res.rows[0]?.payload as StandaloneVideoAsset | undefined) ?? null;
}

export async function saveStandaloneVideoAsset(record: StandaloneVideoAsset): Promise<void> {
  await ensureStudioVideoReady();
  const db = await getDb();
  const firstCaseId = record.boundCases?.[0]?.caseId ?? null;
  await db.query(
    `INSERT INTO studio_media_assets (id, media_kind, case_id, product_name, marketplace, payload, created_at)
     VALUES ($1, 'video', (SELECT id FROM product_cases WHERE id = $2 LIMIT 1), $3, 'US', $4::jsonb, COALESCE($5::timestamptz, NOW()))
     ON CONFLICT (id) DO UPDATE SET
       case_id = EXCLUDED.case_id,
       product_name = EXCLUDED.product_name,
       payload = EXCLUDED.payload`,
    [
      record.id,
      firstCaseId,
      record.productName || "",
      JSON.stringify(record),
      record.createdAt || null,
    ],
  );
}

export async function deleteStandaloneVideoAsset(id: string): Promise<StandaloneVideoAsset | null> {
  const target = await getStandaloneVideoAsset(id);
  if (!target) return null;
  const db = await getDb();
  await db.query(`DELETE FROM studio_media_assets WHERE id = $1 AND media_kind = 'video'`, [id]);
  return target;
}

export async function markStandaloneVideoBound(
  id: string,
  ref: { caseId: string; caseTitle: string },
): Promise<void> {
  const existing = await getStandaloneVideoAsset(id);
  if (!existing) return;
  const current = Array.isArray(existing.boundCases) ? existing.boundCases : [];
  if (current.some((c) => c.caseId === ref.caseId)) return;
  const next: StandaloneVideoAsset = {
    ...existing,
    boundCases: [...current, { caseId: ref.caseId, caseTitle: ref.caseTitle, boundAt: new Date().toISOString() }],
  };
  await saveStandaloneVideoAsset(next);
}
