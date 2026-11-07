import { NextResponse } from "next/server";
import { getCaseDetail, getContentDetail } from "@/lib/repository";
import { emptyListingContent, normalizeListingContent } from "@/lib/listing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = await getCaseDetail(id);
  if (!detail) {
    return new NextResponse("商品案卷不存在", { status: 404 });
  }

  const contentDetail = await getContentDetail(id);
  const currentListing = contentDetail?.listing
    ? normalizeListingContent(contentDetail.listing.content)
    : emptyListingContent();

  const { productCase, costModel } = detail;
  const sku = productCase.asin;
  const brand = currentListing?.brand || "Brand";
  const title = (currentListing?.title || productCase.title || "").replace(/[\t\r\n]+/g, " ");
  const bullets = currentListing?.bullets || [];
  const b1 = (bullets[0] || "").replace(/[\t\r\n]+/g, " ");
  const b2 = (bullets[1] || "").replace(/[\t\r\n]+/g, " ");
  const b3 = (bullets[2] || "").replace(/[\t\r\n]+/g, " ");
  const b4 = (bullets[3] || "").replace(/[\t\r\n]+/g, " ");
  const b5 = (bullets[4] || "").replace(/[\t\r\n]+/g, " ");
  const description = (currentListing?.description || title).replace(/[\t\r\n]+/g, " ");
  const searchTerms = (currentListing?.searchTerms || "").replace(/[\t\r\n]+/g, " ");
  const price = costModel?.assumptions?.salePriceCents
    ? (costModel.assumptions.salePriceCents / 100).toFixed(2)
    : (productCase.competitor_price_cents / 100).toFixed(2);
  const currency = costModel?.assumptions?.currency || productCase.currency || "USD";

  const headers = [
    "feed_product_type",
    "item_sku",
    "brand_name",
    "item_name",
    "standard_price",
    "currency",
    "quantity",
    "bullet_point1",
    "bullet_point2",
    "bullet_point3",
    "bullet_point4",
    "bullet_point5",
    "product_description",
    "generic_keywords",
  ];

  const row = [
    "product",
    sku,
    brand,
    title,
    price,
    currency,
    "100",
    b1,
    b2,
    b3,
    b4,
    b5,
    description,
    searchTerms,
  ];

  const tsvContent = [headers.join("\t"), row.join("\t")].join("\n");

  return new NextResponse(tsvContent, {
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Content-Disposition": `attachment; filename="amazon_flatfile_${sku}.tsv"`,
    },
  });
}
