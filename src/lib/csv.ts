import { calculateEconomics, type EconomicsAssumptions } from "./economics.ts";

export type CandidateImportRow = {
  asin: string;
  marketplace: string;
  category: string;
  title: string;
  url: string;
  competitorPriceCents: number;
  currency: string;
  monthlySalesEstimate: number;
  monthlySalesMin: number;
  monthlySalesMax: number;
  reviewCount: number;
  rating: number | null;
  bsr: number | null;
  keyword: string;
  keywordSearchVolume: number | null;
  sellerCount: number | null;
  variationCount: number | null;
  notes: string;
  source: string;
  sourceRecordId: string;
  observedAt: string;
  assumptions: EconomicsAssumptions;
  rawPayload: Record<string, string>;
};

export type SupplierImportRow = {
  platform: string;
  externalSupplierId: string;
  name: string;
  url: string;
  contact: string;
  country: string;
  category: string;
  rating: number | null;
  verified: boolean;
  moq: number | null;
  leadTimeDays: number | null;
  certifications: string;
  observedAt: string;
  rawPayload: Record<string, string>;
};

export type QuoteImportRow = {
  caseId: string;
  asin: string;
  marketplace: string;
  supplierPlatform: string;
  externalSupplierId: string;
  supplierName: string;
  supplierUrl: string;
  supplierContact: string;
  supplierCountry: string;
  supplierCategory: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
  qualityScore: number;
  moq: number;
  leadTimeDays: number | null;
  paymentTerms: string;
  incoterm: string;
  sampleFeeCents: number | null;
  toolingFeeCents: number | null;
  certifications: string;
  quoteValidUntil: string | null;
  currency: string;
  observedAt: string;
  rawPayload: Record<string, string>;
};

const candidateHeaderAliases: Record<string, string> = {
  asin: "asin",
  市场: "marketplace",
  站点: "marketplace",
  marketplace: "marketplace",
  类目: "category",
  分类: "category",
  category: "category",
  标题: "title",
  产品标题: "title",
  title: "title",
  链接: "url",
  产品链接: "url",
  url: "url",
  竞品价格: "competitor_price",
  售价: "competitor_price",
  价格: "competitor_price",
  competitor_price: "competitor_price",
  币种: "currency",
  货币: "currency",
  currency: "currency",
  月销量: "monthly_sales_estimate",
  月销: "monthly_sales_estimate",
  monthly_sales_estimate: "monthly_sales_estimate",
  月销量下限: "monthly_sales_min",
  最低月销: "monthly_sales_min",
  monthly_sales_min: "monthly_sales_min",
  月销量上限: "monthly_sales_max",
  最高月销: "monthly_sales_max",
  monthly_sales_max: "monthly_sales_max",
  评论数: "review_count",
  review_count: "review_count",
  评分: "rating",
  rating: "rating",
  bsr: "bsr",
  排名: "bsr",
  关键词: "keyword",
  keyword: "keyword",
  关键词搜索量: "keyword_search_volume",
  keyword_search_volume: "keyword_search_volume",
  卖家数: "seller_count",
  seller_count: "seller_count",
  变体数: "variation_count",
  variation_count: "variation_count",
  备注: "notes",
  notes: "notes",
  来源: "source",
  source: "source",
  源记录id: "source_record_id",
  source_record_id: "source_record_id",
  采集时间: "observed_at",
  观察时间: "observed_at",
  observed_at: "observed_at",
  采购成本: "landed_cost",
  落地成本: "landed_cost",
  landed_cost: "landed_cost",
  fba费用: "fba_fee",
  fba_fee: "fba_fee",
  佣金率: "referral_rate",
  referral_rate: "referral_rate",
  广告占比: "ad_rate",
  ad_rate: "ad_rate",
  退货率: "return_rate",
  return_rate: "return_rate",
  退货处理费: "return_processing",
  return_processing: "return_processing",
  退货残值率: "return_recovery_rate",
  return_recovery_rate: "return_recovery_rate",
  coupon: "coupon",
  优惠券: "coupon",
  仓储费: "storage_cost",
  storage_cost: "storage_cost",
  其他成本: "other_cost",
  other_cost: "other_cost",
};

