export type SupplierScorePart = {
  key: "product_match" | "trust" | "price_moq" | "fulfillment" | "evidence";
  label: string;
  points: number;
  maxPoints: number;
  reason: string;
};

export type ParsedSupplierCandidate = {
  title: string;
  supplierName: string;
  platform: string;
  offerUrl: string;
  supplierUrl: string;
  priceCents: number | null;
  currency: string;
  moq: number | null;
  location: string;
  badges: string[];
  leadTimeDays: number | null;
  sourceText: string;
  observedAt: string;
  offerId: string | null;
  fingerprint: string;
  score: number;
  scoreParts: SupplierScorePart[];
  reasons: string[];
  riskNotes: string[];
};

export type SupplierCandidateParseResult = {
  candidates: ParsedSupplierCandidate[];
  receivedCount: number;
  duplicateCount: number;
  pageUrl: string | null;
  capturedAt: string;
  source: string;
  warnings: string[];
};

type ParseOptions = {
  query?: string;
  observedAt?: string;
  platform?: string;
};

type RawCandidate = Record<string, unknown>;

type NormalizedDraft = Omit<
  ParsedSupplierCandidate,
  "fingerprint" | "score" | "scoreParts" | "reasons" | "riskNotes"
> & {
  riskNotes: string[];
};

const MAX_INPUT_LENGTH = 500_000;
const MAX_CANDIDATES = 200;
const MAX_TITLE_LENGTH = 500;
const MAX_SOURCE_TEXT_LENGTH = 8_000;

const TITLE_KEYS = ["title", "productTitle", "name", "产品标题", "商品标题", "名称"];
const SUPPLIER_KEYS = ["supplierName", "companyName", "shopName", "sellerName", "供应商", "公司名称", "店铺名称"];
const PLATFORM_KEYS = ["platform", "sourcePlatform", "平台"];
const OFFER_URL_KEYS = ["offerUrl", "detailUrl", "productUrl", "url", "链接", "商品链接"];
const SUPPLIER_URL_KEYS = ["supplierUrl", "shopUrl", "companyUrl", "店铺链接", "供应商链接"];
const PRICE_KEYS = ["price", "unitPrice", "价格", "单价"];
const CURRENCY_KEYS = ["currency", "币种"];
const MOQ_KEYS = ["moq", "minimumOrderQuantity", "起订量", "起批量"];
const LOCATION_KEYS = ["location", "province", "city", "所在地", "地区"];
const BADGE_KEYS = ["badges", "trustSignals", "services", "tags", "标签", "服务", "认证"];
const LEAD_TIME_KEYS = ["leadTimeDays", "deliveryDays", "交期", "发货天数"];
const SOURCE_TEXT_KEYS = ["sourceText", "cardText", "原文", "页面文本"];
const OBSERVED_AT_KEYS = ["observedAt", "capturedAt", "采集时间"];
const OFFER_ID_KEYS = ["offerId", "offer_id", "商品ID", "货号"];

const TRUST_RULES: Array<{ pattern: RegExp; points: number; label: string }> = [
  { pattern: /实力商家|实力工厂|超级工厂|源头工厂/, points: 6, label: "实力/工厂标签" },
  { pattern: /深度验厂|验厂报告|实地认证/, points: 5, label: "验厂信息" },
  { pattern: /诚信通|诚信档案/, points: 4, label: "诚信通" },
  { pattern: /1688严选|严选|工业品牌/, points: 3, label: "平台严选" },
  { pattern: /回头率|复购率|老客/, points: 2, label: "复购信号" },
];

