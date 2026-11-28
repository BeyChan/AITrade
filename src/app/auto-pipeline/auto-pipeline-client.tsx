"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  AutoCandidateResult,
  AutoGrade,
  AutoPipelineRunSummary,
  DeliveryMethodCode,
  PlatformPipelineConfig,
} from "@/lib/auto-pipeline/types";
import {
  ELIMINATION_REASONS,
  findEliminationMatches,
  type EliminatedHistoryRecord,
} from "@/lib/sourcing-funnel";
import { getSelectionActionCapabilities } from "@/lib/selection-status";
import { CandidateCard } from "./candidate-card";
import { CandidateDrawer } from "./candidate-drawer";
import { CandidateTable, type SortDir, type SortField } from "./candidate-table";
import { PlatformConfigEditor } from "./platform-config-editor";
import {
  btn,
  feedbackStyle,
  formatRunTime,
  inputStyle,
  panelStyle,
  pillStyle,
  rowBetweenStyle,
  rowStyle,
} from "./ui-styles";

const GRADE_TABS: Array<{ key: AutoGrade | "ALL"; label: string }> = [
  { key: "ALL", label: "全部线索" },
  { key: "S", label: "S 级 · 优先验证" },
  { key: "A", label: "A 级 · 复核报价" },
  { key: "B", label: "B 级 · 补扫竞品" },
  { key: "HOLD", label: "HOLD · 暂存" },
  { key: "ELIMINATED", label: "已淘汰" },
];

const GRADE_RANK: Record<AutoGrade, number> = { S: 1, A: 2, B: 3, HOLD: 4, ELIMINATED: 5 };

const DELIVERY_LABELS: Record<DeliveryMethodCode, string> = {
  flatfile_tsv: "Flat File TSV",
  shopify_csv: "Shopify Draft CSV",
  extension_autofill: "扩展半自动填表",
  api_draft: "官方 API 草稿",
};