const supplierHeaderAliases: Record<string, string> = {
  supplier_platform: "supplier_platform",
  供应商平台: "supplier_platform",
  平台: "supplier_platform",
  external_supplier_id: "external_supplier_id",
  供应商id: "external_supplier_id",
  供应商编号: "external_supplier_id",
  supplier_name: "supplier_name",
  供应商名称: "supplier_name",
  供应商: "supplier_name",
  supplier_url: "supplier_url",
  供应商链接: "supplier_url",
  店铺链接: "supplier_url",
  country: "country",
  国家: "country",
  国家地区: "country",
  contact: "contact",
  联系方式: "contact",
  category: "category",
  主营类目: "category",
  rating: "rating",
  评分: "rating",
  verified: "verified",
  是否认证: "verified",
  认证供应商: "verified",
  moq: "moq",
  起订量: "moq",
  lead_time_days: "lead_time_days",
  交期: "lead_time_days",
  交期天数: "lead_time_days",
  certifications: "certifications",
  认证: "certifications",
  observed_at: "observed_at",
  采集时间: "observed_at",
  数据时间: "observed_at",
};

const quoteHeaderAliases: Record<string, string> = {
  case_id: "case_id",
  商品机会id: "case_id",
  asin: "asin",
  marketplace: "marketplace",
  市场: "marketplace",
  站点: "marketplace",
  supplier_platform: "supplier_platform",
  供应商平台: "supplier_platform",
  平台: "supplier_platform",
  external_supplier_id: "external_supplier_id",
  供应商id: "external_supplier_id",
  供应商编号: "external_supplier_id",
  supplier_name: "supplier_name",
  供应商名称: "supplier_name",
  供应商: "supplier_name",
  supplier_url: "supplier_url",
  供应商链接: "supplier_url",
  店铺链接: "supplier_url",
  supplier_contact: "supplier_contact",
  供应商联系方式: "supplier_contact",
  supplier_country: "supplier_country",
  供应商国家: "supplier_country",
  supplier_category: "supplier_category",
  供应商类目: "supplier_category",
  unit_price: "unit_price",
  采购单价: "unit_price",
  单价: "unit_price",
  freight_per_unit: "freight_per_unit",
  单件运费: "freight_per_unit",
  freight: "freight_per_unit",
  duty_rate: "duty_rate",
  关税率: "duty_rate",
  quality_score: "quality_score",
  质量评分: "quality_score",
  moq: "moq",
  起订量: "moq",
  lead_time_days: "lead_time_days",
  交期天数: "lead_time_days",
  交期: "lead_time_days",
  payment_terms: "payment_terms",
  账期: "payment_terms",
  付款条件: "payment_terms",
  incoterm: "incoterm",
  贸易条款: "incoterm",
  sample_fee: "sample_fee",
  样品费: "sample_fee",
  tooling_fee: "tooling_fee",
  开模费: "tooling_fee",
  certifications: "certifications",
  认证: "certifications",
  quote_valid_until: "quote_valid_until",
  报价有效期: "quote_valid_until",
  有效期至: "quote_valid_until",
  currency: "currency",
  币种: "currency",
  货币: "currency",
  observed_at: "observed_at",
  采集时间: "observed_at",
  报价时间: "observed_at",
};

