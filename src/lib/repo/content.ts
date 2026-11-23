import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { isSupportedImageSlot, type ImageAssetSlot } from "../image-skills.ts";
import { preflightListing, type ListingDraftContent } from "../listing.ts";
import {
  approveChannelVersionWithExecutor,
  ensureChannelFoundation,
  saveChannelVersionWithExecutor,
} from "./channel-helpers.ts";
import { getCaseWorkflowFacts } from "./cases.ts";
import { getSourcingDetail } from "./sourcing.ts";
import type {
  AssetRow,
  AuditRow,
  ContentDetail,
  ContentProfileRow,
  CostModelRow,
  ListingReviewRow,
  ListingRow,
  ProductCaseRow,
  ProductRow,
  SupplierSelectionRow,
} from "../types.ts";

export type ProductDefinitionInput = {
  productName: string;
  targetCustomer: string;
  coreDifferentiator: string;
  specifications: string;
  packageContents: string;
  claimsToAvoid: string;
};

export type AssetUploadInput = {
  storageKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  assetType?: ImageAssetSlot;
  parentAssetId?: string | null;
  extraMetadata?: Record<string, unknown>;
};

export type MainImageReviewChecks = {
  whiteBackground: boolean;
  productComplete: boolean;
  noTextWatermark: boolean;
  resolutionConfirmed: boolean;
  matchesPhysicalProduct?: boolean;
};

async function assertContentUnlocked(caseId: string) {
  const db = await getDb();
  const [product, selection] = await Promise.all([
    db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]),
    db.query<SupplierSelectionRow>("SELECT * FROM supplier_selections WHERE case_id = $1 LIMIT 1", [caseId]),
  ]);
  if (!product.rows[0]) throw new Error("商品机会不存在");
  if (product.rows[0].status !== "approved") throw new Error("只有已立项商品可以进入内容制作");
  if (!selection.rows[0]) throw new Error("请先完成供应商人工定标，再制作商品内容");
  return { product: product.rows[0], selection: selection.rows[0] };
}


