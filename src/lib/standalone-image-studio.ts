import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.ts";
import type { ImageAspectRatio, ImageAssetSlot } from "./image-skills.ts";

const MAX_STANDALONE_ASSETS = 500;
const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data");
const LEGACY_MANIFEST_PATH = path.join(DATA_DIR, "standalone-image-studio.json");

export type StudioBoundCaseRef = {
  caseId: string;
  caseTitle: string;
  boundAt: string;
};

export type StandaloneStudioAsset = {
  id: string;
  storageKey: string;
  fileUrl: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  slot: ImageAssetSlot;
  aspectRatio: ImageAspectRatio;
  skillId: string;
  skillName: string;
  provider: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  productName: string;
  marketplace: string;
  actor: string;
  parentAssetId?: string | null;
  boundCases?: StudioBoundCaseRef[];
  createdAt: string;
};

let studioImageReadyPromise: Promise<void> | null = null;

async function ensureStudioImageReady(): Promise<void> {
  if (!studioImageReadyPromise) {
    studioImageReadyPromise = (async () => {
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
            if (!item || typeof item !== "object" || typeof (item as StandaloneStudioAsset).id !== "string") continue;
            const rec = item as StandaloneStudioAsset;
            const firstCaseId = rec.boundCases?.[0]?.caseId ?? null;
            await db.query(
              `INSERT INTO studio_media_assets (id, media_kind, case_id, product_name, marketplace, payload, created_at)
               VALUES ($1, 'image', (SELECT id FROM product_cases WHERE id = $2 LIMIT 1), $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()))
               ON CONFLICT (id) DO NOTHING`,
              [
                rec.id,
                firstCaseId,
                rec.productName || "",
                rec.marketplace || "US",
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
      studioImageReadyPromise = null;
      throw err;
    });
  }
  await studioImageReadyPromise;
}

export async function listStandaloneStudioAssets(): Promise<StandaloneStudioAsset[]> {
  await ensureStudioImageReady();
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM studio_media_assets WHERE media_kind = 'image' ORDER BY created_at DESC LIMIT $1`,
    [MAX_STANDALONE_ASSETS],
  );
  return res.rows
    .map((r) => r.payload as StandaloneStudioAsset)
    .filter((item): item is StandaloneStudioAsset => Boolean(item && typeof item.id === "string"));
}

export async function getStandaloneStudioAsset(id: string): Promise<StandaloneStudioAsset | null> {
  await ensureStudioImageReady();
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM studio_media_assets WHERE id = $1 AND media_kind = 'image' LIMIT 1`,
    [id],
  );
  return (res.rows[0]?.payload as StandaloneStudioAsset | undefined) ?? null;
}

export async function saveStandaloneStudioAsset(record: StandaloneStudioAsset): Promise<void> {
  await ensureStudioImageReady();
  const db = await getDb();
  const firstCaseId = record.boundCases?.[0]?.caseId ?? null;
  await db.query(
    `INSERT INTO studio_media_assets (id, media_kind, case_id, product_name, marketplace, payload, created_at)
     VALUES ($1, 'image', (SELECT id FROM product_cases WHERE id = $2 LIMIT 1), $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()))
     ON CONFLICT (id) DO UPDATE SET
       case_id = EXCLUDED.case_id,
       product_name = EXCLUDED.product_name,
       marketplace = EXCLUDED.marketplace,
       payload = EXCLUDED.payload`,
    [
      record.id,
      firstCaseId,
      record.productName || "",
      record.marketplace || "US",
      JSON.stringify(record),
      record.createdAt || null,
    ],
  );
}

export async function deleteStandaloneStudioAsset(id: string): Promise<StandaloneStudioAsset | null> {
  const target = await getStandaloneStudioAsset(id);
  if (!target) return null;
  const db = await getDb();
  await db.query(`DELETE FROM studio_media_assets WHERE id = $1 AND media_kind = 'image'`, [id]);
  return target;
}

export async function markStandaloneImageBound(
  id: string,
  ref: { caseId: string; caseTitle: string },
): Promise<void> {
  const existing = await getStandaloneStudioAsset(id);
  if (!existing) return;
  const current = Array.isArray(existing.boundCases) ? existing.boundCases : [];
  if (current.some((c) => c.caseId === ref.caseId)) return;
  const next: StandaloneStudioAsset = {
    ...existing,
    boundCases: [...current, { caseId: ref.caseId, caseTitle: ref.caseTitle, boundAt: new Date().toISOString() }],
  };
  await saveStandaloneStudioAsset(next);
}
