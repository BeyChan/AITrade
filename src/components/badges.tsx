import type { CaseStatus } from "@/lib/types";

const statusLabels: Record<CaseStatus, string> = {
  draft: "草稿",
  researching: "调研中",
  review_pending: "待立项",
  approved: "已立项",
  rejected: "已否决",
  archived: "已归档",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge status-${status}`}>{statusLabels[status] ?? status}</span>;
}

export function RecommendationBadge({ value }: { value: "GO" | "HOLD" | "NO-GO" }) {
  return <span className={`badge recommendation-${value.toLowerCase()}`}>{value}</span>;
}

export function DecisionBadge({ value }: { value: string | null }) {
  if (!value) return <span className="badge badge-neutral">待审批</span>;
  return <span className={`badge ${value === "approved" ? "badge-success" : "badge-danger"}`}>{value === "approved" ? "通过" : "否决"}</span>;
}