export async function getContentDetail(caseId: string): Promise<ContentDetail | null> {
  const db = await getDb();
  const product = await db.query<ProductCaseRow>("SELECT * FROM product_cases WHERE id = $1", [caseId]);
  const productCase = product.rows[0];
  if (!productCase) return null;

  const [costs, selections, profiles, assets, listings, audits, workflowFacts] = await Promise.all([
    db.query<CostModelRow>("SELECT * FROM cost_models WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId]),
    db.query<SupplierSelectionRow & { supplier_name: string }>(
      `SELECT ss.*, s.name AS supplier_name
       FROM supplier_selections ss
       JOIN suppliers s ON s.id = ss.supplier_id
       WHERE ss.case_id = $1
       LIMIT 1`,
      [caseId],
    ),
    db.query<ContentProfileRow>("SELECT * FROM case_content_profiles WHERE case_id = $1 LIMIT 1", [caseId]),
    db.query<AssetRow>("SELECT * FROM assets WHERE case_id = $1 ORDER BY created_at DESC", [caseId]),
    db.query<ListingRow>(
      `SELECT l.*
       FROM listings l
       JOIN channel_listings cl ON cl.id = l.channel_listing_id
       JOIN channel_accounts ca ON ca.id = cl.channel_account_id
       JOIN product_market_variants pmv ON pmv.id = cl.product_market_variant_id
       WHERE l.case_id = $1
         AND ca.platform_code = 'amazon'
         AND pmv.country_code = $2
       ORDER BY l.version DESC
       LIMIT 1`,
      [caseId, productCase.marketplace || "US"],
    ),
    db.query<AuditRow>(
      "SELECT * FROM audit_logs WHERE entity_type = 'product_case' AND entity_id = $1 ORDER BY created_at DESC LIMIT 40",
      [caseId],
    ),
    getCaseWorkflowFacts(caseId),
  ]);
  const listing = listings.rows[0] ?? null;
  const reviews = listing
    ? await db.query<ListingReviewRow>("SELECT * FROM listing_reviews WHERE listing_id = $1 ORDER BY created_at DESC", [listing.id])
    : { rows: [] as ListingReviewRow[] };

  return {
    productCase,
    costModel: costs.rows[0] ?? null,
    selection: selections.rows[0] ?? null,
    selectedSupplierName: selections.rows[0]?.supplier_name ?? null,
    profile: profiles.rows[0] ?? null,
    assets: assets.rows,
    listing,
    listingReviews: reviews.rows,
    auditLogs: audits.rows,
    quoteCount: workflowFacts.quoteCount,
    hasFlatFileExported: workflowFacts.hasFlatFileExported,
    hasMediaPackExported: workflowFacts.hasMediaPackExported,
    hasNoGoException: workflowFacts.hasNoGoException,
  };
}

export async function upsertProductDefinition(caseId: string, input: ProductDefinitionInput, actor: string) {
  if (!actor.trim()) throw new Error("请输入编辑人");
  const definition = {
    productName: input.productName.trim(),
    targetCustomer: input.targetCustomer.trim(),
    coreDifferentiator: input.coreDifferentiator.trim(),
    specifications: input.specifications.trim(),
    packageContents: input.packageContents.trim(),
    claimsToAvoid: input.claimsToAvoid.trim(),
  };
  if (!definition.productName) throw new Error("请输入商品名称");
  if (!definition.targetCustomer) throw new Error("请输入目标用户");
  if (!definition.coreDifferentiator) throw new Error("请输入核心差异点");
  if (!definition.specifications) throw new Error("请输入规格与材质");
  if (!definition.packageContents) throw new Error("请输入包装清单");

  await assertContentUnlocked(caseId);
  const db = await getDb();
  const existing = await db.query<{ id: string }>("SELECT id FROM case_content_profiles WHERE case_id = $1 LIMIT 1", [caseId]);
  const id = existing.rows[0]?.id ?? randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO case_content_profiles
        (id, case_id, product_name, target_customer, core_differentiator, specifications,
         package_contents, claims_to_avoid, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (case_id) DO UPDATE SET
         product_name = EXCLUDED.product_name,
         target_customer = EXCLUDED.target_customer,
         core_differentiator = EXCLUDED.core_differentiator,
         specifications = EXCLUDED.specifications,
         package_contents = EXCLUDED.package_contents,
         claims_to_avoid = EXCLUDED.claims_to_avoid,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        id,
        caseId,
        definition.productName,
        definition.targetCustomer,
        definition.coreDifferentiator,
        definition.specifications,
        definition.packageContents,
        definition.claimsToAvoid,
        actor.trim(),
      ],
    );
    await tx.query(
      "UPDATE product_cases SET updated_at = NOW() WHERE id = $1",
      [caseId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'content_profile.updated', 'product_case', $3, $4::jsonb)`,
      [randomUUID(), actor.trim(), caseId, JSON.stringify({ definition, humanDecision: false })],
    );
  });
  return { id };
}

export async function createAssetRecord(caseId: string, input: AssetUploadInput, actor: string) {
  if (!actor.trim()) throw new Error("请输入上传人");
  await assertContentUnlocked(caseId);
  const db = await getDb();
  const assetId = randomUUID();
  const assetType: ImageAssetSlot = input.assetType && isSupportedImageSlot(input.assetType)
    ? input.assetType
    : "main_image";
  const parentAssetId = input.parentAssetId?.trim() || null;
  const source = typeof input.extraMetadata?.source === "string" ? input.extraMetadata.source : "uploaded";
  const metadata = {
    role: assetType,
    source,
    storageKey: input.storageKey,
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
    ...(typeof input.width === "number" ? { width: input.width } : {}),
    ...(typeof input.height === "number" ? { height: input.height } : {}),
    uploadedBy: actor.trim(),
    reviewed: false,
    ...(input.extraMetadata ?? {}),
  };
  const auditAction = source === "ai_generated" ? "asset.ai_image_generated" : "asset.main_image_uploaded";
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO assets (id, case_id, asset_type, file_url, status, metadata, parent_asset_id)
       VALUES ($1, $2, $3, $4, 'draft', $5::jsonb, $6)`,
      [assetId, caseId, assetType, `/api/assets/${assetId}`, JSON.stringify(metadata), parentAssetId],
    );
    await tx.query(
      "UPDATE product_cases SET updated_at = NOW() WHERE id = $1",
      [caseId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
      [
        randomUUID(),
        actor.trim(),
        auditAction,
        caseId,
        JSON.stringify({
          assetId,
          assetType,
          source,
          originalName: input.originalName,
          mimeType: input.mimeType,
          size: input.size,
          width: input.width,
          height: input.height,
          parentAssetId,
          skillId: typeof input.extraMetadata?.skillId === "string" ? input.extraMetadata.skillId : undefined,
        }),
      ],
    );
  });
  return { assetId, assetType, fileUrl: `/api/assets/${assetId}`, metadata };
}

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
  await assertContentUnlocked(caseId);
  const db = await getDb();
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

export async function reviewVideoAsset(
  caseId: string,
  assetId: string,
  decision: "approved" | "rejected",
  reviewer: string,
  notes: string,
) {
  if (!reviewer.trim()) throw new Error("请输入审核人");
  await assertContentUnlocked(caseId);
  const db = await getDb();
  const existing = await db.query<AssetRow>(
    "SELECT * FROM assets WHERE id = $1 AND case_id = $2 AND asset_type = 'product_video'",
    [assetId, caseId],
  );
  if (!existing.rows[0]) throw new Error("视频资产不存在");

  const nextMeta = {
    ...(existing.rows[0].metadata ?? {}),
    reviewedBy: reviewer.trim(),
    reviewedAt: new Date().toISOString(),
    reviewNotes: notes.trim() || (decision === "approved" ? "人工确认外观一致、无水印与畸变" : "退回重做"),
  };

  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE assets SET status = $1, metadata = $2::jsonb WHERE id = $3",
      [decision, JSON.stringify(nextMeta), assetId],
    );
    await tx.query("UPDATE product_cases SET updated_at = NOW() WHERE id = $1", [caseId]);
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
      [
        randomUUID(),
        reviewer.trim(),
        decision === "approved" ? "content.video_approved" : "content.video_rejected",
        caseId,
        JSON.stringify({ assetId, decision, notes: nextMeta.reviewNotes }),
      ],
    );
  });

  return { assetId, status: decision, metadata: nextMeta };
}

