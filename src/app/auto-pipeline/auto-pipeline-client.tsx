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
import { btn, feedbackStyle, formatRunTime, inputStyle, panelStyle, pillStyle, rowBetweenStyle, rowStyle } from "./ui-styles";

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

export function AutoPipelineClient(props: {
  initialConfigs: PlatformPipelineConfig[];
  initialRuns: AutoPipelineRunSummary[];
  initialCandidates: AutoCandidateResult[];
  initialPlatform: string;
  initialMarket: string;
  initialRunId: string;
}) {
  const [configs, setConfigs] = useState(props.initialConfigs);
  const [runs, setRuns] = useState(props.initialRuns);
  const [candidates, setCandidates] = useState(props.initialCandidates);

  const defaultConfigKey = `${props.initialPlatform}:${props.initialMarket}`;
  const [selectedConfigId, setSelectedConfigId] = useState(
    props.initialConfigs.some((c) => c.id === defaultConfigKey) ? defaultConfigKey : (props.initialConfigs[0]?.id ?? "amazon:US"),
  );
  const [selectedRunId, setSelectedRunId] = useState(props.initialRunId || "");
  const [activeGrade, setActiveGrade] = useState<AutoGrade | "ALL">("ALL");
  const [hidePromoted, setHidePromoted] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [unpromotingId, setUnpromotingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [renamingRunId, setRenamingRunId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const activeConfig = useMemo(() => configs.find((c) => c.id === selectedConfigId) ?? configs[0], [configs, selectedConfigId]);

  const platformRuns = useMemo(
    () => (activeConfig ? runs.filter((r) => r.platformCode === activeConfig.platformCode && r.marketCode === activeConfig.marketCode) : runs),
    [runs, activeConfig],
  );

  const activeRun = useMemo(() => (selectedRunId ? platformRuns.find((r) => r.id === selectedRunId) ?? null : null), [platformRuns, selectedRunId]);

  const fetchView = async (platformCode: string, marketCode: string, runId: string) => {
    setLoadingRun(true);
    try {
      const qs = new URLSearchParams({ platform: platformCode, market: marketCode });
      if (runId) qs.set("runId", runId);
      const res = await fetch(`/api/auto-pipeline?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "刷新自动选品失败");
      setConfigs(data.configs ?? []);
      setRuns(data.runs ?? []);
      setCandidates(runId ? (data.candidates ?? []) : []);
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

  const handleSelectPlatform = async (nextConfigId: string) => {
    setSelectedConfigId(nextConfigId);
    setRenamingRunId(null);
    setSelectedIds([]);
    const cfg = configs.find((c) => c.id === nextConfigId);
    if (!cfg) return;
    const nextRunId = runs.find((r) => r.platformCode === cfg.platformCode && r.marketCode === cfg.marketCode)?.id ?? "";
    setSelectedRunId(nextRunId);
    try {
      await fetchView(cfg.platformCode, cfg.marketCode, nextRunId);
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
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, nextRunId);
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "切换批次失败" });
    }
  };

  const handleIngest = (payload: Record<string, unknown>, onOk: (data: Record<string, unknown>) => string, fallbackErr: string) => {
    if (!activeConfig) return;
    void withBusy(async () => {
      const res = await fetch("/api/auto-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformCode: activeConfig.platformCode, marketCode: activeConfig.marketCode, ...payload }),
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
        return `已自动处理 ${r.totalSeeds} 条候选并切换到本批次：S 级 ${r.sCount}、A 级 ${r.aCount}、B 级 ${r.bCount}、HOLD ${r.holdCount}、淘汰 ${r.eliminatedCount}（估算快筛，人工补真实报价后才可签发 GO）。`;
      },
      "CSV 自动选品运行失败",
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
      setFeedback({ kind: "ok", text: `已保存 ${data.config.label} 的选品费率、分级阈值与半自动上架策略。` });
      await fetchView(nextConfig.platformCode, nextConfig.marketCode, selectedRunId);
    }, "保存失败");

  const handleCreateCustomPlatform = (input: { platformCode: string; marketCode: string; currency: string }) =>
    withBusy(async () => {
      const res = await fetch("/api/auto-pipeline/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, label: `${input.platformCode.toUpperCase()} (${input.marketCode})` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建平台配置失败");
      setSelectedConfigId(data.config.id);
      setSelectedRunId("");
      setShowConfigEditor(false);
      await fetchView(data.config.platformCode, data.config.marketCode, "");
      setFeedback({ kind: "ok", text: `已新增平台配置 ${data.config.label}，后续可直接切换使用。` });
    }, "新增失败");

  const handlePromote = async (candidateId: string) => {
    if (!activeConfig) return;
    setPromotingId(candidateId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/candidates/${encodeURIComponent(candidateId)}/promote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "推进案卷失败");
      setFeedback({
        kind: "ok",
        text: data.alreadyExisted ? "该候选已关联正式商品案卷，已为你刷新入口。" : "已推进为正式商品案卷（初始状态 HOLD，待录真实报价并定标后可签发 GO）。",
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
    if (!window.confirm(`确认取消推进「${item.externalId} · ${item.title.slice(0, 48)}」？\n\n若该案卷刚推进尚未录入报价/证据/文案，将同步删除该空案卷；若已有业务数据，将保留正式案卷仅解除关联。`)) return;
    setUnpromotingId(item.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/candidates/${encodeURIComponent(item.id)}/promote`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "取消推进失败");
      setFeedback({
        kind: "ok",
        text: data.caseDeleted
          ? `已取消推进 ${item.externalId}，并同步移除了刚创建的空白商品案卷。`
          : `已解除 ${item.externalId} 的推进关联（原正式案卷已包含业务数据，已为你保留）。`,
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
    if (!window.confirm(`确认删除批次「${run.sourceLabel}」（共 ${run.totalSeeds} 条候选）？\n\n仅删除该批次的选品快照，不会影响已推进生成的正式商品案卷。`)) return;
    void withBusy(async () => {
      const res = await fetch(`/api/auto-pipeline/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除批次失败");
      const nextRunId = selectedRunId === run.id ? (platformRuns.find((r) => r.id !== run.id)?.id ?? "") : selectedRunId;
      setSelectedRunId(nextRunId);
      setRenamingRunId(null);
      setFeedback({ kind: "ok", text: `已删除批次「${run.sourceLabel}」（移除 ${data.deletedCandidates ?? run.totalSeeds} 条快照）。` });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, nextRunId);
    }, "删除批次失败");
  };

  const handleDeleteSingle = async (item: AutoCandidateResult) => {
    if (!activeConfig || !selectedRunId) return;
    if (!window.confirm(`确认从当前批次删除「${item.externalId} · ${item.title.slice(0, 48)}」？（不影响已推进的正式商品案卷）`)) return;
    setDeletingId(item.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/candidates/${encodeURIComponent(item.id)}?runId=${encodeURIComponent(selectedRunId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除候选记录失败");
      setFeedback({ kind: "ok", text: `已移除候选 ${item.externalId}。` });
      await fetchView(activeConfig.platformCode, activeConfig.marketCode, selectedRunId);
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "删除失败" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleCleanup = (payload: { ids?: string[]; grade?: AutoGrade }, confirmMsg: string, okMsg: (n: number) => string) => {
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

  const filteredCandidates = useMemo(
    () =>
      candidates.filter((c) => {
        if (activeConfig && (c.platformCode !== activeConfig.platformCode || c.marketCode !== activeConfig.marketCode)) return false;
        if (activeGrade !== "ALL" && c.grade !== activeGrade) return false;
        return !(hidePromoted && c.promotedCaseId);
      }),
    [candidates, activeConfig, activeGrade, hidePromoted],
  );

  const gradeCounts = useMemo(() => {
    const map: Record<AutoGrade, number> = { S: 0, A: 0, B: 0, HOLD: 0, ELIMINATED: 0 };
    for (const c of candidates) {
      if (activeConfig && (c.platformCode !== activeConfig.platformCode || c.marketCode !== activeConfig.marketCode)) continue;
      if (hidePromoted && c.promotedCaseId) continue;
      map[c.grade] += 1;
    }
    return map;
  }, [candidates, activeConfig, hidePromoted]);

  const allSelected = filteredCandidates.length > 0 && filteredCandidates.every((c) => selectedIds.includes(c.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ ...panelStyle, padding: 20, gap: 14 }}>
        <div style={{ ...rowBetweenStyle, alignItems: "flex-start" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>自动选品 · 多平台可配置流水线</h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              无需 Keepa Key：支持卖家精灵/H10 CSV 上传、本地收件箱扫描与 Chrome 扩展一键推送。按批次独立留存历史快照，自动执行市场格局快筛、目标净利率采购上限反推与 S/A/B 分级；<strong>严禁自动签发 GO</strong>，人工核实报价并定标后进入半自动上架。
            </p>
          </div>
          <div style={rowStyle}>
            <select value={selectedConfigId} onChange={(e) => void handleSelectPlatform(e.target.value)} style={{ ...inputStyle, padding: "8px 12px", fontWeight: 600 }}>
              {configs.map((cfg) => (
                <option key={cfg.id} value={cfg.id}>{cfg.label} ({cfg.currency})</option>
              ))}
            </select>
            <button type="button" onClick={() => setShowConfigEditor((v) => !v)} style={{ ...btn.secondary, padding: "8px 14px", fontSize: 13 }}>
              配置当前平台规则
            </button>
          </div>
        </div>

        {activeConfig && (
          <div style={{ ...rowStyle, gap: 12, padding: 14, borderRadius: 10, background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
            <label style={{ ...btn.primary, padding: "8px 14px", fontSize: 13, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
              <span>上传候选 CSV 自动跑批</span>
              <input type="file" accept=".csv,text/csv" disabled={busy} style={{ display: "none" }} onChange={(e) => { void handleCsvUpload(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </label>
            <button type="button" disabled={busy} onClick={handleScanInbox} style={{ ...btn.secondary, padding: "8px 14px", fontSize: 13 }}>
              扫描收件箱目录 ({activeConfig.inboxDir || `.data/inbox-csv/${activeConfig.platformCode}-${activeConfig.marketCode}`})
            </button>
            <div style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
              目标净利率门禁：<strong>{(activeConfig.economicsDefaults.targetMarginRate * 100).toFixed(0)}%</strong> · S 级线：<strong>≥{(activeConfig.thresholds.sGradeMinMargin * 100).toFixed(0)}%</strong> · 交付方式：{activeConfig.deliveryMethods.map((m) => DELIVERY_LABELS[m] || m).join(" / ")}
            </div>
          </div>
        )}

        {feedback && <div style={feedbackStyle(feedback.kind)}>{feedback.text}</div>}
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
                <option value="">暂无选品批次</option>
              ) : (
                platformRuns.map((r, idx) => (
                  <option key={r.id} value={r.id}>
                    {idx === 0 ? "[最新] " : ""}{r.sourceLabel} · {formatRunTime(r.createdAt)} · 共 {r.totalSeeds} 条 (S:{r.sCount} / A:{r.aCount})
                  </option>
                ))
              )}
            </select>
            {loadingRun && <span style={{ fontSize: 12, color: "var(--muted)" }}>加载中…</span>}
          </div>

          <div style={rowStyle}>
            <Link
              href={activeConfig ? `/auto-pipeline/history?platform=${encodeURIComponent(activeConfig.platformCode)}&market=${encodeURIComponent(activeConfig.marketCode)}` : "/auto-pipeline/history"}
              style={btn.secondary}
            >
              历史选品 ({platformRuns.length})
            </Link>

            {activeRun &&
              (renamingRunId === activeRun.id ? (
                <>
                  <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} placeholder="输入批次备注名" style={{ ...inputStyle, width: 200, fontSize: 12, border: "1px solid var(--accent)" }} />
                  <button type="button" disabled={busy || !renameDraft.trim()} onClick={() => handleRenameRun(activeRun.id)} style={btn.primary}>保存</button>
                  <button type="button" onClick={() => setRenamingRunId(null)} style={btn.secondary}>取消</button>
                </>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => { setRenamingRunId(activeRun.id); setRenameDraft(activeRun.sourceLabel); }} style={btn.secondary}>重命名此批</button>
                  <button type="button" disabled={busy} onClick={() => handleDeleteRun(activeRun)} style={btn.danger}>删除此批</button>
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
                {idx === 0 ? "最新 · " : ""}{r.sourceLabel} <span style={{ opacity: 0.75 }}>({r.totalSeeds})</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 分级 Tab 与批量操作 */}
      <section style={rowBetweenStyle}>
        <div style={rowStyle}>
          {GRADE_TABS.map((tab) => {
            const count = tab.key === "ALL" ? Object.values(gradeCounts).reduce((a, b) => a + b, 0) : gradeCounts[tab.key];
            return (
              <button key={tab.key} type="button" onClick={() => { setActiveGrade(tab.key); setSelectedIds([]); }} style={{ ...pillStyle(activeGrade === tab.key), padding: "8px 14px", fontSize: 13 }}>
                {tab.label} ({count})
              </button>
            );
          })}
        </div>

        <div style={rowStyle}>
          <label style={{ ...rowStyle, gap: 6, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={hidePromoted} onChange={(e) => { setHidePromoted(e.target.checked); setSelectedIds([]); }} />
            隐藏已推进案卷
          </label>
          {filteredCandidates.length > 0 && (
            <button type="button" onClick={() => setSelectedIds(allSelected ? [] : filteredCandidates.map((c) => c.id))} style={btn.secondary}>
              {allSelected ? "取消全选" : `全选当前 (${filteredCandidates.length})`}
            </button>
          )}
          {selectedIds.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                handleCleanup(
                  { ids: selectedIds },
                  `确认从当前批次批量删除已勾选的 ${selectedIds.length} 条候选记录？\n不影响已推进生成的正式商品案卷。`,
                  (n) => `已批量删除 ${n || selectedIds.length} 条候选记录。`,
                )
              }
              style={btn.danger}
            >
              删除已选 ({selectedIds.length})
            </button>
          )}
          {gradeCounts.ELIMINATED > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                handleCleanup(
                  { grade: "ELIMINATED" },
                  `确认一键清理当前批次下的 ${gradeCounts.ELIMINATED} 条「已淘汰」记录？\n不影响其他分级和已推进的正式商品案卷。`,
                  (n) => `已清理 ${n} 条「已淘汰」候选记录。`,
                )
              }
              style={btn.secondary}
            >
              一键清理已淘汰 ({gradeCounts.ELIMINATED})
            </button>
          )}
        </div>
      </section>

      <section style={panelStyle}>
        {filteredCandidates.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            当前批次/分级下暂无候选品。你可以点击上方「上传候选 CSV 自动跑批」、点「历史选品」切换其他批次，或在 Amazon 搜索页打开 Chrome 扩展点击「推送本页到自动选品」。
          </div>
        ) : (
          filteredCandidates.map((item) => (
            <CandidateCard
              key={item.id}
              item={item}
              checked={selectedIds.includes(item.id)}
              busy={busy}
              promoting={promotingId === item.id}
              unpromoting={unpromotingId === item.id}
              deleting={deletingId === item.id}
              onToggleSelect={(id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
              onPromote={(id) => void handlePromote(id)}
              onUnpromote={(target) => void handleUnpromote(target)}
              onDelete={(target) => void handleDeleteSingle(target)}
            />
          ))
        )}
      </section>
    </div>
  );
}
