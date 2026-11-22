"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { money, shortDate } from "@/lib/format";
import type {
  SupplierDirectoryItem,
  SupplierStatus,
  SourcingCaseSummary,
} from "@/lib/types";
import {
  buildRfqScript,
  getStatus,
  SAMPLE_STATUS_LABEL,
  STATUS_META,
  type SupplierDetailData,
} from "./helpers";

type Props = {
  drawerSupplier: SupplierDirectoryItem;
  cases: SourcingCaseSummary[];
  copiedKey: string | null;
  drawerLoading: boolean;
  drawerDetail: SupplierDetailData | null;
  savingProfile: boolean;
  drawerMsg: { type: "ok" | "err"; text: string } | null;
  rfqCaseId: string;
  setRfqCaseId: (v: string) => void;
  editName: string;
  setEditName: (v: string) => void;
  editStatus: SupplierStatus;
  setEditStatus: (v: SupplierStatus) => void;
  editRating: string;
  setEditRating: (v: string) => void;
  editContact: string;
  setEditContact: (v: string) => void;
  editCountry: string;
  setEditCountry: (v: string) => void;
  editUrl: string;
  setEditUrl: (v: string) => void;
  editWechat: string;
  setEditWechat: (v: string) => void;
  editPhone: string;
  setEditPhone: (v: string) => void;
  editMoq: string;
  setEditMoq: (v: string) => void;
  editLeadTime: string;
  setEditLeadTime: (v: string) => void;
  editPaymentTerms: string;
  setEditPaymentTerms: (v: string) => void;
  editOem: boolean;
  setEditOem: (v: boolean) => void;
  editCustomBox: boolean;
  setEditCustomBox: (v: boolean) => void;
  editNotes: string;
  setEditNotes: (v: string) => void;
  closeDrawer: () => void;
  handleCopy: (text: string, key: string) => void;
  handleSaveProfile: (e: FormEvent) => void;
};

