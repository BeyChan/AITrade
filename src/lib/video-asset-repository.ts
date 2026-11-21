import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { ProductCaseRow, SupplierSelectionRow } from "./types";

/** 将视频资产写入商品案卷 assets 表并记录审计日志（初始状态为 pending_review） */
export async function createVideoAssetRecord(
  caseId: string,
  input: {
    storageKey: string;
    originalName: string;
    mimeType: string;
    size: number;
    parentAssetId?: string | null;
    extraMetadata?: Record<string, unknown>;
  },
  actor: string,
) {
  if (!actor.trim()) throw new Error("请输入操作人");
  const db = await getDb();
  const [product, selection] = await Promise.all([
    db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]),
    db.query<SupplierSelectionRow>("SELECT * FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]),
  ]);
  if (!product.rows[0]) throw new Error("商品机会不存在");
  if (product.rows[0].status !== "approved") throw new Error("只有已立项商品可以进入内容制作");
  if (!selection.rows[0]) throw new Error("请先完成供应商人工定标，再制作商品内容");

  const assetId = randomUUID();
  const metadata = {
    role: "product_video",
    source: typeof input.extraMetadata?.source === "string" ? input.extraMetadata.source : "ai_video_generated",
    storageKey: input.storageKey,
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    ...(input.parentAssetId ? { parentAssetId: input.parentAssetId } : {}),
    ...(input.extraMetadata ?? {}),
  };

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO assets (id, case_id, asset_type, file_url, metadata, status, created_at)
       VALUES ($1, $2, 'product_video', $3, $4::jsonb, 'pending_review', NOW())`,
      [assetId, caseId, `/api/assets/${assetId}`, JSON.stringify(metadata)],
    );
    await tx.query("UPDATE product_cases SET updated_at = NOW() WHERE id = $1", [caseId]);
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'content.video_generated', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor.trim(),
        caseId,
        JSON.stringify({
          assetId,
          assetType: "product_video",
          originalName: input.originalName,
          mimeType: input.mimeType,
          size: input.size,
          parentAssetId: input.parentAssetId ?? null,
        }),
      ],
    );
  });

  return { assetId, assetType: "product_video" as const, fileUrl: `/api/assets/${assetId}`, metadata };
}
