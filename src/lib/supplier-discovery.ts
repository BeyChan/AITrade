export type SupplierLead = {
  role: string;
  query: string;
  note: string;
};

type SupplierLeadInput = {
  concept: string;
  category: string;
  targetUser?: string;
  supplierKeywords?: string[];
};

type LeadTemplate = {
  role: string;
  note: string;
  fallback: (input: SupplierLeadInput) => string;
};

const LEAD_TEMPLATES: LeadTemplate[] = [
  {
    role: "核心品名",
    note: "先用最准确的中文品名找同类货源，重点核对材质、尺寸和结构。",
    fallback: ({ concept }) => concept,
  },
  {
    role: "功能 / 结构",
    note: "补充关键功能和结构词，缩小到真正可替代的款式。",
    fallback: ({ concept }) => `${concept} 功能结构`,
  },
  {
    role: "使用场景",
    note: "用目标人群和使用场景找细分款，避免只看到泛品类通货。",
    fallback: ({ concept, category, targetUser }) => `${category} ${targetUser || "目标用户"} ${concept}`,
  },
  {
    role: "源头工厂",
    note: "优先核验工厂资质、主营类目、真实地址和可提供的认证。",
    fallback: ({ concept }) => `${concept} 源头工厂 OEM`,
  },
  {
    role: "跨境批发",
    note: "面向跨境卖家寻找小批量、贴牌和英文包装能力，不把搜索命中当成供应商已核验。",
    fallback: ({ concept }) => `${concept} 跨境专供 Wholesale`,
  },
];

export function buildSupplierLeads(input: SupplierLeadInput): SupplierLead[] {
  const concept = cleanText(input.concept) || "当前候选品";
  const category = cleanText(input.category) || "目标品类";
  const targetUser = cleanText(input.targetUser);
  const keywords = uniqueQueries(input.supplierKeywords ?? []);
  const used = new Set<string>();
  let keywordIndex = 0;

  return LEAD_TEMPLATES.map((template, index) => {
    let query = "";
    while (keywordIndex < keywords.length && !query) {
      const candidate = keywords[keywordIndex++];
      if (!used.has(queryKey(candidate))) query = candidate;
    }
    if (!query) {
      query = cleanText(template.fallback({ concept, category, targetUser }));
    }

    let key = queryKey(query);
    if (used.has(key)) {
      query = `${query} ${template.role}`;
      key = queryKey(query);
    }
    let suffix = 2;
    while (used.has(key)) {
      query = `${template.fallback({ concept, category, targetUser })} ${index + 1}-${suffix}`;
      key = queryKey(query);
      suffix += 1;
    }
    used.add(key);

    return {
      role: template.role,
      query,
      note: template.note,
    };
  });
}

export function supplier1688SearchUrl(query: string) {
  return `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(query)}`;
}

export function supplierAlibabaSearchUrl(query: string) {
  return `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(query)}`;
}

export function supplierGoogleSearchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${query} 工厂 OEM wholesale supplier`)}`;
}

function uniqueQueries(values: string[]) {
  const seen = new Set<string>();
  return values
    .map(cleanText)
    .filter((value) => {
      if (!value) return false;
      const key = queryKey(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function cleanText(value: string | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function queryKey(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}
