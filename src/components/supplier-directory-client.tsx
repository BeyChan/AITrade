"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { shortDate } from "@/lib/format";
import { IconClipboard, IconFactory } from "@/components/icons";
import type {
  SupplierDirectoryItem,
  SupplierProfileMeta,
  SupplierStatus,
  SourcingCaseSummary,
} from "@/lib/types";
import {
  getProfile,
  getStatus,
  STATUS_META,
  type SupplierDetailData,
  type SupplierQuoteHistoryItem,
  type SupplierSampleHistoryItem,
} from "./supplier-directory/helpers";
import { SupplierCreateDrawer } from "./supplier-directory/supplier-create-drawer";
import { SupplierCasesTab } from "./supplier-directory/supplier-cases-tab";
import { SupplierDetailDrawer } from "./supplier-directory/supplier-detail-drawer";

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
  const router = useRouter();
  const [supplierList, setSupplierList] = useState<SupplierDirectoryItem[]>(suppliers);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkCaseId, setLinkCaseId] = useState<string>(cases[0]?.productCase.id ?? "");
  const [linkPriceCny, setLinkPriceCny] = useState<string>("25");
  const [linkMoq, setLinkMoq] = useState<string>("100");
  const [savingLink, setSavingLink] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "ok" | "err"; text: string; href?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"directory" | "cases">("directory");
  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SupplierStatus>("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 档案抽屉状态
  const [drawerSupplierId, setDrawerSupplierId] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<SupplierDetailData | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [drawerMsg, setDrawerMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [rfqCaseId, setRfqCaseId] = useState<string>(cases[0]?.productCase.id ?? "");

  // 表单受控字段
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState<SupplierStatus>("new");
  const [editRating, setEditRating] = useState("4.5");
  const [editContact, setEditContact] = useState("");
  const [editCountry, setEditCountry] = useState("CN");
  const [editUrl, setEditUrl] = useState("");
  const [editWechat, setEditWechat] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editMoq, setEditMoq] = useState("");
  const [editLeadTime, setEditLeadTime] = useState("");
  const [editPaymentTerms, setEditPaymentTerms] = useState("");
  const [editOem, setEditOem] = useState(false);
  const [editCustomBox, setEditCustomBox] = useState(false);
  const [editNotes, setEditNotes] = useState("");

  const drawerSupplier = drawerSupplierId
    ? supplierList.find((item) => item.id === drawerSupplierId) ?? null
    : null;

  useEffect(() => {
    setSupplierList(suppliers);
  }, [suppliers]);

  function openDrawer(supplier: SupplierDirectoryItem) {
    const profile = getProfile(supplier);
    setDrawerSupplierId(supplier.id);
    setDrawerMsg(null);
    setEditName(supplier.name || "");
    setEditStatus(getStatus(supplier));
    setEditRating(String(supplier.rating ?? 4.5));
    setEditContact(supplier.contact || "");
    setEditCountry(supplier.country || "CN");
    setEditUrl(supplier.url || "");
    setEditWechat(profile.wechat || "");
    setEditPhone(profile.phone || "");
    setEditMoq(profile.moq ? String(profile.moq) : "");
    setEditLeadTime(profile.leadTimeDays ? String(profile.leadTimeDays) : "");
    setEditPaymentTerms(profile.paymentTerms || "");
    setEditOem(Boolean(profile.supportsOem));
    setEditCustomBox(Boolean(profile.supportsCustomBox));
    setEditNotes(supplier.notes || "");

    setDrawerLoading(true);
    setDrawerDetail(null);
    fetch(`/api/suppliers/${encodeURIComponent(supplier.id)}`)
      .then((res) => res.json())
      .then((data: { quoteHistory?: SupplierQuoteHistoryItem[]; sampleHistory?: SupplierSampleHistoryItem[] }) => {
        setDrawerDetail({
          quoteHistory: Array.isArray(data.quoteHistory) ? data.quoteHistory : [],
          sampleHistory: Array.isArray(data.sampleHistory) ? data.sampleHistory : [],
        });
      })
      .catch(() => {
        setDrawerDetail({ quoteHistory: [], sampleHistory: [] });
      })
      .finally(() => {
        setDrawerLoading(false);
      });
  }

  function closeDrawer() {
    setDrawerSupplierId(null);
    setDrawerMsg(null);
  }

  async function handleCopy(text: string, key: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 1800);
    } catch {
      setActionMsg({ type: "err", text: "剪贴板复制失败，请手动选中复制。" });
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!drawerSupplier) return;
    setSavingProfile(true);
    setDrawerMsg(null);
    try {
      const payload = {
        name: editName.trim(),
        contact: editContact.trim(),
        country: editCountry.trim() || "CN",
        url: editUrl.trim(),
        rating: Number(editRating) || 4.5,
        notes: editNotes.trim(),
        profile: {
          status: editStatus,
          wechat: editWechat.trim(),
          phone: editPhone.trim(),
          moq: editMoq ? Number(editMoq) : null,
          leadTimeDays: editLeadTime ? Number(editLeadTime) : null,
          paymentTerms: editPaymentTerms.trim(),
          supportsOem: editOem,
          supportsCustomBox: editCustomBox,
        },
      };
      const res = await fetch(`/api/suppliers/${encodeURIComponent(drawerSupplier.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        supplier?: Partial<SupplierDirectoryItem>;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.supplier) {
        setDrawerMsg({ type: "err", text: json.error || "保存档案失败" });
        return;
      }
      setSupplierList((prev) =>
        prev.map((item) =>
          item.id === drawerSupplier.id
            ? {
                ...item,
                name: json.supplier?.name ?? item.name,
                contact: json.supplier?.contact ?? null,
                country: json.supplier?.country ?? item.country,
                url: json.supplier?.url ?? null,
                rating: json.supplier?.rating ?? item.rating,
                notes: json.supplier?.notes ?? "",
                profile: (json.supplier?.profile as SupplierProfileMeta | null) ?? payload.profile,
              }
            : item,
        ),
      );
      setDrawerMsg({ type: "ok", text: "工厂档案已更新并保存到本地数据库。" });
      router.refresh();
    } catch {
      setDrawerMsg({ type: "err", text: "网络异常，请重试" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleLinkToCase(supplier: SupplierDirectoryItem) {
    if (!linkCaseId) {
      setActionMsg({ type: "err", text: "暂无可关联的商品，请先在选品雷达立项一个商品。" });
      return;
    }
    setActionMsg(null);
    setSavingLink(true);
    try {
      const res = await fetch(`/api/suppliers/${encodeURIComponent(supplier.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: linkCaseId,
          priceCny: Number(linkPriceCny) || 25,
          moq: Number(linkMoq) || 100,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; redirectUrl?: string; error?: string };
      if (!res.ok || !json.ok) {
        setActionMsg({ type: "err", text: json.error || "关联商品失败" });
        return;
      }
      setSupplierList((prev) =>
        prev.map((item) => (item.id === supplier.id ? { ...item, quoteCount: item.quoteCount + 1 } : item)),
      );
      setLinkingId(null);
      setActionMsg({
        type: "ok",
        text: `已将「${supplier.name}」加入商品比价表（¥${Number(linkPriceCny) || 25} / 起订 ${Number(linkMoq) || 100}）。`,
        href: json.redirectUrl,
      });
      router.refresh();
    } catch {
      setActionMsg({ type: "err", text: "网络异常，请重试" });
    } finally {
      setSavingLink(false);
    }
  }

  async function handleRemoveSupplier(supplier: SupplierDirectoryItem) {
    if (!window.confirm(`确认从工厂库移除「${supplier.name}」吗？`)) return;
    setActionMsg(null);
    setDeletingId(supplier.id);
    try {
      const res = await fetch(`/api/suppliers/${encodeURIComponent(supplier.id)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setActionMsg({ type: "err", text: json.error || "移除工厂失败" });
        return;
      }
      setSupplierList((prev) => prev.filter((item) => item.id !== supplier.id));
      setActionMsg({ type: "ok", text: `已移除工厂「${supplier.name}」。` });
      router.refresh();
    } catch {
      setActionMsg({ type: "err", text: "请求异常，请重试" });
    } finally {
      setDeletingId(null);
    }
  }

  const filteredSuppliers = supplierList.filter((s) => {
    const profile = getProfile(s);
    const status = getStatus(s);
    const q = searchQuery.trim().toLowerCase();
    const matchQuery =
      !q ||
      s.name.toLowerCase().includes(q) ||
      (s.notes || "").toLowerCase().includes(q) ||
      (s.contact || "").toLowerCase().includes(q) ||
      (profile.wechat || "").toLowerCase().includes(q) ||
      (profile.phone || "").toLowerCase().includes(q) ||
      (profile.paymentTerms || "").toLowerCase().includes(q);
    const matchPlatform =
      platformFilter === "all" ||
      (platformFilter === "1688" && (s.platform || "").toLowerCase().includes("1688")) ||
      (platformFilter === "other" && !(s.platform || "").toLowerCase().includes("1688"));
    const matchStatus = statusFilter === "all" || status === statusFilter;
    return matchQuery && matchPlatform && matchStatus;
  });

  return (
    <div className="stack" style={{ gap: "24px" }}>
      {notice && (
        <div className="notice">
          <span className="badge badge-success">已完成</span>
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="notice warn">
          <span className="badge badge-danger">未完成</span>
          <span>{error}</span>
        </div>
      )}
      {actionMsg && (
        <div className={`notice ${actionMsg.type === "err" ? "warn" : ""}`}>
          <span className={`badge ${actionMsg.type === "err" ? "badge-danger" : "badge-success"}`}>
            {actionMsg.type === "err" ? "提示" : "已完成"}
          </span>
          <span>
            {actionMsg.text}{" "}
            {actionMsg.href ? (
              <Link href={actionMsg.href} style={{ textDecoration: "underline", fontWeight: 700 }}>
                前往商品比价表
              </Link>
            ) : null}
          </span>
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
            <IconFactory size={15} />
            <span>1688 工厂名录资产池 ({supplierList.length})</span>
          </button>
          <button
            type="button"
            className={`button ${activeTab === "cases" ? "primary" : "secondary"}`}
            onClick={() => setActiveTab("cases")}
            style={{ fontSize: "13px", height: "36px", padding: "0 16px" }}
          >
            <IconClipboard size={15} />
            <span>在办商品询价跟踪 ({cases.length})</span>
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
      {showAddForm && (
        <SupplierCreateDrawer
          createAction={createAction}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {/* Tab 1: 1688 合作工厂名录视图 */}
      {activeTab === "directory" && (
        <div className="stack" style={{ gap: "16px" }}>
          {/* 筛选与搜索 */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="搜索工厂名称、微信号、联系人、验厂备注..."
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | SupplierStatus)}
              aria-label="按合作状态筛选"
              style={{
                height: "36px",
                padding: "0 10px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                fontSize: "13px",
                background: "var(--paper)",
                color: "var(--ink)",
              }}
            >
              <option value="all">全部合作状态</option>
              <option value="preferred">⭐ 核心优选厂</option>
              <option value="sampled">📦 已拿样</option>
              <option value="contacted">💬 已加微信</option>
              <option value="new">待联系</option>
              <option value="blacklisted">🚫 黑名单避雷</option>
            </select>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              aria-label="按平台来源筛选"
              style={{
                height: "36px",
                padding: "0 10px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                fontSize: "13px",
                background: "var(--paper)",
                color: "var(--ink)",
              }}
            >
              <option value="all">所有平台来源</option>
              <option value="1688">仅 1688 源头厂</option>
              <option value="other">线下展会 / 其它</option>
            </select>
          </div>

          {filteredSuppliers.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px", background: "var(--paper)", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <h3>未找到匹配的工厂档案</h3>
              <p>请尝试更换搜索关键词或状态筛选，或点击右上角「+ 录入新 1688 工厂」添加。</p>
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
                const profile = getProfile(supplier);
                const status = getStatus(supplier);
                const statusMeta = STATUS_META[status];
                const isBlacklisted = status === "blacklisted";
                const isPreferred = status === "preferred";
                const quickContact = profile.wechat || profile.phone || (supplier.contact && supplier.contact !== "待补充" ? supplier.contact : "");
                const quickContactLabel = profile.wechat
                  ? `微信 ${profile.wechat}`
                  : profile.phone
                    ? `电话 ${profile.phone}`
                    : supplier.contact || "待补充";

                return (
                  <article
                    key={supplier.id}
                    style={{
                      background: "var(--paper)",
                      border: isBlacklisted
                        ? "1px solid var(--red)"
                        : isPreferred
                          ? "1px solid var(--green)"
                          : "1px solid var(--line)",
                      borderRadius: "12px",
                      padding: "18px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "14px",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                      opacity: isBlacklisted ? 0.86 : 1,
                    }}
                  >
                    <div>
                      {/* 头部：名称与状态/平台徽标 */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
                            <span
                              className={`badge ${statusMeta.badgeClass}`}
                              style={{ fontSize: "12px", fontWeight: 700 }}
                            >
                              {statusMeta.label}
                            </span>
                            <span
                              className={`badge ${is1688 ? "badge-success" : "badge-neutral"}`}
                              style={{ fontSize: "12px", fontWeight: 700 }}
                            >
                              {supplier.platform || "1688"}
                            </span>
                            {supplier.country && (
                              <span className="badge badge-neutral" style={{ fontSize: "12px" }}>
                                {supplier.country}
                              </span>
                            )}
                            {supplier.selectionCount > 0 && (
                              <span className="badge badge-success" style={{ fontSize: "12px" }}>
                                🏆 定标 {supplier.selectionCount} 次
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => openDrawer(supplier)}
                            style={{
                              padding: 0,
                              border: "none",
                              background: "transparent",
                              textAlign: "left",
                              cursor: "pointer",
                              fontSize: "16px",
                              color: "var(--ink)",
                              fontWeight: 700,
                              lineHeight: 1.35,
                            }}
                            title="点击打开工厂档案与历史报价"
                          >
                            {supplier.name}
                          </button>
                        </div>
                        {supplier.rating ? (
                          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <strong style={{ color: isBlacklisted ? "var(--red)" : "var(--green)", fontSize: "16px" }}>
                              ★ {supplier.rating}
                            </strong>
                            <div style={{ fontSize: "12px", color: "var(--muted)" }}>自评分数</div>
                          </div>
                        ) : null}
                      </div>

                      {/* 核心生产条款标签（起订量 / 交期 / OEM / 彩盒 / 账期） */}
                      {(profile.moq || profile.leadTimeDays || profile.supportsOem || profile.supportsCustomBox || profile.paymentTerms) && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
                          {profile.moq ? (
                            <span className="badge badge-neutral" style={{ fontSize: "11.5px" }}>
                              MOQ {profile.moq} 件
                            </span>
                          ) : null}
                          {profile.leadTimeDays ? (
                            <span className="badge badge-neutral" style={{ fontSize: "11.5px" }}>
                              交期 {profile.leadTimeDays} 天
                            </span>
                          ) : null}
                          {profile.supportsOem ? (
                            <span className="badge badge-success" style={{ fontSize: "11.5px" }}>
                              支持贴牌 OEM
                            </span>
                          ) : null}
                          {profile.supportsCustomBox ? (
                            <span className="badge badge-success" style={{ fontSize: "11.5px" }}>
                              支持定制彩盒
                            </span>
                          ) : null}
                          {profile.paymentTerms ? (
                            <span className="badge badge-neutral" style={{ fontSize: "11.5px" }}>
                              {profile.paymentTerms}
                            </span>
                          ) : null}
                        </div>
                      )}

                      {/* 工厂描述与验厂避雷备注 */}
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

                      {/* 关键信息项：联系人 / 微信一键复制 */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: "8px",
                          marginTop: "12px",
                          fontSize: "12px",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span style={{ color: "var(--muted)" }}>对接: </span>
                          <strong style={{ color: "var(--ink)", whiteSpace: "nowrap" }}>
                            {quickContactLabel}
                          </strong>
                          {quickContact ? (
                            <button
                              type="button"
                              onClick={() => handleCopy(quickContact, `card-${supplier.id}`)}
                              style={{
                                padding: "1px 6px",
                                borderRadius: "4px",
                                border: "1px solid var(--line)",
                                background: "var(--bg)",
                                color: copiedKey === `card-${supplier.id}` ? "var(--green)" : "var(--muted)",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              {copiedKey === `card-${supplier.id}` ? "已复制" : "复制"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openDrawer(supplier)}
                              style={{
                                padding: "1px 6px",
                                borderRadius: "4px",
                                border: "1px dashed var(--line)",
                                background: "transparent",
                                color: "var(--muted)",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              + 补微信/电话
                            </button>
                          )}
                        </div>
                        <div>
                          <span style={{ color: "var(--muted)" }}>录入: </span>
                          <span style={{ color: "var(--ink)" }}>{shortDate(supplier.created_at)}</span>
                        </div>
                      </div>

                      {/* 历史关联案卷 */}
                      {supplier.cases.length > 0 && (
                        <div style={{ marginTop: "12px", borderTop: "1px dashed var(--line)", paddingTop: "8px" }}>
                          <span style={{ fontSize: "12px", color: "var(--muted)" }}>曾参与询价商品 ({supplier.cases.length}):</span>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                            {supplier.cases.map((c) => (
                              <Link
                                key={c.id}
                                href={`/cases/${c.id}/sourcing`}
                                style={{
                                  fontSize: "12px",
                                  padding: "2px 8px",
                                  background: "var(--green-soft)",
                                  border: "1px solid var(--line-strong)",
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
                        gap: "8px",
                        flexWrap: "wrap",
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
                          打开 1688 主页
                        </a>
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--muted)" }}>暂无外链</span>
                      )}

                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => openDrawer(supplier)}
                          style={{
                            padding: "3px 9px",
                            borderRadius: "6px",
                            border: "1px solid var(--line-strong)",
                            background: "var(--bg)",
                            color: "var(--ink)",
                            fontSize: "12px",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          编辑档案
                        </button>
                        <button
                          type="button"
                          onClick={() => setLinkingId(linkingId === supplier.id ? null : supplier.id)}
                          style={{
                            padding: "3px 9px",
                            borderRadius: "6px",
                            border: "1px solid var(--green)",
                            background: "transparent",
                            color: "var(--green)",
                            fontSize: "12px",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          {linkingId === supplier.id ? "取消" : "+ 关联商品"}
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === supplier.id}
                          onClick={() => handleRemoveSupplier(supplier)}
                          style={{
                            padding: "3px 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--line)",
                            background: "transparent",
                            color: "var(--red)",
                            fontSize: "12px",
                            cursor: deletingId === supplier.id ? "wait" : "pointer",
                          }}
                        >
                          {deletingId === supplier.id ? "移除中…" : "移除"}
                        </button>
                      </div>
                    </div>

                    {linkingId === supplier.id ? (
                      <div
                        style={{
                          marginTop: "10px",
                          paddingTop: "10px",
                          borderTop: "1px dashed var(--line)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}
                      >
                        <select
                          value={linkCaseId}
                          onChange={(e) => setLinkCaseId(e.target.value)}
                          aria-label="选择要参与的商品"
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: "6px",
                            border: "1px solid var(--line)",
                            background: "var(--paper)",
                            color: "var(--ink)",
                            fontSize: "12px",
                          }}
                        >
                          {cases.length === 0 ? (
                            <option value="">暂无在办商品（请先在选品雷达立项）</option>
                          ) : (
                            cases.map((c) => (
                              <option key={c.productCase.id} value={c.productCase.id}>
                                [{c.productCase.marketplace}] {c.productCase.asin} · {c.productCase.title.slice(0, 24)}
                              </option>
                            ))
                          )}
                        </select>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <input
                            type="number"
                            step="0.5"
                            value={linkPriceCny}
                            onChange={(e) => setLinkPriceCny(e.target.value)}
                            placeholder="拿货价 ¥"
                            aria-label="拿货价人民币"
                            style={{
                              width: "90px",
                              padding: "5px 7px",
                              borderRadius: "6px",
                              border: "1px solid var(--line)",
                              background: "var(--paper)",
                              color: "var(--ink)",
                              fontSize: "12px",
                            }}
                          />
                          <input
                            type="number"
                            step="10"
                            value={linkMoq}
                            onChange={(e) => setLinkMoq(e.target.value)}
                            placeholder="起订量"
                            aria-label="起订量"
                            style={{
                              width: "80px",
                              padding: "5px 7px",
                              borderRadius: "6px",
                              border: "1px solid var(--line)",
                              background: "var(--paper)",
                              color: "var(--ink)",
                              fontSize: "12px",
                            }}
                          />
                          <button
                            type="button"
                            disabled={savingLink || cases.length === 0}
                            onClick={() => handleLinkToCase(supplier)}
                            className="button primary"
                            style={{ flex: 1, padding: "5px 8px", fontSize: "12px" }}
                          >
                            {savingLink ? "关联中…" : "确认加入比价"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: 在办商品询价跟踪视图 */}
      {activeTab === "cases" && <SupplierCasesTab cases={cases} />}

      {/* 工厂私域档案抽屉（编辑资料 + 一键询价话术 + 历史报价与拿样记录） */}
      {drawerSupplier && (
        <SupplierDetailDrawer
          drawerSupplier={drawerSupplier}
          cases={cases}
          copiedKey={copiedKey}
          drawerLoading={drawerLoading}
          drawerDetail={drawerDetail}
          savingProfile={savingProfile}
          drawerMsg={drawerMsg}
          rfqCaseId={rfqCaseId}
          setRfqCaseId={setRfqCaseId}
          editName={editName}
          setEditName={setEditName}
          editStatus={editStatus}
          setEditStatus={setEditStatus}
          editRating={editRating}
          setEditRating={setEditRating}
          editContact={editContact}
          setEditContact={setEditContact}
          editCountry={editCountry}
          setEditCountry={setEditCountry}
          editUrl={editUrl}
          setEditUrl={setEditUrl}
          editWechat={editWechat}
          setEditWechat={setEditWechat}
          editPhone={editPhone}
          setEditPhone={setEditPhone}
          editMoq={editMoq}
          setEditMoq={setEditMoq}
          editLeadTime={editLeadTime}
          setEditLeadTime={setEditLeadTime}
          editPaymentTerms={editPaymentTerms}
          setEditPaymentTerms={setEditPaymentTerms}
          editOem={editOem}
          setEditOem={setEditOem}
          editCustomBox={editCustomBox}
          setEditCustomBox={setEditCustomBox}
          editNotes={editNotes}
          setEditNotes={setEditNotes}
          closeDrawer={closeDrawer}
          handleCopy={handleCopy}
          handleSaveProfile={handleSaveProfile}
        />
      )}
    </div>
  );
}
