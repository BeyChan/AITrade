import type { getAISourcingBatch } from "@/lib/ai-sourcing-repository";

export type BatchType = NonNullable<Awaited<ReturnType<typeof getAISourcingBatch>>>;

export type DetailTab = "overview" | "hypotheses" | "suppliers" | "quotes" | "decision";

export function evidenceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    review_insight: "差评",
    patent_check: "专利",
    logistics_check: "物流",
    competitor_snapshot: "竞品",
    supplier_quote: "报价",
  };
  return labels[value] ?? value;
}

export function dateInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function dateTimeInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function googleSearchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export function marketplaceSearchUrl(platformCode: string, marketCode: string, query: string) {
  const encoded = encodeURIComponent(query);
  if (platformCode === "amazon") {
    const domains: Record<string, string> = {
      US: "www.amazon.com",
      GB: "www.amazon.co.uk",
      DE: "www.amazon.de",
      JP: "www.amazon.co.jp",
      SG: "www.amazon.sg",
      MY: "www.amazon.com.my",
      AU: "www.amazon.com.au",
    };
    return `https://${domains[marketCode] ?? "www.amazon.com"}/s?k=${encoded}`;
  }
  if (platformCode === "ebay") {
    const domains: Record<string, string> = {
      US: "www.ebay.com",
      GB: "www.ebay.co.uk",
      DE: "www.ebay.de",
      AU: "www.ebay.com.au",
      SG: "www.ebay.com.sg",
      MY: "www.ebay.com.my",
    };
    return `https://${domains[marketCode] ?? "www.ebay.com"}/sch/i.html?_nkw=${encoded}`;
  }
  if (platformCode === "shopify") return googleSearchUrl(`site:myshopify.com ${query} ${marketCode}`);
  if (platformCode === "tiktok_shop") return googleSearchUrl(`site:shop.tiktok.com ${query} ${marketCode}`);
  return googleSearchUrl(`${query} ${marketCode}`);
}