export async function deleteAssetRecord(assetId: string, actor = "本机管理员"): Promise<AssetRow | null> {
  const db = await getDb();
  const existing = await db.query<AssetRow>("SELECT * FROM assets WHERE id = $1", [assetId]);
  const target = existing.rows[0];
  if (!target) return null;

  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM assets WHERE id = $1", [assetId]);
    await tx.query("UPDATE product_cases SET updated_at = NOW() WHERE id = $1", [target.case_id]);
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'content.asset_deleted', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor.trim() || "本机管理员",
        target.case_id,
        JSON.stringify({
          assetId: target.id,
          assetType: target.asset_type,
          originalName: typeof target.metadata?.originalName === "string" ? target.metadata.originalName : "",
        }),
      ],
    );
  });

  return target;
}

export async function getAssetRecord(assetId: string): Promise<AssetRow | null> {
  const db = await getDb();
  const result = await db.query<AssetRow>("SELECT * FROM assets WHERE id = $1", [assetId]);
  return result.rows[0] ?? null;
}

export async function reviewMainImageAsset(
  caseId: string,
  assetId: string,
  reviewer: string,
  notes: string,
  checks: MainImageReviewChecks,
) {
  if (!reviewer.trim()) throw new Error("请输入图片检查人");
  if (!notes.trim()) throw new Error("请填写图片检查说明");
  const corePassed =
    Boolean(checks.whiteBackground) &&
    Boolean(checks.productComplete) &&
    Boolean(checks.noTextWatermark) &&
    Boolean(checks.resolutionConfirmed);
  if (!corePassed) throw new Error("请逐项确认图片检查项");
  await assertContentUnlocked(caseId);

  const db = await getDb();
  const asset = await db.query<AssetRow>("SELECT * FROM assets WHERE id = $1 AND case_id = $2", [assetId, caseId]);
  if (!asset.rows[0]) throw new Error("图片素材不存在");
  if (!isSupportedImageSlot(asset.rows[0].asset_type)) throw new Error("不支持的图片资产类型");

  const isAiGenerated = asset.rows[0].metadata?.source === "ai_generated";
  if (isAiGenerated && !checks.matchesPhysicalProduct) {
    throw new Error("AI 生成图必须勾选确认「画面外观/结构/配件数量与实物样品一致，无 AI 幻觉变形」");
  }

  const normalizedChecks: MainImageReviewChecks = {
    whiteBackground: checks.whiteBackground,
    productComplete: checks.productComplete,
    noTextWatermark: checks.noTextWatermark,
    resolutionConfirmed: checks.resolutionConfirmed,
    ...(isAiGenerated ? { matchesPhysicalProduct: Boolean(checks.matchesPhysicalProduct) } : {}),
  };

  const review = { reviewer: reviewer.trim(), notes: notes.trim(), checks: normalizedChecks, reviewedAt: new Date().toISOString() };
  const metadata = { ...asset.rows[0].metadata, reviewed: true, review };
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE assets SET status = 'approved', metadata = $1::jsonb WHERE id = $2 AND case_id = $3",
      [JSON.stringify(metadata), assetId, caseId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'asset.main_image_reviewed', 'product_case', $3, $4::jsonb)`,
      [randomUUID(), reviewer.trim(), caseId, JSON.stringify({ assetId, assetType: asset.rows[0]!.asset_type, review })],
    );
  });
  return { assetId };
}

export async function createListingDraft(caseId: string, input: Partial<ListingDraftContent>, actor: string) {
  if (!actor.trim()) throw new Error("请输入内容编辑人");
  const { product } = await assertContentUnlocked(caseId);
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const target = await ensureChannelFoundation(tx, product, "amazon", product.marketplace || "US");
    return saveChannelVersionWithExecutor(tx, product, target, input, actor.trim());
  });

  return {
    listingId: result.listingId,
    channelListingId: result.channelListingId,
    channelVersionId: result.channelVersionId,
    version: result.version,
    preflight: result.preflight,
  };
}

export async function approveListingContent(caseId: string, reviewer: string, notes: string) {
  if (!reviewer.trim()) throw new Error("请输入内容确认人");
  if (!notes.trim()) throw new Error("请填写内容确认说明，记录声明核验依据");
  const { product } = await assertContentUnlocked(caseId);
  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const target = await ensureChannelFoundation(tx, product, "amazon", product.marketplace || "US");
    return approveChannelVersionWithExecutor(tx, product, target, reviewer.trim(), notes.trim());
  });

  return {
    listingId: result.channelVersionId,
    channelListingId: result.channelListingId,
    channelVersionId: result.channelVersionId,
    version: result.version,
    preflight: result.preflight,
  };
}

