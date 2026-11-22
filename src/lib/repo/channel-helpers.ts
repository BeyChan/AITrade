import { randomUUID } from "node:crypto";
import { getChannelProfile, mapChannelPayload, preflightChannelContent, type ChannelContext } from "../channels.ts";
import { normalizeListingContent, type ListingDraftContent, type ListingPreflightResult } from "../listing.ts";
import type {
  AssetRow,
  ChannelAccountRow,
  ChannelListingRow,
  ChannelListingVersionRow,
  ContentProfileRow,
  ListingRow,
  MarketRow,
  PlatformRow,
  ProductCaseRow,
  ProductMarketVariantRow,
  ProductRow,
} from "../types.ts";

export type SqlExecutor = {
  query<T>(query: string, params?: any[]): Promise<{ rows: T[] }>;
};

type ChannelTargetBaseRow = ChannelListingRow & {
  product: ProductRow;
  variant: ProductMarketVariantRow;
  account: ChannelAccountRow;
  market: MarketRow;
  platform: PlatformRow;
};

export type ChannelFoundation = {
  product: ProductRow;
  variant: ProductMarketVariantRow;
  account: ChannelAccountRow;
  channelListing: ChannelListingRow;
  market: MarketRow;
  platform: PlatformRow;
};

function channelContext(market: MarketRow): ChannelContext {
  return { marketCode: market.code, locale: market.locale, currency: market.currency };
}

