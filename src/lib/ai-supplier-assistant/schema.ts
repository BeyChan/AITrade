export const SUPPLIER_DRAFT_TYPES = ["rfq", "followup", "expiry_reminder"] as const;

export type SupplierDraftType = (typeof SUPPLIER_DRAFT_TYPES)[number];
export type SupplierDraftStatus = "draft" | "reviewed";
export type SupplierDraftGenerationMode = "deterministic" | "model_polished";

export const SUPPLIER_DRAFT_PROMPT_VERSION = "supplier-draft-v1";
export const SUPPLIER_DRAFT_SCHEMA_VERSION = "supplier-draft-schema-v1";

export const SUPPLIER_DRAFT_TYPE_LABELS: Record<SupplierDraftType, string> = {
  rfq: "RFQ 询价草稿",
  followup: "缺失信息追问",
  expiry_reminder: "报价到期提醒",
};

export type SupplierDraftSupplierFact = {
  id: string;
  name: string;
  platform: string;
  url: string;
  country: string | null;
  productMatch: string;
};

export type SupplierDraftQuoteFact = {
  id: string;
  currency: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  landedCostCents: number;
  moq: number;
  leadTimeDays: number;
  sampleFeeCents: number;
  certifications: string;
  paymentTerms: string;
  incoterm: string;
  observedAt: string;
};

export type SupplierDraftFactSnapshot = {
  hypothesis: {
    id: string;
    concept: string;
    category: string;
    targetUser: string;
    painPoint: string;
    differentiator: string;
    mainRisks: string[];
    marketCode: string;
    platformCode: string;
    currency: string;
  };
  supplier: SupplierDraftSupplierFact | null;
  quote: SupplierDraftQuoteFact | null;
  quoteValidUntil: string | null;
};

export type SupplierDraftQuestion = {
  field: string;
  label: string;
  question: string;
};

export type SupplierDraftContent = {
  subject: string;
  introduction: string;
  body: string;
  missingFields: SupplierDraftQuestion[];
  questions: SupplierDraftQuestion[];
};

export type SupplierDraftPolish = {
  subject: string;
  introduction: string;
};

type BuildSupplierDraftInput = {
  draftType: SupplierDraftType;
  facts: SupplierDraftFactSnapshot;
};

export function isSupplierDraftType(value: string): value is SupplierDraftType {
  return (SUPPLIER_DRAFT_TYPES as readonly string[]).includes(value);
}

export function buildDeterministicSupplierDraft(input: BuildSupplierDraftInput): SupplierDraftContent {
  const { draftType, facts } = input;
  const concept = facts.hypothesis.concept.trim();
  const supplierName = facts.supplier?.name.trim() || "供应商";
  let subject: string;
  let introduction: string;
  let missingFields: SupplierDraftQuestion[];
  let questions: SupplierDraftQuestion[];

  if (draftType === "rfq") {
    subject = `询价：${concept}`;
    introduction = `您好，我们正在评估「${concept}」这个产品方向，希望向贵司获取可核实的产品信息和报价。该产品方向面向 ${facts.hypothesis.marketCode} 市场的 ${facts.hypothesis.targetUser}，重点关注 ${facts.hypothesis.painPoint}。`;
    missingFields = rfqMissingFields(facts);
    questions = missingFields;
  } else if (draftType === "followup") {
    subject = `补充确认：${concept}`;
    introduction = `您好，感谢此前就「${concept}」进行沟通。我们是 ${facts.hypothesis.marketCode} 市场的跨境卖家，现需要补充以下信息，以便完成供应商比价。${facts.supplier ? `本次沟通对象为 ${supplierName}（${facts.supplier.platform}）。` : ""}`;
    missingFields = followupMissingFields(facts);
    questions = missingFields;
  } else {
    const validUntil = facts.quoteValidUntil || "提醒日期";
    subject = `报价有效期确认：${concept}`;
    introduction = `您好，我们正在复核 ${supplierName} 对「${concept}」的报价，内部记录的提醒日期为 ${validUntil}。为避免使用过期信息，希望确认当前报价是否仍然有效。`;
    missingFields = [];
    questions = [
      {
        field: "quoteValidity",
        label: "报价有效期",
        question: `请确认此前报价在 ${validUntil} 前是否仍然有效；如已变化，请给出新的有效期。`,
      },
      {
        field: "priceChange",
        label: "价格与成本变化",
        question: "请确认采购价、运费、MOQ、交期和贸易条款是否发生变化。",
      },
      {
        field: "capacity",
        label: "当前产能",
        question: "请确认当前产能、旺季排期以及可接受的订单数量范围。",
      },
    ];
  }

  return {
    subject,
    introduction,
    body: composeSupplierDraftBody(introduction, questions),
    missingFields,
    questions,
  };
}

export function composeSupplierDraftBody(
  introduction: string,
  questions: SupplierDraftQuestion[],
) {
  const list = questions
    .map((question, index) => `${index + 1}. ${question.question.trim()}`)
    .join("\n");
  return `${introduction.trim()}\n\n请确认以下信息：\n${list}\n\n谢谢。`;
}

export function applySupplierPolish(
  deterministic: SupplierDraftContent,
  polish: SupplierDraftPolish,
): SupplierDraftContent {
  return {
    ...deterministic,
    subject: polish.subject.trim(),
    introduction: polish.introduction.trim(),
    body: composeSupplierDraftBody(polish.introduction, deterministic.questions),
  };
}

