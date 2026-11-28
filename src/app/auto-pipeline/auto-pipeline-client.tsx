"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  AutoCandidateResult,
  AutoGrade,
  AutoPipelineRunSummary,
  DeliveryMethodCode,
  PlatformPipelineConfig,
} from "@/lib/auto-pipeline/types";
import { CandidateCard } from "./candidate-card";
import { PlatformConfigEditor } from "./platform-config-editor";

const GRADE_TABS: Array<{ key: AutoGrade | "ALL"; label: string }> = [
  { key: "ALL", label: "全部候选" },
  { key: "S", label: "S 级 · 优先找厂" },
  { key: "A", label: "A 级 · 复核报价" },
  { key: "B", label: "B 级 · 补扫竞品" },
  { key: "HOLD", label: "HOLD · 待观察" },
  { key: "ELIMINATED", label: "已淘汰" },
];

const DELIVERY_LABELS: Record<DeliveryMethodCode, string> = {
  flatfile_tsv: "Flat File TSV",
  shopify_csv: "Shopify Draft CSV",
  extension_autofill: "扩展半自动填表",
  api_draft: "官方 API 草稿",
};

function formatRunTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

export function AutoPipelineClient(props: {
  initialConfigs: PlatformPipelineConfig[];
  initialRuns: AutoPipelineRunSummary[];
  initialCandidates: AutoCandidateResult[];
  initialPlatform: string;
  initialMarket: string;
  initialRunId: string;
}) {
  const [configs, setConfigs] = useState<PlatformPipelineConfig[]>(props.initialConfigs);
  const [runs, setRuns] = useState<AutoPipelineRunSummary[]>(props.initialRuns);
  const [candidates, setCandidates] = useState<AutoCandidateResult[]>(props.initialCandidates);

  const defaultConfigKey = `${props.initialPlatform}:${props.initialMarket}`;
  const [selectedConfigId, setSelectedConfigId] = useState<string>(
    props.initialConfigs.some((c) => c.id === defaultConfigKey)
      ? defaultConfigKey
      : (props.initialConfigs[0]?.id ?? "amazon:US"),
  );
  const [selectedRunId, setSelectedRunId] = useState<string>(props.initialRunId || "");
  const [activeGrade, setActiveGrade] = useState<AutoGrade | "ALL">("ALL");
  const [hidePromoted, setHidePromoted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [deletingCandidateId, setDeletingCandidateId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [renamingRunId, setRenamingRunId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const activeConfig = useMemo(
    () => configs.find((c) => c.id === selectedConfigId) ?? configs[0],
    [configs, selectedConfigId],
  );

  const platformRuns = useMemo(() => {
    if (!activeConfig) return runs;
    return runs.filter(
      (r) => r.platformCode === activeConfig.platformCode && r.marketCode === activeConfig.marketCode,
    );
  }, [runs, activeConfig]);

  const activeRun = useMemo(
    () => (selectedRunId ? platformRuns.find((r) => r.id === selectedRunId) ?? null : null),
    [platformRuns, selectedRunId],
  );

  const fetchPipelineView = async (opts: { platformCode: string; marketCode: string; runId: string }) => {
    setLoadingRun(true);
    try {
      const qs = new URLSearchParams({ platform: opts.platformCode, market: opts.marketCode });
      if (opts.runId) qs.set("runId", opts.runId);
      const res = await fetch(`/api/auto-pipeline?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "刷新自动选品池失败");
      setConfigs(data.configs ?? []);
      setRuns(data.runs ?? []);
      setCandidates(opts.runId ? (data.candidates ?? []) : []);
      setSelectedIds([]);
    } finally {
      setLoadingRun(false);
    }
  };

  const handleSelectPlatform = async (nextConfigId: string) => {
    setSelectedConfigId(nextConfigId);
    setRenamingRunId(null);
    setSelectedIds([]);
    const cfg = configs.find((c) => c.id === nextConfigId);
    if (!cfg) return;
    const nextRunId =
      runs.find((r) => r.platformCode === cfg.platformCode && r.marketCode === cfg.marketCode)?.id ?? "";
    setSelectedRunId(nextRunId);
    try {
      await fetchPipelineView({ platformCode: cfg.platformCode, marketCode: cfg.marketCode, runId: nextRunId });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "切换平台失败" });
    }
  };

  const handleSelectRun = async (nextRunId: string) => {
    if (!activeConfig) return;
    setSelectedRunId(nextRunId);
    setRenamingRunId(null);
    setSelectedIds([]);
    try {
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: nextRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "切换批次失败" });
    }
  };

  const handleCsvUpload = async (file: File | null) => {
    if (!file || !activeConfig) return;
    setBusy(true);
    setFeedback(null);
    try {
      const csv = await file.text();
      const res = await fetch("/api/auto-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformCode: activeConfig.platformCode,
          marketCode: activeConfig.marketCode,
          sourceType: "csv",
          sourceLabel: file.name,
          csv,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "CSV 自动选品运行失败");
      const newRunId: string = data.run?.id || "";
      setSelectedRunId(newRunId);
      setActiveGrade("ALL");
      setFeedback({
        kind: "ok",
        text: `已自动处理 ${data.run.totalSeeds} 条候选并切换到本批次：S 级 ${data.run.sCount}、A 级 ${data.run.aCount}、B 级 ${data.run.bCount}、HOLD ${data.run.holdCount}、淘汰 ${data.run.eliminatedCount}（估算快筛，人工补真实报价后才可签发 GO）。`,
      });
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: newRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "上传失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleScanInbox = async () => {
    if (!activeConfig) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auto-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformCode: activeConfig.platformCode,
          marketCode: activeConfig.marketCode,
          sourceType: "inbox",
          inboxDir: activeConfig.inboxDir,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "扫描收件箱失败");
      const newRunId: string = data.run?.id || "";
      setSelectedRunId(newRunId);
      setActiveGrade("ALL");
      setFeedback({
        kind: "ok",
        text: `已扫描 ${data.filesRead?.length ?? 0} 个 CSV 文件，共入池 ${data.run.totalSeeds} 条（S 级 ${data.run.sCount} / A 级 ${data.run.aCount}），已切换到本批次。`,
      });
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: newRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "扫描失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async (nextConfig: PlatformPipelineConfig) => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auto-pipeline/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextConfig),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存配置失败");
      setShowConfigEditor(false);
      setFeedback({ kind: "ok", text: `已保存 ${data.config.label} 的选品费率、分级阈值与半自动上架策略。` });
      await fetchPipelineView({
        platformCode: nextConfig.platformCode,
        marketCode: nextConfig.marketCode,
        runId: selectedRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCustomPlatform = async (input: {
    platformCode: string;
    marketCode: string;
    currency: string;
  }) => {
    setBusy(true);
    setFeedback(null);
    try {
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
      setSelectedConfigId(data.config.id);
      setSelectedRunId("");
      setShowConfigEditor(false);
      await fetchPipelineView({
        platformCode: data.config.platformCode,
        marketCode: data.config.marketCode,
        runId: "",
      });
      setFeedback({ kind: "ok", text: `已新增平台配置 ${data.config.label}，后续可直接切换使用。` });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "新增失败" });
    } finally {
      setBusy(false);
    }
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
      if (!res.ok) throw new Error(data.error || "推进案卷失败");
      setFeedback({
        kind: "ok",
        text: data.alreadyExisted
          ? "该候选已关联正式商品案卷，已为你刷新入口。"
          : "已推进为正式商品案卷（初始状态 HOLD，待录真实报价并定标后可签发 GO）。",
      });
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: selectedRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "推进失败" });
    } finally {
      setPromotingId(null);
    }
  };

  const handleRenameRun = async (runId: string) => {
    if (!activeConfig || !renameDraft.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLabel: renameDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重命名批次失败");
      setRenamingRunId(null);
      setFeedback({ kind: "ok", text: `批次已重命名为「${data.run.sourceLabel}」。` });
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: selectedRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "重命名失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteRun = async (run: AutoPipelineRunSummary) => {
    if (!activeConfig) return;
    if (
      !window.confirm(
        `确认删除批次「${run.sourceLabel}」（共 ${run.totalSeeds} 条候选）？\n\n仅删除该批次的选品快照，不会影响已推进生成的正式商品案卷。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除批次失败");
      const remaining = platformRuns.filter((r) => r.id !== run.id);
      const nextRunId = selectedRunId === run.id ? (remaining[0]?.id ?? "") : selectedRunId;
      setSelectedRunId(nextRunId);
      setRenamingRunId(null);
      setFeedback({
        kind: "ok",
        text: `已删除批次「${run.sourceLabel}」（移除 ${data.deletedCandidates ?? run.totalSeeds} 条快照，正式案卷不受影响）。`,
      });
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: nextRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "删除批次失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSingleCandidate = async (item: AutoCandidateResult) => {
    if (!activeConfig || !selectedRunId) return;
    if (
      !window.confirm(
        `确认从当前批次删除「${item.externalId} · ${item.title.slice(0, 48)}」？\n（不影响已推进的正式商品案卷）。`,
      )
    ) {
      return;
    }
    setDeletingCandidateId(item.id);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/auto-pipeline/candidates/${encodeURIComponent(item.id)}?runId=${encodeURIComponent(selectedRunId)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除候选记录失败");
      setFeedback({ kind: "ok", text: `已移除候选 ${item.externalId}。` });
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: selectedRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "删除失败" });
    } finally {
      setDeletingCandidateId(null);
    }
  };

  const handleBulkDeleteSelected = async () => {
    if (!activeConfig || !selectedRunId || selectedIds.length === 0) return;
    if (
      !window.confirm(
        `确认从当前批次批量删除已勾选的 ${selectedIds.length} 条候选记录？\n不影响已推进生成的正式商品案卷。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auto-pipeline/candidates/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: selectedIds,
          runId: selectedRunId,
          platformCode: activeConfig.platformCode,
          marketCode: activeConfig.marketCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "批量删除失败");
      setFeedback({ kind: "ok", text: `已批量删除 ${data.deletedCount ?? selectedIds.length} 条候选记录。` });
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: selectedRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "批量删除失败" });
    } finally {
      setBusy(false);
    }
  };

  const handleCleanupEliminated = async () => {
    if (!activeConfig || !selectedRunId || gradeCounts.ELIMINATED === 0) return;
    if (
      !window.confirm(
        `确认一键清理当前批次下的 ${gradeCounts.ELIMINATED} 条「已淘汰」记录？\n不影响其他分级和已推进的正式商品案卷。`,
      )
    ) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/auto-pipeline/candidates/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade: "ELIMINATED",
          runId: selectedRunId,
          platformCode: activeConfig.platformCode,
          marketCode: activeConfig.marketCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "清理已淘汰记录失败");
      if (activeGrade === "ELIMINATED") setActiveGrade("ALL");
      setFeedback({ kind: "ok", text: `已清理 ${data.deletedCount ?? 0} 条「已淘汰」候选记录。` });
      await fetchPipelineView({
        platformCode: activeConfig.platformCode,
        marketCode: activeConfig.marketCode,
        runId: selectedRunId,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "清理失败" });
    } finally {
      setBusy(false);
    }
  };

  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      if (activeConfig && (c.platformCode !== activeConfig.platformCode || c.marketCode !== activeConfig.marketCode)) {
        return false;
      }
      if (activeGrade !== "ALL" && c.grade !== activeGrade) return false;
      if (hidePromoted && c.promotedCaseId) return false;
      return true;
    });
  }, [candidates, activeConfig, activeGrade, hidePromoted]);

  const gradeCounts = useMemo(() => {
    const map: Record<AutoGrade, number> = { S: 0, A: 0, B: 0, HOLD: 0, ELIMINATED: 0 };
    for (const c of candidates) {
      if (activeConfig && (c.platformCode !== activeConfig.platformCode || c.marketCode !== activeConfig.marketCode)) {
        continue;
      }
      if (hidePromoted && c.promotedCaseId) continue;
      map[c.grade] += 1;
    }
    return map;
  }, [candidates, activeConfig, hidePromoted]);

  const allFilteredSelected =
    filteredCandidates.length > 0 && filteredCandidates.every((c) => selectedIds.includes(c.id));

  const toggleSelectAllFiltered = () => {
    setSelectedIds(allFilteredSelected ? [] : filteredCandidates.map((c) => c.id));
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 顶部标题与平台切换 */}
      <section
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>
              自动选品池 · 多平台可配置流水线
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              无需 Keepa Key：支持卖家精灵/H10 CSV 上传、本地收件箱扫描与 Chrome 扩展一键推送。按批次独立留存历史快照，自动执行市场格局快筛、目标净利率采购上限反推与 S/A/B 分级；<strong>严禁自动签发 GO</strong>，人工核实报价并定标后进入半自动上架。
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={selectedConfigId}
              onChange={(e) => void handleSelectPlatform(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {configs.map((cfg) => (
                <option key={cfg.id} value={cfg.id}>
                  {cfg.label} ({cfg.currency})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowConfigEditor((v) => !v)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              配置当前平台规则
            </button>
          </div>
        </div>

        {/* 快捷摄入操作区 */}
        {activeConfig && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              padding: 14,
              borderRadius: 10,
              background: "var(--surface-subtle)",
              border: "1px solid var(--line)",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 8,
                background: "var(--accent)",
                color: "var(--paper)",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <span>上传候选 CSV 自动跑批</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  void handleCsvUpload(file);
                  e.target.value = "";
                }}
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleScanInbox()}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--paper)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              扫描收件箱目录 ({activeConfig.inboxDir || `.data/inbox-csv/${activeConfig.platformCode}-${activeConfig.marketCode}`})
            </button>

            <div style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
              目标净利率门禁：<strong>{(activeConfig.economicsDefaults.targetMarginRate * 100).toFixed(0)}%</strong> · S 级线：<strong>≥{(activeConfig.thresholds.sGradeMinMargin * 100).toFixed(0)}%</strong> · 交付方式：{activeConfig.deliveryMethods.map((m) => DELIVERY_LABELS[m] || m).join(" / ")}
            </div>
          </div>
        )}

        {feedback && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: feedback.kind === "ok" ? "var(--green-soft)" : "var(--red-soft)",
              color: feedback.kind === "ok" ? "var(--green)" : "var(--red)",
              border: `1px solid ${feedback.kind === "ok" ? "var(--green)" : "var(--red)"}`,
            }}
          >
            {feedback.text}
          </div>
        )}
      </section>

      {/* 平台规则配置编辑器 */}
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
      <section
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>查看批次：</span>
            <select
              value={selectedRunId}
              disabled={loadingRun || busy || platformRuns.length === 0}
              onChange={(e) => void handleSelectRun(e.target.value)}
              style={{
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                color: "var(--ink)",
                fontSize: 13,
                fontWeight: 600,
                maxWidth: 420,
              }}
            >
              {platformRuns.length === 0 ? (
                <option value="">暂无选品批次</option>
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

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={
                activeConfig
                  ? `/auto-pipeline/history?platform=${encodeURIComponent(activeConfig.platformCode)}&market=${encodeURIComponent(activeConfig.marketCode)}`
                  : "/auto-pipeline/history"
              }
              style={{
                padding: "6px 12px",
                borderRadius: 7,
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                color: "var(--ink)",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              历史选品 ({platformRuns.length})
            </Link>

            {activeRun &&
              (renamingRunId === activeRun.id ? (
                <>
                  <input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    placeholder="输入批次备注名"
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--accent)",
                      background: "var(--surface-subtle)",
                      color: "var(--ink)",
                      fontSize: 12,
                      width: 200,
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy || !renameDraft.trim()}
                    onClick={() => void handleRenameRun(activeRun.id)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "none",
                      background: "var(--accent)",
                      color: "var(--paper)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingRunId(null)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--line)",
                      background: "var(--surface-subtle)",
                      color: "var(--muted)",
                      fontSize: 12,
                    }}
                  >
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
                    style={{
                      padding: "6px 10px",
                      borderRadius: 7,
                      border: "1px solid var(--line)",
                      background: "var(--surface-subtle)",
                      color: "var(--ink)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    重命名此批
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDeleteRun(activeRun)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 7,
                      border: "1px solid var(--red)",
                      background: "var(--red-soft)",
                      color: "var(--red)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    删除此批
                  </button>
                </>
              ))}
          </div>
        </div>

        {/* 最近批次快捷胶囊 */}
        {platformRuns.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {platformRuns.slice(0, 6).map((r, idx) => {
              const isSelected = selectedRunId === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={loadingRun}
                  onClick={() => void handleSelectRun(r.id)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 8,
                    border: `1px solid ${isSelected ? "var(--accent)" : "var(--line)"}`,
                    background: isSelected ? "var(--accent-soft)" : "var(--surface-subtle)",
                    color: isSelected ? "var(--accent)" : "var(--ink)",
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 500,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>
                    {idx === 0 ? "最新 · " : ""}
                    {r.sourceLabel}
                  </span>
                  <span style={{ opacity: 0.75 }}>({r.totalSeeds})</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 分级统计 Tab 与批量清理工具栏 */}
      <section style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {GRADE_TABS.map((tab) => {
            const count =
              tab.key === "ALL"
                ? Object.values(gradeCounts).reduce((a, b) => a + b, 0)
                : gradeCounts[tab.key];
            const active = activeGrade === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveGrade(tab.key);
                  setSelectedIds([]);
                }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                  background: active ? "var(--accent-soft)" : "var(--paper)",
                  color: active ? "var(--accent)" : "var(--ink)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--muted)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={hidePromoted}
              onChange={(e) => {
                setHidePromoted(e.target.checked);
                setSelectedIds([]);
              }}
            />
            隐藏已推进案卷
          </label>

          {filteredCandidates.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              style={{
                padding: "6px 10px",
                borderRadius: 7,
                border: "1px solid var(--line)",
                background: "var(--paper)",
                color: "var(--ink)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {allFilteredSelected ? "取消全选" : `全选当前 (${filteredCandidates.length})`}
            </button>
          )}

          {selectedIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleBulkDeleteSelected()}
              style={{
                padding: "6px 12px",
                borderRadius: 7,
                border: "1px solid var(--red)",
                background: "var(--red-soft)",
                color: "var(--red)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              删除已选 ({selectedIds.length})
            </button>
          )}

          {gradeCounts.ELIMINATED > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCleanupEliminated()}
              style={{
                padding: "6px 12px",
                borderRadius: 7,
                border: "1px solid var(--amber)",
                background: "var(--amber-soft)",
                color: "var(--amber)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              一键清理已淘汰 ({gradeCounts.ELIMINATED})
            </button>
          )}
        </div>
      </section>

      {/* 候选列表 */}
      <section
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {filteredCandidates.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            当前批次/分级下暂无候选品。你可以点击上方「上传候选 CSV 自动跑批」、点「历史选品」切换其他批次，或在 Amazon 搜索页打开 Chrome 扩展点击「推送本页到自动选品池」。
          </div>
        ) : (
          filteredCandidates.map((item) => (
            <CandidateCard
              key={item.id}
              item={item}
              checked={selectedIds.includes(item.id)}
              busy={busy}
              promoting={promotingId === item.id}
              deleting={deletingCandidateId === item.id}
              onToggleSelect={toggleSelectOne}
              onPromote={(id) => void handlePromote(id)}
              onDelete={(target) => void handleDeleteSingleCandidate(target)}
            />
          ))
        )}
      </section>
    </div>
  );
}
