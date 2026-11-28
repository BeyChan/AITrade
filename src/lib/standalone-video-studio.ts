import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAppMode, isDemoMode, type AppMode, type ModeOptions } from "./app-mode.ts";
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

async function ensureStudioVideoReady(mode: AppMode): Promise<void> {
  // 历史 JSON 没有可靠的模式字段，只能作为演示素材导入，绝不能复制到真实空间。
  if (!isDemoMode(mode)) return;
  if (!studioVideoReadyPromise) {
    studioVideoReadyPromise = (async () => {
      const db = await getDb();

      try {
        const raw = await readFile(LEGACY_MANIFEST_PATH, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          await db.transaction(async (tx) => {
            for (const item of parsed) {
              if (!item || typeof item !== "object" || typeof (item as StandaloneVideoAsset).id !== "string") continue;
              const rec = item as StandaloneVideoAsset;
              const caseIds = [...new Set((rec.boundCases ?? []).map((bound) => bound.caseId).filter(Boolean))];
              let boundCases = rec.boundCases;
              if (caseIds.length > 0) {
                const validCases = await tx.query<{ id: string }>(
                  `SELECT id FROM product_cases WHERE id = ANY($1::text[]) AND is_demo = TRUE`,
                  [caseIds],
                );
                const validCaseIds = new Set(validCases.rows.map((row) => row.id));
                boundCases = rec.boundCases?.filter((bound) => validCaseIds.has(bound.caseId));
              }
              const sanitized = { ...rec, boundCases };
              const firstCaseId = boundCases?.[0]?.caseId ?? null;
              await tx.query(
                `INSERT INTO studio_media_assets (id, media_kind, case_id, product_name, marketplace, payload, created_at, is_demo)
                 VALUES ($1, 'video', (SELECT id FROM product_cases WHERE id = $2 AND is_demo = $6 LIMIT 1), $3, 'US', $4::jsonb, COALESCE($5::timestamptz, NOW()), $6)
                 ON CONFLICT (id) DO NOTHING`,
                [
                  rec.id,
                  firstCaseId,
                  rec.productName || "",
                  JSON.stringify(sanitized),
                  rec.createdAt || null,
                  true,
                ],
              );
            }
          });
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

export async function listStandaloneVideoAssets(options?: ModeOptions): Promise<StandaloneVideoAsset[]> {
  const mode = options?.mode ?? (await getAppMode());
  await ensureStudioVideoReady(mode);
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM studio_media_assets
     WHERE media_kind = 'video' AND is_demo = $2
     ORDER BY created_at DESC LIMIT $1`,
    [MAX_STANDALONE_VIDEOS, isDemoMode(mode)],
  );
  return res.rows
    .map((r) => r.payload as StandaloneVideoAsset)
    .filter((item): item is StandaloneVideoAsset => Boolean(item && typeof item.id === "string"));
}

export async function getStandaloneVideoAsset(
  id: string,
  options?: ModeOptions,
): Promise<StandaloneVideoAsset | null> {
  const mode = options?.mode ?? (await getAppMode());
  await ensureStudioVideoReady(mode);
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM studio_media_assets
     WHERE id = $1 AND media_kind = 'video' AND is_demo = $2
     LIMIT 1`,
    [id, isDemoMode(mode)],
  );
  return (res.rows[0]?.payload as StandaloneVideoAsset | undefined) ?? null;
}

async function assertVideoBoundCasesInMode(
  boundCases: StudioBoundCaseRef[] | undefined,
  isDemo: boolean,
): Promise<void> {
  const caseIds = [...new Set((boundCases ?? []).map((item) => item.caseId).filter(Boolean))];
  if (caseIds.length === 0) return;
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `SELECT id FROM product_cases WHERE id = ANY($1::text[]) AND is_demo = $2`,
    [caseIds, isDemo],
  );
  if (res.rows.length !== caseIds.length) throw new Error("绑定案卷不存在");
}

export async function saveStandaloneVideoAsset(
  record: StandaloneVideoAsset,
  options?: ModeOptions,
): Promise<void> {
  const mode = options?.mode ?? (await getAppMode());
  await ensureStudioVideoReady(mode);
  const db = await getDb();
  const demo = isDemoMode(mode);
  await assertVideoBoundCasesInMode(record.boundCases, demo);
  const firstCaseId = record.boundCases?.[0]?.caseId ?? null;
  const saved = await db.query<{ id: string }>(
    `INSERT INTO studio_media_assets (id, media_kind, case_id, product_name, marketplace, payload, created_at, is_demo)
     VALUES ($1, 'video', (SELECT id FROM product_cases WHERE id = $2 AND is_demo = $6 LIMIT 1), $3, 'US', $4::jsonb, COALESCE($5::timestamptz, NOW()), $6)
     ON CONFLICT (id) DO UPDATE SET
       case_id = EXCLUDED.case_id,
       product_name = EXCLUDED.product_name,
       payload = EXCLUDED.payload
     WHERE studio_media_assets.is_demo = EXCLUDED.is_demo
     RETURNING id`,
    [
      record.id,
      firstCaseId,
      record.productName || "",
      JSON.stringify(record),
      record.createdAt || null,
      demo,
    ],
  );
  if (!saved.rows[0]) throw new Error("素材不存在");
}

export async function deleteStandaloneVideoAsset(
  id: string,
  options?: ModeOptions,
): Promise<StandaloneVideoAsset | null> {
  const mode = options?.mode ?? (await getAppMode());
  const target = await getStandaloneVideoAsset(id, { mode });
  if (!target) return null;
  const db = await getDb();
  await db.query(
    `DELETE FROM studio_media_assets WHERE id = $1 AND media_kind = 'video' AND is_demo = $2`,
    [id, isDemoMode(mode)],
  );
  return target;
}

export async function markStandaloneVideoBound(
  id: string,
  ref: { caseId: string; caseTitle: string },
  options?: ModeOptions,
): Promise<void> {
  const mode = options?.mode ?? (await getAppMode());
  const demo = isDemoMode(mode);
  await assertVideoBoundCasesInMode([{ ...ref, boundAt: new Date().toISOString() }], demo);
  const existing = await getStandaloneVideoAsset(id, { mode });
  if (!existing) return;
  const current = Array.isArray(existing.boundCases) ? existing.boundCases : [];
  if (current.some((c) => c.caseId === ref.caseId)) return;
  const next: StandaloneVideoAsset = {
    ...existing,
    boundCases: [...current, { caseId: ref.caseId, caseTitle: ref.caseTitle, boundAt: new Date().toISOString() }],
  };
  await saveStandaloneVideoAsset(next, { mode });
}
