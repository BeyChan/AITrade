export type ListingDraftContent = {
  brand: string;
  title: string;
  bullets: string[];
  description: string;
  searchTerms: string;
};

export type PreflightSeverity = "error" | "warning";

export type PreflightFinding = {
  code: string;
  severity: PreflightSeverity;
  field: "brand" | "title" | "bullets" | "description" | "searchTerms" | "claims";
  message: string;
};

export type ListingPreflightResult = {
  passed: boolean;
  score: number;
  errorCount: number;
  warningCount: number;
  findings: PreflightFinding[];
  benchmarkAdvisories?: PreflightFinding[];
  metrics: {
    titleChars: number;
    bulletCount: number;
    filledBulletCount: number;
    maxBulletChars: number;
    descriptionChars: number;
    searchTermsBytes: number;
  };
};

const MAX_TITLE_CHARS = 200;
const MAX_BULLET_CHARS = 500;
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_SEARCH_TERMS_BYTES = 250;

export function emptyListingContent(): ListingDraftContent {
  return { brand: "", title: "", bullets: ["", "", "", "", ""], description: "", searchTerms: "" };
}

export function normalizeListingContent(input: Partial<ListingDraftContent>): ListingDraftContent {
  const bullets = Array.isArray(input.bullets) ? input.bullets.map((item) => String(item ?? "").trim()) : [];
  while (bullets.length < 5) bullets.push("");
  return {
    brand: String(input.brand ?? "").trim(),
    title: String(input.title ?? "").trim(),
    bullets: bullets.slice(0, 5),
    description: String(input.description ?? "").trim(),
    searchTerms: String(input.searchTerms ?? "").trim(),
  };
}

export function preflightListing(input: Partial<ListingDraftContent>): ListingPreflightResult {
  const content = normalizeListingContent(input);
  const findings: PreflightFinding[] = [];
  const add = (code: string, severity: PreflightSeverity, field: PreflightFinding["field"], message: string) => {
    findings.push({ code, severity, field, message });
  };

  if (!content.brand) add("BRAND_EMPTY", "warning", "brand", "未填写品牌名，发布前需确认使用哪个品牌或白牌方案。");
  if (!content.title) {
    add("TITLE_EMPTY", "error", "title", "标题不能为空。");
  } else {
    if (content.title.length > MAX_TITLE_CHARS) {
      add("TITLE_TOO_LONG", "error", "title", `标题 ${content.title.length} 字符，超过保守上限 ${MAX_TITLE_CHARS}。`);
    }
    if (content.title.length < 40) {
      add("TITLE_SHORT", "warning", "title", "标题少于 40 个字符，可能没有充分表达品类、核心功能和适用对象。");
    }
    if (isMostlyUppercase(content.title)) {
      add("TITLE_ALLCAPS", "warning", "title", "标题大部分为大写字母，可读性和平台规范风险较高。");
    }
  }

  const filledBullets = content.bullets.filter(Boolean);
  if (filledBullets.length < 5) {
    add("BULLETS_INCOMPLETE", "error", "bullets", `五点描述需要填满 5 条，当前为 ${filledBullets.length} 条。`);
  }
  content.bullets.forEach((bullet, index) => {
    if (!bullet) return;
    if (bullet.length > MAX_BULLET_CHARS) {
      add(`BULLET_${index + 1}_TOO_LONG`, "error", "bullets", `第 ${index + 1} 条卖点 ${bullet.length} 字符，超过保守上限 ${MAX_BULLET_CHARS}。`);
    }
    if (bullet.length < 35) {
      add(`BULLET_${index + 1}_SHORT`, "warning", "bullets", `第 ${index + 1} 条卖点较短，建议补充具体场景、规格或使用结果。`);
    }
  });

  const normalizedBullets = filledBullets.map((bullet) => bullet.toLowerCase().replace(/\s+/g, " "));
  if (new Set(normalizedBullets).size !== normalizedBullets.length) {
    add("BULLETS_DUPLICATE", "warning", "bullets", "存在重复卖点，建议覆盖不同购买理由。");
  }

  if (!content.description) {
    add("DESCRIPTION_EMPTY", "error", "description", "商品描述不能为空。");
  } else if (content.description.length > MAX_DESCRIPTION_CHARS) {
    add("DESCRIPTION_TOO_LONG", "error", "description", `商品描述 ${content.description.length} 字符，超过保守上限 ${MAX_DESCRIPTION_CHARS}。`);
  }

  const searchTermsBytes = new TextEncoder().encode(content.searchTerms).length;
  if (!content.searchTerms) {
    add("SEARCH_TERMS_EMPTY", "error", "searchTerms", "后台搜索词不能为空。");
  } else if (searchTermsBytes > MAX_SEARCH_TERMS_BYTES) {
    add("SEARCH_TERMS_TOO_LONG", "error", "searchTerms", `后台搜索词 ${searchTermsBytes} 字节，超过保守上限 ${MAX_SEARCH_TERMS_BYTES}。`);
  }
  if (/[,，;；]/.test(content.searchTerms)) {
    add("SEARCH_TERMS_PUNCTUATION", "warning", "searchTerms", "搜索词包含逗号或分号；多数平台更适合用空格分隔。");
  }

  const visibleText = [content.title, ...content.bullets, content.description].join("\n");
  for (const claim of findRiskyClaims(visibleText)) {
    add(`CLAIM_${claim.code}`, "warning", "claims", `检测到可能需要证据或合规审核的表述：“${claim.term}”。`);
  }
  if (!content.description.includes(content.brand) && content.brand) {
    add("BRAND_NOT_IN_DESCRIPTION", "warning", "brand", "品牌名没有出现在商品描述中，请确认是否符合品牌表达策略。");
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.length - errorCount;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);
  return {
    passed: errorCount === 0,
    score,
    errorCount,
    warningCount,
    findings,
    metrics: {
      titleChars: content.title.length,
      bulletCount: content.bullets.length,
      filledBulletCount: filledBullets.length,
      maxBulletChars: Math.max(0, ...content.bullets.map((bullet) => bullet.length)),
      descriptionChars: content.description.length,
      searchTermsBytes,
    },
  };
}

function isMostlyUppercase(value: string) {
  const letters = [...value].filter((char) => /[A-Za-z]/.test(char));
  if (letters.length < 12) return false;
  const uppercase = letters.filter((char) => char === char.toUpperCase()).length;
  return uppercase / letters.length > 0.75;
}

export function findRiskyClaims(value: string) {
  const patterns: Array<{ code: string; pattern: RegExp }> = [
    { code: "BEST", pattern: /\b(?:best|#1|number one)\b/gi },
    { code: "GUARANTEE", pattern: /\b(?:guaranteed|guarantee)\b/gi },
    { code: "MEDICAL", pattern: /\b(?:cure|cures|cured|fda approved|medical grade)\b/gi },
    { code: "PERFECT", pattern: /(?:100%|zero risk)/gi },
    { code: "CN_ABSOLUTE", pattern: /绝对|第一|最佳|治愈|永久|零风险|保证/g },
  ];
  const found = new Map<string, string>();
  for (const { code, pattern } of patterns) {
    for (const match of value.matchAll(pattern)) {
      const term = match[0].trim();
      if (!term) continue;
      found.set(`${code}:${term.toLowerCase()}`, `${code}:${term}`);
    }
  }
  return [...found.entries()].map(([key, value]) => {
    const [code, term] = value.split(/:(.*)/s);
    return { code: code || "REVIEW", term: term || key };
  });
}
