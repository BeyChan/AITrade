import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAppMode, isDemoMode, type AppMode, type ModeOptions } from "./app-mode.ts";
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

async function ensureStudioImageReady(mode: AppMode): Promise<void> {
  // 历史 JSON 没有可靠的模式字段，只能作为演示素材导入，绝不能复制到真实空间。
  if (!isDemoMode(mode)) return;
  if (!studioImageReadyPromise) {
    studioImageReadyPromise = (async () => {
      const db = await getDb();

      try {
        const raw = await readFile(LEGACY_MANIFEST_PATH, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          await db.transaction(async (tx) => {
            for (const item of parsed) {
              if (!item || typeof item !== "object" || typeof (item as StandaloneStudioAsset).id !== "string") continue;
              const rec = item as StandaloneStudioAsset;
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
                 VALUES ($1, 'image', (SELECT id FROM product_cases WHERE id = $2 AND is_demo = $7 LIMIT 1), $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()), $7)
                 ON CONFLICT (id) DO NOTHING`,
                [
                  rec.id,
                  firstCaseId,
                  rec.productName || "",
                  rec.marketplace || "US",
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
      studioImageReadyPromise = null;
      throw err;
    });
  }
  await studioImageReadyPromise;
}

export async function listStandaloneStudioAssets(options?: ModeOptions): Promise<StandaloneStudioAsset[]> {
  const mode = options?.mode ?? (await getAppMode());
  await ensureStudioImageReady(mode);
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM studio_media_assets
     WHERE media_kind = 'image' AND is_demo = $2
     ORDER BY created_at DESC LIMIT $1`,
    [MAX_STANDALONE_ASSETS, isDemoMode(mode)],
  );
  return res.rows
    .map((r) => r.payload as StandaloneStudioAsset)
    .filter((item): item is StandaloneStudioAsset => Boolean(item && typeof item.id === "string"));
}

export async function getStandaloneStudioAsset(
  id: string,
  options?: ModeOptions,
): Promise<StandaloneStudioAsset | null> {
  const mode = options?.mode ?? (await getAppMode());
  await ensureStudioImageReady(mode);
  const db = await getDb();
  const res = await db.query<{ payload: unknown }>(
    `SELECT payload FROM studio_media_assets
     WHERE id = $1 AND media_kind = 'image' AND is_demo = $2
     LIMIT 1`,
    [id, isDemoMode(mode)],
  );
  return (res.rows[0]?.payload as StandaloneStudioAsset | undefined) ?? null;
}

async function assertBoundCasesInMode(boundCases: StudioBoundCaseRef[] | undefined, isDemo: boolean): Promise<void> {
  const caseIds = [...new Set((boundCases ?? []).map((item) => item.caseId).filter(Boolean))];
  if (caseIds.length === 0) return;
  const db = await getDb();
  const res = await db.query<{ id: string }>(
    `SELECT id FROM product_cases WHERE id = ANY($1::text[]) AND is_demo = $2`,
    [caseIds, isDemo],
  );
  if (res.rows.length !== caseIds.length) throw new Error("绑定案卷不存在");
}

export async function saveStandaloneStudioAsset(
  record: StandaloneStudioAsset,
  options?: ModeOptions,
): Promise<void> {
  const mode = options?.mode ?? (await getAppMode());
  await ensureStudioImageReady(mode);
  const db = await getDb();
  const demo = isDemoMode(mode);
  await assertBoundCasesInMode(record.boundCases, demo);
  const firstCaseId = record.boundCases?.[0]?.caseId ?? null;
  const saved = await db.query<{ id: string }>(
    `INSERT INTO studio_media_assets (id, media_kind, case_id, product_name, marketplace, payload, created_at, is_demo)
     VALUES ($1, 'image', (SELECT id FROM product_cases WHERE id = $2 AND is_demo = $7 LIMIT 1), $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()), $7)
     ON CONFLICT (id) DO UPDATE SET
       case_id = EXCLUDED.case_id,
       product_name = EXCLUDED.product_name,
       marketplace = EXCLUDED.marketplace,
       payload = EXCLUDED.payload
     WHERE studio_media_assets.is_demo = EXCLUDED.is_demo
     RETURNING id`,
    [
      record.id,
      firstCaseId,
      record.productName || "",
      record.marketplace || "US",
      JSON.stringify(record),
      record.createdAt || null,
      demo,
    ],
  );
  if (!saved.rows[0]) throw new Error("素材不存在");
}

export async function deleteStandaloneStudioAsset(
  id: string,
  options?: ModeOptions,
): Promise<StandaloneStudioAsset | null> {
  const mode = options?.mode ?? (await getAppMode());
  const target = await getStandaloneStudioAsset(id, { mode });
  if (!target) return null;
  const db = await getDb();
  await db.query(
    `DELETE FROM studio_media_assets WHERE id = $1 AND media_kind = 'image' AND is_demo = $2`,
    [id, isDemoMode(mode)],
  );
  return target;
}

export async function markStandaloneImageBound(
  id: string,
  ref: { caseId: string; caseTitle: string },
  options?: ModeOptions,
): Promise<void> {
  const mode = options?.mode ?? (await getAppMode());
  const demo = isDemoMode(mode);
  await assertBoundCasesInMode([{ ...ref, boundAt: new Date().toISOString() }], demo);
  const existing = await getStandaloneStudioAsset(id, { mode });
  if (!existing) return;
  const current = Array.isArray(existing.boundCases) ? existing.boundCases : [];
  if (current.some((c) => c.caseId === ref.caseId)) return;
  const next: StandaloneStudioAsset = {
    ...existing,
    boundCases: [...current, { caseId: ref.caseId, caseTitle: ref.caseTitle, boundAt: new Date().toISOString() }],
  };
  await saveStandaloneStudioAsset(next, { mode });
}
