import type {
  SupplierDirectoryItem,
  SupplierProfileMeta,
  SupplierStatus,
  SourcingCaseSummary,
} from "@/lib/types";

export type SupplierQuoteHistoryItem = {
  quoteId: string;
  caseId: string;
  asin: string;
  caseTitle: string;
  marketplace: string;
  unitPriceCents: number;
  priceCny: number | null;
  moq: number;
  leadTimeDays: number | null;
  currency: string;
  isSelected: boolean;
  createdAt: string;
};

export type SupplierSampleHistoryItem = {
  id: string;
  caseId: string;
  supplierName: string;
  totalCostCny: number;
  trackingNo: string;
  status: string;
  qualityRating: number | null;
  pros: string;
  defects: string;
  createdAt: string;
};

export type SupplierDetailData = {
  quoteHistory: SupplierQuoteHistoryItem[];
  sampleHistory: SupplierSampleHistoryItem[];
};

export const STATUS_META: Record<SupplierStatus, { label: string; badgeClass: string }> = {
  new: { label: "待联系", badgeClass: "badge-neutral" },
  contacted: { label: "已加微信", badgeClass: "status-review_pending" },
  sampled: { label: "已拿样", badgeClass: "status-researching" },
  preferred: { label: "⭐ 核心优选厂", badgeClass: "badge-success" },
  blacklisted: { label: "🚫 黑名单避雷", badgeClass: "badge-danger" },
};

export const SAMPLE_STATUS_LABEL: Record<string, string> = {
  ordered: "已下单",
  shipped: "已寄出",
  received: "已签收",
  passed: "验货通过",
  rejected: "验货淘汰",
};

export function getProfile(supplier: SupplierDirectoryItem): SupplierProfileMeta {
  return supplier.profile && typeof supplier.profile === "object" ? supplier.profile : {};
}

export function getStatus(supplier: SupplierDirectoryItem): SupplierStatus {
  const status = getProfile(supplier).status;
  if (status && status in STATUS_META) return status;
  return "new";
}

export function buildRfqScript(supplier: SupplierDirectoryItem, selectedCase: SourcingCaseSummary | undefined): string {
  const profile = getProfile(supplier);
  const contactName = supplier.contact && supplier.contact !== "待补充" ? `${supplier.contact}您好` : "您好";
  const productLine = selectedCase
    ? `我们正在做亚马逊 ${selectedCase.productCase.marketplace} 站点的「${selectedCase.productCase.title}」`
    : "我们正在选品开发跨境电商货源";
  const moqHint = profile.moq ? `${profile.moq} 件` : "100 / 300 / 500 件";
  return [
    `${contactName}，在 1688 看到贵司（${supplier.name}）的产品，${productLine}，想咨询一下拿货合作：`,
    `1. 请问该款目前现货阶梯拿货价是多少（${moqHint} 分别什么价格，是否含税/开票）？`,
    `2. 支持拿 1-2 个样品测品质吗？样品费和寄样时间大概多久？`,
    `3. 后续如果走亚马逊 FBA，支持小批量贴牌 OEM / 定制彩盒 / 贴 FNSKU 条码吗？起订量各是多少？`,
    `4. 方便提供一下单品净重、彩盒尺寸以及整箱装箱规格（长宽高/箱规毛重）吗？我们需要核算头程运费。`,
    `方便的话留个微信，我们发参考图和具体需求给您核价，感谢！`,
  ].join("\n");
}

export function sourcingStage(quoteCount: number, eligibleCount: number, selected: boolean) {
  if (selected) return { label: "已定标", className: "badge-success" };
  if (eligibleCount >= 3) return { label: "可进入定标", className: "badge-success" };
  if (quoteCount === 0) return { label: "待发起询价", className: "badge-neutral" };
  if (eligibleCount < 3) return { label: `有效报价 ${eligibleCount}/3`, className: "status-review_pending" };
  return { label: "评估中", className: "status-researching" };
}

