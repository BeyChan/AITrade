"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { money, shortDate } from "@/lib/format";
import { StatusBadge } from "@/components/badges";
import { IconClipboard, IconFactory } from "@/components/icons";
import type {
  SupplierDirectoryItem,
  SupplierProfileMeta,
  SupplierStatus,
  SourcingCaseSummary,
} from "@/lib/types";

type SupplierQuoteHistoryItem = {
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

type SupplierSampleHistoryItem = {
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

type SupplierDetailData = {
  quoteHistory: SupplierQuoteHistoryItem[];
  sampleHistory: SupplierSampleHistoryItem[];
};

const STATUS_META: Record<SupplierStatus, { label: string; badgeClass: string }> = {
  new: { label: "待联系", badgeClass: "badge-neutral" },
  contacted: { label: "已加微信", badgeClass: "status-review_pending" },
  sampled: { label: "已拿样", badgeClass: "status-researching" },
  preferred: { label: "⭐ 核心优选厂", badgeClass: "badge-success" },
  blacklisted: { label: "🚫 黑名单避雷", badgeClass: "badge-danger" },
};

const SAMPLE_STATUS_LABEL: Record<string, string> = {
  ordered: "已下单",
  shipped: "已寄出",
  received: "已签收",
  passed: "验货通过",
  rejected: "验货淘汰",
};

function getProfile(supplier: SupplierDirectoryItem): SupplierProfileMeta {
  return supplier.profile && typeof supplier.profile === "object" ? supplier.profile : {};
}

function getStatus(supplier: SupplierDirectoryItem): SupplierStatus {
  const status = getProfile(supplier).status;
  if (status && status in STATUS_META) return status;
  return "new";
}

function buildRfqScript(supplier: SupplierDirectoryItem, selectedCase: SourcingCaseSummary | undefined): string {
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
      {activeTab === "cases" && (
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
      )}

      {/* 工厂私域档案抽屉（编辑资料 + 一键询价话术 + 历史报价与拿样记录） */}
      {drawerSupplier && (
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
