import { NextResponse } from "next/server";
import { getCaseDetail, getContentDetail } from "@/lib/repository";
import { evaluateFlatFileExportGate } from "@/lib/export-gates";
import { emptyListingContent, normalizeListingContent } from "@/lib/listing";
import { buildSemiAutoListingPayload } from "@/lib/listing-delivery";
import { recordAuditLog } from "@/lib/audit-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const headers = corsHeaders(request);
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const platformCode = (searchParams.get("platform") || "amazon").trim().toLowerCase();

  const detail = await getCaseDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "商品案卷不存在" }, { status: 404, headers });
  }

  const contentDetail = await getContentDetail(id);
  const gate = evaluateFlatFileExportGate({
    caseStatus: detail.productCase.status,
    hasSelection: Boolean(contentDetail?.selection ?? detail.hasSupplierSelection),
    hasListing: Boolean(contentDetail?.listing),
    listingStatus: contentDetail?.listing?.status ?? null,
  });
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status, headers });
  }

  const currentListing = contentDetail?.listing
    ? normalizeListingContent(contentDetail.listing.content)
    : emptyListingContent();

  const { productCase, costModel } = detail;
  const price = costModel?.assumptions?.salePriceCents
    ? (costModel.assumptions.salePriceCents / 100).toFixed(2)
    : (productCase.competitor_price_cents / 100).toFixed(2);
  const currency = costModel?.assumptions?.currency || productCase.currency || "USD";
  const marketCode = (searchParams.get("market") || productCase.marketplace || "US").trim().toUpperCase();

  const payload = buildSemiAutoListingPayload({
    caseId: productCase.id,
    platformCode,
    marketCode,
    currency,
    sku: `SKU-${productCase.asin}`,
    externalProductId: productCase.asin,
    price,
    category: productCase.category || "General",
    listing: {
      ...currentListing,
      title: currentListing.title || productCase.title,
    },
    specifications: contentDetail?.profile?.specifications ?? "",
    packageContents: contentDetail?.profile?.package_contents ?? "",
    claimsToAvoid: contentDetail?.profile?.claims_to_avoid ?? "",
    images: (contentDetail?.assets ?? []).map((asset) => ({
      id: asset.id,
      assetType: asset.asset_type,
      status: asset.status,
      fileName: String(asset.metadata?.originalName || asset.metadata?.storageKey || asset.file_url || asset.id),
      width: typeof asset.metadata?.width === "number" ? asset.metadata.width : null,
      height: typeof asset.metadata?.height === "number" ? asset.metadata.height : null,
      sizeBytes: typeof asset.metadata?.size === "number" ? asset.metadata.size : null,
    })),
  });

  await recordAuditLog({
    actor: "运营人员",
    action: "case.listing_payload_fetched",
    entityType: "product_case",
    entityId: id,
    details: { platformCode, marketCode, sku: payload.fields.sku },
  }).catch(() => {});

  return NextResponse.json({ ok: true, payload }, { headers });
}