export async function ensureChannelFoundation(
  tx: SqlExecutor,
  productCase: ProductCaseRow,
  platformCode: string,
  marketCode: string,
): Promise<ChannelFoundation> {
  const [platformResult, marketResult] = await Promise.all([
    tx.query<PlatformRow>("SELECT * FROM platforms WHERE code = $1 AND status <> 'disabled' LIMIT 1", [platformCode]),
    tx.query<MarketRow>("SELECT * FROM markets WHERE code = $1 AND status = 'active' LIMIT 1", [marketCode]),
  ]);
  const platform = platformResult.rows[0];
  const market = marketResult.rows[0];
  if (!platform) throw new Error("目标平台不存在或已停用");
  if (!market) throw new Error("目标市场不存在或已停用");

  let productResult = await tx.query<ProductRow>("SELECT * FROM products WHERE case_id = $1 LIMIT 1", [productCase.id]);
  let product = productResult.rows[0];
  if (!product) {
    const sku = `SKU-${productCase.id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    await tx.query(
      `INSERT INTO products (id, case_id, sku, category, brand, status)
       VALUES ($1, $2, $3, $4, NULL, 'active')
       ON CONFLICT (case_id) DO NOTHING`,
      [`product-${productCase.id}`, productCase.id, sku, productCase.category],
    );
    productResult = await tx.query<ProductRow>("SELECT * FROM products WHERE case_id = $1 LIMIT 1", [productCase.id]);
    product = productResult.rows[0];
  }
  if (!product) throw new Error("无法创建商品主记录");

  let variantResult = await tx.query<ProductMarketVariantRow>(
    `SELECT * FROM product_market_variants
     WHERE product_id = $1 AND country_code = $2 AND locale = $3
     LIMIT 1`,
    [product.id, market.code, market.locale],
  );
  let variant = variantResult.rows[0];
  if (!variant) {
    variantResult = await tx.query<ProductMarketVariantRow>(
      `INSERT INTO product_market_variants
        (id, product_id, country_code, locale, currency, title, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (product_id, country_code, locale) DO NOTHING
       RETURNING *`,
      [
        `pmv-${productCase.id}-${market.code.toLowerCase()}`,
        product.id,
        market.code,
        market.locale,
        market.currency,
        productCase.title,
      ],
    );
    variant = variantResult.rows[0] ??
      (await tx.query<ProductMarketVariantRow>(
        `SELECT * FROM product_market_variants
         WHERE product_id = $1 AND country_code = $2 AND locale = $3
         LIMIT 1`,
        [product.id, market.code, market.locale],
      )).rows[0];
  }
  if (!variant) throw new Error("无法创建市场版本");

  const accountName = `${platform.name} ${market.name} · ${productCase.asin} 测试店铺`;
  let accountResult = await tx.query<ChannelAccountRow>(
    `SELECT * FROM channel_accounts
     WHERE platform_code = $1 AND market_code = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    [platform.code, market.code],
  );
  let account = accountResult.rows[0];
  if (!account) {
    accountResult = await tx.query<ChannelAccountRow>(
      `INSERT INTO channel_accounts
        (id, platform_code, market_code, name, currency, locale, status, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, 'unconfigured', TRUE)
       ON CONFLICT (platform_code, market_code, name) DO NOTHING
       RETURNING *`,
      [
        `account-${productCase.id}-${platform.code}-${market.code.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        platform.code,
        market.code,
        accountName,
        market.currency,
        market.locale,
      ],
    );
    account = accountResult.rows[0] ??
      (await tx.query<ChannelAccountRow>(
        `SELECT * FROM channel_accounts
         WHERE platform_code = $1 AND market_code = $2 AND name = $3
         LIMIT 1`,
        [platform.code, market.code, accountName],
      )).rows[0];
  }
  if (!account) throw new Error("无法创建渠道店铺");

  let listingResult = await tx.query<ChannelListingRow>(
    `SELECT * FROM channel_listings
     WHERE product_market_variant_id = $1 AND channel_account_id = $2
     LIMIT 1`,
    [variant.id, account.id],
  );
  let channelListing = listingResult.rows[0];
  if (!channelListing) {
    listingResult = await tx.query<ChannelListingRow>(
      `INSERT INTO channel_listings
        (id, product_market_variant_id, channel_account_id, status, adapter_version, metadata)
       VALUES ($1, $2, $3, 'draft', 'p1.1', $4::jsonb)
       ON CONFLICT (product_market_variant_id, channel_account_id) DO NOTHING
       RETURNING *`,
      [
        `channel-${productCase.id}-${platform.code}-${market.code.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        variant.id,
        account.id,
        JSON.stringify({ createdFrom: "content-workflow", externalActions: "none" }),
      ],
    );
    channelListing = listingResult.rows[0] ??
      (await tx.query<ChannelListingRow>(
        `SELECT * FROM channel_listings
         WHERE product_market_variant_id = $1 AND channel_account_id = $2
         LIMIT 1`,
        [variant.id, account.id],
      )).rows[0];
  }
  if (!channelListing) throw new Error("无法创建渠道 Listing");

  return { product, variant, account, channelListing, market, platform };
}


export async function saveChannelVersionWithExecutor(
  tx: SqlExecutor,
  productCase: ProductCaseRow,
  target: ChannelFoundation,
  input: Partial<ListingDraftContent>,
  actor: string,
) {
  const content = normalizeListingContent(input);
  const context = channelContext(target.market);
  const mappedPayload = mapChannelPayload(target.platform.code, content, context);
  const preflight = preflightChannelContent(target.platform.code, content, context);
  const versionResult = await tx.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM channel_listing_versions WHERE channel_listing_id = $1",
    [target.channelListing.id],
  );
  const version = Number(versionResult.rows[0]?.version ?? 1);
  const versionId = randomUUID();
  const mirrorLegacy = target.platform.code === "amazon" && target.market.code === productCase.marketplace;

  await tx.query(
    `INSERT INTO channel_listing_versions
      (id, channel_listing_id, version, canonical_snapshot, mapped_payload, preflight_result, status)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, 'draft')`,
    [
      versionId,
      target.channelListing.id,
      version,
      JSON.stringify(content),
      JSON.stringify(mappedPayload),
      JSON.stringify(preflight),
    ],
  );
  await tx.query(
    `UPDATE channel_listings
     SET status = 'draft', updated_at = NOW(), metadata = metadata || $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify({
        lastPreflightPassed: preflight.passed,
        lastPreflightScore: preflight.score,
        lastSavedVersion: version,
        lastSavedBy: actor,
        externalActions: "none",
      }),
      target.channelListing.id,
    ],
  );

  let legacyListingId: string | null = null;
  if (mirrorLegacy) {
    legacyListingId = randomUUID();
    await tx.query(
      `INSERT INTO listings
        (id, case_id, marketplace, status, content, version, created_by,
         channel_listing_id, platform_code, country_code, locale, currency)
       VALUES ($1, $2, $3, 'draft', $4::jsonb, $5, $6, $7, $8, $9, $10, $11)`,
      [
        legacyListingId,
        productCase.id,
        target.market.code,
        JSON.stringify(content),
        version,
        actor,
        target.channelListing.id,
        target.platform.code,
        target.market.code,
        target.market.locale,
        target.market.currency,
      ],
    );
    await tx.query(
      `INSERT INTO listing_reviews (id, listing_id, review_type, status, findings, reviewer)
       VALUES ($1, $2, 'automated_preflight', $3, $4::jsonb, 'system')`,
      [
        randomUUID(),
        legacyListingId,
        preflight.passed ? "passed" : "failed",
        JSON.stringify({ preflight, content, channelListingId: target.channelListing.id }),
      ],
    );
  }

  await tx.query("UPDATE product_cases SET updated_at = NOW() WHERE id = $1", [productCase.id]);
  await tx.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
    [
      randomUUID(),
      actor,
      mirrorLegacy ? "listing.draft_saved" : "channel.listing_version_saved",
      productCase.id,
      JSON.stringify({
        channelListingId: target.channelListing.id,
        channelVersionId: versionId,
        legacyListingId,
        platformCode: target.platform.code,
        marketCode: target.market.code,
        locale: target.market.locale,
        currency: target.market.currency,
        version,
        preflightPassed: preflight.passed,
        preflightScore: preflight.score,
        errorCount: preflight.errorCount,
        warningCount: preflight.warningCount,
        externalActions: "none",
      }),
    ],
  );

  return { channelListingId: target.channelListing.id, channelVersionId: versionId, listingId: legacyListingId, version, preflight };
}


export async function approveChannelVersionWithExecutor(
  tx: SqlExecutor,
  productCase: ProductCaseRow,
  target: ChannelFoundation,
  reviewer: string,
  notes: string,
) {
  const latestResult = await tx.query<ChannelListingVersionRow>(
    `SELECT * FROM channel_listing_versions
     WHERE channel_listing_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [target.channelListing.id],
  );
  const latest = latestResult.rows[0];
  if (!latest) throw new Error("请先保存该渠道的 Listing 草稿");
  if (latest.status === "content_approved") throw new Error("当前渠道 Listing 版本已经通过内容确认");
  const preflight = latest.preflight_result as Partial<ListingPreflightResult>;
  if (!preflight.passed) throw new Error("渠道预检未通过，不能进行人工内容确认");

  const approvedAsset = await tx.query<{ id: string }>(
    `SELECT id FROM assets
     WHERE case_id = $1 AND asset_type = 'main_image' AND status = 'approved'
     ORDER BY created_at DESC LIMIT 1`,
    [productCase.id],
  );
  if (!approvedAsset.rows[0]) throw new Error("请先上传并通过人工主图检查");

  const approvedAt = new Date().toISOString();
  await tx.query(
    `UPDATE channel_listing_versions
     SET status = 'content_approved', approved_by = $1, approved_at = $2
     WHERE id = $3`,
    [reviewer, approvedAt, latest.id],
  );
  await tx.query(
    `UPDATE channel_listings
     SET status = 'content_approved', updated_at = NOW(), metadata = metadata || $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify({ approvedBy: reviewer, approvedAt, externalActions: "none" }),
      target.channelListing.id,
    ],
  );

  const mirrorLegacy = target.platform.code === "amazon" && target.market.code === productCase.marketplace;
  let legacyListingId: string | null = null;
  if (mirrorLegacy) {
    const legacy = await tx.query<{ id: string }>(
      `SELECT id FROM listings
       WHERE channel_listing_id = $1 AND version = $2
       LIMIT 1`,
      [target.channelListing.id, latest.version],
    );
    legacyListingId = legacy.rows[0]?.id ?? null;
    if (legacyListingId) {
      await tx.query(
        "UPDATE listings SET status = 'content_approved', updated_at = NOW() WHERE id = $1",
        [legacyListingId],
      );
      await tx.query(
        `INSERT INTO listing_reviews
          (id, listing_id, review_type, status, findings, reviewer, reviewed_at)
         VALUES ($1, $2, 'human_content_review', 'approved', $3::jsonb, $4, $5)`,
        [
          randomUUID(),
          legacyListingId,
          JSON.stringify({
            preflight,
            notes,
            approvedAssetId: approvedAsset.rows[0].id,
            channelListingId: target.channelListing.id,
            boundary: "content approval only; no marketplace publish or external action",
          }),
          reviewer,
          approvedAt,
        ],
      );
    }
  }

  await tx.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, 'product_case', $4, $5::jsonb)`,
    [
      randomUUID(),
      reviewer,
      mirrorLegacy ? "listing.content_approved" : "channel.content_approved",
      productCase.id,
      JSON.stringify({
        channelListingId: target.channelListing.id,
        channelVersionId: latest.id,
        legacyListingId,
        platformCode: target.platform.code,
        marketCode: target.market.code,
        version: latest.version,
        preflightScore: preflight.score,
        warningCount: preflight.warningCount,
        approvedAssetId: approvedAsset.rows[0].id,
        notes,
        humanDecision: true,
        externalActions: "none",
      }),
    ],
  );

  return { channelListingId: target.channelListing.id, channelVersionId: latest.id, version: latest.version, preflight };
}