export function parseSupplierCandidatePayload(
  payload: string,
  options: ParseOptions = {},
): SupplierCandidateParseResult {
  if (typeof payload !== "string" || !payload.trim()) {
    throw new Error("请粘贴采集结果或当前页文本");
  }
  if (payload.length > MAX_INPUT_LENGTH) {
    throw new Error("采集内容过大，请一次只采集当前搜索结果页");
  }

  const trimmed = payload.trim();
  const json = tryParseJson(trimmed);
  const rawCandidates = json
    ? extractJsonCandidates(json)
    : parseTextCandidates(trimmed);
  if (rawCandidates.length === 0) {
    throw new Error("没有识别到候选商品，请确认当前页是 1688 搜索结果页后重新采集");
  }
  if (rawCandidates.length > MAX_CANDIDATES) {
    throw new Error(`一次最多处理 ${MAX_CANDIDATES} 个候选，请缩小搜索结果范围`);
  }

  const platform = cleanText(options.platform ?? "") || "1688";
  const fallbackObservedAt = normalizeIsoDate(options.observedAt ?? "") ?? new Date().toISOString();
  const metadata = json && isRecord(json) ? json : {};
  const capturedAt =
    normalizeIsoDate(pickString(metadata, OBSERVED_AT_KEYS)) ?? fallbackObservedAt;
  const pageUrl = normalizeHttpUrl(pickString(metadata, ["pageUrl", "sourceUrl", "页面地址"]));
  const drafts = rawCandidates
    .map((candidate) => normalizeCandidate(candidate, { ...options, platform, capturedAt }))
    .filter((candidate): candidate is NormalizedDraft => candidate !== null);

  if (drafts.length === 0) {
    throw new Error("候选缺少标题或有效链接，未写入候选池");
  }

  const deduplicated = deduplicateCandidates(drafts);
  const scored = deduplicated
    .map((candidate) => scoreCandidate(candidate, options.query ?? ""))
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN"))
    .slice(0, 10);

  return {
    candidates: scored,
    receivedCount: rawCandidates.length,
    duplicateCount: Math.max(0, drafts.length - deduplicated.length),
    pageUrl,
    capturedAt,
    source: pickString(metadata, ["source"]) || "visible_page_capture",
    warnings: [
      "候选信息来自用户当前可见页面，尚未核验供应商主体、资质、报价有效期和产品一致性。",
      ...(deduplicated.length > scored.length ? [`已按评分保留前 ${scored.length} 个候选。`] : []),
    ],
  };
}

function extractJsonCandidates(value: unknown): RawCandidate[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) return [];
  for (const key of ["candidates", "offers", "items", "results", "data"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
    if (isRecord(nested)) {
      const candidates = extractJsonCandidates(nested);
      if (candidates.length > 0) return candidates;
    }
  }
  return isRecord(value) ? [value] : [];
}