export function parseCandidateCsv(csv: string): CandidateImportRow[] {
  const parsed = parseNamedCsv(csv, candidateHeaderAliases);
  if (!parsed.headers.includes("title") || !parsed.headers.includes("competitor_price")) {
    throw new Error("候选品 CSV 必须包含 title 和 competitor_price（标题、竞品价格）");
  }

  return parsed.rows.map(({ raw, lineNumber }, index) => {
    const title = raw.title || `未命名候选品 ${index + 1}`;
    const competitorPrice = parseMoney(raw.competitor_price);
    if (!competitorPrice) throw new Error(`候选品 CSV 第 ${lineNumber} 行缺少有效的 competitor_price`);
    const salePriceCents = Math.round(competitorPrice * 100);
    const asin = raw.asin || `MANUAL-${Date.now()}-${index + 1}`;
    const landedCostCents = raw.landed_cost
      ? Math.round(parseMoney(raw.landed_cost) * 100)
      : Math.round(salePriceCents * 0.3);
    const assumptions: EconomicsAssumptions = {
      salePriceCents,
      landedCostCents,
      fbaFeeCents: raw.fba_fee ? Math.round(parseMoney(raw.fba_fee) * 100) : 550,
      referralRate: raw.referral_rate ? parseRate(raw.referral_rate) : 0.15,
      adRate: raw.ad_rate ? parseRate(raw.ad_rate) : 0.12,
      returnRate: raw.return_rate ? parseRate(raw.return_rate) : 0.05,
      returnProcessingCents: raw.return_processing ? Math.round(parseMoney(raw.return_processing) * 100) : 300,
      returnRecoveryRate: raw.return_recovery_rate ? parseRate(raw.return_recovery_rate) : 0.3,
      couponCents: raw.coupon ? Math.round(parseMoney(raw.coupon) * 100) : 0,
      storageCents: raw.storage_cost ? Math.round(parseMoney(raw.storage_cost) * 100) : 40,
      otherCostCents: raw.other_cost ? Math.round(parseMoney(raw.other_cost) * 100) : 50,
    };
    const economicResult = calculateEconomics(assumptions);
    if (!economicResult.isProfitable) {
      throw new Error(`候选品 CSV 第 ${lineNumber} 行按当前成本模型不盈利，请补充真实成本后再导入`);
    }

    const legacyEstimate = Math.max(0, Math.round(parseNumber(raw.monthly_sales_estimate)));
    const monthlySalesMin = raw.monthly_sales_min
      ? Math.max(0, Math.round(parseNumber(raw.monthly_sales_min)))
      : legacyEstimate;
    const monthlySalesMax = raw.monthly_sales_max
      ? Math.max(0, Math.round(parseNumber(raw.monthly_sales_max)))
      : legacyEstimate;
    if (monthlySalesMax < monthlySalesMin) {
      throw new Error(`候选品 CSV 第 ${lineNumber} 行 monthly_sales_max 不能小于 monthly_sales_min`);
    }
    const monthlySalesEstimate = Math.round((monthlySalesMin + monthlySalesMax) / 2);

    return {
      asin,
      marketplace: (raw.marketplace || "US").toUpperCase(),
      category: raw.category || "未分类",
      title,
      url: raw.url || "",
      competitorPriceCents: salePriceCents,
      currency: normalizeCurrency(raw.currency),
      monthlySalesEstimate,
      monthlySalesMin,
      monthlySalesMax,
      reviewCount: Math.max(0, Math.round(parseNumber(raw.review_count))),
      rating: raw.rating ? clamp(parseNumber(raw.rating), 0, 5) : null,
      bsr: optionalNumber(raw.bsr),
      keyword: raw.keyword || "",
      keywordSearchVolume: optionalNumber(raw.keyword_search_volume),
      sellerCount: optionalNumber(raw.seller_count, true),
      variationCount: optionalNumber(raw.variation_count, true),
      notes: raw.notes || "",
      source: raw.source || "csv_candidates",
      sourceRecordId: raw.source_record_id || asin,
      observedAt: parseObservedAt(raw.observed_at, `候选品 CSV 第 ${lineNumber} 行`),
      assumptions,
      rawPayload: raw,
    };
  });
}

export function parseSupplierCsv(csv: string): SupplierImportRow[] {
  const parsed = parseNamedCsv(csv, supplierHeaderAliases);
  if (!parsed.headers.includes("supplier_name")) {
    throw new Error("供应商 CSV 必须包含 supplier_name（供应商名称）");
  }

  return parsed.rows.map(({ raw, lineNumber }) => {
    const name = raw.supplier_name?.trim();
    if (!name) throw new Error(`供应商 CSV 第 ${lineNumber} 行缺少 supplier_name`);
    return {
      platform: (raw.supplier_platform || "manual").trim().toLowerCase(),
      externalSupplierId: raw.external_supplier_id || "",
      name,
      url: raw.supplier_url || "",
      contact: raw.contact || "",
      country: raw.country || "",
      category: raw.category || "",
      rating: raw.rating ? clamp(parseNumber(raw.rating), 0, 5) : null,
      verified: parseBoolean(raw.verified),
      moq: optionalNumber(raw.moq, true),
      leadTimeDays: optionalNumber(raw.lead_time_days, true),
      certifications: raw.certifications || "",
      observedAt: parseObservedAt(raw.observed_at, `供应商 CSV 第 ${lineNumber} 行`),
      rawPayload: raw,
    };
  });
}