function persistSiteCookies(platformCode: string, marketCode: string) {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 24 * 180;
  document.cookie = `aitrade_site_platform=${encodeURIComponent(platformCode.toLowerCase())}; path=/; max-age=${maxAge}; SameSite=Lax`;
  document.cookie = `aitrade_site_market=${encodeURIComponent(marketCode.toUpperCase())}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function AutoPipelineClient(props: {
  initialConfigs: PlatformPipelineConfig[];
  initialRuns: AutoPipelineRunSummary[];
  initialCandidates: AutoCandidateResult[];
  initialEliminatedHistory: EliminatedHistoryRecord[];
  initialPlatform: string;
  initialMarket: string;
  initialRunId: string;
  initialAction?: string;
}) {
  const [configs, setConfigs] = useState(props.initialConfigs);
  const [runs, setRuns] = useState(props.initialRuns);
  const [candidates, setCandidates] = useState(props.initialCandidates);
  const [eliminatedHistory, setEliminatedHistory] = useState(props.initialEliminatedHistory);

  const defaultConfigKey = `${props.initialPlatform}:${props.initialMarket}`;
  const [selectedConfigId, setSelectedConfigId] = useState(
    props.initialConfigs.some((c) => c.id === defaultConfigKey)
      ? defaultConfigKey
      : (props.initialConfigs[0]?.id ?? "amazon:US"),
  );
  const [selectedRunId, setSelectedRunId] = useState(props.initialRunId || "");
  const [activeGrade, setActiveGrade] = useState<AutoGrade | "ALL">("ALL");
  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("grade");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [hideProcessed, setHideProcessed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drawerCandidateId, setDrawerCandidateId] = useState<string | null>(null);
  const [bulkElimReason, setBulkElimReason] = useState<string>(ELIMINATION_REASONS[0]);

  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const [unadoptingId, setUnadoptingId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [unpromotingId, setUnpromotingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(
    props.initialAction === "upload"
      ? { kind: "ok", text: "请选择卖家精灵 / Helium 10 / 自定义 CSV 文件上传，系统将自动快筛分级并反推采购上限。" }
      : null,
  );
  const [renamingRunId, setRenamingRunId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const activeConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId) ?? configs[0],
    [configs, selectedConfigId],
  );

  const platformRuns = useMemo(
    () =>
      activeConfig
        ? runs.filter((r) => r.platformCode === activeConfig.platformCode && r.marketCode === activeConfig.marketCode)
        : runs,
    [runs, activeConfig],
  );

  const activeRun = useMemo(
    () => (selectedRunId ? platformRuns.find((r) => r.id === selectedRunId) ?? null : null),
    [platformRuns, selectedRunId],
  );

  const fetchView = async (platformCode: string, marketCode: string, runId: string) => {
    setLoadingRun(true);
    try {
      const qs = new URLSearchParams({ platform: platformCode, market: marketCode });
      if (runId) qs.set("runId", runId);
      const res = await fetch(`/api/auto-pipeline?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "刷新选品初筛失败");
      setConfigs(data.configs ?? []);
      setRuns(data.runs ?? []);
      setCandidates(runId ? (data.candidates ?? []) : []);
      if (Array.isArray(data.eliminatedHistory)) {
        setEliminatedHistory(data.eliminatedHistory);
      }
      setSelectedIds([]);
    } finally {
      setLoadingRun(false);
    }
  };

  const withBusy = async (fn: () => Promise<void>, fallbackErr: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await fn();
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : fallbackErr });
    } finally {
      setBusy(false);
    }
  };

  const handleSelectRun = async (nextRunId: string) => {
    if (!activeConfig) return;
    setSelectedRunId(nextRunId);
    setRenamingRunId(null);
    setSelectedIds([]);
    setDrawerCandidateId(null);
    try {
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, nextRunId);
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "切换批次失败" });
    }
  };

  const handleIngest = (
    payload: Record<string, unknown>,
    onOk: (data: Record<string, unknown>) => string,
    fallbackErr: string,
  ) => {
    if (!activeConfig) return;
    void withBusy(async () => {
      const res = await fetch("/api/auto-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformCode: activeConfig.platformCode,
          marketCode: activeConfig.marketCode,
          ...payload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || fallbackErr);
      const newRunId: string = data.run?.id || "";
      setSelectedRunId(newRunId);
      setActiveGrade("ALL");
      setFeedback({ kind: "ok", text: onOk(data) });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, newRunId);
    }, fallbackErr);
  };

  const handleCsvUpload = async (file: File | null) => {
    if (!file) return;
    const csv = await file.text();
    handleIngest(
      { sourceType: "csv", sourceLabel: file.name, csv },
      (d) => {
        const r = d.run as AutoPipelineRunSummary;
        return `已自动快筛 ${r.totalSeeds} 条线索并切换到本批次：S 级 ${r.sCount}、A 级 ${r.aCount}、B 级 ${r.bCount}、HOLD ${r.holdCount}、淘汰 ${r.eliminatedCount}。可勾选优质线索一键「采纳进看板」。`;
      },
      "CSV 自动快筛运行失败",
    );
  };

  const handleScanInbox = () => {
    if (!activeConfig) return;
    handleIngest(
      { sourceType: "inbox", inboxDir: activeConfig.inboxDir },
      (d) => {
        const r = d.run as AutoPipelineRunSummary;
        const files = Array.isArray(d.filesRead) ? d.filesRead.length : 0;
        return `已扫描 ${files} 个 CSV 文件，共入池 ${r.totalSeeds} 条（S 级 ${r.sCount} / A 级 ${r.aCount}），已切换到本批次。`;
      },
      "扫描收件箱失败",
    );
  };

  const handleSaveConfig = (nextConfig: PlatformPipelineConfig) =>
    withBusy(async () => {
      const res = await fetch("/api/auto-pipeline/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextConfig),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存配置失败");
      setShowConfigEditor(false);
      setFeedback({
        kind: "ok",
        text: `已保存 ${data.config.label} 的规则并同步至选品看板红灯阈值。`,
      });
      await fetchView(nextConfig.platformCode, nextConfig.marketCode, selectedRunId);
    }, "保存失败");

  const handleCreateCustomPlatform = (input: { platformCode: string; marketCode: string; currency: string }) =>
    withBusy(async () => {
      const res = await fetch("/api/auto-pipeline/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          label: `${input.platformCode.toUpperCase()} (${input.marketCode})`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建平台配置失败");
      persistSiteCookies(data.config.platformCode, data.config.marketCode);
      setSelectedConfigId(data.config.id);
      setSelectedRunId("");
      setShowConfigEditor(false);
      await fetchView(data.config.platformCode, data.config.marketCode, "");
      setFeedback({ kind: "ok", text: `已新增平台配置 ${data.config.label}，后续可直接切换使用。` });
    }, "新增失败");

  const handleAdopt = async (candidateIds: string[]) => {
    if (!activeConfig || candidateIds.length === 0) return;
    if (candidateIds.length === 1) setAdoptingId(candidateIds[0]);
    else setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auto-pipeline/candidates/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "采纳入选品看板失败");
      const added = Number(data.adoptedCount || 0);
      const reused = Number(data.reusedCount || 0);
      setFeedback({
        kind: "ok",
        text:
          added > 0
            ? `已采纳 ${added} 条候选进入「选品看板」（4 步验证漏斗）${reused > 0 ? `，另有 ${reused} 条已在看板中` : ""}。`
            : `选中的 ${reused} 条候选已在选品看板中，可直接点击「查看看板 →」继续验证。`,
      });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "采纳进看板失败" });
    } finally {
      setAdoptingId(null);
      setBusy(false);
    }
  };

  const handleUnadopt = async (item: AutoCandidateResult) => {
    if (!activeConfig) return;
    setUnadoptingId(item.id);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/auto-pipeline/candidates/adopt?candidateId=${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取消采纳失败");
      setFeedback({
        kind: "ok",
        text: data.hypothesisDeleted
          ? `已取消采纳 ${item.externalId}，并同步从选品看板移除了空白候选。`
          : `已解除 ${item.externalId} 的初筛关联（选品看板中已有调研数据，已为你保留）。`,
      });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "取消采纳失败" });
    } finally {
      setUnadoptingId(null);
    }
  };

  const handleEliminateToBlacklist = async (candidateIds: string[], reason: string, note = "") => {
    if (!activeConfig || candidateIds.length === 0) return;
    void withBusy(async () => {
      const res = await fetch("/api/auto-pipeline/candidates/eliminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds, reason, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "淘汰入避坑库失败");
      setFeedback({
        kind: "ok",
        text: `已将 ${data.eliminatedCount ?? candidateIds.length} 条线索淘汰并沉淀至统一避坑库（原因：${reason}），后续导入与 AI 发散将自动预警。`,
      });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    }, "淘汰入避坑库失败");
  };

  const handlePromote = async (candidateId: string) => {
    if (!activeConfig) return;
    setPromotingId(candidateId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/candidates/${encodeURIComponent(candidateId)}/promote`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "快轨直达案卷失败");
      setFeedback({
        kind: "ok",
        text: data.alreadyExisted
          ? "该线索已关联正式商品案卷，已刷新入口。"
          : "已通过快轨创建正式商品案卷（初始状态 HOLD，补录真实报价并定标后才可签发 GO）。",
      });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "推进失败" });
    } finally {
      setPromotingId(null);
    }
  };

  const handleUnpromote = async (item: AutoCandidateResult) => {
    if (!activeConfig) return;
    if (
      !window.confirm(
        `确认取消直达案卷「${item.externalId} · ${item.title.slice(0, 48)}」？\n\n若该案卷刚创建尚未录入报价/证据/文案，将同步删除该空案卷；若已有业务数据，将保留正式案卷仅解除关联。`,
      )
    ) {
      return;
    }
    setUnpromotingId(item.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/candidates/${encodeURIComponent(item.id)}/promote`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取消推进失败");
      setFeedback({
        kind: "ok",
        text: data.caseDeleted
          ? `已取消直达案卷 ${item.externalId}，并同步移除了空白商品案卷。`
          : `已解除 ${item.externalId} 的案卷关联（原正式案卷已有业务数据，已保留）。`,
      });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "取消推进失败" });
    } finally {
      setUnpromotingId(null);
    }
  };

  const handleRenameRun = (runId: string) => {
    if (!activeConfig || !renameDraft.trim()) return;
    void withBusy(async () => {
      const res = await fetch(`/api/auto-pipeline/runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLabel: renameDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重命名批次失败");
      setRenamingRunId(null);
      setFeedback({ kind: "ok", text: `批次已重命名为「${data.run.sourceLabel}」。` });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    }, "重命名失败");
  };

  const handleDeleteRun = (run: AutoPipelineRunSummary) => {
    if (!activeConfig) return;
    if (
      !window.confirm(
        `确认删除批次「${run.sourceLabel}」（共 ${run.totalSeeds} 条线索）？\n\n仅删除该批次的线索快照，不影响已采纳进看板的候选与已立项的商品案卷。`,
      )
    ) {
      return;
    }
    void withBusy(async () => {
      const res = await fetch(`/api/auto-pipeline/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除批次失败");
      const nextRunId =
        selectedRunId === run.id ? (platformRuns.find((r) => r.id !== run.id)?.id ?? "") : selectedRunId;
      setSelectedRunId(nextRunId);
      setRenamingRunId(null);
      setFeedback({
        kind: "ok",
        text: `已删除批次「${run.sourceLabel}」（移除 ${data.deletedCandidates ?? run.totalSeeds} 条快照）。`,
      });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, nextRunId);
    }, "删除批次失败");
  };

  const handleDeleteSingle = async (item: AutoCandidateResult) => {
    if (!activeConfig || !selectedRunId) return;
    if (
      !window.confirm(
        `确认从当前批次移出「${item.externalId} · ${item.title.slice(0, 48)}」？（不影响已采纳进看板或已立项的案卷）`,
      )
    ) {
      return;
    }
    setDeletingId(item.id);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/auto-pipeline/candidates/${encodeURIComponent(item.id)}?runId=${encodeURIComponent(selectedRunId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除线索失败");
      if (drawerCandidateId === item.id) setDrawerCandidateId(null);
      setFeedback({ kind: "ok", text: `已移出线索 ${item.externalId}。` });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "删除失败" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleCleanup = (
    payload: { ids?: string[]; grade?: AutoGrade },
    confirmMsg: string,
    okMsg: (n: number) => string,
  ) => {
    if (!activeConfig || !selectedRunId || !window.confirm(confirmMsg)) return;
    void withBusy(async () => {
      const res = await fetch("/api/auto-pipeline/candidates/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, runId: selectedRunId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "清理失败");
      if (payload.grade && activeGrade === payload.grade) setActiveGrade("ALL");
      setFeedback({ kind: "ok", text: okMsg(data.deletedCount ?? 0) });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    }, "清理失败");
  };

  // 为每条线索匹配统一避坑库（ASIN 精确命中或关键词语义命中）
  const blacklistMap = useMemo(() => {
    const map = new Map<string, EliminatedHistoryRecord>();
    if (eliminatedHistory.length === 0) return map;
    for (const item of candidates) {
      const extUpper = item.externalId.trim().toUpperCase();
      const exactHit = eliminatedHistory.find(
        (rec) =>
          rec.concept.toUpperCase().includes(extUpper) ||
          rec.competitorQueries.some((q) => q.toUpperCase() === extUpper),
      );
      if (exactHit) {
        map.set(item.id, exactHit);
        continue;
      }
      const fuzzy = findEliminationMatches(item.title, item.category, eliminatedHistory)[0];
      if (fuzzy) {
        map.set(item.id, fuzzy.record);
      }
    }
    return map;
  }, [candidates, eliminatedHistory]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "grade" ? "asc" : "desc");
    }
  };

  const filteredCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = candidates.filter((c) => {
      if (activeConfig && (c.platformCode !== activeConfig.platformCode || c.marketCode !== activeConfig.marketCode)) {
        return false;
      }
      if (activeGrade !== "ALL" && c.grade !== activeGrade) return false;
      if (hideProcessed && getSelectionActionCapabilities(c.selectionStatus).isProcessed) return false;
      if (q) {
        const hay = `${c.externalId} ${c.title} ${c.brand} ${c.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortField === "grade") {
        const diff = GRADE_RANK[a.grade] - GRADE_RANK[b.grade];
        return diff !== 0 ? diff * dir : b.score - a.score;
      }
      if (sortField === "score") return (a.score - b.score) * dir;
      if (sortField === "price") return (a.priceCents - b.priceCents) * dir;
      if (sortField === "margin") return (a.estimatedMarginRate - b.estimatedMarginRate) * dir;
      if (sortField === "maxCost") return (a.maxLandedCostCny - b.maxLandedCostCny) * dir;
      return (a.reviewCount - b.reviewCount) * dir;
    });
  }, [candidates, activeConfig, activeGrade, hideProcessed, searchQuery, sortField, sortDir]);

  const gradeCounts = useMemo(() => {
    const map: Record<AutoGrade, number> = { S: 0, A: 0, B: 0, HOLD: 0, ELIMINATED: 0 };
    for (const c of candidates) {
      if (activeConfig && (c.platformCode !== activeConfig.platformCode || c.marketCode !== activeConfig.marketCode)) {
        continue;
      }
      if (hideProcessed && getSelectionActionCapabilities(c.selectionStatus).isProcessed) continue;
      map[c.grade] += 1;
    }
    return map;
  }, [candidates, activeConfig, hideProcessed]);

  const allSelected =
    filteredCandidates.length > 0 && filteredCandidates.every((c) => selectedIds.includes(c.id));

  const drawerItem = useMemo(
    () => (drawerCandidateId ? candidates.find((c) => c.id === drawerCandidateId) ?? null : null),
    [candidates, drawerCandidateId],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingBottom: selectedIds.length > 0 ? 76 : 0 }}>
      {/* 隐藏 CSV 文件输入，供主栏按钮与统一「+ 添加选品」菜单共用 */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        style={{ display: "none" }}
        onChange={(e) => {
          void handleCsvUpload(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      <section style={{ ...panelStyle, padding: 20, gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 420px", minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>
              选品漏斗 · 第 1 阶段（批量快筛分诊台）
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>
              选品初筛
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              统一承接卖家精灵/H10 CSV、本地收件箱与 Chrome 扩展整页采集。自动完成 HHI/CR3、合规快筛与 18% 采购上限反推，并自动关联统一避坑库预警；挑出优质候选一键<strong>采纳入选品看板</strong>进入 4 步验证。
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
            <button
              type="button"
              onClick={() => setShowConfigEditor((v) => !v)}
              style={{ ...btn.secondary, padding: "8px 12px", fontSize: 13 }}
            >
              规则配置
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => csvInputRef.current?.click()}
              style={{ ...btn.primary, padding: "8px 14px", fontSize: 13 }}
            >
              上传 CSV 快筛
            </button>
          </div>
        </div>

        {activeConfig && (
          <div
            style={{
              ...rowStyle,
              gap: 10,
              padding: 12,
              borderRadius: 10,
              background: "var(--surface-subtle)",
              border: "1px solid var(--line)",
            }}
          >
            <button
              type="button"
              disabled={busy}
              onClick={handleScanInbox}
              style={{ ...btn.secondary, padding: "7px 13px", fontSize: 13 }}
            >
              扫描收件箱 ({activeConfig.inboxDir || `.data/inbox-csv/${activeConfig.platformCode}-${activeConfig.marketCode}`})
            </button>
            <div style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
              当前规则（{activeConfig.label}）：净利率门禁 <strong>{(activeConfig.economicsDefaults.targetMarginRate * 100).toFixed(0)}%</strong> · S 级线
              <strong> ≥{(activeConfig.thresholds.sGradeMinMargin * 100).toFixed(0)}%</strong> · 交付：
              {activeConfig.deliveryMethods.map((m) => DELIVERY_LABELS[m] || m).join(" / ")}
            </div>
          </div>
        )}

        {feedback && (
          <div
            role="status"
            style={{
              ...feedbackStyle(feedback.kind),
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="关闭提示"
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: 1,
                padding: "2px 6px",
                borderRadius: 4,
                opacity: 0.8,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}
      </section>

      {showConfigEditor && activeConfig && (
        <PlatformConfigEditor
          key={activeConfig.id}
          initialConfig={activeConfig}
          busy={busy}
          onClose={() => setShowConfigEditor(false)}
          onSave={handleSaveConfig}
          onCreatePlatform={handleCreateCustomPlatform}
        />
      )}

      {/* 批次切换与管理栏 */}
      <section style={panelStyle}>
        <div style={rowBetweenStyle}>
          <div style={rowStyle}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>查看批次：</span>
            <select
              value={selectedRunId}
              disabled={loadingRun || busy || platformRuns.length === 0}
              onChange={(e) => void handleSelectRun(e.target.value)}
              style={{ ...inputStyle, fontWeight: 600, maxWidth: 420 }}
            >
              {platformRuns.length === 0 ? (
                <option value="">暂无线索批次</option>
              ) : (
                platformRuns.map((r, idx) => (
                  <option key={r.id} value={r.id}>
                    {idx === 0 ? "[最新] " : ""}
                    {r.sourceLabel} · {formatRunTime(r.createdAt)} · 共 {r.totalSeeds} 条 (S:{r.sCount} / A:{r.aCount})
                  </option>
                ))
              )}
            </select>
            {loadingRun && <span style={{ fontSize: 12, color: "var(--muted)" }}>加载中…</span>}
          </div>

          <div style={rowStyle}>
            <Link
              href={
                activeConfig
                  ? `/auto-pipeline/history?platform=${encodeURIComponent(activeConfig.platformCode)}&market=${encodeURIComponent(activeConfig.marketCode)}`
                  : "/auto-pipeline/history"
              }
              style={btn.secondary}
            >
              历史批次 ({platformRuns.length})
            </Link>

            {activeRun &&
              (renamingRunId === activeRun.id ? (
                <>
                  <input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    placeholder="输入批次备注名"
                    style={{ ...inputStyle, width: 200, fontSize: 12, border: "1px solid var(--accent)" }}
                  />
                  <button
                    type="button"
                    disabled={busy || !renameDraft.trim()}
                    onClick={() => handleRenameRun(activeRun.id)}
                    style={btn.primary}
                  >
                    保存
                  </button>
                  <button type="button" onClick={() => setRenamingRunId(null)} style={btn.secondary}>
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setRenamingRunId(activeRun.id);
                      setRenameDraft(activeRun.sourceLabel);
                    }}
                    style={btn.secondary}
                  >
                    重命名
                  </button>
                  <button type="button" disabled={busy} onClick={() => handleDeleteRun(activeRun)} style={btn.danger}>
                    删除此批
                  </button>
                </>
              ))}
          </div>
        </div>

        {platformRuns.length > 0 && (
          <div style={rowStyle}>
            {platformRuns.slice(0, 6).map((r, idx) => (
              <button
                key={r.id}
                type="button"
                disabled={loadingRun}
                onClick={() => void handleSelectRun(r.id)}
                style={{ ...pillStyle(selectedRunId === r.id), borderRadius: 8, padding: "5px 10px" }}
              >
                {idx === 0 ? "最新 · " : ""}
                {r.sourceLabel} <span style={{ opacity: 0.75 }}>({r.totalSeeds})</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 分级过滤 + 搜索 + 视图切换 */}
      <section style={rowBetweenStyle}>
        <div style={rowStyle}>
          {GRADE_TABS.map((tab) => {
            const count =
              tab.key === "ALL" ? Object.values(gradeCounts).reduce((a, b) => a + b, 0) : gradeCounts[tab.key];
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveGrade(tab.key);
                  setSelectedIds([]);
                }}
                style={{ ...pillStyle(activeGrade === tab.key), padding: "7px 12px", fontSize: 12 }}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>

        <div style={rowStyle}>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="筛选 ASIN / 标题 / 品牌…"
            style={{ ...inputStyle, width: 200, fontSize: 12 }}
          />
          <label style={{ ...rowStyle, gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={hideProcessed}
              onChange={(e) => {
                setHideProcessed(e.target.checked);
                setSelectedIds([]);
              }}
            />
            隐藏已采纳/立项
          </label>
          <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: viewMode === "table" ? "var(--accent-soft)" : "var(--paper)",
                color: viewMode === "table" ? "var(--accent)" : "var(--muted)",
              }}
            >
              表格
            </button>
            <button
              type="button"
              onClick={() => setViewMode("card")}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                borderLeft: "1px solid var(--line)",
                cursor: "pointer",
                background: viewMode === "card" ? "var(--accent-soft)" : "var(--paper)",
                color: viewMode === "card" ? "var(--accent)" : "var(--muted)",
              }}
            >
              卡片
            </button>
          </div>
          {gradeCounts.ELIMINATED > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                handleCleanup(
                  { grade: "ELIMINATED" },
                  `确认一键清理当前批次下的 ${gradeCounts.ELIMINATED} 条「已淘汰」快照？\n已沉淀的避坑库记录与正式案卷不受影响。`,
                  (n) => `已清理 ${n} 条「已淘汰」线索快照。`,
                )
              }
              style={btn.secondary}
            >
              清理已淘汰 ({gradeCounts.ELIMINATED})
            </button>
          )}
        </div>
      </section>

      {/* 线索列表主体：默认高密度表格，支持切换卡片 */}
      <section style={panelStyle}>
        {filteredCandidates.length === 0 ? (
          <div style={{ padding: 36, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            当前批次/筛选条件下暂无线索。你可以点击右上角「上传 CSV 快筛」、扫描收件箱，或在 Amazon 搜索页打开 Chrome 扩展点击「推送到自动选品池」。
          </div>
        ) : viewMode === "table" ? (
          <CandidateTable
            items={filteredCandidates}
            selectedIds={selectedIds}
            allSelected={allSelected}
            sortField={sortField}
            sortDir={sortDir}
            busy={busy}
            adoptingId={adoptingId}
            unadoptingId={unadoptingId}
            blacklistMap={blacklistMap}
            onToggleAll={() => setSelectedIds(allSelected ? [] : filteredCandidates.map((c) => c.id))}
            onToggleSelect={toggleSelect}
            onSort={handleSort}
            onOpenDrawer={(item) => setDrawerCandidateId(item.id)}
            onAdopt={(id) => void handleAdopt([id])}
            onUnadopt={(target) => void handleUnadopt(target)}
          />
        ) : (
          filteredCandidates.map((item) => (
            <CandidateCard
              key={item.id}
              item={item}
              blacklistHit={blacklistMap.get(item.id) ?? null}
              checked={selectedIds.includes(item.id)}
              busy={busy}
              adopting={adoptingId === item.id}
              unadopting={unadoptingId === item.id}
              promoting={promotingId === item.id}
              unpromoting={unpromotingId === item.id}
              deleting={deletingId === item.id}
              onToggleSelect={toggleSelect}
              onOpenDrawer={(target) => setDrawerCandidateId(target.id)}
              onAdopt={(id) => void handleAdopt([id])}
              onUnadopt={(target) => void handleUnadopt(target)}
              onPromote={(id) => void handlePromote(id)}
              onUnpromote={(target) => void handleUnpromote(target)}
              onDelete={(target) => void handleDeleteSingle(target)}
            />
          ))
        )}
      </section>

      {/* 底部悬浮批量操作条（行业分诊台标准交互） */}
      {selectedIds.length > 0 && (
        <div
          role="region"
          aria-label="批量分诊操作条"
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 70,
            background: "var(--paper)",
            border: "1px solid var(--accent)",
            borderRadius: 12,
            padding: "10px 16px",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.22)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            maxWidth: "92vw",
          }}
        >
          <strong style={{ fontSize: 13, color: "var(--ink)" }}>
            已选 <span className="mono">{selectedIds.length}</span> 条线索
          </strong>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleAdopt(selectedIds)}
            style={btn.primary}
          >
            批量采纳进看板 ({selectedIds.length})
          </button>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <select
              value={bulkElimReason}
              onChange={(e) => setBulkElimReason(e.target.value)}
              style={{ ...inputStyle, fontSize: 12, padding: "5px 8px" }}
              aria-label="批量淘汰原因"
            >
              {ELIMINATION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleEliminateToBlacklist(selectedIds, bulkElimReason)}
              style={btn.danger}
            >
              批量淘汰入避坑库
            </button>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              handleCleanup(
                { ids: selectedIds },
                `确认从当前批次批量删除已勾选的 ${selectedIds.length} 条线索记录？`,
                (n) => `已批量删除 ${n || selectedIds.length} 条线索记录。`,
              )
            }
            style={btn.secondary}
          >
            删除已选
          </button>

          <button type="button" onClick={() => setSelectedIds([])} style={btn.secondary}>
            取消
          </button>
        </div>
      )}

      {/* 右侧详情抽屉 */}
      <CandidateDrawer
        item={drawerItem}
        blacklistHit={drawerItem ? (blacklistMap.get(drawerItem.id) ?? null) : null}
        busy={busy}
        adopting={drawerItem ? adoptingId === drawerItem.id : false}
        unadopting={drawerItem ? unadoptingId === drawerItem.id : false}
        promoting={drawerItem ? promotingId === drawerItem.id : false}
        unpromoting={drawerItem ? unpromotingId === drawerItem.id : false}
        deleting={drawerItem ? deletingId === drawerItem.id : false}
        onClose={() => setDrawerCandidateId(null)}
        onAdopt={(id) => void handleAdopt([id])}
        onUnadopt={(target) => void handleUnadopt(target)}
        onPromote={(id) => void handlePromote(id)}
        onUnpromote={(target) => void handleUnpromote(target)}
        onEliminate={(id, reason, note) => void handleEliminateToBlacklist([id], reason, note)}
        onDelete={(target) => void handleDeleteSingle(target)}
      />
    </div>
  );
}