function parseTextCandidates(text: string): RawCandidate[] {
  const blocks = text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length <= 1) {
    const urlLines = text.split(/\r?\n/).filter((line) => /https?:\/\//i.test(line));
    if (urlLines.length === 0) return [];
    return urlLines.map((line) => ({ sourceText: line, url: firstUrl(line) }));
  }

  return blocks.map((block) => {
    const lines = block.split(/\r?\n/).map(cleanText).filter(Boolean);
    const url = firstUrl(block);
    const supplierLine = lines.find((line) => /供应商|店铺|公司|工厂/.test(line));
    const title =
      lines.find((line) => !/https?:\/\//i.test(line) && !/^[¥￥]?\s*\d/.test(line)) ?? "";
    return {
      title,
      supplierName: supplierLine ?? "",
      url,
      sourceText: block,
      price: firstMatch(block, /[¥￥]\s*[0-9]+(?:\.[0-9]+)?/),
      moq: firstMatch(block, /[0-9]+\s*(?:件|个|套|只|台|箱|千克|kg)\s*起/),
      location: firstMatch(block, /(?:广东|浙江|江苏|福建|山东|河北|河南|湖北|湖南|安徽|江西|上海|北京|天津|重庆|四川|辽宁|吉林|黑龙江|陕西|山西|云南|贵州|广西|海南|甘肃|青海|宁夏|新疆|内蒙古|西藏)(?:省|市|自治区)?[^\n]{0,18}/),
    };
  });
}

function normalizeCandidate(
  raw: RawCandidate,
  options: ParseOptions & { platform: string; capturedAt: string },
): NormalizedDraft | null {
  const sourceText = truncate(cleanText(pickString(raw, SOURCE_TEXT_KEYS)), MAX_SOURCE_TEXT_LENGTH);
  const title = truncate(
    cleanText(pickString(raw, TITLE_KEYS)) || inferTitle(sourceText),
    MAX_TITLE_LENGTH,
  );
  const offerUrl = normalizeHttpUrl(pickString(raw, OFFER_URL_KEYS));
  const supplierUrl = normalizeHttpUrl(pickString(raw, SUPPLIER_URL_KEYS));
  if (!title || (!offerUrl && !supplierUrl)) return null;

  const badges = normalizeBadges(pick(raw, BADGE_KEYS), sourceText);
  const parsedPrice = parsePrice(pick(raw, PRICE_KEYS), pickString(raw, CURRENCY_KEYS), sourceText);
  const parsedMoq = parsePositiveInteger(pick(raw, MOQ_KEYS)) ?? inferMoq(sourceText);
  const leadTimeDays = parseLeadTimeDays(pick(raw, LEAD_TIME_KEYS)) ?? inferLeadTimeDays(sourceText);
  const supplierName =
    truncate(cleanText(pickString(raw, SUPPLIER_KEYS)), 180) || inferSupplierName(sourceText);
  const platform = truncate(cleanText(pickString(raw, PLATFORM_KEYS)) || options.platform, 60) || "1688";
  const location = truncate(cleanText(pickString(raw, LOCATION_KEYS)), 120);
  const observedAt =
    normalizeIsoDate(pickString(raw, OBSERVED_AT_KEYS)) ?? options.capturedAt;
  const offerId = extractOfferId(pickString(raw, OFFER_ID_KEYS), offerUrl);
  const riskNotes: string[] = [];

  if (!supplierName) riskNotes.push("未识别供应商名称，需打开链接核对店铺主体");
  if (!parsedPrice.priceCents) riskNotes.push("未识别价格，不能直接用于比价");
  if (parsedPrice.isRange) riskNotes.push("识别为价格区间，当前按最低价记录");
  if (!parsedMoq) riskNotes.push("未识别 MOQ，需向供应商确认");
  if (!leadTimeDays) riskNotes.push("未识别交期，需向供应商确认");
  if (!supplierUrl) riskNotes.push("未识别供应商主页，需补核验");
  if (!location) riskNotes.push("未识别经营地区");

  return {
    title,
    supplierName: supplierName || "待核验供应商",
    platform,
    offerUrl,
    supplierUrl,
    priceCents: parsedPrice.priceCents,
    currency: parsedPrice.currency,
    moq: parsedMoq,
    location,
    badges,
    leadTimeDays,
    sourceText,
    observedAt,
    offerId,
    riskNotes,
  };
}

function scoreCandidate(candidate: NormalizedDraft, query: string): ParsedSupplierCandidate {
  const fingerprint = candidateFingerprint(candidate);
  const combinedText = `${candidate.title} ${candidate.sourceText} ${candidate.badges.join(" ")}`;
  const queryTerms = tokenizeForMatch(query);
  const matchedTerms = queryTerms.filter((term) => normalizeMatchText(combinedText).includes(term));
  const exactQueryMatch = queryTerms.length > 1 && normalizeMatchText(combinedText).includes(normalizeMatchText(query));
  const productCoverage = queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;
  const productPoints = queryTerms.length === 0
    ? 12
    : Math.min(30, Math.round((exactQueryMatch ? 0.85 : productCoverage) * 30));

  const trustMatches = TRUST_RULES.filter((rule) => rule.pattern.test(combinedText));
  const trustPoints = Math.min(
    25,
    (candidate.supplierUrl ? 4 : 0) + trustMatches.reduce((sum, rule) => sum + rule.points, 0),
  );

  const pricePoints = candidate.priceCents ? 7 : 0;
  const moqPoints = candidate.moq
    ? 5 + (candidate.moq <= 10 ? 5 : candidate.moq <= 50 ? 3 : candidate.moq <= 100 ? 1 : 0)
    : 0;
  const priceMoqPoints = Math.min(20, pricePoints + moqPoints + (candidate.currency ? 3 : 0));

  const leadTimePoints = candidate.leadTimeDays
    ? candidate.leadTimeDays <= 3
      ? 9
      : candidate.leadTimeDays <= 7
        ? 7
        : candidate.leadTimeDays <= 15
          ? 4
          : 2
    : 0;
  const servicePoints = /24小时发货|24h发货|当日发货|48小时发货|48h发货/.test(combinedText)
    ? 4
    : /准时发货|发货保障|7天包换/.test(combinedText)
      ? 2
      : 0;
  const fulfillmentPoints = Math.min(15, leadTimePoints + servicePoints);

  let evidencePoints = 2;
  if (candidate.offerUrl) evidencePoints += 2;
  if (candidate.supplierUrl) evidencePoints += 2;
  if (candidate.location) evidencePoints += 1;
  if (candidate.sourceText.length >= 40) evidencePoints += 1;
  if (candidate.badges.length > 0) evidencePoints += 1;
  if (candidate.observedAt) evidencePoints += 1;
  if (candidate.riskNotes.some((note) => /价格|MOQ|交期/.test(note))) evidencePoints -= 1;
  evidencePoints = clamp(evidencePoints, 0, 10);

  const scoreParts: SupplierScorePart[] = [
    {
      key: "product_match",
      label: "产品匹配",
      points: productPoints,
      maxPoints: 30,
      reason: queryTerms.length === 0
        ? "未提供检索词，仅按标题可用性给基础分"
        : `命中 ${matchedTerms.length}/${queryTerms.length} 个检索要素${exactQueryMatch ? "，包含完整搜索词" : ""}`,
    },
    {
      key: "trust",
      label: "供应商信号",
      points: trustPoints,
      maxPoints: 25,
      reason: [
        candidate.supplierUrl ? "有店铺链接" : "缺店铺链接",
        ...trustMatches.map((rule) => rule.label),
      ].join(" · "),
    },
    {
      key: "price_moq",
      label: "价格 / MOQ",
      points: priceMoqPoints,
      maxPoints: 20,
      reason: [
        candidate.priceCents ? `价格 ${formatMoney(candidate.priceCents, candidate.currency)}` : "缺价格",
        candidate.moq ? `MOQ ${candidate.moq}` : "缺 MOQ",
      ].join(" · "),
    },
    {
      key: "fulfillment",
      label: "履约信息",
      points: fulfillmentPoints,
      maxPoints: 15,
      reason: candidate.leadTimeDays
        ? `交期 ${candidate.leadTimeDays} 天${servicePoints ? "，有发货服务标签" : ""}`
        : "未识别交期或发货承诺",
    },
    {
      key: "evidence",
      label: "证据完整度",
      points: evidencePoints,
      maxPoints: 10,
      reason: `来源链接、店铺、地区、页面文本共 ${evidencePoints}/10 分；缺项见风险提示`,
    },
  ];

  return {
    ...candidate,
    fingerprint,
    score: scoreParts.reduce((sum, part) => sum + part.points, 0),
    scoreParts,
    reasons: scoreParts.map((part) => `${part.label}：${part.reason}`),
    riskNotes: candidate.riskNotes,
  };
}

function deduplicateCandidates(candidates: NormalizedDraft[]): NormalizedDraft[] {
  const byKey = new Map<string, NormalizedDraft>();
  for (const candidate of candidates) {
    const key = dedupeKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    const merged: NormalizedDraft = {
      ...existing,
      supplierName: existing.supplierName === "待核验供应商" ? candidate.supplierName : existing.supplierName,
      supplierUrl: existing.supplierUrl || candidate.supplierUrl,
      priceCents: existing.priceCents ?? candidate.priceCents,
      moq: existing.moq ?? candidate.moq,
      location: existing.location || candidate.location,
      leadTimeDays: existing.leadTimeDays ?? candidate.leadTimeDays,
      badges: uniqueStrings([...existing.badges, ...candidate.badges]).slice(0, 12),
      riskNotes: uniqueStrings([...existing.riskNotes, ...candidate.riskNotes]),
    };
    byKey.set(key, {
      ...merged,
      riskNotes: reconcileRiskNotes(merged),
    });
  }
  return [...byKey.values()];
}

function reconcileRiskNotes(candidate: NormalizedDraft) {
  return candidate.riskNotes.filter((note) => {
    if (note.startsWith("未识别供应商名称") && candidate.supplierName !== "待核验供应商") return false;
    if (note.startsWith("未识别价格") && candidate.priceCents) return false;
    if (note.startsWith("未识别 MOQ") && candidate.moq) return false;
    if (note.startsWith("未识别交期") && candidate.leadTimeDays) return false;
    if (note.startsWith("未识别供应商主页") && candidate.supplierUrl) return false;
    if (note.startsWith("未识别经营地区") && candidate.location) return false;
    return true;
  });
}

function dedupeKey(candidate: NormalizedDraft) {
  if (candidate.offerId) return `offer:${candidate.offerId}`;
  if (candidate.offerUrl) return `url:${candidate.offerUrl.toLocaleLowerCase("en-US")}`;
  return `supplier:${candidate.supplierUrl.toLocaleLowerCase("en-US")}|${normalizeMatchText(candidate.title)}`;
}

function candidateFingerprint(candidate: NormalizedDraft) {
  return stableHash(dedupeKey(candidate)).toString(16).padStart(16, "0");
}

function stableHash(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

function tokenizeForMatch(value: string): string[] {
  const normalized = normalizeMatchText(value);
  if (!normalized) return [];
  const tokens = new Set<string>();
  for (const token of normalized.match(/[a-z0-9]{2,}/g) ?? []) tokens.add(token);
  for (const sequence of normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    if (sequence.length <= 4) {
      tokens.add(sequence);
      continue;
    }
    for (let index = 0; index < sequence.length - 1; index += 1) {
      tokens.add(sequence.slice(index, index + 2));
    }
  }
  return [...tokens];
}

function normalizeMatchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function extractOfferId(explicit: string, offerUrl: string) {
  const direct = explicit.trim();
  if (/^\d{5,}$/.test(direct)) return direct;
  const match = offerUrl.match(/\/offer\/(\d+)\.html|[?&](?:offerId|offer_id)=(\d+)/i);
  return match?.[1] ?? match?.[2] ?? null;
}

function parsePrice(value: unknown, explicitCurrency: string, sourceText: string) {
  const text = Array.isArray(value) ? value.join("-") : cleanText(String(value ?? ""));
  const fallbackMatch = sourceText.match(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)(?:\s*[-~至]\s*([0-9]+(?:\.[0-9]+)?))?/);
  const raw = text || fallbackMatch?.[0] || "";
  const numbers = raw.match(/[0-9]+(?:\.[0-9]+)?/g) ?? [];
  const first = Number(numbers[0]);
  const isRange = numbers.length > 1 || /\s[-~至]\s/.test(raw);
  const currency = normalizeCurrency(explicitCurrency) || inferCurrency(`${text} ${sourceText}`);
  return {
    priceCents: Number.isFinite(first) && first > 0 ? Math.round(first * 100) : null,
    currency,
    isRange,
  };
}

function parsePositiveInteger(value: unknown) {
  const text = Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  const match = text.match(/[0-9]+/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseLeadTimeDays(value: unknown) {
  const text = Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  if (!text) return null;
  const days = text.match(/([0-9]+)\s*(?:天|日)/);
  if (days) return positiveInteger(Number(days[1]));
  const hours = text.match(/([0-9]+)\s*(?:小时|h)/i);
  if (hours) return positiveInteger(Math.ceil(Number(hours[1]) / 24));
  return positiveInteger(Number(text));
}

function inferMoq(text: string) {
  const match = text.match(/([0-9]+)\s*(?:件|个|套|只|台|箱|千克|kg)\s*起/i);
  return match ? positiveInteger(Number(match[1])) : null;
}

function inferLeadTimeDays(text: string) {
  const match = text.match(/([0-9]+)\s*(?:天|日)(?:内)?(?:发货|交货|发出)/) ?? text.match(/交期\s*([0-9]+)\s*天/);
  return match ? positiveInteger(Number(match[1])) : null;
}

function inferTitle(text: string) {
  return text
    .split(/\r?\n/)
    .map(cleanText)
    .find((line) => line.length >= 4 && !/https?:\/\//i.test(line) && !/^[¥￥]?\s*\d/.test(line)) ?? "";
}

function inferSupplierName(text: string) {
  const line = text
    .split(/\r?\n/)
    .map(cleanText)
    .find((item) => /供应商|店铺|公司|工厂/.test(item) && item.length <= 120);
  return line ? truncate(line, 180) : "";
}

function normalizeBadges(value: unknown, sourceText: string) {
  const raw = Array.isArray(value)
    ? value.map(String)
    : cleanText(String(value ?? "")).split(/[,，;；|/、]+/);
  const fromText = ["实力商家", "深度验厂", "诚信通", "超级工厂", "源头工厂", "1688严选", "24小时发货", "48小时发货", "准时发货", "7天包换"]
    .filter((badge) => sourceText.includes(badge));
  return uniqueStrings([...raw, ...fromText].map(cleanText).filter((item) => item && item.length <= 30)).slice(0, 12);
}

function normalizeCurrency(value: string) {
  const normalized = cleanText(value).toLocaleUpperCase("en-US");
  if (/^(CNY|RMB|人民币|元)$/.test(normalized)) return "CNY";
  if (/^(USD|美元|\$)$/.test(normalized)) return "USD";
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  return "";
}

function inferCurrency(text: string) {
  if (/美元|USD|\$/i.test(text)) return "USD";
  if (/欧元|EUR|€/i.test(text)) return "EUR";
  if (/英镑|GBP|£/i.test(text)) return "GBP";
  return "CNY";
}

function normalizeIsoDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeHttpUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(spm|from|source|scene|src|traceid|clickid|utm_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function pick(record: RawCandidate, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function pickString(record: RawCandidate, keys: string[]) {
  const value = pick(record, keys);
  if (Array.isArray(value)) return value.map(String).join(" ");
  return cleanText(String(value ?? ""));
}

function tryParseJson(value: string): unknown | null {
  if (!/^[\[{]/.test(value)) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("采集结果不是有效 JSON，请重新点击采集书签");
  }
}

function firstUrl(value: string) {
  return value.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? "";
}

function firstMatch(value: string, pattern: RegExp) {
  return value.match(pattern)?.[0] ?? "";
}

function cleanText(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function positiveInteger(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function formatMoney(cents: number, currency: string) {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
