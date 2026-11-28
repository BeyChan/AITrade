"use client";

import { useState } from "react";
import Link from "next/link";
import { deleteHypothesisAction } from "@/app/actions";
import { SOURCING_GRADE_META, type SourcingGrade } from "@/lib/sourcing-grade";
import type { DetailTab } from "./helpers";

export type SwitcherCandidate = {
  id: string;
  position: number;
  concept: string;
  eliminatedAt: string | null;
  productCaseId: string | null;
  decision: "GO" | "HOLD" | "NO-GO" | null;
  grade: SourcingGrade;
};

export function CandidateSwitcher({
  runId,
  activeTab,
  activeHypothesisId,
  items,
}: {
  runId: string;
  activeTab: DetailTab;
  activeHypothesisId: string | undefined;
  items: SwitcherCandidate[];
}) {
  const [confirmTarget, setConfirmTarget] = useState<SwitcherCandidate | null>(null);

  if (items.length === 0) return null;

  return (
    <>
      <nav className="funnel-candidate-switcher" aria-label="切换同批次候选方向">
        {items.map((item) => {
          const isCurrent = item.id === activeHypothesisId;
          const isElim = Boolean(item.eliminatedAt);
          const isGo = item.decision === "GO";
          const href = `/ai-sourcing/${encodeURIComponent(runId)}?tab=${encodeURIComponent(activeTab)}&hypothesisId=${encodeURIComponent(item.id)}`;

          return (
            <div
              key={item.id}
              className={`funnel-candidate-pill${isCurrent ? " is-current" : ""}${isElim ? " is-eliminated" : ""}`}
            >
              <Link
                href={href}
                className="funnel-candidate-pill-link"
                aria-current={isCurrent ? "page" : undefined}
              >
                <span className="mono">0{item.position}</span>
                <strong title={item.concept}>{item.concept}</strong>
                {isElim ? (
                  <span className="badge badge-danger">已淘汰</span>
                ) : (
                  <>
                    <span className={`badge ${SOURCING_GRADE_META[item.grade].badgeClass}`}>
                      {SOURCING_GRADE_META[item.grade].shortLabel}
                    </span>
                    {item.productCaseId ? (
                      <span className="badge badge-success">已立项</span>
                    ) : isGo ? (
                      <span className="badge badge-success">GO</span>
                    ) : null}
                  </>
                )}
              </Link>
              <button
                type="button"
                className="funnel-candidate-delete-btn"
                title={`删除「${item.concept}」`}
                aria-label={`删除 ${item.concept}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirmTarget(item);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </nav>

      {confirmTarget ? (
        <div
          className="funnel-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-candidate-title"
          onClick={() => setConfirmTarget(null)}
        >
          <div className="funnel-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 id="delete-candidate-title">确认删除这个候选方向？</h3>
            <p className="funnel-modal-target">
              <strong>0{confirmTarget.position} · {confirmTarget.concept}</strong>
            </p>
            <p className="funnel-modal-desc">
              删除后会一并移除该方向下的竞品快照、差评与报价记录（不可恢复；若已转正式立项案卷，案卷数据会保留）。
              如果是市场/利润不行，建议点「淘汰」留存避坑记录。
            </p>
            <div className="funnel-modal-actions">
              <button
                type="button"
                className="button secondary compact-button"
                onClick={() => setConfirmTarget(null)}
              >
                取消
              </button>
              <form action={deleteHypothesisAction}>
                <input type="hidden" name="runId" value={runId} />
                <input type="hidden" name="hypothesisId" value={confirmTarget.id} />
                <input type="hidden" name="tab" value={activeTab} />
                <button type="submit" className="button compact-button funnel-btn-danger">
                  确认删除
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