export function parseQuoteCsv(csv: string): QuoteImportRow[] {
  const parsed = parseNamedCsv(csv, quoteHeaderAliases);
  if (!parsed.headers.includes("supplier_name") || !parsed.headers.includes("unit_price")) {
    throw new Error("报价 CSV 必须包含 supplier_name 和 unit_price（供应商名称、采购单价）");
  }
  if (!parsed.headers.includes("asin") && !parsed.headers.includes("case_id")) {
    throw new Error("报价 CSV 必须包含 asin 或 case_id，用于关联已立项商品");
  }

  return parsed.rows.map(({ raw, lineNumber }) => {
    const supplierName = raw.supplier_name?.trim();
    if (!supplierName) throw new Error(`报价 CSV 第 ${lineNumber} 行缺少 supplier_name`);
    const unitPrice = parseMoney(raw.unit_price);
    if (!unitPrice) throw new Error(`报价 CSV 第 ${lineNumber} 行缺少有效的 unit_price`);
    if (!raw.asin && !raw.case_id) throw new Error(`报价 CSV 第 ${lineNumber} 行必须填写 asin 或 case_id`);
    const moq = raw.moq ? Math.max(1, Math.round(parseNumber(raw.moq))) : 1;

    return {
      caseId: raw.case_id || "",
      asin: raw.asin || "",
      marketplace: (raw.marketplace || "US").toUpperCase(),
      supplierPlatform: (raw.supplier_platform || "manual").trim().toLowerCase(),
      externalSupplierId: raw.external_supplier_id || "",
      supplierName,
      supplierUrl: raw.supplier_url || "",
      supplierContact: raw.supplier_contact || "",
      supplierCountry: raw.supplier_country || "",
      supplierCategory: raw.supplier_category || "",
      unitPriceCents: Math.round(unitPrice * 100),
      freightPerUnitCents: Math.max(0, Math.round(parseMoney(raw.freight_per_unit) * 100)),
      dutyRate: raw.duty_rate ? parseRate(raw.duty_rate) : 0,
      qualityScore: raw.quality_score ? clamp(Math.round(parseNumber(raw.quality_score)), 0, 100) : 60,
      moq,
      leadTimeDays: optionalNumber(raw.lead_time_days, true),
      paymentTerms: raw.payment_terms || "",
      incoterm: raw.incoterm || "",
      sampleFeeCents: raw.sample_fee === undefined || raw.sample_fee === "" ? null : Math.max(0, Math.round(parseMoney(raw.sample_fee) * 100)),
      toolingFeeCents: raw.tooling_fee === undefined || raw.tooling_fee === "" ? null : Math.max(0, Math.round(parseMoney(raw.tooling_fee) * 100)),
      certifications: raw.certifications || "",
      quoteValidUntil: parseOptionalDate(raw.quote_valid_until, `报价 CSV 第 ${lineNumber} 行`),
      currency: normalizeCurrency(raw.currency),
      observedAt: parseObservedAt(raw.observed_at, `报价 CSV 第 ${lineNumber} 行`),
      rawPayload: raw,
    };
  });
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    const next = clean[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) records.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (inQuotes) throw new Error("CSV 引号未闭合");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) records.push(row);
  return records;
}

export function normalizeSupplierUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm$|scm$|from$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
}

export function supplierIdentityKey(input: {
  platform: string;
  externalSupplierId?: string;
  url?: string;
  name: string;
}): string {
  const platform = normalizeIdentityPart(input.platform || "manual");
  if (input.externalSupplierId?.trim()) return `${platform}:id:${normalizeIdentityPart(input.externalSupplierId)}`;
  const normalizedUrl = normalizeSupplierUrl(input.url || "");
  if (normalizedUrl) return `${platform}:url:${normalizedUrl}`;
  return `${platform}:name:${normalizeIdentityPart(input.name)}`;
}

function parseNamedCsv(csv: string, aliases: Record<string, string>) {
  const records = parseCsv(csv);
  if (records.length < 2) throw new Error("CSV 至少需要表头和一行数据");
  const headers = records[0].map((header) => aliases[normalizeHeader(header)] ?? normalizeHeader(header));
  const rows = records.slice(1).map((record, index) => {
    const raw: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      raw[header] = (record[headerIndex] ?? "").trim();
    });
    return { raw, lineNumber: index + 2 };
  });
  return { headers, rows };
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeIdentityPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeCurrency(value: string | undefined) {
  return (value || "USD").trim().toUpperCase().slice(0, 3);
}

function parseObservedAt(value: string | undefined, context: string) {
  if (!value) return new Date().toISOString();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${context} observed_at 不是有效日期`);
  return new Date(timestamp).toISOString();
}

function parseOptionalDate(value: string | undefined, context: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${context} quote_valid_until 不是有效日期`);
  return new Date(timestamp).toISOString().slice(0, 10);
}

function parseMoney(value: string | undefined) {
  if (!value) return 0;
  const number = Number(value.replace(/[$,\s¥￥€£，]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function parseNumber(value: string | undefined) {
  if (!value) return 0;
  const number = Number(value.replace(/[$,\s¥￥€£，%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value: string | undefined, integer = false): number | null {
  if (value === undefined || value.trim() === "") return null;
  const number = parseNumber(value);
  return integer ? Math.max(0, Math.round(number)) : number;
}

function parseRate(value: string) {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) return clamp(Number(trimmed.slice(0, -1)) / 100, 0, 1);
  const number = Number(trimmed);
  if (!Number.isFinite(number)) return 0;
  return clamp(number > 1 ? number / 100 : number, 0, 1);
}

function parseBoolean(value: string | undefined) {
  return /^(true|1|yes|y|verified|已认证|认证|是)$/i.test((value || "").trim());
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
