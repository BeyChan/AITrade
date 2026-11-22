"use client";

import Link from "next/link";
import { money, shortDate } from "@/lib/format";
import { StatusBadge } from "@/components/badges";
import type { SourcingCaseSummary } from "@/lib/types";
import { sourcingStage } from "./helpers";

type Props = {
  cases: SourcingCaseSummary[];
};

export function SupplierCasesTab({ cases }: Props) {
  return (
        <div className="stack" style={{ gap: "16px" }}>
          {cases.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px", background: "var(--paper)", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <h3>暂无已立项商品</h3>
              <p>请先在选品阶段完成立项，项目将自动进入询价追踪。</p>
            </div>
          ) : (
            <section className="sourcing-list">
              {cases.map((item) => {
                const stage = sourcingStage(item.quoteCount, item.eligibleCount, Boolean(item.selection));
                const preferred = item.scoredQuotes.find((quote) => quote.isPreferred);
                return (
                  <article className="sourcing-case-card" key={item.productCase.id}>
                    <div className="sourcing-case-main">
                      <div className="evidence-top">
                        <div>
                          <div className="product-title">
                            {item.productCase.title}
                            {item.productCase.is_demo ? <span className="badge demo-badge">演示</span> : null}
                          </div>
                          <div className="product-meta">
                            <span>{item.productCase.marketplace}</span>
                            <span>{item.productCase.category}</span>
                            <span>{item.productCase.asin}</span>
                            <span>立项更新 {shortDate(item.productCase.updated_at)}</span>
                          </div>
                        </div>
                        <span className={`badge ${stage.className}`}>{stage.label}</span>
                      </div>

                      <div className="sourcing-case-metrics">
                        <div>
                          <small>当前模型到岸成本</small>
                          <strong>{item.costModel ? money(item.costModel.assumptions.landedCostCents) : "—"}</strong>
                        </div>
                        <div>
                          <small>已录入报价</small>
                          <strong>{item.quoteCount} 家</strong>
                        </div>
                        <div>
                          <small>有效报价</small>
                          <strong>{item.eligibleCount} / 3</strong>
                        </div>
                        <div>
                          <small>{item.selection ? "已选定供应商" : "系统推荐"}</small>
                          <strong>{item.selectedSupplierName ?? item.preferredSupplierName ?? "待录入报价"}</strong>
                          {preferred && !item.selection ? (
                            <span>{preferred.score} 分 · {money(preferred.landedCostCents)} 到岸</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="sourcing-case-side">
                      <div>
                        <span className="muted">当前状态</span>
                        <StatusBadge status={item.productCase.status} />
                      </div>
                      <Link href={`/cases/${item.productCase.id}/sourcing`} className="button primary">
                        {item.selection ? "查看 1688 比价定标" : item.quoteCount ? "继续多厂比价" : "录入 1688 报价"}
                      </Link>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </div>
  );
}
