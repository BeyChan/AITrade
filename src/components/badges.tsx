import type { CaseStatus } from "@/lib/types";
import type { TradeGateVerdict } from "@/lib/case-stage";

const statusLabels: Record<CaseStatus, string> = {
  draft: "候选",
  researching: "候选",
  review_pending: "待验证",
  approved: "正式推进",
  rejected: "已归档",
  archived: "已归档",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge status-${status}`}>{statusLabels[status] ?? status}</span>;
}

export function RecommendationBadge({ value }: { value: "GO" | "HOLD" | "NO-GO" | TradeGateVerdict }) {
  if (value === "NO-GO_EXCEPTION") {
    return <span className="badge status-review_pending">NO-GO 例外通过</span>;
  }
  return <span className={`badge recommendation-${value.toLowerCase()}`}>{value}</span>;
}

export function DecisionBadge({ value }: { value: string | null }) {
  if (!value) return <span className="badge badge-neutral">待验证</span>;
  return <span className={`badge ${value === "approved" ? "badge-success" : "badge-danger"}`}>{value === "approved" ? "通过" : "否决"}</span>;
}