export function SupplierDetailDrawer({
  drawerSupplier,
  cases,
  copiedKey,
  drawerLoading,
  drawerDetail,
  savingProfile,
  drawerMsg,
  rfqCaseId,
  setRfqCaseId,
  editName,
  setEditName,
  editStatus,
  setEditStatus,
  editRating,
  setEditRating,
  editContact,
  setEditContact,
  editCountry,
  setEditCountry,
  editUrl,
  setEditUrl,
  editWechat,
  setEditWechat,
  editPhone,
  setEditPhone,
  editMoq,
  setEditMoq,
  editLeadTime,
  setEditLeadTime,
  editPaymentTerms,
  setEditPaymentTerms,
  editOem,
  setEditOem,
  editCustomBox,
  setEditCustomBox,
  editNotes,
  setEditNotes,
  closeDrawer,
  handleCopy,
  handleSaveProfile,
}: Props) {
  return (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`编辑工厂档案：${drawerSupplier.name}`}
          onClick={closeDrawer}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0, 0, 0, 0.55)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(620px, 100vw)",
              height: "100vh",
              overflowY: "auto",
              background: "var(--paper)",
              borderLeft: "1px solid var(--line)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.25)",
            }}
          >
            {/* 抽屉头部 */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "12px",
                borderBottom: "1px solid var(--line)",
                paddingBottom: "14px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                  <span className={`badge ${STATUS_META[getStatus(drawerSupplier)].badgeClass}`}>
                    {STATUS_META[getStatus(drawerSupplier)].label}
                  </span>
                  <span className="badge badge-neutral">{drawerSupplier.platform || "1688"}</span>
                  {drawerSupplier.url && (
                    <a
                      href={drawerSupplier.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: "12px", color: "var(--green)", textDecoration: "underline", fontWeight: 600 }}
                    >
                      打开 1688 主页 ↗
                    </a>
                  )}
                </div>
                <h2 style={{ margin: 0, fontSize: "18px", color: "var(--ink)", fontWeight: 700, lineHeight: 1.35 }}>
                  {drawerSupplier.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="button ghost"
                style={{ padding: "4px 10px", fontSize: "14px" }}
                aria-label="关闭档案抽屉"
              >
                ✕
              </button>
            </div>

            {drawerMsg && (
              <div className={`notice ${drawerMsg.type === "err" ? "warn" : ""}`}>
                <span className={`badge ${drawerMsg.type === "err" ? "badge-danger" : "badge-success"}`}>
                  {drawerMsg.type === "err" ? "失败" : "已保存"}
                </span>
                <span>{drawerMsg.text}</span>
              </div>
            )}

            {/* 区块 1：可编辑工厂合作档案 */}
            <form onSubmit={handleSaveProfile} className="stack" style={{ gap: "12px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>
                1. 私域合作档案与谈判底价记录
              </div>

              <div className="form-grid">
                <div className="field full">
                  <label htmlFor="edit-sup-name">工厂名称 *</label>
                  <input
                    id="edit-sup-name"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-sup-status">合作状态分级</label>
                  <select
                    id="edit-sup-status"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as SupplierStatus)}
                  >
                    <option value="new">待联系</option>
                    <option value="contacted">💬 已加微信</option>
                    <option value="sampled">📦 已拿样</option>
                    <option value="preferred">⭐ 核心优选厂</option>
                    <option value="blacklisted">🚫 黑名单避雷</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="edit-sup-rating">综合自评 (1-5)</label>
                  <input
                    id="edit-sup-rating"
                    type="number"
                    min="1"
                    max="5"
                    step="0.1"
                    value={editRating}
                    onChange={(e) => setEditRating(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-sup-contact">业务员姓名</label>
                  <input
                    id="edit-sup-contact"
                    value={editContact}
                    onChange={(e) => setEditContact(e.target.value)}
                    placeholder="如：陈经理"
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-sup-country">产地 / 地区</label>
                  <input
                    id="edit-sup-country"
                    value={editCountry}
                    onChange={(e) => setEditCountry(e.target.value)}
                    placeholder="如：浙江义乌 / CN"
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-sup-wechat">
                    业务员微信号{" "}
                    {editWechat ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(editWechat, "drawer-wechat")}
                        style={{
                          marginLeft: "6px",
                          padding: "0 6px",
                          borderRadius: "4px",
                          border: "1px solid var(--line)",
                          background: "var(--bg)",
                          color: copiedKey === "drawer-wechat" ? "var(--green)" : "var(--muted)",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        {copiedKey === "drawer-wechat" ? "已复制" : "复制"}
                      </button>
                    ) : null}
                  </label>
                  <input
                    id="edit-sup-wechat"
                    value={editWechat}
                    onChange={(e) => setEditWechat(e.target.value)}
                    placeholder="加微信后记这里，下次直接搜"
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-sup-phone">
                    联系电话{" "}
                    {editPhone ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(editPhone, "drawer-phone")}
                        style={{
                          marginLeft: "6px",
                          padding: "0 6px",
                          borderRadius: "4px",
                          border: "1px solid var(--line)",
                          background: "var(--bg)",
                          color: copiedKey === "drawer-phone" ? "var(--green)" : "var(--muted)",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        {copiedKey === "drawer-phone" ? "已复制" : "复制"}
                      </button>
                    ) : null}
                  </label>
                  <input
                    id="edit-sup-phone"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="138-xxxx-xxxx"
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-sup-moq">最小起订量 MOQ (件)</label>
                  <input
                    id="edit-sup-moq"
                    type="number"
                    min="1"
                    value={editMoq}
                    onChange={(e) => setEditMoq(e.target.value)}
                    placeholder="如：100"
                  />
                </div>

                <div className="field">
                  <label htmlFor="edit-sup-lead">大货交期 (天)</label>
                  <input
                    id="edit-sup-lead"
                    type="number"
                    min="1"
                    value={editLeadTime}
                    onChange={(e) => setEditLeadTime(e.target.value)}
                    placeholder="如：7"
                  />
                </div>

                <div className="field full">
                  <label htmlFor="edit-sup-pay">付款条件 / 账期</label>
                  <input
                    id="edit-sup-pay"
                    value={editPaymentTerms}
                    onChange={(e) => setEditPaymentTerms(e.target.value)}
                    placeholder="如：现货款到发货 / 定制 30% 定金 + 70% 出货前"
                  />
                </div>

                <div className="field full" style={{ display: "flex", flexDirection: "row", gap: "18px", flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={editOem}
                      onChange={(e) => setEditOem(e.target.checked)}
                      style={{ width: "auto" }}
                    />
                    <span>支持小批量贴牌 OEM / 印 Logo</span>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={editCustomBox}
                      onChange={(e) => setEditCustomBox(e.target.checked)}
                      style={{ width: "auto" }}
                    />
                    <span>支持定制彩盒 / FNSKU 贴标</span>
                  </label>
                </div>

                <div className="field full">
                  <label htmlFor="edit-sup-url">1688 店铺 / 商品链接</label>
                  <input
                    id="edit-sup-url"
                    type="url"
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    placeholder="https://detail.1688.com/offer/..."
                  />
                </div>

                <div className="field full">
                  <label htmlFor="edit-sup-notes">验厂笔记 / 拿样评价 / 避雷记录</label>
                  <textarea
                    id="edit-sup-notes"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="记录主营款、实测做工、沟通配合度、是否乱加价或延误交期..."
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <button type="button" className="button ghost" onClick={closeDrawer}>
                  取消
                </button>
                <button type="submit" className="button primary" disabled={savingProfile}>
                  {savingProfile ? "保存中…" : "保存工厂档案"}
                </button>
              </div>
            </form>

            {/* 区块 2：一键生成并复制 1688 / 微信询价话术 */}
            <section
              style={{
                borderTop: "1px solid var(--line)",
                paddingTop: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>
                  2. 一键复制 1688 / 微信询价话术
                </div>
                <select
                  value={rfqCaseId}
                  onChange={(e) => setRfqCaseId(e.target.value)}
                  aria-label="选择要询价的商品"
                  style={{
                    maxWidth: "280px",
                    height: "32px",
                    padding: "0 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    fontSize: "12px",
                  }}
                >
                  <option value="">通用询盘（不限定具体商品）</option>
                  {cases.map((c) => (
                    <option key={c.productCase.id} value={c.productCase.id}>
                      [{c.productCase.marketplace}] {c.productCase.title.slice(0, 26)}
                    </option>
                  ))}
                </select>
              </div>
              {(() => {
                const selectedCase = cases.find((c) => c.productCase.id === rfqCaseId);
                const script = buildRfqScript(drawerSupplier, selectedCase);
                return (
                  <>
                    <pre
                      style={{
                        margin: 0,
                        padding: "12px",
                        borderRadius: "8px",
                        border: "1px solid var(--line)",
                        background: "var(--bg)",
                        color: "var(--ink)",
                        fontSize: "12px",
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                      }}
                    >
                      {script}
                    </pre>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => handleCopy(script, "drawer-rfq")}
                        style={{ fontSize: "12px", height: "34px" }}
                      >
                        {copiedKey === "drawer-rfq" ? "✓ 已复制询价话术，去 1688 旺旺/微信粘贴" : "一键复制询价话术"}
                      </button>
                    </div>
                  </>
                );
              })()}
            </section>

            {/* 区块 3：自动聚合历史报价与拿样验货记录 */}
            <section
              style={{
                borderTop: "1px solid var(--line)",
                paddingTop: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>
                3. 历史合作记录（自动聚合）
              </div>

              {drawerLoading ? (
                <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>正在加载历史报价与拿样记录…</p>
              ) : (
                <>
                  {/* 历史报价 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--muted)" }}>
                      历史关联商品与报价 ({drawerDetail?.quoteHistory.length ?? 0})
                    </div>
                    {!drawerDetail || drawerDetail.quoteHistory.length === 0 ? (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: "8px",
                          background: "var(--bg)",
                          fontSize: "12px",
                          color: "var(--muted)",
                        }}
                      >
                        暂无历史报价记录，可在卡片上点「+ 关联商品」将其加入比价表。
                      </div>
                    ) : (
                      drawerDetail.quoteHistory.map((q) => (
                        <div
                          key={q.quoteId}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--line)",
                            background: "var(--bg)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "10px",
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <Link
                              href={`/cases/${q.caseId}/sourcing`}
                              style={{ fontSize: "13px", fontWeight: 600, color: "var(--green)", textDecoration: "none" }}
                            >
                              [{q.marketplace}] {q.caseTitle}
                            </Link>
                            <div style={{ fontSize: "11.5px", color: "var(--muted)", marginTop: "2px" }}>
                              MOQ {q.moq} 件
                              {q.leadTimeDays ? ` · 交期 ${q.leadTimeDays} 天` : ""}
                              {" · "}
                              {shortDate(q.createdAt)}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <strong style={{ fontSize: "13px", color: "var(--ink)" }}>
                              {q.priceCny !== null ? `¥${q.priceCny}` : money(q.unitPriceCents)}
                            </strong>
                            {q.isSelected && <span className="badge badge-success">🏆 已中标</span>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* 拿样验货记录 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--muted)" }}>
                      关联拿样与验货日记 ({drawerDetail?.sampleHistory.length ?? 0})
                    </div>
                    {!drawerDetail || drawerDetail.sampleHistory.length === 0 ? (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: "8px",
                          background: "var(--bg)",
                          fontSize: "12px",
                          color: "var(--muted)",
                        }}
                      >
                        暂无同名工厂的拿样记录（在具体商品的比价页录入拿样日记后会自动归档到此）。
                      </div>
                    ) : (
                      drawerDetail.sampleHistory.map((s) => (
                        <div
                          key={s.id}
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--line)",
                            background: "var(--bg)",
                            fontSize: "12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                            <span className="badge badge-neutral">
                              {SAMPLE_STATUS_LABEL[s.status] ?? s.status}
                            </span>
                            <span style={{ color: "var(--muted)" }}>
                              样品+运费 ¥{s.totalCostCny.toFixed(0)}
                              {s.qualityRating ? ` · 品质 ${s.qualityRating}/5★` : ""}
                            </span>
                          </div>
                          {s.pros ? <div style={{ color: "var(--green)" }}>优点：{s.pros}</div> : null}
                          {s.defects ? <div style={{ color: "var(--red)" }}>缺陷：{s.defects}</div> : null}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </section>
          </aside>
        </div>
  );
}