export function parseSupplierPolish(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function validateSupplierPolish(
  raw: unknown,
  _deterministic: SupplierDraftContent,
  facts: SupplierDraftFactSnapshot,
): { ok: true; value: SupplierDraftPolish } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "模型输出不是 JSON 对象" };
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  const introduction = typeof raw.introduction === "string" ? raw.introduction.trim() : "";
  if (!subject || subject.length > 160) return { ok: false, error: "模型输出的主题为空或过长" };
  if (!introduction || introduction.length > 1_200) {
    return { ok: false, error: "模型输出的正文为空或过长" };
  }
  if (/```|^\s*[#>*]/m.test(`${subject}\n${introduction}`)) {
    return { ok: false, error: "模型输出包含 Markdown" };
  }
  if (/(已发送|已联系|已下单|已付款|已认证|保证|承诺|最低价|全网最低|包过)/.test(`${subject}\n${introduction}`)) {
    return { ok: false, error: "模型输出包含未经证实或越权表述" };
  }
  if (!`${subject}\n${introduction}`.includes(facts.hypothesis.concept.trim())) {
    return { ok: false, error: "模型输出未保留商品方向" };
  }

  const allowedNumbers = new Set(extractNumericTokens(JSON.stringify(facts)));
  const generatedNumbers = extractNumericTokens(`${subject}\n${introduction}`);
  const inventedNumber = generatedNumbers.find((token) => !allowedNumbers.has(token));
  if (inventedNumber) {
    return { ok: false, error: `模型输出引入了未经提供的事实数字：${inventedNumber}` };
  }

  return { ok: true, value: { subject, introduction } };
}

export function supplierDraftQuestionText(content: Pick<SupplierDraftContent, "questions">) {
  return content.questions.map((question) => question.question).join("\n");
}

function rfqMissingFields(facts: SupplierDraftFactSnapshot): SupplierDraftQuestion[] {
  return [
    {
      field: "specifications",
      label: "产品规格",
      question: "请提供产品规格，包括材质、尺寸、颜色、包装方式和可定制项。",
    },
    {
      field: "targetQuantity",
      label: "目标数量",
      question: "请确认 MOQ、价格阶梯和可接受的首单数量范围。",
    },
    {
      field: "targetPrice",
      label: "价格口径",
      question: `请分别报出厂价、含税价和不含税价，并注明币种（目标站点币种：${facts.hypothesis.currency}）。`,
    },
    {
      field: "certifications",
      label: "认证与合规",
      question: "请确认可提供的认证、检测报告及合规文件，并注明相关费用和周期。",
    },
    {
      field: "sample",
      label: "样品信息",
      question: "请确认样品费、打样周期、寄样方式，以及样品费能否在量产订单中抵扣。",
    },
    {
      field: "leadTime",
      label: "生产交期",
      question: "请确认 MOQ 下的生产交期、旺季交期和发货仓所在地。",
    },
    {
      field: "paymentTerms",
      label: "付款与贸易条款",
      question: "请确认付款条件、贸易条款（EXW/FOB/DDP 等）和报价有效期。",
    },
  ];
}

function followupMissingFields(facts: SupplierDraftFactSnapshot): SupplierDraftQuestion[] {
  const quote = facts.quote;
  const fields: SupplierDraftQuestion[] = [
    {
      field: "specifications",
      label: "产品规格",
      question: `请补充「${facts.hypothesis.concept}」的材质、尺寸、颜色、包装方式和可定制项。`,
    },
    {
      field: "targetQuantity",
      label: "目标数量",
      question: "请确认 MOQ、价格阶梯和可接受的首单数量范围。",
    },
    {
      field: "targetPrice",
      label: "价格口径",
      question: `请明确采购价、运费、税费、币种（目标站点币种：${facts.hypothesis.currency}）和贸易条款。`,
    },
    {
      field: "quoteValidity",
      label: "报价有效期",
      question: "请确认当前报价的有效期；如未提供，请补充明确的失效日期。",
    },
  ];

  if (!quote?.certifications.trim()) {
    fields.push({
      field: "certifications",
      label: "认证与合规",
      question: "请补充可提供的认证、检测报告和合规文件，并注明费用与周期。",
    });
  }
  if (!quote || quote.sampleFeeCents <= 0) {
    fields.push({
      field: "sample",
      label: "样品信息",
      question: "请补充样品费、打样周期、寄样方式，以及样品费能否在量产订单中抵扣。",
    });
  }
  if (!quote) {
    fields.push(
      {
        field: "leadTime",
        label: "生产交期",
        question: "请确认 MOQ 下的生产交期、旺季交期和发货仓所在地。",
      },
      {
        field: "paymentTerms",
        label: "付款条件",
        question: "请确认付款比例、付款节点和结算币种。",
      },
    );
  }
  if (!quote?.incoterm.trim()) {
    fields.push({
      field: "incoterm",
      label: "贸易条款",
      question: "请明确报价对应的贸易条款（EXW/FOB/DDP 等）及费用包含范围。",
    });
  }
  if (!quote?.paymentTerms.trim() && quote) {
    fields.push({
      field: "paymentTerms",
      label: "付款条件",
      question: "请确认付款比例、付款节点和结算币种。",
    });
  }
  return fields;
}

function extractNumericTokens(value: string) {
  return value.match(/\d+(?:\.\d+)?/g) ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
