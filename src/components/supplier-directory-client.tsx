"use client";

import { useState } from "react";
import Link from "next/link";
import { money, shortDate } from "@/lib/format";
import { StatusBadge } from "@/components/badges";
import type { SupplierDirectoryItem, SourcingCaseSummary } from "@/lib/types";

type Props = {
  suppliers: SupplierDirectoryItem[];
  stats: {
    totalSuppliers: number;
    platform1688Count: number;
    totalQuotesCount: number;
    selectedCount: number;
  };
  cases: SourcingCaseSummary[];
  createAction: (formData: FormData) => void;
  notice?: string;
  error?: string;
};

export function SupplierDirectoryClient({
  suppliers,
  stats,
  cases,
  createAction,
  notice,
  error,
}: Props) {
  const [activeTab, setActiveTab] = useState<"directory" | "cases">("directory");
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);

  const filteredSuppliers = suppliers.filter((s) => {
    const matchQuery =
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.notes || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.contact || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchPlatform =
      platformFilter === "all" ||
      (platformFilter === "1688" && (s.platform || "").toLowerCase().includes("1688")) ||
      (platformFilter === "other" && !(s.platform || "").toLowerCase().includes("1688"));
    return matchQuery && matchPlatform;
  });

  return (
    <div className="stack" style={{ gap: "24px" }}>
      {notice && (
        <div className="notice">
          <span className="badge badge-success">SUCCESS</span>
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="notice warn">
          <span className="badge badge-danger">ERROR</span>
          <span>{error}</span>
        </div>
      )}

      {/* 顶部供应链核心资产指标 */}
      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-label">合作工厂档案库</div>
          <div className="metric-value">{stats.totalSuppliers} 家</div>
          <div className="metric-note">企业私域供应链资产</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">1688 源头工厂</div>
          <div className="metric-value">{stats.platform1688Count} 家</div>
          <div className="metric-note">占比 {stats.totalSuppliers ? Math.round((stats.platform1688Count / stats.totalSuppliers) * 100) : 0}%</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已定标合作工厂</div>
          <div className="metric-value">{stats.selectedCount} 家</div>
          <div className="metric-note">已实际建立生产成本模型</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">在办询价商品案卷</div>
          <div className="metric-value">{cases.length} 个</div>
          <div className="metric-note">{cases.filter(c => c.selection).length} 个已完成定标</div>
        </article>
      </section>

      {/* Tab 切换栏与操作条 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          borderBottom: "1px solid var(--line)",
          paddingBottom: "12px",
        }}
      >
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className={`button ${activeTab === "directory" ? "primary" : "secondary"}`}
            onClick={() => setActiveTab("directory")}
            style={{ fontSize: "13px", height: "36px", padding: "0 16px" }}
          >
            🏭 1688 工厂名录资产池 ({suppliers.length})
          </button>
          <button
            type="button"
            className={`button ${activeTab === "cases" ? "primary" : "secondary"}`}
            onClick={() => setActiveTab("cases")}
            style={{ fontSize: "13px", height: "36px", padding: "0 16px" }}
          >
            📋 在办商品询价跟踪 ({cases.length})
          </button>
        </div>

        {activeTab === "directory" && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setShowAddForm(!showAddForm)}
            style={{ fontSize: "13px", height: "36px" }}
          >
            {showAddForm ? "收起录入表单" : "+ 录入新 1688 工厂"}
          </button>
        )}
      </div>

      {/* 录入新工厂抽屉表单 */}
      {showAddForm && activeTab === "directory" && (
        <section
          className="section"
          style={{
            border: "1.5px dashed var(--green)",
            background: "rgba(31, 122, 85, 0.02)",
            borderRadius: "12px",
            padding: "20px",
          }}
        >
          <div className="section-header" style={{ marginBottom: "16px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", color: "var(--ink)", fontWeight: 700 }}>
                录入 1688 / 线下源头工厂档案
              </h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
                录入后将永久保存在企业供应链资产库中，后续在任何商品立项时均可直接调取。
              </p>
            </div>
          </div>

          <form action={createAction} className="stack">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">工厂名称 *</label>
                <input id="name" name="name" required placeholder="如：宁波市倍洁日用品制造有限公司" />
              </div>
              <div className="field">
                <label htmlFor="platform">供应商平台 / 来源</label>
                <input id="platform" name="platform" defaultValue="1688" placeholder="1688 / 阿里国际站 / 广交会" />
              </div>
              <div className="field">
                <label htmlFor="contact">联系人及电话/微信 *</label>
                <input id="contact" name="contact" required placeholder="如：陈经理 · 138-xxxx-xxxx" />
              </div>
              <div className="field">
                <label htmlFor="country">生产地 / 国家</label>
                <input id="country" name="country" defaultValue="CN" placeholder="CN" />
              </div>
              <div className="field full">
                <label htmlFor="url">1688 店铺 / 工厂主页链接</label>
                <input id="url" name="url" type="url" placeholder="https://detail.1688.com/offer/..." />
              </div>
              <div className="field full">
                <label htmlFor="notes">主营类目、验厂资质与配合优势</label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  placeholder="如：1688 实力商家，主营免手洗拖把与宠物注塑件，支持定制包装贴标，通过 BSCI 验厂。"
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button type="submit" className="button primary">
                保存入库
              </button>
              <button type="button" className="button ghost" onClick={() => setShowAddForm(false)}>
                取消
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Tab 1: 1688 合作工厂名录视图 */}
      {activeTab === "directory" && (
        <div className="stack" style={{ gap: "16px" }}>
          {/* 筛选与搜索 */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="搜索工厂名称、主营类目、联系人..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: "1 1 240px",
                height: "36px",
                padding: "0 12px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                fontSize: "13px",
              }}
            />
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              style={{
                height: "36px",
                padding: "0 10px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                fontSize: "13px",
                background: "#fff",
              }}
            >
              <option value="all">所有平台来源</option>
              <option value="1688">仅 1688 源头厂</option>
              <option value="other">线下展会 / 其它</option>
            </select>
          </div>

          {filteredSuppliers.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px", background: "#fff", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <h3>未找到匹配的工厂档案</h3>
              <p>请尝试更换搜索关键词，或点击右上角「+ 录入新 1688 工厂」添加。</p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
                gap: "16px",
              }}
            >
              {filteredSuppliers.map((supplier) => {
                const is1688 = (supplier.platform || "").toLowerCase().includes("1688");
                return (
                  <article
                    key={supplier.id}
                    style={{
                      background: "#fff",
                      border: "1px solid var(--line)",
                      borderRadius: "12px",
                      padding: "18px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "14px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                    }}
                  >
                    <div>
                      {/* 头部：名称与平台徽标 */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                            <span
                              className={`badge ${is1688 ? "badge-success" : "badge-neutral"}`}
                              style={{ fontSize: "11px", fontWeight: 700 }}
                            >
                              {supplier.platform || "1688"}
                            </span>
                            {supplier.country && (
                              <span className="badge badge-neutral" style={{ fontSize: "11px" }}>
                                {supplier.country}
                              </span>
                            )}
                            {supplier.selectionCount > 0 && (
                              <span className="badge badge-success" style={{ fontSize: "11px" }}>
                                🏆 定标 {supplier.selectionCount} 次
                              </span>
                            )}
                          </div>
                          <h3 style={{ margin: 0, fontSize: "16px", color: "var(--ink)", fontWeight: 700, lineHeight: 1.3 }}>
                            {supplier.name}
                          </h3>
                        </div>
                        {supplier.rating ? (
                          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <strong style={{ color: "var(--green)", fontSize: "16px" }}>★ {supplier.rating}</strong>
                            <div style={{ fontSize: "11px", color: "var(--muted)" }}>综合评分</div>
                          </div>
                        ) : null}
                      </div>

                      {/* 工厂描述与类目资质 */}
                      {supplier.notes && (
                        <p
                          style={{
                            margin: "10px 0 0 0",
                            fontSize: "12.5px",
                            color: "var(--ink)",
                            lineHeight: 1.5,
                            background: "var(--bg)",
                            padding: "8px 10px",
                            borderRadius: "6px",
                          }}
                        >
                          {supplier.notes}
                        </p>
                      )}

                      {/* 关键信息项 */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "8px",
                          marginTop: "12px",
                          fontSize: "12px",
                        }}
                      >
                        <div>
                          <span style={{ color: "var(--muted)" }}>对接联系人: </span>
                          <strong style={{ color: "var(--ink)" }}>{supplier.contact || "待补充"}</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--muted)" }}>录入时间: </span>
                          <span style={{ color: "var(--ink)" }}>{shortDate(supplier.created_at)}</span>
                        </div>
                      </div>

                      {/* 历史关联案卷 */}
                      {supplier.cases.length > 0 && (
                        <div style={{ marginTop: "12px", borderTop: "1px dashed var(--line)", paddingTop: "8px" }}>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>曾参与询价商品 ({supplier.cases.length}):</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                            {supplier.cases.map((c) => (
                              <Link
                                key={c.id}
                                href={`/cases/${c.id}/sourcing`}
                                style={{
                                  fontSize: "11px",
                                  padding: "2px 8px",
                                  background: "#f0fdf4",
                                  border: "1px solid #bbf7d0",
                                  borderRadius: "4px",
                                  color: "var(--green)",
                                  textDecoration: "none",
                                  maxWidth: "240px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={c.title}
                              >
                                {c.title} ({c.marketplace})
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 卡片底栏操作 */}
                    <div
                      style={{
                        borderTop: "1px solid var(--line)",
                        paddingTop: "10px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      {supplier.url ? (
                        <a
                          href={supplier.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: "12px",
                            color: "var(--green)",
                            textDecoration: "underline",
                            fontWeight: 600,
                          }}
                        >
                          打开 1688 主页 ↗
                        </a>
                      ) : (
                        <span style={{ fontSize: "11px", color: "var(--muted)" }}>暂无外链</span>
                      )}

                      <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                        参与案卷: {supplier.quoteCount} 个
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: 在办商品询价跟踪视图 */}
      {activeTab === "cases" && (
        <div className="stack" style={{ gap: "16px" }}>
          {cases.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px", background: "#fff", borderRadius: "12px", border: "1px solid var(--line)" }}>
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
                        {item.selection ? "查看 1688 比价定标" : item.quoteCount ? "继续多厂比价" : "录入 1688 报价"} →
                      </Link>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function sourcingStage(quoteCount: number, eligibleCount: number, selected: boolean) {
  if (selected) return { label: "已定标", className: "badge-success" };
  if (eligibleCount >= 3) return { label: "可进入定标", className: "badge-success" };
  if (quoteCount === 0) return { label: "待发起询价", className: "badge-neutral" };
  if (eligibleCount < 3) return { label: `有效报价 ${eligibleCount}/3`, className: "status-review_pending" };
  return { label: "评估中", className: "status-researching" };
}
