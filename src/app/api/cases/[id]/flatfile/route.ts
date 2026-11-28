import { NextResponse } from "next/server";
import { getCaseDetail, getContentDetail } from "@/lib/repository";
import { evaluateFlatFileExportGate } from "@/lib/export-gates";
import { emptyListingContent, normalizeListingContent } from "@/lib/listing";
import { buildPlatformFeedExport } from "@/lib/listing-delivery";
import { recordAuditLog } from "@/lib/audit-logs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const platformCode = (searchParams.get("platform") || "amazon").trim().toLowerCase();

  const detail = await getCaseDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "商品案卷不存在" }, { status: 404 });
  }

  const contentDetail = await getContentDetail(id);
  const gate = evaluateFlatFileExportGate({
    caseStatus: detail.productCase.status,
    hasSelection: Boolean(contentDetail?.selection ?? detail.hasSupplierSelection),
    hasListing: Boolean(contentDetail?.listing),
    listingStatus: contentDetail?.listing?.status ?? null,
  });
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status });
  }

  const currentListing = contentDetail?.listing
    ? normalizeListingContent(contentDetail.listing.content)
    : emptyListingContent();

  const { productCase, costModel } = detail;
  const sku = productCase.asin;
  const price = costModel?.assumptions?.salePriceCents
    ? (costModel.assumptions.salePriceCents / 100).toFixed(2)
    : (productCase.competitor_price_cents / 100).toFixed(2);
  const currency = costModel?.assumptions?.currency || productCase.currency || "USD";

  const exported = buildPlatformFeedExport({
    platformCode,
    sku,
    externalProductId: productCase.asin,
    brand: currentListing.brand || "Brand",
    title: currentListing.title || productCase.title || "",
    price,
    currency,
    quantity: 100,
    category: productCase.category || "General",
    bullets: currentListing.bullets || [],
    description: currentListing.description || currentListing.title || productCase.title || "",
    searchTerms: currentListing.searchTerms || "",
    imageFilenames: (contentDetail?.assets ?? []).map((a) =>
      String(a.metadata?.originalName || a.metadata?.storageKey || a.file_url || a.id),
    ),
  });

  await recordAuditLog({
    actor: "运营人员",
    action: "case.flat_file_exported",
    entityType: "product_case",
    entityId: id,
    details: {
      asin: sku,
      platformCode: exported.platformCode,
      currency,
      price,
      format: `${exported.platformCode}_${exported.format}`,
    },
  }).catch(() => {});

  return new NextResponse(exported.content, {
    headers: {
      "Content-Type": exported.mimeType,
      "Content-Disposition": `attachment; filename="${exported.fileName}"`,
    },
  });
}
